import MarkdownIt from "markdown-it";
import type { Block } from "../core/types.ts";
import { h } from "./dom.ts";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/** Renders one block's Markdown source to HTML. */
export function renderMarkdown(source: string): string {
  return md.render(source);
}

/** Rough pixel height guess used for `contain-intrinsic-size` before a chunk renders. */
function estimateHeight(block: Block): number {
  const lines = Math.max(
    1,
    Math.ceil(block.text.length / 70) + (block.text.match(/\n/g)?.length ?? 0),
  );
  return 20 + lines * 27;
}

const CHUNK_SIZE = 40;

export interface BlockListOptions {
  /** Called after a block's HTML is in the DOM (used to apply highlights). */
  onRender?: (el: HTMLElement, block: Block) => void;
  /** Pixel height of any fixed header, so scrolled-to blocks land below it. */
  headerOffset?: () => number;
}

/**
 * Mounts a book as nested `<section>` elements (one per heading) whose bodies
 * are split into chunks that render lazily as they approach the viewport.
 * Every block stays in the DOM, so scroll anchoring, find-in-page and text
 * selection keep working; `content-visibility: auto` skips off-screen work.
 */
export class BlockList {
  private readonly elements: HTMLElement[] = [];
  private readonly rendered = new Set<number>();
  private readonly chunkBlocks = new Map<HTMLElement, number[]>();
  private readonly observer: IntersectionObserver;
  private readonly headingSections = new Map<number, HTMLElement>();

  constructor(
    readonly root: HTMLElement,
    readonly blocks: Block[],
    private readonly opts: BlockListOptions = {},
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this.renderChunk(e.target as HTMLElement);
        }
      },
      { rootMargin: "150% 0px 150% 0px" },
    );
    this.build();
  }

  private build(): void {
    const frag = document.createDocumentFragment();
    const stack: { level: number; body: HTMLElement }[] = [];
    let body: HTMLElement = h("div", { class: "sec-body" });
    frag.appendChild(body);
    let chunk: HTMLElement | null = null;
    let chunkIndices: number[] = [];
    let chunkEstimate = 0;

    const closeChunk = (): void => {
      if (!chunk) return;
      chunk.style.setProperty("--est", `${chunkEstimate}px`);
      this.chunkBlocks.set(chunk, chunkIndices);
      this.observer.observe(chunk);
      chunk = null;
      chunkIndices = [];
      chunkEstimate = 0;
    };

    this.blocks.forEach((block, i) => {
      if (block.type === "heading") {
        closeChunk();
        while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= block.level)
          stack.pop();
        const parent = stack[stack.length - 1]?.body ?? frag;
        const headingEl = h("div", { class: "blk blk-h", dataset: { i: String(i) } });
        headingEl.innerHTML = renderMarkdown(block.md);
        const toggle = h("button", {
          class: "sec-toggle",
          type: "button",
          ariaLabel: "Collapse section",
          on: { click: () => this.toggleSection(i) },
        });
        headingEl.firstElementChild?.appendChild(toggle);
        const secBody = h("div", { class: "sec-body" });
        secBody.addEventListener("beforematch", () => {
          secBody.hidden = false;
          section.classList.remove("collapsed");
        });
        const section = h(
          "section",
          { class: "sec", dataset: { level: String(block.level), i: String(i) } },
          headingEl,
          secBody,
        );
        parent.appendChild(section);
        this.elements[i] = headingEl;
        this.rendered.add(i);
        this.headingSections.set(i, section);
        this.opts.onRender?.(headingEl, block);
        stack.push({ level: block.level, body: secBody });
        body = secBody;
        return;
      }
      if (!chunk || chunkIndices.length >= CHUNK_SIZE) {
        closeChunk();
        chunk = h("div", { class: "chunk" });
        body.appendChild(chunk);
      }
      const el = h("div", { class: `blk blk-${block.type}`, dataset: { i: String(i) } });
      chunk.appendChild(el);
      this.elements[i] = el;
      chunkIndices.push(i);
      chunkEstimate += estimateHeight(block);
    });
    closeChunk();
    this.root.replaceChildren(frag);
  }

  private renderChunk(chunk: HTMLElement): void {
    const indices = this.chunkBlocks.get(chunk);
    if (!indices) return;
    this.chunkBlocks.delete(chunk);
    this.observer.unobserve(chunk);
    for (const i of indices) this.renderBlock(i);
    chunk.classList.add("rendered");
  }

  private renderBlock(i: number): void {
    if (this.rendered.has(i)) return;
    const el = this.elements[i];
    const block = this.blocks[i];
    if (!el || !block) return;
    el.innerHTML = renderMarkdown(block.md);
    this.rendered.add(i);
    this.opts.onRender?.(el, block);
  }

  elementFor(index: number): HTMLElement | null {
    return this.elements[index] ?? null;
  }

  isRendered(index: number): boolean {
    return this.rendered.has(index);
  }

  /** Renders the chunk containing `index` (and expands collapsed ancestors). */
  ensureRendered(index: number): HTMLElement | null {
    const el = this.elements[index];
    if (!el) return null;
    const chunk = el.parentElement;
    if (chunk?.classList.contains("chunk")) this.renderChunk(chunk);
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== this.root) {
      if (node.classList.contains("sec-body") && node.hidden) {
        node.hidden = false;
        node.parentElement?.classList.remove("collapsed");
      }
      node = node.parentElement;
    }
    return el;
  }

  /** Re-runs onRender for every rendered block (e.g. after the terms change). */
  refreshRendered(): void {
    for (const i of this.rendered) {
      const el = this.elements[i];
      const block = this.blocks[i];
      if (el && block) this.opts.onRender?.(el, block);
    }
  }

  scrollTo(index: number, ratio = 0, behavior: ScrollBehavior = "auto"): void {
    const el = this.ensureRendered(index);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "instant" });
    const offset = this.opts.headerOffset?.() ?? 0;
    const delta = el.getBoundingClientRect().top - offset + ratio * el.offsetHeight;
    if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior });
  }

  /** The block at the top of the viewport, with how far it is scrolled past. */
  topBlock(): { index: number; ratio: number } | null {
    const offset = this.opts.headerOffset?.() ?? 0;
    const x = Math.floor(window.innerWidth / 2);
    for (const y of [offset + 4, offset + 40, offset + 120]) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !this.root.contains(hit)) continue;
      let blk = hit.closest<HTMLElement>(".blk");
      if (!blk) {
        const chunk = hit.closest<HTMLElement>(".chunk");
        blk =
          chunk?.querySelector<HTMLElement>(".blk") ??
          hit.closest<HTMLElement>(".sec")?.querySelector<HTMLElement>(".blk") ??
          null;
      }
      if (!blk) continue;
      const index = Number(blk.dataset.i);
      if (!Number.isFinite(index)) continue;
      const rect = blk.getBoundingClientRect();
      const ratio =
        rect.height > 0 ? Math.min(1, Math.max(0, (offset - rect.top) / rect.height)) : 0;
      return { index, ratio };
    }
    return null;
  }

  toggleSection(headingIndex: number, collapsed?: boolean): void {
    const section = this.headingSections.get(headingIndex);
    const body = section?.querySelector<HTMLElement>(":scope > .sec-body");
    if (!section || !body) return;
    const next = collapsed ?? !body.hidden;
    if (next) {
      body.setAttribute("hidden", "until-found");
      section.classList.add("collapsed");
    } else {
      body.hidden = false;
      section.classList.remove("collapsed");
    }
  }

  isCollapsed(headingIndex: number): boolean {
    return this.headingSections.get(headingIndex)?.classList.contains("collapsed") ?? false;
  }

  destroy(): void {
    this.observer.disconnect();
    this.chunkBlocks.clear();
    this.root.replaceChildren();
  }
}
