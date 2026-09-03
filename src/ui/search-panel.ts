import * as Comlink from "comlink";
import type { Block, BlockHit, Combine, FileHits, SavedSearch, TermSpec } from "../core/types.ts";
import { deleteSavedSearch, getSavedSearches, putSavedSearch } from "../storage/db.ts";
import { debounce, h, icon } from "./dom.ts";
import { COLOUR_SLOTS } from "./highlight.ts";
import { renderMarkdown } from "./render.ts";
import { newTerm, type Store } from "./store.ts";

export interface SearchActions {
  openBlock(fileId: string, blockIndex: number): void;
}

const GROUPS_PER_PAGE = 25;

interface HeadingGroup {
  key: string;
  path: string[];
  hits: BlockHit[];
}

export class SearchPanel {
  readonly el: HTMLElement;
  private readonly termsEl: HTMLElement;
  private readonly optionsEl: HTMLElement;
  private readonly savedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly scroller: HTMLElement;
  private searchToken = 0;
  private fileCount = 0;
  private matchCount = 0;
  private startedAt = 0;
  private isOpen = false;

  constructor(
    private readonly store: Store,
    private readonly actions: SearchActions,
  ) {
    this.termsEl = h("div", { class: "terms" });
    this.optionsEl = h("div", { class: "options" });
    this.savedEl = h("div", { class: "saved" });
    this.statusEl = h("div", { class: "status muted small" });
    this.resultsEl = h("div", { class: "results" });
    this.scroller = h(
      "div",
      { class: "panel-scroll" },
      h(
        "div",
        { class: "panel-controls" },
        this.termsEl,
        this.optionsEl,
        this.savedEl,
        this.statusEl,
      ),
      this.resultsEl,
    );
    this.el = h(
      "div",
      { class: "panel", hidden: true, role: "dialog", ariaLabel: "Search" },
      h(
        "header",
        { class: "topbar" },
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            ariaLabel: "Close search",
            on: { click: () => this.close() },
          },
          icon("close"),
        ),
        h("h1", { class: "topbar-title", text: "Search" }),
        h(
          "div",
          { class: "topbar-actions" },
          h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              ariaLabel: "Save this search",
              on: { click: () => this.promptSave() },
            },
            icon("save"),
          ),
        ),
      ),
      this.scroller,
    );
    if (this.store.state.terms.length === 0) this.store.set("terms", [newTerm("", 0)]);
    this.renderTerms();
    this.renderOptions();
    void this.loadSaved();
    store.subscribe((key) => {
      if (key === "currentFileId") this.renderOptions();
      if (key === "settings") this.runSearch();
      if (key === "savedSearches") this.renderSaved();
      if (key === "library" && this.isOpen) this.runSearch();
    });
  }

  open(): void {
    this.isOpen = true;
    this.el.hidden = false;
    document.documentElement.classList.add("modal-open");
    this.renderOptions();
    if (this.resultsEl.childElementCount === 0) this.runSearch();
    const firstEmpty = this.termsEl.querySelector<HTMLInputElement>(
      "input.term-input:placeholder-shown",
    );
    const first = firstEmpty ?? this.termsEl.querySelector<HTMLInputElement>("input.term-input");
    if (first && this.store.activeTerms().length === 0) first.focus();
  }

  close(): void {
    this.isOpen = false;
    this.el.hidden = true;
    document.documentElement.classList.remove("modal-open");
  }

  // ---- terms -------------------------------------------------------------

  private commitTerms(terms: TermSpec[]): void {
    this.store.set("terms", terms);
    this.runSearch();
  }

  /**
   * Input changes are debounced; before any re-render of the term rows, pull
   * whatever is currently typed into state so nothing is lost.
   */
  private termsFromInputs(): TermSpec[] {
    const inputs = [...this.termsEl.querySelectorAll<HTMLInputElement>("input.term-input")];
    return this.store.state.terms.map((t, i) => {
      const v = inputs[i]?.value;
      return v !== undefined && v !== t.pattern ? { ...t, pattern: v } : t;
    });
  }

  private renderTerms(): void {
    const terms = this.store.state.terms;
    const frag = document.createDocumentFragment();
    terms.forEach((term, i) => frag.appendChild(this.termRow(term, i)));
    frag.appendChild(
      h(
        "button",
        {
          class: "btn add-term",
          type: "button",
          on: {
            click: () => {
              const used = new Set(terms.map((t) => t.colour));
              let colour = 0;
              while (used.has(colour) && colour < COLOUR_SLOTS - 1) colour++;
              this.commitTerms([...this.termsFromInputs(), newTerm("", colour)]);
              this.renderTerms();
              this.termsEl.querySelector<HTMLInputElement>(".term-row:last-of-type input")?.focus();
            },
          },
        },
        icon("plus"),
        " Add term",
      ),
    );
    this.termsEl.replaceChildren(frag);
  }

  private termRow(term: TermSpec, index: number): HTMLElement {
    const update = (patch: Partial<TermSpec>): void => {
      const terms = this.termsFromInputs().map((t, i) => (i === index ? { ...t, ...patch } : t));
      this.commitTerms(terms);
    };
    const input = h("input", {
      type: "search",
      class: "input term-input",
      value: term.pattern,
      placeholder: `Term ${index + 1}`,
      attrs: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "search",
      },
    });
    const onInput = debounce(() => update({ pattern: input.value }), 180);
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        update({ pattern: input.value });
        input.blur();
      }
    });
    const toggle = (
      label: string,
      title: string,
      key: "caseSensitive" | "wholeWord" | "regex",
    ): HTMLElement =>
      h("button", {
        class: `toggle${term[key] ? " on" : ""}`,
        type: "button",
        text: label,
        title,
        attrs: { "aria-pressed": String(term[key]) },
        on: {
          click: () => {
            update({ [key]: !term[key] });
            this.renderTerms();
          },
        },
      });
    return h(
      "div",
      { class: "term-row", style: `--slot:${term.colour % COLOUR_SLOTS}` },
      h("button", {
        class: "swatch",
        type: "button",
        ariaLabel: "Change colour",
        on: {
          click: () => {
            update({ colour: (term.colour + 1) % COLOUR_SLOTS });
            this.renderTerms();
          },
        },
      }),
      input,
      h(
        "div",
        { class: "term-toggles" },
        toggle("Aa", "Match case", "caseSensitive"),
        toggle("ab", "Whole word", "wholeWord"),
        toggle(".*", "Regular expression", "regex"),
      ),
      h(
        "button",
        {
          class: "icon-btn",
          type: "button",
          ariaLabel: "Remove term",
          on: {
            click: () => {
              const terms = this.termsFromInputs().filter((_, i) => i !== index);
              this.commitTerms(terms.length > 0 ? terms : [newTerm("", 0)]);
              this.renderTerms();
            },
          },
        },
        icon("close"),
      ),
    );
  }

  // ---- options -----------------------------------------------------------

  private renderOptions(): void {
    const { combine, scope, currentFileId } = this.store.state;
    const seg = (
      options: { value: string; label: string }[],
      current: string,
      onPick: (v: string) => void,
    ): HTMLElement => {
      const group = h("div", { class: "seg", role: "radiogroup" });
      for (const o of options) {
        group.appendChild(
          h("button", {
            type: "button",
            role: "radio",
            class: `seg-btn${o.value === current ? " active" : ""}`,
            text: o.label,
            attrs: { "aria-checked": String(o.value === current) },
            on: { click: () => onPick(o.value) },
          }),
        );
      }
      return group;
    };
    const combineSeg = seg(
      [
        { value: "any", label: "Any" },
        { value: "all", label: "All" },
        { value: "all-section", label: "All in section" },
      ],
      combine,
      (v) => {
        this.store.set("combine", v as Combine);
        this.renderOptions();
        this.runSearch();
      },
    );
    const children: HTMLElement[] = [combineSeg];
    if (currentFileId) {
      children.push(
        seg(
          [
            { value: "file", label: "This book" },
            { value: "library", label: "Library" },
          ],
          scope.kind,
          (v) => {
            this.store.set(
              "scope",
              v === "file" ? { kind: "file", fileId: currentFileId } : { kind: "library" },
            );
            this.renderOptions();
            this.runSearch();
          },
        ),
      );
    } else if (scope.kind === "file") {
      this.store.set("scope", { kind: "library" });
    }
    this.optionsEl.replaceChildren(...children);
  }

  // ---- saved searches ----------------------------------------------------

  private async loadSaved(): Promise<void> {
    this.store.set("savedSearches", await getSavedSearches());
  }

  private renderSaved(): void {
    const saved = this.store.state.savedSearches;
    if (saved.length === 0) {
      this.savedEl.replaceChildren();
      return;
    }
    const frag = document.createDocumentFragment();
    for (const s of saved) {
      frag.appendChild(
        h(
          "div",
          { class: "chip" },
          h("button", {
            class: "chip-main",
            type: "button",
            text: s.name,
            on: { click: () => this.applySaved(s) },
          }),
          h(
            "button",
            {
              class: "chip-x",
              type: "button",
              ariaLabel: `Delete saved search ${s.name}`,
              on: {
                click: () => {
                  if (!confirm(`Delete saved search “${s.name}”?`)) return;
                  void deleteSavedSearch(s.id).then(() => this.loadSaved());
                },
              },
            },
            icon("close"),
          ),
        ),
      );
    }
    this.savedEl.replaceChildren(frag);
  }

  private applySaved(s: SavedSearch): void {
    this.store.set("combine", s.combine);
    this.commitTerms(s.terms.map((t) => ({ ...t, id: newTerm().id })));
    this.renderTerms();
    this.renderOptions();
  }

  private promptSave(): void {
    const terms = this.store.activeTerms();
    if (terms.length === 0) {
      this.statusEl.textContent = "Enter at least one term before saving.";
      return;
    }
    const suggested = terms.map((t) => t.pattern).join(", ");
    const nameInput = h("input", {
      type: "text",
      class: "input",
      value: suggested,
      attrs: { enterkeyhint: "done" },
    });
    const row = h(
      "div",
      { class: "save-row" },
      nameInput,
      h("button", {
        class: "btn primary",
        type: "button",
        text: "Save",
        on: { click: () => void save() },
      }),
      h("button", {
        class: "btn",
        type: "button",
        text: "Cancel",
        on: { click: () => row.remove() },
      }),
    );
    const save = async (): Promise<void> => {
      const name = nameInput.value.trim() || suggested;
      const record: SavedSearch = {
        id: `s${Date.now().toString(36)}`,
        name,
        terms: terms.map((t) => ({ ...t })),
        combine: this.store.state.combine,
        createdAt: Date.now(),
      };
      await putSavedSearch(record);
      row.remove();
      await this.loadSaved();
    };
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void save();
    });
    this.savedEl.prepend(row);
    nameInput.focus();
    nameInput.select();
  }

  // ---- search + results --------------------------------------------------

  runSearch(): void {
    const token = ++this.searchToken;
    const terms = this.store.activeTerms();
    this.resultsEl.replaceChildren();
    this.fileCount = 0;
    this.matchCount = 0;
    if (terms.length === 0) {
      this.statusEl.textContent =
        this.store.state.library.length === 0
          ? "Add books to the library to search them."
          : "Type a term to search.";
      return;
    }
    this.startedAt = performance.now();
    this.statusEl.textContent = "Searching…";
    const query = this.store.query();
    void this.store.api
      .search(
        query,
        this.store.state.currentFileId,
        Comlink.proxy((fh: FileHits) => {
          if (token !== this.searchToken) return;
          this.fileCount++;
          this.matchCount += fh.matchCount;
          this.resultsEl.appendChild(this.fileGroup(fh));
          this.updateStatus(false);
        }),
      )
      .then((searched) => {
        if (token !== this.searchToken || searched < 0) return;
        this.updateStatus(true);
      })
      .catch((err: unknown) => {
        if (token !== this.searchToken) return;
        this.statusEl.textContent = err instanceof Error ? err.message : String(err);
      });
  }

  private updateStatus(done: boolean): void {
    const ms = Math.max(1, Math.round(performance.now() - this.startedAt));
    if (this.matchCount === 0) {
      this.statusEl.textContent = done ? `No matches · ${ms} ms` : "Searching…";
      return;
    }
    this.statusEl.textContent = `${this.matchCount} match${this.matchCount === 1 ? "" : "es"} in ${this.fileCount} book${this.fileCount === 1 ? "" : "s"} · ${ms} ms${done ? "" : " …"}`;
  }

  private fileGroup(fh: FileHits): HTMLElement {
    const groups: HeadingGroup[] = [];
    for (const hit of fh.hits) {
      const key = hit.headingIds.join("/");
      const last = groups[groups.length - 1];
      if (last?.key === key) last.hits.push(hit);
      else groups.push({ key, path: hit.headingPath, hits: [hit] });
    }
    const body = h("div", { class: "file-body" });
    const head = h(
      "button",
      {
        class: "file-head",
        type: "button",
        attrs: { "aria-expanded": "true" },
        on: {
          click: () => {
            const open = body.hidden;
            body.hidden = !open;
            head.setAttribute("aria-expanded", String(open));
          },
        },
      },
      h("span", { class: "file-title", text: fh.title }),
      h("span", {
        class: "muted small",
        text: `${fh.matchCount}${fh.truncated ? "+" : ""} in ${groups.length} section${groups.length === 1 ? "" : "s"}`,
      }),
    );
    let shown = 0;
    const showMore = (): void => {
      const page = groups.slice(shown, shown + GROUPS_PER_PAGE);
      shown += page.length;
      const indices = page.flatMap((g) => g.hits.map((hit) => hit.blockIndex));
      void this.store.api.getBlocks(fh.fileId, indices).then((blocks) => {
        const byIndex = new Map(
          blocks.map((b) => [Number(b.id.slice(b.id.lastIndexOf(":") + 1)), b]),
        );
        for (const g of page) body.insertBefore(this.headingGroup(fh.fileId, g, byIndex), moreBtn);
        moreBtn.hidden = shown >= groups.length;
        moreBtn.textContent = `Show ${Math.min(GROUPS_PER_PAGE, groups.length - shown)} more sections`;
      });
    };
    const moreBtn = h("button", {
      class: "btn more",
      type: "button",
      hidden: true,
      on: { click: showMore },
    });
    body.appendChild(moreBtn);
    showMore();
    return h("section", { class: "file-group" }, head, body);
  }

  private headingGroup(
    fileId: string,
    group: HeadingGroup,
    byIndex: Map<number, Block>,
  ): HTMLElement {
    const blocksEl = h("div", { class: "group-blocks" });
    const renderHits = (): void => {
      blocksEl.replaceChildren(
        ...group.hits.map((hit) =>
          this.blockEl(fileId, hit.blockIndex, byIndex.get(hit.blockIndex)),
        ),
      );
    };
    renderHits();
    const levels: { label: string; level: number }[] = [];
    const sectionLevel = this.store.state.settings.sectionLevel;
    const depth = group.path.length;
    if (depth > 0) {
      const own = Math.min(depth, 6);
      if (own > sectionLevel) levels.push({ label: `H${own}`, level: own });
      if (sectionLevel <= depth) levels.push({ label: `H${sectionLevel}`, level: sectionLevel });
      if (sectionLevel > 1) levels.push({ label: "H1", level: 1 });
    }
    const seen = new Set<number>();
    const uniqueLevels = levels.filter((l) =>
      seen.has(l.level) ? false : (seen.add(l.level), true),
    );
    let mode = -1;
    const expandBtn = h(
      "button",
      { class: "btn small expand", type: "button", ariaLabel: "Expand to section" },
      icon("expand"),
      h("span", { text: uniqueLevels[0] ? ` ${uniqueLevels[0].label}` : " Section" }),
    );
    expandBtn.addEventListener("click", () => {
      mode++;
      if (mode >= uniqueLevels.length) {
        mode = -1;
        renderHits();
        expandBtn.querySelector("span")?.replaceChildren(` ${uniqueLevels[0]?.label ?? "Section"}`);
        return;
      }
      const target = uniqueLevels[mode];
      const first = group.hits[0];
      if (!target || !first) return;
      expandBtn.querySelector("span")?.replaceChildren(" …");
      void this.store.api.getSection(fileId, first.blockIndex, target.level).then((blocks) => {
        const map = new Map(blocks.map((b) => [Number(b.id.slice(b.id.lastIndexOf(":") + 1)), b]));
        blocksEl.replaceChildren(...[...map.entries()].map(([i, b]) => this.blockEl(fileId, i, b)));
        const nextLabel =
          mode + 1 < uniqueLevels.length ? (uniqueLevels[mode + 1]?.label ?? "") : "Hits only";
        expandBtn.querySelector("span")?.replaceChildren(` ${nextLabel}`);
      });
    });
    const crumb = h("div", { class: "group-path" });
    group.path.forEach((title, i) => {
      if (i > 0) crumb.appendChild(h("span", { class: "sep", text: "›" }));
      crumb.appendChild(
        h("span", { class: i === group.path.length - 1 ? "strong" : "", text: title }),
      );
    });
    if (group.path.length === 0)
      crumb.appendChild(h("span", { class: "muted", text: "(before first heading)" }));
    const first = group.hits[0];
    if (first)
      crumb.addEventListener("click", () => this.actions.openBlock(fileId, first.blockIndex));
    return h(
      "div",
      { class: "heading-group" },
      h("div", { class: "group-head" }, crumb, uniqueLevels.length > 0 ? expandBtn : null),
      blocksEl,
    );
  }

  private blockEl(fileId: string, index: number, block: Block | undefined): HTMLElement {
    const el = h("div", {
      class: `blk hit blk-${block?.type ?? "paragraph"}`,
      dataset: { i: String(index) },
      role: "link",
      attrs: { tabindex: "0" },
    });
    el.innerHTML = block ? renderMarkdown(block.md) : "<p class='muted'>…</p>";
    if (block?.type === "heading") el.classList.add("blk-h");
    this.store.highlighter.apply(el);
    const open = (): void => this.actions.openBlock(fileId, index);
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      open();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });
    return el;
  }
}
