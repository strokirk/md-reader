import type { Block } from "../core/types.ts";
import { h, icon } from "./dom.ts";

interface TocNode {
  index: number;
  title: string;
  level: number;
  children: TocNode[];
}

function buildTree(blocks: Block[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  blocks.forEach((b, index) => {
    if (b.type !== "heading") return;
    const node: TocNode = { index, title: b.text || "(untitled)", level: b.level, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= b.level) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    stack.push(node);
  });
  return roots;
}

export class TocDrawer {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly filter: HTMLInputElement;
  private blocks: Block[] = [];
  private tree: TocNode[] = [];
  private onJump: (index: number) => void = () => undefined;
  private readonly expanded = new Set<number>();

  constructor() {
    this.list = h("div", { class: "toc-list" });
    this.filter = h("input", {
      type: "search",
      class: "input",
      placeholder: "Jump to chapter…",
      attrs: { autocomplete: "off", autocorrect: "off", autocapitalize: "off", enterkeyhint: "go" },
      on: { input: () => this.renderList() },
    });
    this.el = h(
      "div",
      { class: "drawer-wrap", hidden: true },
      h("div", { class: "backdrop", on: { click: () => this.close() } }),
      h(
        "nav",
        { class: "drawer", ariaLabel: "Table of contents" },
        h(
          "div",
          { class: "drawer-head" },
          this.filter,
          h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              ariaLabel: "Close",
              on: { click: () => this.close() },
            },
            icon("close"),
          ),
        ),
        this.list,
      ),
    );
    this.filter.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = this.list.querySelector<HTMLButtonElement>(".toc-item");
        first?.click();
      }
    });
  }

  setBlocks(blocks: Block[]): void {
    this.blocks = blocks;
    this.tree = buildTree(blocks);
    this.expanded.clear();
    for (const n of this.tree) this.expanded.add(n.index);
  }

  open(currentIndex: number, onJump: (index: number) => void): void {
    this.onJump = onJump;
    this.filter.value = "";
    // Expand ancestors of the current position.
    const current = this.blocks[currentIndex];
    for (const id of current?.headingIds ?? [])
      this.expanded.add(Number(id.slice(id.lastIndexOf(":") + 1)));
    this.renderList(currentIndex);
    this.el.hidden = false;
    document.documentElement.classList.add("modal-open");
    requestAnimationFrame(() => {
      this.list.querySelector(".toc-item.current")?.scrollIntoView({ block: "center" });
    });
  }

  close(): void {
    this.el.hidden = true;
    document.documentElement.classList.remove("modal-open");
  }

  private renderList(currentIndex = -1): void {
    const q = this.filter.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    const currentPath = new Set(this.blocks[currentIndex]?.headingIds ?? []);
    if (q) {
      let count = 0;
      for (const [i, b] of this.blocks.entries()) {
        if (b.type !== "heading" || !b.text.toLowerCase().includes(q)) continue;
        frag.appendChild(
          this.item({ index: i, title: b.text, level: b.level, children: [] }, true, currentPath),
        );
        if (++count >= 200) break;
      }
      if (count === 0)
        frag.appendChild(h("p", { class: "muted pad", text: "No matching headings" }));
    } else {
      const walk = (nodes: TocNode[], depth: number): void => {
        for (const node of nodes) {
          frag.appendChild(this.item(node, false, currentPath, depth));
          if (node.children.length > 0 && this.expanded.has(node.index))
            walk(node.children, depth + 1);
        }
      };
      walk(this.tree, 0);
      if (this.tree.length === 0)
        frag.appendChild(h("p", { class: "muted pad", text: "This book has no headings" }));
    }
    this.list.replaceChildren(frag);
  }

  private item(node: TocNode, flat: boolean, currentPath: Set<string>, depth = 0): HTMLElement {
    const block = this.blocks[node.index];
    const isCurrent = block ? currentPath.has(block.id) : false;
    const hasChildren = node.children.length > 0;
    const row = h("div", {
      class: `toc-row${isCurrent ? " current-path" : ""}`,
      style: `--depth:${depth}`,
    });
    if (!flat && hasChildren) {
      const open = this.expanded.has(node.index);
      row.appendChild(
        h(
          "button",
          {
            class: `toc-twisty${open ? " open" : ""}`,
            type: "button",
            ariaLabel: open ? "Collapse" : "Expand",
            on: {
              click: () => {
                if (this.expanded.has(node.index)) this.expanded.delete(node.index);
                else this.expanded.add(node.index);
                this.renderList();
              },
            },
          },
          icon("chevron"),
        ),
      );
    } else {
      row.appendChild(h("span", { class: "toc-twisty-spacer" }));
    }
    row.appendChild(
      h(
        "button",
        {
          class: `toc-item lvl-${node.level}${isCurrent ? " current" : ""}`,
          type: "button",
          on: {
            click: () => {
              this.close();
              this.onJump(node.index);
            },
          },
        },
        flat
          ? h("span", {
              class: "toc-path muted",
              text: block?.headingPath.slice(0, -1).join(" › ") ?? "",
            })
          : null,
        h("span", { class: "toc-title", text: node.title }),
      ),
    );
    return row;
  }
}
