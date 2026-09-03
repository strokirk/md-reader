import { formatBytes, h, icon } from "./dom.ts";
import type { LineWidth, Theme } from "./settings.ts";
import type { Store } from "./store.ts";

function segmented<T extends string>(
  options: { value: T; label: string }[],
  current: T,
  onPick: (v: T) => void,
): HTMLElement {
  const group = h("div", { class: "seg", role: "radiogroup" });
  for (const o of options) {
    const btn = h("button", {
      type: "button",
      role: "radio",
      class: `seg-btn${o.value === current ? " active" : ""}`,
      text: o.label,
      attrs: { "aria-checked": String(o.value === current) },
      on: {
        click: () => {
          for (const b of group.querySelectorAll(".seg-btn")) {
            b.classList.remove("active");
            b.setAttribute("aria-checked", "false");
          }
          btn.classList.add("active");
          btn.setAttribute("aria-checked", "true");
          onPick(o.value);
        },
      },
    });
    group.appendChild(btn);
  }
  return group;
}

export class SettingsSheet {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;

  constructor(private readonly store: Store) {
    this.body = h("div", { class: "sheet-body" });
    this.el = h(
      "div",
      { class: "sheet-wrap", hidden: true },
      h("div", { class: "backdrop", on: { click: () => this.close() } }),
      h(
        "div",
        { class: "sheet", role: "dialog", ariaLabel: "Settings" },
        h(
          "div",
          { class: "sheet-head" },
          h("h2", { text: "Settings" }),
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
        this.body,
      ),
    );
  }

  open(): void {
    this.render();
    this.el.hidden = false;
    document.documentElement.classList.add("modal-open");
  }

  close(): void {
    this.el.hidden = true;
    document.documentElement.classList.remove("modal-open");
  }

  private render(): void {
    const s = this.store.state.settings;
    const sizeLabel = h("span", { class: "size-label", text: `${Math.round(s.fontScale * 100)}%` });
    const setScale = (delta: number): void => {
      const next =
        Math.round(Math.min(2, Math.max(0.7, this.store.state.settings.fontScale + delta)) * 20) /
        20;
      this.store.updateSettings({ fontScale: next });
      sizeLabel.textContent = `${Math.round(next * 100)}%`;
    };
    const storage = h("p", { class: "muted small", text: "Storage: checking…" });
    void this.store.api.storageStatus().then((st) => {
      const pct = st.quota > 0 ? ` (${((st.usage / st.quota) * 100).toFixed(1)}%)` : "";
      storage.textContent = `Storage: ${formatBytes(st.usage)} of ${formatBytes(st.quota)} used${pct}${st.persisted ? " · persistent" : ""}`;
    });
    this.body.replaceChildren(
      h("label", { class: "row-label", text: "Theme" }),
      segmented<Theme>(
        [
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "System" },
        ],
        s.theme,
        (theme) => this.store.updateSettings({ theme }),
      ),
      h("label", { class: "row-label", text: "Text size" }),
      h(
        "div",
        { class: "stepper" },
        h("button", {
          type: "button",
          class: "btn",
          text: "A−",
          ariaLabel: "Smaller text",
          on: { click: () => setScale(-0.1) },
        }),
        sizeLabel,
        h("button", {
          type: "button",
          class: "btn",
          text: "A+",
          ariaLabel: "Larger text",
          on: { click: () => setScale(0.1) },
        }),
      ),
      h("label", { class: "row-label", text: "Line width" }),
      segmented<LineWidth>(
        [
          { value: "narrow", label: "Narrow" },
          { value: "medium", label: "Medium" },
          { value: "wide", label: "Wide" },
        ],
        s.lineWidth,
        (lineWidth) => this.store.updateSettings({ lineWidth }),
      ),
      h("label", {
        class: "row-label",
        text: "“Same section” means everything under the nearest…",
      }),
      segmented(
        [
          { value: "1", label: "H1" },
          { value: "2", label: "H2" },
          { value: "3", label: "H3" },
        ],
        String(s.sectionLevel),
        (v) => this.store.updateSettings({ sectionLevel: Number(v) }),
      ),
      storage,
    );
  }
}
