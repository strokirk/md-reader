import * as Comlink from "comlink";
import type { Block, BlockHit, FileMeta } from "../core/types.ts";
import { debounce, h, icon } from "./dom.ts";
import type { HighlightRange } from "./highlight.ts";
import { BlockList } from "./render.ts";
import type { Store } from "./store.ts";
import { TocDrawer } from "./toc.ts";

export interface ReaderActions {
  back(): void;
  openSearch(): void;
  openSettings(): void;
}

interface Cursor {
  hitIndex: number;
  rangeIndex: number;
}

export class ReaderView {
  readonly el: HTMLElement;
  private readonly header: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly crumbEl: HTMLElement;
  private readonly article: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly toc = new TocDrawer();
  private list: BlockList | null = null;
  private meta: FileMeta | null = null;
  private blocks: Block[] = [];
  private hits: BlockHit[] = [];
  private totalMatches = 0;
  private cursor: Cursor | null = null;
  private unsubscribe: (() => void) | null = null;
  private topIndex = 0;
  private searchToken = 0;

  constructor(
    private readonly store: Store,
    private readonly actions: ReaderActions,
  ) {
    this.titleEl = h("div", { class: "topbar-title small-title" });
    this.crumbEl = h("button", {
      class: "crumb",
      type: "button",
      ariaLabel: "Open table of contents",
      on: { click: () => this.openToc() },
    });
    this.header = h(
      "header",
      { class: "topbar reader-bar" },
      h(
        "button",
        {
          class: "icon-btn",
          type: "button",
          ariaLabel: "Back to library",
          on: { click: () => this.actions.back() },
        },
        icon("back"),
      ),
      h("div", { class: "topbar-center" }, this.titleEl, this.crumbEl),
      h(
        "div",
        { class: "topbar-actions" },
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            ariaLabel: "Search",
            on: { click: () => this.actions.openSearch() },
          },
          icon("search"),
        ),
      ),
    );
    this.article = h("article", { class: "book" });
    this.counter = h("button", {
      class: "counter",
      type: "button",
      on: { click: () => this.actions.openSearch() },
    });
    this.prevBtn = h(
      "button",
      {
        class: "icon-btn",
        type: "button",
        ariaLabel: "Previous match",
        on: { click: () => this.step(-1) },
      },
      icon("up"),
    );
    this.nextBtn = h(
      "button",
      {
        class: "icon-btn",
        type: "button",
        ariaLabel: "Next match",
        on: { click: () => this.step(1) },
      },
      icon("down"),
    );
    this.el = h(
      "div",
      { class: "view reader-view" },
      this.header,
      h("main", { class: "content reading" }, this.article),
      h(
        "footer",
        { class: "bottombar" },
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            ariaLabel: "Table of contents",
            on: { click: () => this.openToc() },
          },
          icon("list"),
        ),
        this.prevBtn,
        this.counter,
        this.nextBtn,
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            ariaLabel: "Display settings",
            on: { click: () => this.actions.openSettings() },
          },
          icon("text"),
        ),
      ),
      this.toc.el,
    );
    this.updateCounter();
  }

  private headerOffset(): number {
    return this.header.offsetHeight;
  }

  get fileId(): string | null {
    return this.meta?.id ?? null;
  }

  async open(fileId: string, blockIndex?: number): Promise<boolean> {
    const book = await this.store.api.getBook(fileId);
    if (!book) return false;
    this.close();
    this.meta = book.meta;
    this.blocks = book.blocks;
    this.titleEl.textContent = book.meta.title;
    this.toc.setBlocks(book.blocks);
    this.list = new BlockList(this.article, book.blocks, {
      headerOffset: () => this.headerOffset(),
      onRender: (el) => {
        if (this.store.highlighter.hasTerms) this.store.highlighter.apply(el);
        else this.store.highlighter.remove(el);
      },
    });
    this.unsubscribe = this.store.subscribe((key) => {
      if (key === "terms" || key === "combine" || key === "settings") {
        this.list?.refreshRendered();
        void this.refreshHits();
      }
    });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    const pos = blockIndex !== undefined ? { blockIndex, offsetRatio: 0 } : book.meta.lastRead;
    // Layout must exist before scrolling; wait a frame.
    await new Promise((r) => requestAnimationFrame(r));
    if (pos && pos.blockIndex < book.blocks.length) {
      this.list.scrollTo(pos.blockIndex, pos.offsetRatio);
      this.topIndex = pos.blockIndex;
    } else {
      window.scrollTo(0, 0);
      this.topIndex = 0;
    }
    this.updateCrumb();
    void this.store.api.touchFile(fileId);
    void this.refreshHits().then(() => {
      if (blockIndex !== undefined) this.jumpToBlockMatch(blockIndex);
    });
    return true;
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener("scroll", this.onScroll);
    this.savePosition.flush?.();
    this.list?.destroy();
    this.list = null;
    this.meta = null;
    this.blocks = [];
    this.hits = [];
    this.cursor = null;
    this.store.highlighter.setCurrent(null);
    this.toc.close();
  }

  private readonly onScroll = (): void => {
    this.trackPosition();
  };

  private readonly trackPosition = debounce(() => {
    const top = this.list?.topBlock();
    if (!top) return;
    this.topIndex = top.index;
    this.updateCrumb();
    this.savePosition(top.index, top.ratio);
  }, 200);

  private readonly savePosition = Object.assign(
    debounce((blockIndex: number, offsetRatio: number) => {
      if (this.meta)
        void this.store.api.setReadingPosition(this.meta.id, { blockIndex, offsetRatio });
    }, 800),
    { flush: undefined as (() => void) | undefined },
  );

  private updateCrumb(): void {
    const block = this.blocks[this.topIndex];
    const path = block?.headingPath ?? [];
    this.crumbEl.textContent = path.length > 0 ? path.join(" › ") : (this.meta?.title ?? "");
  }

  private openToc(): void {
    this.toc.open(this.topIndex, (index) => {
      this.list?.scrollTo(index, 0);
      this.topIndex = index;
      this.updateCrumb();
    });
  }

  /** Recomputes the in-book hit list for prev/next navigation. */
  private async refreshHits(): Promise<void> {
    const meta = this.meta;
    const token = ++this.searchToken;
    this.hits = [];
    this.totalMatches = 0;
    this.cursor = null;
    this.store.highlighter.setCurrent(null);
    if (!meta || this.store.activeTerms().length === 0) {
      this.updateCounter();
      return;
    }
    const query = this.store.query({ kind: "file", fileId: meta.id });
    try {
      await this.store.api.search(
        query,
        null,
        Comlink.proxy((fh) => {
          if (token !== this.searchToken) return;
          this.hits = fh.hits;
          this.totalMatches = fh.matchCount;
          this.updateCounter();
        }),
      );
    } catch {
      // A bad regex; the search panel reports it.
    }
    this.updateCounter();
  }

  private updateCounter(): void {
    const hasTerms = this.store.activeTerms().length > 0;
    this.prevBtn.disabled = this.hits.length === 0;
    this.nextBtn.disabled = this.hits.length === 0;
    if (!hasTerms) {
      this.counter.textContent = "Search";
      return;
    }
    if (this.hits.length === 0) {
      this.counter.textContent = "No matches";
      return;
    }
    const pos = this.cursor ? this.positionOf(this.cursor) : 0;
    this.counter.textContent = `${pos > 0 ? pos : "–"} / ${this.totalMatches}`;
  }

  private positionOf(c: Cursor): number {
    let n = 0;
    for (let i = 0; i < c.hitIndex; i++) n += this.hits[i]?.matches.length ?? 0;
    return n + c.rangeIndex + 1;
  }

  private rangesForHit(hitIndex: number): HighlightRange[] {
    const hit = this.hits[hitIndex];
    if (!hit || !this.list) return [];
    const el = this.list.ensureRendered(hit.blockIndex);
    if (!el) return [];
    const ranges = this.store.highlighter.rangesFor(el);
    return ranges.length > 0 ? ranges : this.store.highlighter.apply(el);
  }

  private step(direction: 1 | -1): void {
    if (this.hits.length === 0) return;
    let next: Cursor;
    if (!this.cursor) {
      // Start from the first hit at or after the current scroll position.
      let hitIndex = this.hits.findIndex((hh) => hh.blockIndex >= this.topIndex);
      if (hitIndex < 0) hitIndex = direction > 0 ? 0 : this.hits.length - 1;
      else if (direction < 0) hitIndex = Math.max(0, hitIndex - 1);
      next = {
        hitIndex,
        rangeIndex: direction > 0 ? 0 : Math.max(0, this.rangesForHit(hitIndex).length - 1),
      };
    } else {
      const { hitIndex, rangeIndex } = this.cursor;
      const count = this.rangesForHit(hitIndex).length;
      if (direction > 0 && rangeIndex + 1 < count) next = { hitIndex, rangeIndex: rangeIndex + 1 };
      else if (direction < 0 && rangeIndex > 0) next = { hitIndex, rangeIndex: rangeIndex - 1 };
      else {
        const hi = (hitIndex + direction + this.hits.length) % this.hits.length;
        next = {
          hitIndex: hi,
          rangeIndex: direction > 0 ? 0 : Math.max(0, this.rangesForHit(hi).length - 1),
        };
      }
    }
    this.goTo(next);
  }

  private jumpToBlockMatch(blockIndex: number): void {
    const hitIndex = this.hits.findIndex((hh) => hh.blockIndex === blockIndex);
    if (hitIndex >= 0) this.goTo({ hitIndex, rangeIndex: 0 });
  }

  private goTo(c: Cursor): void {
    const hit = this.hits[c.hitIndex];
    if (!hit || !this.list) return;
    this.cursor = c;
    const el = this.list.ensureRendered(hit.blockIndex);
    if (!el) return;
    this.list.scrollTo(hit.blockIndex, 0, "auto");
    const ranges = this.rangesForHit(c.hitIndex);
    const range = ranges[c.rangeIndex]?.range ?? null;
    this.store.highlighter.setCurrent(range);
    if (range) {
      const rect = range.getBoundingClientRect();
      const target = this.headerOffset() + window.innerHeight * 0.25;
      if (rect.height > 0) window.scrollBy({ top: rect.top - target, behavior: "auto" });
    }
    this.topIndex = hit.blockIndex;
    this.updateCrumb();
    this.updateCounter();
  }
}
