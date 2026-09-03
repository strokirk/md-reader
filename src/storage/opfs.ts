/**
 * OPFS helpers for use inside a Web Worker. Sync access handles are used for
 * both reads and writes because Safari lacks `createWritable()`.
 */

const LIB_DIR = "lib";

let libDirPromise: Promise<FileSystemDirectoryHandle> | null = null;

export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    "getDirectory" in navigator.storage
  );
}

async function libDir(): Promise<FileSystemDirectoryHandle> {
  libDirPromise ??= navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle(LIB_DIR, { create: true }));
  return libDirPromise;
}

export class QuotaExceededError extends Error {
  constructor(readonly fileName: string) {
    super(`Not enough storage to save ${fileName}`);
    this.name = "QuotaExceededError";
  }
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function writeText(name: string, content: string): Promise<number> {
  const dir = await libDir();
  const handle = await dir.getFileHandle(name, { create: true });
  const bytes = encoder.encode(content);
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
  } catch (err) {
    access.close();
    if (isQuotaError(err)) {
      await dir.removeEntry(name).catch(() => undefined);
      throw new QuotaExceededError(name);
    }
    throw err;
  }
  access.close();
  return bytes.byteLength;
}

export async function readText(name: string): Promise<string | null> {
  const dir = await libDir();
  let handle: FileSystemFileHandle;
  try {
    handle = await dir.getFileHandle(name);
  } catch {
    return null;
  }
  const access = await handle.createSyncAccessHandle();
  try {
    const size = access.getSize();
    const buf = new Uint8Array(size);
    access.read(buf, { at: 0 });
    return decoder.decode(buf);
  } finally {
    access.close();
  }
}

export async function removeFile(name: string): Promise<void> {
  const dir = await libDir();
  await dir.removeEntry(name).catch(() => undefined);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  if (!("estimate" in navigator.storage)) return { usage: 0, quota: 0 };
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
