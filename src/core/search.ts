import type { Block, BlockHit, Combine, SearchQuery, TermMatch, TermSpec } from "./types.ts";

export const MAX_MATCHES_PER_TERM_PER_FILE = 5000;

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\/]/g;

export function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIALS, "\\$&");
}

export class TermCompileError extends Error {
  constructor(
    readonly termId: string,
    message: string,
  ) {
    super(message);
    this.name = "TermCompileError";
  }
}

/** Compiles a term to a global RegExp, or null when the pattern is empty. */
export function compileTerm(term: TermSpec): RegExp | null {
  const raw = term.pattern.trim();
  if (raw.length === 0) return null;
  let source = term.regex ? raw : escapeRegex(raw);
  if (term.wholeWord) {
    // Unicode-aware word boundaries; `\b` in JS only understands ASCII.
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }
  const flags = `gu${term.caseSensitive ? "" : "i"}`;
  try {
    return new RegExp(source, flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TermCompileError(term.id, msg);
  }
}

export interface CompiledTerm {
  term: TermSpec;
  re: RegExp;
}

export function compileTerms(terms: TermSpec[]): CompiledTerm[] {
  const out: CompiledTerm[] = [];
  for (const term of terms) {
    const re = compileTerm(term);
    if (re) out.push({ term, re });
  }
  return out;
}

export interface RawMatch {
  termId: string;
  start: number;
  end: number;
}

/**
 * Scans `text` with every compiled term and returns absolute match offsets.
 * Zero-length matches are skipped (they would otherwise loop forever).
 */
export function scanText(
  text: string,
  terms: CompiledTerm[],
  limit = MAX_MATCHES_PER_TERM_PER_FILE,
): { matches: RawMatch[]; truncated: boolean } {
  const matches: RawMatch[] = [];
  let truncated = false;
  for (const { term, re } of terms) {
    re.lastIndex = 0;
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      matches.push({ termId: term.id, start: m.index, end: m.index + m[0].length });
      if (++count >= limit) {
        truncated = true;
        break;
      }
    }
  }
  return { matches, truncated };
}

/** Index of the block whose charStart is the greatest value <= offset. */
export function blockIndexForOffset(offsets: Uint32Array, offset: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Groups absolute matches by block. A match that crosses a block boundary
 * (possible with regex terms) is clipped to the block it starts in.
 */
export function groupMatchesByBlock(
  matches: RawMatch[],
  blocks: Block[],
  offsets: Uint32Array,
): Map<number, TermMatch[]> {
  const byBlock = new Map<number, TermMatch[]>();
  if (blocks.length === 0) return byBlock;
  for (const m of matches) {
    const bi = blockIndexForOffset(offsets, m.start);
    const block = blocks[bi];
    if (!block) continue;
    const start = m.start - block.charStart;
    const end = Math.min(m.end, block.charEnd) - block.charStart;
    if (end <= start) continue;
    let list = byBlock.get(bi);
    if (!list) {
      list = [];
      byBlock.set(bi, list);
    }
    list.push({ termId: m.termId, start, end });
  }
  for (const list of byBlock.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return byBlock;
}

/**
 * Applies the boolean combination rule. Returns the block indices that should
 * be reported as hits, in document order.
 */
export function combineHits(
  byBlock: Map<number, TermMatch[]>,
  blocks: Block[],
  termIds: string[],
  combine: Combine,
  sectionLevel: number,
): number[] {
  const indices = [...byBlock.keys()].sort((a, b) => a - b);
  if (termIds.length <= 1 || combine === "any") return indices;
  const hasAll = (present: Set<string>) => termIds.every((id) => present.has(id));
  if (combine === "all") {
    return indices.filter((bi) => {
      const present = new Set((byBlock.get(bi) ?? []).map((m) => m.termId));
      return hasAll(present);
    });
  }
  const termsBySection = new Map<string, Set<string>>();
  for (const bi of indices) {
    const block = blocks[bi];
    if (!block) continue;
    const key = sectionKeyByLevel(block, blocks, sectionLevel);
    let set = termsBySection.get(key);
    if (!set) {
      set = new Set();
      termsBySection.set(key, set);
    }
    for (const m of byBlock.get(bi) ?? []) set.add(m.termId);
  }
  return indices.filter((bi) => {
    const block = blocks[bi];
    if (!block) return false;
    const set = termsBySection.get(sectionKeyByLevel(block, blocks, sectionLevel));
    return set !== undefined && hasAll(set);
  });
}

/**
 * Section key that respects actual heading levels: the deepest ancestor
 * heading whose level is <= sectionLevel. Blocks before any heading share "".
 */
export function sectionKeyByLevel(block: Block, blocks: Block[], sectionLevel: number): string {
  let key = "";
  for (const id of block.headingIds) {
    const idx = Number(id.slice(id.lastIndexOf(":") + 1));
    const heading = blocks[idx];
    if (!heading) break;
    if (heading.level > sectionLevel) break;
    key = id;
  }
  return key;
}

export interface FileSearchInput {
  fileId: string;
  text: string;
  blocks: Block[];
  offsets: Uint32Array;
}

export interface FileSearchResult {
  hits: BlockHit[];
  matchCount: number;
  truncated: boolean;
}

/** Searches one file end to end: scan, map, combine, and build hits. */
export function searchFile(
  file: FileSearchInput,
  compiled: CompiledTerm[],
  query: Pick<SearchQuery, "combine" | "sectionLevel">,
): FileSearchResult {
  const { matches, truncated } = scanText(file.text, compiled);
  const byBlock = groupMatchesByBlock(matches, file.blocks, file.offsets);
  const termIds = compiled.map((c) => c.term.id);
  const indices = combineHits(byBlock, file.blocks, termIds, query.combine, query.sectionLevel);
  const hits: BlockHit[] = [];
  let matchCount = 0;
  for (const bi of indices) {
    const block = file.blocks[bi];
    const ms = byBlock.get(bi);
    if (!block || !ms) continue;
    matchCount += ms.length;
    hits.push({
      blockId: block.id,
      blockIndex: bi,
      fileId: file.fileId,
      headingPath: block.headingPath,
      headingIds: block.headingIds,
      level: block.level,
      type: block.type,
      matches: ms,
    });
  }
  return { hits, matchCount, truncated };
}

/** Matches inside a single piece of text (used by the in-DOM highlighter). */
export function matchesInText(text: string, compiled: CompiledTerm[]): TermMatch[] {
  return scanText(text, compiled, Infinity).matches.sort((a, b) => a.start - b.start);
}
