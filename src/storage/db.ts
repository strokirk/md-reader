import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { FileMeta, SavedSearch } from "../core/types.ts";

interface ReaderDB extends DBSchema {
  files: { key: string; value: FileMeta; indexes: { byPath: string } };
  handles: { key: string; value: { id: string; handle: FileSystemDirectoryHandle; name: string } };
  savedSearches: { key: string; value: SavedSearch };
}

const DB_NAME = "md-reader";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null;

export function db(): Promise<IDBPDatabase<ReaderDB>> {
  dbPromise ??= openDB<ReaderDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const files = database.createObjectStore("files", { keyPath: "id" });
      files.createIndex("byPath", "path");
      database.createObjectStore("handles", { keyPath: "id" });
      database.createObjectStore("savedSearches", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function getAllFileMetas(): Promise<FileMeta[]> {
  return (await db()).getAll("files");
}

export async function putFileMeta(meta: FileMeta): Promise<void> {
  await (await db()).put("files", meta);
}

export async function getFileMeta(id: string): Promise<FileMeta | undefined> {
  return (await db()).get("files", id);
}

export async function getFileMetaByPath(path: string): Promise<FileMeta | undefined> {
  return (await db()).getFromIndex("files", "byPath", path);
}

export async function deleteFileMeta(id: string): Promise<void> {
  await (await db()).delete("files", id);
}

export async function clearFileMetas(): Promise<void> {
  await (await db()).clear("files");
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await (await db()).put("handles", { id: "library", handle, name: handle.name });
}

export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return (await (await db()).get("handles", "library"))?.handle;
}

export async function clearDirectoryHandle(): Promise<void> {
  await (await db()).delete("handles", "library");
}

export async function getSavedSearches(): Promise<SavedSearch[]> {
  const all = await (await db()).getAll("savedSearches");
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putSavedSearch(s: SavedSearch): Promise<void> {
  await (await db()).put("savedSearches", s);
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await (await db()).delete("savedSearches", id);
}
