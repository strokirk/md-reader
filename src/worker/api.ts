import type {
  Block,
  FileHits,
  FileMeta,
  ImportProgress,
  ReadingPosition,
  SearchQuery,
  StorageStatus,
} from "../core/types.ts";

export interface ImportSource {
  /** Relative path inside the picked directory, or the bare file name. */
  path: string;
  file: File;
}

export interface ImportOutcome {
  imported: FileMeta[];
  skipped: number;
  errors: { path: string; message: string }[];
}

export interface Book {
  meta: FileMeta;
  blocks: Block[];
}

export interface LibraryApi {
  /** Loads the library from OPFS into memory. Safe to call more than once. */
  init(): Promise<FileMeta[]>;
  importFiles(
    sources: ImportSource[],
    onProgress: (p: ImportProgress) => void,
  ): Promise<ImportOutcome>;
  removeFile(fileId: string): Promise<void>;
  clearLibrary(): Promise<void>;
  listFiles(): Promise<FileMeta[]>;
  getBook(fileId: string): Promise<Book | null>;
  /** Specific blocks of a file, in the order requested. Unknown indices are skipped. */
  getBlocks(fileId: string, indices: number[]): Promise<Block[]>;
  /** Blocks belonging to the section that contains `blockIndex` at heading level `level`. */
  getSection(fileId: string, blockIndex: number, level: number): Promise<Block[]>;
  /**
   * Streams results per file. Resolves with the number of files searched when
   * complete, or -1 if a newer search superseded this one.
   */
  search(
    query: SearchQuery,
    preferredFileId: string | null,
    onFileHits: (hits: FileHits) => void,
  ): Promise<number>;
  cancelSearch(): Promise<void>;
  /** Searches one file and returns its hits directly (no streaming). */
  searchOne(query: SearchQuery, fileId: string): Promise<FileHits | null>;
  setReadingPosition(fileId: string, pos: ReadingPosition): Promise<void>;
  touchFile(fileId: string): Promise<void>;
  storageStatus(): Promise<StorageStatus>;
}
