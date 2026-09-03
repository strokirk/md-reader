import MarkdownIt from "markdown-it";
type Token = ReturnType<InstanceType<typeof MarkdownIt>["parse"]>[number];
import type { Block, BlockType, ParsedFile, StoredBlock } from "./types.ts";

/** Parser instance used only for tokenising; HTML output is never produced here. */
const tokenizer = new MarkdownIt("commonmark", { html: true });
tokenizer.enable(["table", "strikethrough"]);

interface OpenHeading {
  level: number;
  title: string;
  id: string;
}

const BLOCK_TYPE_BY_TOKEN: Record<string, BlockType> = {
  heading_open: "heading",
  paragraph_open: "paragraph",
  bullet_list_open: "list",
  ordered_list_open: "list",
  table_open: "table",
  blockquote_open: "quote",
  fence: "code",
  code_block: "code",
  html_block: "html",
  hr: "hr",
};

/**
 * Splits a file's lines at the boundaries markdown-it reports, so the source
 * slice for a block is exact even when the file mixes line endings.
 */
function lineOffsets(src: string): Uint32Array {
  const offsets: number[] = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  offsets.push(src.length);
  return Uint32Array.from(offsets);
}

function sliceLines(src: string, lines: Uint32Array, start: number, end: number): string {
  const from = lines[Math.min(start, lines.length - 1)] ?? 0;
  const to = lines[Math.min(end, lines.length - 1)] ?? src.length;
  return src.slice(from, to).replace(/\s+$/, "");
}

/** Collects the plain text for the inline children of a block-level token run. */
function inlineText(tokens: Token[], from: number, to: number): string {
  let out = "";
  let needsSeparator = false;
  for (let i = from; i < to; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    switch (tok.type) {
      case "inline": {
        if (needsSeparator && out.length > 0 && !out.endsWith("\n")) out += "\n";
        needsSeparator = false;
        for (const child of tok.children ?? []) {
          switch (child.type) {
            case "text":
            case "code_inline":
              out += child.content;
              break;
            case "softbreak":
            case "hardbreak":
              out += " ";
              break;
            case "image":
              out += child.content;
              break;
            default:
              break;
          }
        }
        break;
      }
      case "fence":
      case "code_block":
      case "html_block":
        if (out.length > 0 && !out.endsWith("\n")) out += "\n";
        out += tok.content.replace(/\s+$/, "");
        needsSeparator = true;
        break;
      case "paragraph_close":
      case "heading_close":
      case "list_item_close":
      case "tr_close":
      case "blockquote_close":
        needsSeparator = true;
        break;
      case "th_close":
      case "td_close":
        out += " ";
        break;
      default:
        break;
    }
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Finds the index of the closing token that matches the opening token at `i` (nesting-aware). */
function findClose(tokens: Token[], i: number): number {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const t = tokens[j];
    if (!t) continue;
    if (t.nesting === 1) depth++;
    else if (t.nesting === -1) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return tokens.length - 1;
}

export function parseMarkdown(fileId: string, src: string): ParsedFile {
  const normalized = src.replace(/\r\n?/g, "\n");
  const tokens = tokenizer.parse(normalized, {});
  const lines = lineOffsets(normalized);
  const blocks: Block[] = [];
  const headings: OpenHeading[] = [];
  let text = "";
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) break;
    const type = BLOCK_TYPE_BY_TOKEN[tok.type];
    if (!type) {
      i++;
      continue;
    }
    const closeIndex = tok.nesting === 1 ? findClose(tokens, i) : i;
    const map = tok.map ?? [0, 0];
    const md = sliceLines(normalized, lines, map[0], map[1]);
    const plain = inlineText(tokens, i, closeIndex + 1);
    const index = blocks.length;
    const id = `${fileId}:${index}`;
    let level: number;
    if (type === "heading") {
      level = Number(tok.tag.slice(1)) || 1;
      while (headings.length > 0 && (headings[headings.length - 1]?.level ?? 0) >= level) {
        headings.pop();
      }
      headings.push({ level, title: plain, id });
    } else {
      level = headings.length;
    }
    if (blocks.length > 0) text += "\n";
    const charStart = text.length;
    text += plain;
    blocks.push({
      id,
      fileId,
      headingPath: headings.map((h) => h.title),
      headingIds: headings.map((h) => h.id),
      level,
      type,
      charStart,
      charEnd: charStart + plain.length,
      text: plain,
      md,
    });
    i = closeIndex + 1;
  }
  return { fileId, blocks, text, offsets: Uint32Array.from(blocks, (b) => b.charStart) };
}

export function toStored(blocks: Block[]): StoredBlock[] {
  return blocks.map(({ text: _text, ...rest }) => rest);
}

export function fromStored(stored: StoredBlock[], text: string): Block[] {
  return stored.map((b) => ({ ...b, text: text.slice(b.charStart, b.charEnd) }));
}

/** Title for a file: the first H1, else the first heading, else the file name without extension. */
export function fileTitle(blocks: Block[], fileName: string): string {
  const h1 = blocks.find((b) => b.type === "heading" && b.level === 1);
  const any = h1 ?? blocks.find((b) => b.type === "heading");
  const title = any?.text.trim();
  if (title) return title;
  return fileName.replace(/\.(md|markdown|txt)$/i, "");
}
