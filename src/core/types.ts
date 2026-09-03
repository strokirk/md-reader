export type BlockType =
  "heading" | "paragraph" | "list" | "table" | "code" | "quote" | "html" | "hr";

export interface Block {
  id: string;
  fileId: string;
  /** Titles of the ancestor headings; for a heading block, includes itself. */
  headingPath: string[];
  /** Block ids of the ancestor headings; parallel to headingPath. */
  headingIds: string[];
  /** Heading level (1-6) for headings; nesting depth of the heading path otherwise. */
  level: number;
  type: BlockType;
  /** Offsets into the file's contiguous plain-text string. */
  charStart: number;
  charEnd: number;
  /** Plain text, for search. */
  text: string;
  /** Source Markdown, for rendering. */
  md: string;
}

/** A Block as serialised to disk: `text` is recovered by slicing the file text. */
export type StoredBlock = Omit<Block, "text">;

export interface ParsedFile {
  fileId: string;
  blocks: Block[];
  /** Plain-text concatenation of every block, separated by "\n". */
  text: string;
  /** charStart of each block, in block order. */
  offsets: Uint32Array;
}

export interface FileMeta {
  id: string;
  name: string;
  /** Relative path inside the imported directory, or just the name. */
  path: string;
  /** Title: first H1, else file name without extension. */
  title: string;
  size: number;
  textLength: number;
  blockCount: number;
  headingCount: number;
  importedAt: number;
  lastOpenedAt?: number;
  lastRead?: ReadingPosition;
}

export interface ReadingPosition {
  blockIndex: number;
  /** Fraction (0..1) of the block scrolled past the viewport top. */
  offsetRatio: number;
}

export type Combine = "any" | "all" | "all-section";

export interface TermSpec {
  id: string;
  pattern: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Colour slot (0-based) used for the `::highlight(term-N)` style. */
  colour: number;
}

export type SearchScope = { kind: "library" } | { kind: "file"; fileId: string };

export interface SearchQuery {
  terms: TermSpec[];
  combine: Combine;
  scope: SearchScope;
  /**
   * Heading level that defines "a section" for `all-section`.
   * Blocks share a section when their nearest ancestor heading of level <= this is the same.
   */
  sectionLevel: number;
}

export interface TermMatch {
  termId: string;
  /** Offsets relative to the block's plain text. */
  start: number;
  end: number;
}

export interface BlockHit {
  blockId: string;
  blockIndex: number;
  fileId: string;
  headingPath: string[];
  headingIds: string[];
  level: number;
  type: BlockType;
  matches: TermMatch[];
}

export interface FileHits {
  fileId: string;
  title: string;
  hits: BlockHit[];
  /** Total number of term matches in this file, across all hit blocks. */
  matchCount: number;
  truncated: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  terms: TermSpec[];
  combine: Combine;
  createdAt: number;
}

export interface ImportProgress {
  phase: "reading" | "parsing" | "writing" | "done";
  fileIndex: number;
  fileCount: number;
  fileName: string;
  bytesDone: number;
  bytesTotal: number;
}

export interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean;
}
