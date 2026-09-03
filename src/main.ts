import * as Comlink from "comlink";
import { registerSW } from "virtual:pwa-register";
import type { FileMeta } from "./core/types.ts";
import { clearDirectoryHandle, getDirectoryHandle, saveDirectoryHandle } from "./storage/db.ts";
import { h } from "./ui/dom.ts";
import {
  collectFromHandle,
  consumeLaunchQueue,
  ensureReadPermission,
  sourcesFromDataTransfer,
  takeSharedFiles,
} from "./ui/import.ts";
import { LibraryView } from "./ui/library-view.ts";
import { ReaderView } from "./ui/reader-view.ts";
import { SearchPanel } from "./ui/search-panel.ts";
import { SettingsSheet } from "./ui/settings-sheet.ts";
import { watchSystemTheme } from "./ui/settings.ts";
import { Store } from "./ui/store.ts";
import type { ImportSource, LibraryApi } from "./worker/api.ts";
import "./style.css";

const worker = new Worker(new URL("./worker/library.worker.ts", import.meta.url), {
  type: "module",
});
const api = Comlink.wrap<LibraryApi>(worker);
const store = new Store(api);

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");

// ---- toast -------------------------------------------------------------------
const toastEl = h("div", { class: "toast", hidden: true, role: "status" });
document.body.appendChild(toastEl);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, ms = 3500): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

// ---- navigation --------------------------------------------------------------
function go(hash: string): void {
  if (location.hash === hash) void route();
  else location.hash = hash;
}

const settings = new SettingsSheet(store);
const search = new SearchPanel(store, {
  openBlock: (fileId, blockIndex) => {
    search.close();
    if (reader.fileId === fileId) {
      void reader.open(fileId, blockIndex);
    } else {
      go(`#/book/${fileId}/${blockIndex}`);
    }
  },
});
const reader = new ReaderView(store, {
  back: () => go("#/"),
  openSearch: () => search.open(),
  openSettings: () => settings.open(),
});
const library = new LibraryView(store, {
  openBook: (id) => go(`#/book/${id}`),
  openSearch: () => search.open(),
  openSettings: () => settings.open(),
  importSources,
  resync,
  removeBook: async (meta: FileMeta) => {
    await api.removeFile(meta.id);
    await store.refreshLibrary();
    toast(`Removed ${meta.title}`);
  },
  clearLibrary: async () => {
    await api.clearLibrary();
    await clearDirectoryHandle();
    await store.refreshLibrary();
  },
});

app.append(library.el, reader.el, search.el, settings.el);

async function route(): Promise<void> {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [view, id, block] = parts;
  if (view === "book" && id) {
    const blockIndex = block !== undefined && block !== "" ? Number(block) : undefined;
    const ok = await reader.open(id, Number.isFinite(blockIndex) ? blockIndex : undefined);
    if (!ok) {
      go("#/");
      return;
    }
    store.set("currentFileId", id);
    if (store.state.scope.kind === "file") store.set("scope", { kind: "file", fileId: id });
    library.el.hidden = true;
    reader.el.hidden = false;
    document.title = `${store.fileMeta(id)?.title ?? "Book"} · MD Reader`;
    return;
  }
  reader.close();
  store.set("currentFileId", null);
  reader.el.hidden = true;
  library.el.hidden = false;
  library.render();
  document.title = "MD Reader";
  window.scrollTo(0, 0);
}

// ---- import ------------------------------------------------------------------
let importing = false;
async function importSources(
  sources: ImportSource[],
  handle: FileSystemDirectoryHandle | null,
): Promise<void> {
  if (importing) {
    toast("An import is already running");
    return;
  }
  if (sources.length === 0) {
    toast("No Markdown files found");
    return;
  }
  importing = true;
  try {
    if (handle) await saveDirectoryHandle(handle);
    if ("persist" in navigator.storage) void navigator.storage.persist();
    const outcome = await api.importFiles(
      sources,
      Comlink.proxy((p) => library.showProgress(p)),
    );
    await store.refreshLibrary();
    const quota = outcome.errors.find((e) => e.message.includes("quota"));
    if (quota) {
      toast(
        `Storage full: ${outcome.imported.length} imported, ${outcome.skipped + outcome.errors.length} skipped. Free up space in Settings › Safari › Advanced › Website Data.`,
        8000,
      );
    } else if (outcome.errors.length > 0) {
      toast(
        `Imported ${outcome.imported.length}, failed ${outcome.errors.length}: ${outcome.errors[0]?.message ?? ""}`,
        6000,
      );
    } else {
      toast(`Imported ${outcome.imported.length} file${outcome.imported.length === 1 ? "" : "s"}`);
    }
  } catch (err) {
    toast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 6000);
  } finally {
    importing = false;
    setTimeout(() => library.showProgress(null), 1500);
  }
}

async function resync(): Promise<void> {
  const handle = await getDirectoryHandle();
  if (!handle) {
    toast("No folder is linked. Use Add folder.");
    library.setHasHandle(false);
    return;
  }
  if (!(await ensureReadPermission(handle))) {
    toast("Permission to read the folder was not granted");
    return;
  }
  const sources = await collectFromHandle(handle);
  const known = new Map(store.state.library.map((m) => [m.path, m]));
  const changed = sources.filter((s) => {
    const m = known.get(s.path);
    if (!m) return true;
    return m.size !== s.file.size || s.file.lastModified > m.importedAt;
  });
  if (changed.length === 0) {
    toast("Library is up to date");
    return;
  }
  await importSources(changed, null);
}

// Drag and drop anywhere.
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  document.documentElement.classList.add("dragging");
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.documentElement.classList.remove("dragging");
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.documentElement.classList.remove("dragging");
  if (!e.dataTransfer) return;
  void sourcesFromDataTransfer(e.dataTransfer).then((sources) => importSources(sources, null));
});

// ---- boot --------------------------------------------------------------------
async function boot(): Promise<void> {
  const updateSW = registerSW({
    onNeedRefresh() {
      toast("Update available — reopen the app to update", 6000);
      void updateSW(true);
    },
  });
  watchSystemTheme(() => store.set("settings", store.state.settings));
  window.addEventListener("hashchange", () => void route());

  const metas = await api.init();
  store.set("library", metas);
  library.setHasHandle((await getDirectoryHandle()) !== undefined);
  await route();

  const url = new URL(location.href);
  if (url.searchParams.has("shared")) {
    url.searchParams.delete("shared");
    history.replaceState(null, "", url.pathname + url.hash);
    const shared = await takeSharedFiles();
    if (shared.length > 0) {
      go("#/");
      await importSources(shared, null);
    }
  }
  consumeLaunchQueue((sources) => {
    go("#/");
    void importSources(sources, null);
  });
}

void boot();
