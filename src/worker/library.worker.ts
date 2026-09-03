import * as Comlink from "comlink";
import { fileTitle, fromStored, parseMarkdown, toStored } from "../core/parser.ts";
import { TermCompileError, compileTerms, searchFile } from "../core/search.ts";
import type {
  Block,
  FileHits,
  FileMeta,
  ImportProgress,
  ReadingPosition,
  StorageStatus,
  StoredBlock,
} from "../core/types.ts";
import {
  clearFileMetas,
  deleteFileMeta,
  getAllFileMetas,
  getFileMetaByPath,
  putFileMeta,
} from "../storage/db.ts";
import {
  QuotaExceededError,
  readText,
  removeFile,
  storageEstimate,
  writeText,
} from "../storage/opfs.ts";
import type { Book, ImportOutcome, LibraryApi } from "./api.ts";

interface LoadedFile {
  meta: FileMeta;
  text: string;
  blocks: Block[];
  offsets: Uint32Array;
}

const files = new Map<string, LoadedFile>();
let initPromise: Promise<FileMeta[]> | null = null;
let searchGeneration = 0;

function newId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

function textName(id: string): string {
  return `${id}.txt`;
}
function blocksName(id: string): string {
  return `${id}.blocks.json`;
}

async function loadFile(meta: FileMeta): Promise<LoadedFile | null> {
  const [text, blocksJson] = await Promise.all([
    readText(textName(meta.id)),
    readText(blocksName(meta.id)),
  ]);
  if (text === null || blocksJson === null) return null;
  const stored = JSON.parse(blocksJson) as StoredBlock[];
  const blocks = fromStored(stored, text);
  return { meta, text, blocks, offsets: Uint32Array.from(blocks, (b) => b.charStart) };
}

async function doInit(): Promise<FileMeta[]> {
  const metas = await getAllFileMetas();
  const loaded = await Promise.all(metas.map(loadFile));
  for (const f of loaded) if (f) files.set(f.meta.id, f);
  // Drop metadata whose payload went missing (e.g. storage was evicted).
  for (const m of metas) if (!files.has(m.id)) await deleteFileMeta(m.id);
  return sortedMetas();
}

function sortedMetas(): FileMeta[] {
  return [...files.values()]
    .map((f) => f.meta)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

const yieldToEventLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const api: LibraryApi = {
  init() {
    initPromise ??= doInit();
    return initPromise;
  },

  async importFiles(sources, onProgress) {
    await api.init();
    const outcome: ImportOutcome = { imported: [], skipped: 0, errors: [] };
    const bytesTotal = sources.reduce((n, s) => n + s.file.size, 0);
    let bytesDone = 0;
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source) continue;
      const base: Omit<ImportProgress, "phase"> = {
        fileIndex: i,
        fileCount: sources.length,
        fileName: source.path,
        bytesDone,
        bytesTotal,
      };
      try {
        onProgress({ ...base, phase: "reading" });
        const src = await source.file.text();
        const existing = await getFileMetaByPath(source.path);
        const id = existing?.id ?? newId();
        onProgress({ ...base, phase: "parsing" });
        const parsed = parseMarkdown(id, src);
        onProgress({ ...base, phase: "writing" });
        await writeText(textName(id), parsed.text);
        await writeText(blocksName(id), JSON.stringify(toStored(parsed.blocks)));
        const meta: FileMeta = {
          id,
          name: source.file.name,
          path: source.path,
          title: fileTitle(parsed.blocks, source.file.name),
          size: source.file.size,
          textLength: parsed.text.length,
          blockCount: parsed.blocks.length,
          headingCount: parsed.blocks.reduce((n, b) => n + (b.type === "heading" ? 1 : 0), 0),
          importedAt: Date.now(),
        };
        if (existing?.lastRead) meta.lastRead = existing.lastRead;
        if (existing?.lastOpenedAt !== undefined) meta.lastOpenedAt = existing.lastOpenedAt;
        await putFileMeta(meta);
        files.set(id, { meta, text: parsed.text, blocks: parsed.blocks, offsets: parsed.offsets });
        outcome.imported.push(meta);
      } catch (err) {
        const message =
          err instanceof QuotaExceededError
            ? "Storage quota exceeded"
            : err instanceof Error
              ? err.message
              : String(err);
        outcome.errors.push({ path: source.path, message });
        if (err instanceof QuotaExceededError) {
          outcome.skipped = sources.length - i - 1;
          break;
        }
      }
      bytesDone += source.file.size;
      await yieldToEventLoop();
    }
    onProgress({
      phase: "done",
      fileIndex: sources.length,
      fileCount: sources.length,
      fileName: "",
      bytesDone: bytesTotal,
      bytesTotal,
    });
    return outcome;
  },

  async removeFile(fileId) {
    await api.init();
    files.delete(fileId);
    await Promise.all([
      deleteFileMeta(fileId),
      removeFile(textName(fileId)),
      removeFile(blocksName(fileId)),
    ]);
  },

  async clearLibrary() {
    await api.init();
    const ids = [...files.keys()];
    files.clear();
    await clearFileMetas();
    await Promise.all(ids.flatMap((id) => [removeFile(textName(id)), removeFile(blocksName(id))]));
  },

  async listFiles() {
    await api.init();
    return sortedMetas();
  },

  async getBook(fileId) {
    await api.init();
    const f = files.get(fileId);
    if (!f) return null;
    const book: Book = { meta: f.meta, blocks: f.blocks };
    return book;
  },

  async getBlocks(fileId, indices) {
    await api.init();
    const f = files.get(fileId);
    if (!f) return [];
    const out: Block[] = [];
    for (const i of indices) {
      const b = f.blocks[i];
      if (b) out.push(b);
    }
    return out;
  },

  async getSection(fileId, blockIndex, level) {
    await api.init();
    const f = files.get(fileId);
    const block = f?.blocks[blockIndex];
    if (!f || !block) return [];
    // Find the ancestor heading at or above `level` (deepest such), then take
    // every block until the next heading of that level or shallower.
    let headingIndex = -1;
    let headingLevel = 0;
    for (const id of block.headingIds) {
      const idx = Number(id.slice(id.lastIndexOf(":") + 1));
      const h = f.blocks[idx];
      if (!h || h.level > level) break;
      headingIndex = idx;
      headingLevel = h.level;
    }
    if (headingIndex < 0) {
      // Pre-heading content: everything up to the first heading.
      const end = f.blocks.findIndex((b) => b.type === "heading");
      return f.blocks.slice(0, end < 0 ? f.blocks.length : end);
    }
    let end = headingIndex + 1;
    while (end < f.blocks.length) {
      const b = f.blocks[end];
      if (b?.type === "heading" && b.level <= headingLevel) break;
      end++;
    }
    return f.blocks.slice(headingIndex, end);
  },

  async search(query, preferredFileId, onFileHits) {
    await api.init();
    const generation = ++searchGeneration;
    let compiled;
    try {
      compiled = compileTerms(query.terms);
    } catch (err) {
      if (err instanceof TermCompileError) throw new Error(`Bad pattern: ${err.message}`);
      throw err;
    }
    if (compiled.length === 0) return 0;
    let targets: LoadedFile[];
    if (query.scope.kind === "file") {
      const f = files.get(query.scope.fileId);
      targets = f ? [f] : [];
    } else {
      targets = sortedMetas()
        .map((m) => files.get(m.id))
        .filter((f): f is LoadedFile => !!f);
      if (preferredFileId) {
        const idx = targets.findIndex((f) => f.meta.id === preferredFileId);
        if (idx > 0) {
          const [pref] = targets.splice(idx, 1);
          if (pref) targets.unshift(pref);
        }
      }
    }
    let searched = 0;
    for (const f of targets) {
      if (generation !== searchGeneration) return -1;
      const result = searchFile(
        { fileId: f.meta.id, text: f.text, blocks: f.blocks, offsets: f.offsets },
        compiled,
        query,
      );
      searched++;
      if (result.hits.length > 0) {
        const fh: FileHits = {
          fileId: f.meta.id,
          title: f.meta.title,
          hits: result.hits,
          matchCount: result.matchCount,
          truncated: result.truncated,
        };
        onFileHits(fh);
      }
      await yieldToEventLoop();
    }
    return generation === searchGeneration ? searched : -1;
  },

  async cancelSearch() {
    searchGeneration++;
    await Promise.resolve();
  },

  async setReadingPosition(fileId, pos: ReadingPosition) {
    await api.init();
    const f = files.get(fileId);
    if (!f) return;
    f.meta = { ...f.meta, lastRead: pos };
    await putFileMeta(f.meta);
  },

  async touchFile(fileId) {
    await api.init();
    const f = files.get(fileId);
    if (!f) return;
    f.meta = { ...f.meta, lastOpenedAt: Date.now() };
    await putFileMeta(f.meta);
  },

  async storageStatus(): Promise<StorageStatus> {
    const { usage, quota } = await storageEstimate();
    const persisted =
      "persisted" in navigator.storage ? await navigator.storage.persisted() : false;
    return { usage, quota, persisted };
  },
};

Comlink.expose(api);
