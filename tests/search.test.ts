import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/core/parser.ts";
import {
  TermCompileError,
  blockIndexForOffset,
  combineHits,
  compileTerm,
  compileTerms,
  groupMatchesByBlock,
  scanText,
  searchFile,
  sectionKeyByLevel,
} from "../src/core/search.ts";
import type { TermSpec } from "../src/core/types.ts";

function term(pattern: string, extra: Partial<TermSpec> = {}): TermSpec {
  return {
    id: extra.id ?? pattern,
    pattern,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    colour: 0,
    ...extra,
  };
}

const DOC = `# Book

## Combat

Grappling uses Strength. A grapple check is a Strength check.

Sneak attack adds damage.

### Grappling details

Escape with Dexterity.

## Magic

Fireball deals fire damage. Strength is irrelevant.

Dexterity saves halve it.
`;

describe("compileTerm", () => {
  it("escapes literal patterns", () => {
    const re = compileTerm(term("a.b"));
    expect(re?.test("a.b")).toBe(true);
    expect(re?.test("axb")).toBe(false);
  });
  it("returns null for an empty pattern", () => {
    expect(compileTerm(term("   "))).toBeNull();
  });
  it("honours case sensitivity", () => {
    expect(compileTerm(term("Foo", { caseSensitive: true }))?.test("foo")).toBe(false);
    expect(compileTerm(term("Foo"))?.test("foo")).toBe(true);
  });
  it("honours whole-word with unicode boundaries", () => {
    const re = compileTerm(term("cat", { wholeWord: true }));
    expect("a cat sat".match(re ?? /x/)?.length).toBe(1);
    expect(re?.test("concatenate")).toBe(false);
    expect(compileTerm(term("über", { wholeWord: true }))?.test("darüber")).toBe(false);
  });
  it("supports regex mode and reports bad patterns", () => {
    expect(compileTerm(term("d\\d+", { regex: true }))?.test("roll d20")).toBe(true);
    expect(() => compileTerm(term("(", { regex: true, id: "t1" }))).toThrow(TermCompileError);
  });
});

describe("scanText", () => {
  it("finds every occurrence for every term", () => {
    const compiled = compileTerms([term("a"), term("b")]);
    const { matches } = scanText("abab", compiled);
    expect(matches).toEqual([
      { termId: "a", start: 0, end: 1 },
      { termId: "a", start: 2, end: 3 },
      { termId: "b", start: 1, end: 2 },
      { termId: "b", start: 3, end: 4 },
    ]);
  });
  it("skips zero-length matches and truncates at the limit", () => {
    const compiled = compileTerms([term("x*", { regex: true })]);
    const { matches, truncated } = scanText("xx xx xx", compiled, 2);
    expect(matches.length).toBe(2);
    expect(truncated).toBe(true);
  });
});

describe("blockIndexForOffset", () => {
  const offsets = Uint32Array.from([0, 10, 20, 35]);
  it("maps offsets to the containing block", () => {
    expect(blockIndexForOffset(offsets, 0)).toBe(0);
    expect(blockIndexForOffset(offsets, 9)).toBe(0);
    expect(blockIndexForOffset(offsets, 10)).toBe(1);
    expect(blockIndexForOffset(offsets, 34)).toBe(2);
    expect(blockIndexForOffset(offsets, 35)).toBe(3);
    expect(blockIndexForOffset(offsets, 1000)).toBe(3);
  });
});

describe("groupMatchesByBlock", () => {
  const parsed = parseMarkdown("f", DOC);
  it("converts absolute offsets to block-relative offsets", () => {
    const compiled = compileTerms([term("Strength")]);
    const { matches } = scanText(parsed.text, compiled);
    const byBlock = groupMatchesByBlock(matches, parsed.blocks, parsed.offsets);
    for (const [bi, ms] of byBlock) {
      const block = parsed.blocks[bi];
      for (const m of ms) expect(block?.text.slice(m.start, m.end)).toBe("Strength");
    }
    expect([...byBlock.keys()]).toEqual([2, 7]);
    expect(byBlock.get(2)?.length).toBe(2);
  });
  it("clips a match that spans a block boundary to its starting block", () => {
    const compiled = compileTerms([term("check\\.\\nSneak", { regex: true, id: "r" })]);
    const { matches } = scanText(parsed.text, compiled);
    expect(matches.length).toBe(1);
    const byBlock = groupMatchesByBlock(matches, parsed.blocks, parsed.offsets);
    const [m] = byBlock.get(2) ?? [];
    expect(m?.end).toBe(parsed.blocks[2]?.text.length);
  });
});

describe("combineHits", () => {
  const parsed = parseMarkdown("f", DOC);
  const terms = [term("Strength"), term("Dexterity")];
  const compiled = compileTerms(terms);
  const { matches } = scanText(parsed.text, compiled);
  const byBlock = groupMatchesByBlock(matches, parsed.blocks, parsed.offsets);
  const ids = terms.map((t) => t.id);

  it("any-of returns every block with at least one term", () => {
    expect(combineHits(byBlock, parsed.blocks, ids, "any", 2)).toEqual([2, 5, 7, 8]);
  });
  it("all-of returns only blocks containing every term", () => {
    expect(combineHits(byBlock, parsed.blocks, ids, "all", 2)).toEqual([]);
    const both = compileTerms([term("Strength"), term("check")]);
    const s = scanText(parsed.text, both);
    const g = groupMatchesByBlock(s.matches, parsed.blocks, parsed.offsets);
    expect(combineHits(g, parsed.blocks, ["Strength", "check"], "all", 2)).toEqual([2]);
  });
  it("all-of-within-section groups blocks by their H2 section", () => {
    // Combat section: Strength in block 2, Dexterity in block 5 (under H3, still inside H2 Combat).
    // Magic section: both in blocks 7 and 8.
    expect(combineHits(byBlock, parsed.blocks, ids, "all-section", 2)).toEqual([2, 5, 7, 8]);
  });
  it("all-of-within-section respects a finer section level", () => {
    // At level 3, block 5 lives in "Grappling details" alone, which lacks Strength.
    expect(combineHits(byBlock, parsed.blocks, ids, "all-section", 3)).toEqual([7, 8]);
  });
  it("all-of-within-section at level 1 treats the whole book as one section", () => {
    const one = compileTerms([term("Sneak"), term("Fireball")]);
    const s = scanText(parsed.text, one);
    const g = groupMatchesByBlock(s.matches, parsed.blocks, parsed.offsets);
    expect(combineHits(g, parsed.blocks, ["Sneak", "Fireball"], "all-section", 1)).toEqual([3, 7]);
    expect(combineHits(g, parsed.blocks, ["Sneak", "Fireball"], "all-section", 2)).toEqual([]);
  });
  it("single-term queries ignore the combine rule", () => {
    const one = compileTerms([term("Strength")]);
    const s = scanText(parsed.text, one);
    const g = groupMatchesByBlock(s.matches, parsed.blocks, parsed.offsets);
    expect(combineHits(g, parsed.blocks, ["Strength"], "all", 2)).toEqual([2, 7]);
  });
});

describe("sectionKeyByLevel", () => {
  const parsed = parseMarkdown("f", DOC);
  it("returns the deepest ancestor heading at or above the level", () => {
    const b5 = parsed.blocks[5];
    if (!b5) throw new Error("missing block");
    expect(sectionKeyByLevel(b5, parsed.blocks, 1)).toBe("f:0");
    expect(sectionKeyByLevel(b5, parsed.blocks, 2)).toBe("f:1");
    expect(sectionKeyByLevel(b5, parsed.blocks, 3)).toBe("f:4");
  });
  it("uses the empty key before any heading", () => {
    const p = parseMarkdown("g", "intro\n\n# H\n\nbody\n");
    const b0 = p.blocks[0];
    if (!b0) throw new Error("missing block");
    expect(sectionKeyByLevel(b0, p.blocks, 2)).toBe("");
  });
});

describe("searchFile", () => {
  const parsed = parseMarkdown("f", DOC);
  it("returns hits with per-block matches and totals", () => {
    const compiled = compileTerms([term("Strength"), term("fire")]);
    const res = searchFile(parsed, compiled, { combine: "any", sectionLevel: 2 });
    expect(res.hits.map((h) => h.blockIndex)).toEqual([2, 7]);
    expect(res.matchCount).toBe(2 + 3);
    expect(res.hits[1]?.headingPath).toEqual(["Book", "Magic"]);
    expect(res.truncated).toBe(false);
    for (const h of res.hits) {
      const sorted = [...h.matches].sort((a, b) => a.start - b.start);
      expect(h.matches).toEqual(sorted);
    }
  });
});
