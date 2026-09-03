import { compileTerms, matchesInText, type CompiledTerm } from "../core/search.ts";
import type { TermMatch, TermSpec } from "../core/types.ts";

export const COLOUR_SLOTS = 8;

export interface HighlightRange {
  termId: string;
  slot: number;
  range: Range;
}

const nativeSupported =
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/**
 * Applies per-term highlights to rendered blocks. Uses the CSS Custom Highlight
 * API when available so the DOM is never mutated; otherwise wraps matches in
 * `<mark>` elements.
 */
export class Highlighter {
  readonly native = nativeSupported;
  private compiled: CompiledTerm[] = [];
  private slots = new Map<string, number>();
  private readonly highlights = new Map<number, Highlight>();
  private readonly perRoot = new Map<Element, HighlightRange[]>();
  private current: Highlight | null = null;

  constructor() {
    if (this.native) {
      for (let slot = 0; slot < COLOUR_SLOTS; slot++) {
        const hl = new Highlight();
        this.highlights.set(slot, hl);
        CSS.highlights.set(`term-${slot}`, hl);
      }
      this.current = new Highlight();
      CSS.highlights.set("current-match", this.current);
    }
  }

  get hasTerms(): boolean {
    return this.compiled.length > 0;
  }

  /** Replaces the active terms. Existing highlights are cleared; callers re-apply. */
  setTerms(terms: TermSpec[]): void {
    this.clearAll();
    try {
      this.compiled = compileTerms(terms);
    } catch {
      this.compiled = [];
    }
    this.slots = new Map(this.compiled.map((c) => [c.term.id, c.term.colour % COLOUR_SLOTS]));
  }

  /** Highlights every match under `root`. Returns the ranges in document order. */
  apply(root: Element): HighlightRange[] {
    this.remove(root);
    if (this.compiled.length === 0) return [];
    const { text, nodes } = collectText(root);
    if (text.length === 0) return [];
    const matches = matchesInText(text, this.compiled);
    if (matches.length === 0) return [];
    const ranges = matches.map((m) => ({
      termId: m.termId,
      slot: this.slots.get(m.termId) ?? 0,
      range: rangeFor(nodes, m),
    }));
    this.perRoot.set(root, ranges);
    if (this.native) {
      for (const r of ranges) this.highlights.get(r.slot)?.add(r.range);
    } else {
      wrapMarks(ranges);
    }
    return ranges;
  }

  remove(root: Element): void {
    const ranges = this.perRoot.get(root);
    if (!ranges) return;
    this.perRoot.delete(root);
    if (this.native) {
      for (const r of ranges) this.highlights.get(r.slot)?.delete(r.range);
    } else {
      unwrapMarks(root);
    }
  }

  clearAll(): void {
    if (this.native) {
      for (const hl of this.highlights.values()) hl.clear();
      this.current?.clear();
      this.perRoot.clear();
    } else {
      for (const root of this.perRoot.keys()) unwrapMarks(root);
      this.perRoot.clear();
    }
  }

  rangesFor(root: Element): HighlightRange[] {
    return this.perRoot.get(root) ?? [];
  }

  /** Marks one range as the current match (prev/next navigation). */
  setCurrent(range: Range | null): void {
    if (this.native && this.current) {
      this.current.clear();
      if (range) this.current.add(range);
      return;
    }
    for (const el of document.querySelectorAll("mark.hl-current"))
      el.classList.remove("hl-current");
    if (range) {
      const el = range.startContainer.parentElement?.closest("mark.hl");
      el?.classList.add("hl-current");
    }
  }
}

interface TextNodeSpan {
  node: Text;
  start: number;
}

function collectText(root: Element): { text: string; nodes: TextNodeSpan[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextNodeSpan[] = [];
  let text = "";
  let node = walker.nextNode();
  while (node) {
    const t = node as Text;
    nodes.push({ node: t, start: text.length });
    text += t.data;
    node = walker.nextNode();
  }
  return { text, nodes };
}

function locate(
  nodes: TextNodeSpan[],
  offset: number,
  preferEnd: boolean,
): { node: Text; offset: number } {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const span = nodes[mid];
    if (!span) break;
    if (preferEnd ? span.start < offset : span.start <= offset) lo = mid;
    else hi = mid - 1;
  }
  const span = nodes[lo];
  if (!span) throw new Error("no text nodes");
  return { node: span.node, offset: Math.min(offset - span.start, span.node.data.length) };
}

function rangeFor(nodes: TextNodeSpan[], m: TermMatch): Range {
  const start = locate(nodes, m.start, false);
  const end = locate(nodes, m.end, true);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** Fallback for browsers without CSS.highlights: wrap each range in a <mark>. */
function wrapMarks(ranges: HighlightRange[]): void {
  // Process from last to first so earlier offsets stay valid while splitting nodes.
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if (!r) continue;
    const { range } = r;
    const segments = textSegments(range);
    for (const seg of segments.reverse()) {
      const target = seg.node.splitText(seg.start);
      target.splitText(seg.end - seg.start);
      const mark = document.createElement("mark");
      mark.className = `hl hl-${r.slot}`;
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
    }
    // Re-point the range at the first mark so setCurrent() can find it.
    const first = segments[0];
    if (first) {
      const mark = first.node.nextSibling;
      if (mark instanceof HTMLElement && mark.firstChild) {
        range.setStart(mark.firstChild, 0);
        range.setEnd(mark.firstChild, mark.textContent.length);
      }
    }
  }
}

function textSegments(range: Range): { node: Text; start: number; end: number }[] {
  const out: { node: Text; start: number; end: number }[] = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    out.push({ node: root as Text, start: range.startOffset, end: range.endOffset });
    return out;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const t = node as Text;
    if (range.intersectsNode(t)) {
      const start = t === range.startContainer ? range.startOffset : 0;
      const end = t === range.endContainer ? range.endOffset : t.data.length;
      if (end > start) out.push({ node: t, start, end });
    }
    node = walker.nextNode();
  }
  return out;
}

function unwrapMarks(root: Element): void {
  for (const mark of root.querySelectorAll("mark.hl")) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  root.normalize();
}
