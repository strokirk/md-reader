import type { ImportSource } from "../worker/api.ts";

export const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd|txt)$/i;

export const supportsDirectoryPicker = typeof window.showDirectoryPicker === "function";

function isMarkdownName(name: string): boolean {
  return MARKDOWN_FILE.test(name) && !name.startsWith(".");
}

export function sourcesFromFileList(files: Iterable<File>): ImportSource[] {
  const out: ImportSource[] = [];
  for (const file of files) {
    if (!isMarkdownName(file.name)) continue;
    const rel = file.webkitRelativePath || file.name;
    out.push({ path: stripTopDir(rel), file });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** `webkitdirectory` paths include the picked folder's own name; drop it. */
function stripTopDir(path: string): string {
  const i = path.indexOf("/");
  return i > 0 ? path.slice(i + 1) : path;
}

/** Opens a native picker through a transient <input type=file>. */
function pickViaInput(directory: boolean): Promise<ImportSource[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) input.webkitdirectory = true;
    else input.accept = ".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain";
    input.style.display = "none";
    let settled = false;
    const finish = (value: ImportSource[] | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => finish(sourcesFromFileList(input.files ?? [])));
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

export function pickFiles(): Promise<ImportSource[] | null> {
  return pickViaInput(false);
}

export interface DirectoryPick {
  sources: ImportSource[];
  handle: FileSystemDirectoryHandle | null;
}

export async function pickDirectory(): Promise<DirectoryPick | null> {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ id: "md-library", mode: "read" });
      return { sources: await collectFromHandle(handle), handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
  }
  const sources = await pickViaInput(true);
  return sources ? { sources, handle: null } : null;
}

export async function collectFromHandle(
  dir: FileSystemDirectoryHandle,
  prefix = "",
): Promise<ImportSource[]> {
  const out: ImportSource[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      out.push(...(await collectFromHandle(handle as FileSystemDirectoryHandle, path)));
    } else if (isMarkdownName(name)) {
      out.push({ path, file: await (handle as FileSystemFileHandle).getFile() });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Re-checks permission on a stored handle, prompting if needed. */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const query = await handle.queryPermission?.({ mode: "read" });
  if (query === "granted") return true;
  const req = await handle.requestPermission?.({ mode: "read" });
  return req === "granted";
}

/** Walks dropped items, descending into directories where the browser allows. */
export async function sourcesFromDataTransfer(dt: DataTransfer): Promise<ImportSource[]> {
  const out: ImportSource[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return sourcesFromFileList(Array.from(dt.files));
  for (const entry of entries) await walkEntry(entry, "", out);
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

function walkEntry(entry: FileSystemEntry, prefix: string, out: ImportSource[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      if (!isMarkdownName(entry.name)) {
        resolve();
        return;
      }
      (entry as FileSystemFileEntry).file(
        (file) => {
          out.push({ path: prefix ? `${prefix}/${entry.name}` : entry.name, file });
          resolve();
        },
        () => resolve(),
      );
      return;
    }
    if (!entry.isDirectory) {
      resolve();
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const readBatch = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve();
            return;
          }
          void Promise.all(batch.map((e) => walkEntry(e, path, out))).then(readBatch);
        },
        () => resolve(),
      );
    };
    readBatch();
  });
}

export const SHARED_CACHE = "shared-files";

/** Collects files the service worker stored from a Web Share Target POST. */
export async function takeSharedFiles(): Promise<ImportSource[]> {
  if (!("caches" in window)) return [];
  const cache = await caches.open(SHARED_CACHE);
  const keys = await cache.keys();
  const out: ImportSource[] = [];
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const name = decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "shared.md");
    const blob = await res.blob();
    out.push({ path: name, file: new File([blob], name, { type: "text/markdown" }) });
    await cache.delete(req);
  }
  return out.filter((s) => isMarkdownName(s.path) || s.file.type.startsWith("text/"));
}

/** Files opened via the OS "Open with" flow (Chromium file handling). */
export function consumeLaunchQueue(onFiles: (sources: ImportSource[]) => void): void {
  window.launchQueue?.setConsumer((params) => {
    void (async () => {
      const out: ImportSource[] = [];
      for (const handle of params.files) {
        if (handle.kind !== "file") continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        if (isMarkdownName(file.name)) out.push({ path: file.name, file });
      }
      if (out.length > 0) onFiles(out);
    })();
  });
}
