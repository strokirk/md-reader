export type Child = Node | string | number | null | undefined | false | Child[];

type Listener = (ev: never) => void;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  role?: string;
  style?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Record<string, Listener>;
  ariaLabel?: string;
}

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
}

/** Tiny element factory; enough to avoid a framework for this app. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.title) el.title = props.title;
  if (props.type && "type" in el) (el as HTMLInputElement).type = props.type;
  if (props.value !== undefined && "value" in el) (el as HTMLInputElement).value = props.value;
  if (props.placeholder && "placeholder" in el)
    (el as HTMLInputElement).placeholder = props.placeholder;
  if (props.disabled !== undefined && "disabled" in el)
    (el as HTMLButtonElement).disabled = props.disabled;
  if (props.hidden) el.hidden = true;
  if (props.role) el.setAttribute("role", props.role);
  if (props.style) el.setAttribute("style", props.style);
  if (props.ariaLabel) el.setAttribute("aria-label", props.ariaLabel);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) {
    for (const [event, fn] of Object.entries(props.on)) {
      el.addEventListener(event, fn as EventListener);
    }
  }
  for (const c of children) append(el, c);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
}

/** Icon glyphs drawn as inline SVG so they scale with Dynamic Type. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  svg.innerHTML = ICONS[name];
  return svg;
}

export type IconName = keyof typeof ICONS;

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  back: `<path ${STROKE} d="M15 18l-6-6 6-6"/>`,
  search: `<circle ${STROKE} cx="11" cy="11" r="7"/><path ${STROKE} d="M20 20l-3.5-3.5"/>`,
  list: `<path ${STROKE} d="M4 6h16M4 12h16M4 18h10"/>`,
  up: `<path ${STROKE} d="M6 15l6-6 6 6"/>`,
  down: `<path ${STROKE} d="M6 9l6 6 6-6"/>`,
  text: `<path ${STROKE} d="M4 7V4h16v3M9 20h6M12 4v16"/>`,
  close: `<path ${STROKE} d="M6 6l12 12M18 6L6 18"/>`,
  plus: `<path ${STROKE} d="M12 5v14M5 12h14"/>`,
  folder: `<path ${STROKE} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
  file: `<path ${STROKE} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path ${STROKE} d="M14 3v5h5"/>`,
  trash: `<path ${STROKE} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`,
  more: `<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>`,
  expand: `<path ${STROKE} d="M4 14v6h6M20 10V4h-6M20 4l-7 7M4 20l7-7"/>`,
  chevron: `<path ${STROKE} d="M9 6l6 6-6 6"/>`,
  save: `<path ${STROKE} d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path ${STROKE} d="M17 21v-8H7v8M7 3v5h8"/>`,
  refresh: `<path ${STROKE} d="M21 12a9 9 0 1 1-3-6.7"/><path ${STROKE} d="M21 3v6h-6"/>`,
} as const;
