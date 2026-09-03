import type { FileMeta, ImportProgress } from "../core/types.ts";
import type { ImportSource } from "../worker/api.ts";
import { formatBytes, h, icon } from "./dom.ts";
import { pickDirectory, pickFiles, supportsDirectoryPicker } from "./import.ts";
import type { Store } from "./store.ts";

export interface LibraryActions {
  openBook(fileId: string): void;
  openSearch(): void;
  openSettings(): void;
  importSources(sources: ImportSource[], handle: FileSystemDirectoryHandle | null): Promise<void>;
  resync(): Promise<void>;
  removeBook(meta: FileMeta): Promise<void>;
  clearLibrary(): Promise<void>;
}

export class LibraryView {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressBar: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly storageLine: HTMLElement;
  private readonly resyncBtn: HTMLButtonElement;
  private hasHandle = false;

  constructor(
    private readonly store: Store,
    private readonly actions: LibraryActions,
  ) {
    this.list = h("div", { class: "book-list" });
    this.progressBar = h("div", { class: "bar-fill" });
    this.progressText = h("div", { class: "muted small" });
    this.progress = h(
      "div",
      { class: "progress", hidden: true },
      h("div", { class: "bar" }, this.progressBar),
      this.progressText,
    );
    this.storageLine = h("p", { class: "muted small" });
    this.resyncBtn = h(
      "button",
      {
        class: "btn",
        type: "button",
        hidden: true,
        on: { click: () => void this.actions.resync() },
      },
      icon("refresh"),
      " Re-sync folder",
    );

    const importCard = h(
      "div",
      { class: "card import-card" },
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          { class: "btn primary", type: "button", on: { click: () => void this.pickDir() } },
          icon("folder"),
          " Add folder",
        ),
        h(
          "button",
          { class: "btn", type: "button", on: { click: () => void this.pickSome() } },
          icon("file"),
          " Add files",
        ),
        this.resyncBtn,
      ),
      h("p", {
        class: "muted small",
        text: "Markdown files (.md, .markdown, .txt). You can also drop files or folders anywhere on this page, or share files to the app.",
      }),
      this.progress,
      this.storageLine,
    );

    this.el = h(
      "div",
      { class: "view library-view" },
      h(
        "header",
        { class: "topbar" },
        h("h1", { class: "topbar-title", text: "Library" }),
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
          h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              ariaLabel: "Settings",
              on: { click: () => this.actions.openSettings() },
            },
            icon("text"),
          ),
        ),
      ),
      h("main", { class: "content" }, importCard, this.list),
    );
    store.subscribe((key) => {
      if (key === "library") this.render();
    });
  }

  setHasHandle(v: boolean): void {
    this.hasHandle = v;
    this.resyncBtn.hidden = !v;
  }

  private async pickDir(): Promise<void> {
    const pick = await pickDirectory();
    if (!pick) return;
    await this.actions.importSources(pick.sources, pick.handle);
    if (pick.handle) this.setHasHandle(true);
  }

  private async pickSome(): Promise<void> {
    const sources = await pickFiles();
    if (sources) await this.actions.importSources(sources, null);
  }

  showProgress(p: ImportProgress | null): void {
    if (!p) {
      this.progress.hidden = true;
      return;
    }
    this.progress.hidden = false;
    const pct = p.bytesTotal > 0 ? Math.round((p.bytesDone / p.bytesTotal) * 100) : 0;
    this.progressBar.style.width = `${pct}%`;
    this.progressText.textContent =
      p.phase === "done"
        ? `Imported ${p.fileCount} file${p.fileCount === 1 ? "" : "s"}`
        : `${p.phase} ${p.fileIndex + 1}/${p.fileCount}: ${p.fileName}`;
  }

  render(): void {
    const books = this.store.state.library;
    this.el.classList.toggle("empty", books.length === 0);
    if (books.length === 0) {
      this.list.replaceChildren(
        h(
          "div",
          { class: "empty-state" },
          h("p", { text: "No books yet." }),
          h("p", {
            class: "muted",
            text: supportsDirectoryPicker
              ? "Add a folder of Markdown files to start reading."
              : "Add Markdown files to start reading. On iPhone, pick them from the Files app.",
          }),
        ),
      );
    } else {
      const frag = document.createDocumentFragment();
      const sorted = [...books].sort(
        (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.path.localeCompare(b.path),
      );
      for (const meta of sorted) frag.appendChild(this.bookRow(meta));
      frag.appendChild(
        h(
          "div",
          { class: "list-footer" },
          h("span", {
            class: "muted small",
            text: `${books.length} book${books.length === 1 ? "" : "s"} · ${formatBytes(books.reduce((n, b) => n + b.size, 0))}`,
          }),
          h(
            "button",
            {
              class: "btn small danger",
              type: "button",
              on: { click: () => void this.confirmClear() },
            },
            icon("trash"),
            " Remove all",
          ),
        ),
      );
      this.list.replaceChildren(frag);
    }
    void this.store.api.storageStatus().then((st) => {
      if (st.quota > 0) {
        this.storageLine.textContent = `${formatBytes(st.usage)} of ${formatBytes(st.quota)} storage used${st.persisted ? "" : " · not yet persistent"}`;
      }
    });
  }

  private bookRow(meta: FileMeta): HTMLElement {
    const pct =
      meta.lastRead && meta.blockCount > 0
        ? Math.round((meta.lastRead.blockIndex / meta.blockCount) * 100)
        : 0;
    const details = `${formatBytes(meta.size)} · ${meta.headingCount} section${meta.headingCount === 1 ? "" : "s"}${meta.lastRead ? ` · ${pct}% read` : ""}`;
    const dir = meta.path.includes("/") ? meta.path.slice(0, meta.path.lastIndexOf("/")) : "";
    return h(
      "div",
      { class: "book-row" },
      h(
        "button",
        { class: "book-main", type: "button", on: { click: () => this.actions.openBook(meta.id) } },
        h("div", { class: "book-title", text: meta.title }),
        h("div", { class: "book-sub muted small", text: dir ? `${dir} · ${details}` : details }),
        meta.lastRead
          ? h("div", { class: "bar thin" }, h("div", { class: "bar-fill", style: `width:${pct}%` }))
          : null,
      ),
      h(
        "button",
        {
          class: "icon-btn",
          type: "button",
          ariaLabel: `Remove ${meta.title}`,
          on: {
            click: () => {
              if (confirm(`Remove “${meta.title}” from the library?`))
                void this.actions.removeBook(meta);
            },
          },
        },
        icon("trash"),
      ),
    );
  }

  private async confirmClear(): Promise<void> {
    if (confirm("Remove every book from this library? Your original files are not touched.")) {
      await this.actions.clearLibrary();
      if (this.hasHandle) this.setHasHandle(false);
    }
  }
}
