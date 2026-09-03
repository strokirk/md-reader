import { describe, expect, it } from "vitest";
import { fileTitle, fromStored, parseMarkdown, toStored } from "../src/core/parser.ts";

const SAMPLE = `# Chapter 3

Intro paragraph with *emphasis* and \`code\`.

## Combat

Attack rolls use a d20.

### Grappling

- Grab the target
- Hold on

> A quote block
> continues here

| Weapon | Damage |
| ------ | ------ |
| Sword  | 1d8    |

\`\`\`js
const x = 1;
\`\`\`

## Magic

Spells are cast.
`;

describe("parseMarkdown", () => {
  const parsed = parseMarkdown("f1", SAMPLE);
  const { blocks } = parsed;

  it("produces a flat list of blocks in document order", () => {
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "list",
      "quote",
      "table",
      "code",
      "heading",
      "paragraph",
    ]);
  });

  it("assigns sequential ids scoped to the file", () => {
    expect(blocks.map((b) => b.id)).toEqual(blocks.map((_, i) => `f1:${i}`));
    expect(blocks.every((b) => b.fileId === "f1")).toBe(true);
  });

  it("tracks the heading path with ancestry", () => {
    const list = blocks[5];
    expect(list?.headingPath).toEqual(["Chapter 3", "Combat", "Grappling"]);
    expect(list?.headingIds).toEqual(["f1:0", "f1:2", "f1:4"]);
    expect(list?.level).toBe(3);
    const magicPara = blocks[10];
    expect(magicPara?.headingPath).toEqual(["Chapter 3", "Magic"]);
  });

  it("includes the heading itself in its own path", () => {
    const grappling = blocks[4];
    expect(grappling?.headingPath).toEqual(["Chapter 3", "Combat", "Grappling"]);
    expect(grappling?.headingIds).toEqual(["f1:0", "f1:2", "f1:4"]);
    expect(grappling?.level).toBe(3);
  });

  it("strips inline markup from the plain text", () => {
    expect(blocks[1]?.text).toBe("Intro paragraph with emphasis and code.");
  });

  it("keeps the source markdown for each block", () => {
    expect(blocks[1]?.md).toBe("Intro paragraph with *emphasis* and `code`.");
    expect(blocks[5]?.md).toBe("- Grab the target\n- Hold on");
    expect(blocks[8]?.md).toBe("```js\nconst x = 1;\n```");
  });

  it("collects plain text for lists, quotes, tables and code", () => {
    expect(blocks[5]?.text).toBe("Grab the target\nHold on");
    expect(blocks[6]?.text).toBe("A quote block continues here");
    expect(blocks[7]?.text).toBe("Weapon Damage\nSword 1d8");
    expect(blocks[8]?.text).toBe("const x = 1;");
  });

  it("builds a contiguous text whose offsets slice back to block text", () => {
    for (const b of blocks) {
      expect(parsed.text.slice(b.charStart, b.charEnd)).toBe(b.text);
    }
    expect(Array.from(parsed.offsets)).toEqual(blocks.map((b) => b.charStart));
    expect(parsed.text.split("\n").length).toBeGreaterThanOrEqual(blocks.length);
  });

  it("round-trips through the stored form", () => {
    const stored = toStored(blocks);
    expect("text" in (stored[0] ?? {})).toBe(false);
    expect(fromStored(stored, parsed.text)).toEqual(blocks);
  });

  it("handles CRLF input and a file with no headings", () => {
    const p = parseMarkdown("f2", "First para\r\n\r\nSecond para\r\n");
    expect(p.blocks.map((b) => b.text)).toEqual(["First para", "Second para"]);
    expect(p.blocks[0]?.headingPath).toEqual([]);
    expect(p.blocks[0]?.level).toBe(0);
  });

  it("resets deeper headings when a shallower heading appears", () => {
    const p = parseMarkdown("f3", "# A\n\n### Deep\n\ntext\n\n## B\n\nmore\n");
    expect(p.blocks[2]?.headingPath).toEqual(["A", "Deep"]);
    expect(p.blocks[4]?.headingPath).toEqual(["A", "B"]);
  });

  it("does not choke on an empty file", () => {
    const p = parseMarkdown("f4", "");
    expect(p.blocks).toEqual([]);
    expect(p.text).toBe("");
  });
});

describe("fileTitle", () => {
  it("prefers the first H1", () => {
    const p = parseMarkdown("f", "## Sub\n\n# Main\n");
    expect(fileTitle(p.blocks, "book.md")).toBe("Main");
  });
  it("falls back to any heading, then the file name", () => {
    expect(fileTitle(parseMarkdown("f", "## Sub\n").blocks, "book.md")).toBe("Sub");
    expect(fileTitle(parseMarkdown("f", "hello\n").blocks, "my book.md")).toBe("my book");
  });
});
