export type Theme = "dark" | "light" | "system";
export type LineWidth = "narrow" | "medium" | "wide";

export interface Settings {
  theme: Theme;
  fontScale: number;
  lineWidth: LineWidth;
  sectionLevel: number;
}

const KEY = "md-reader:settings";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontScale: 1,
  lineWidth: "medium",
  sectionLevel: 2,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };
    const p = parsed as Partial<Settings>;
    return {
      theme: p.theme === "light" || p.theme === "system" ? p.theme : "dark",
      fontScale:
        typeof p.fontScale === "number" && p.fontScale >= 0.7 && p.fontScale <= 2 ? p.fontScale : 1,
      lineWidth: p.lineWidth === "narrow" || p.lineWidth === "wide" ? p.lineWidth : "medium",
      sectionLevel:
        typeof p.sectionLevel === "number" && p.sectionLevel >= 1 && p.sectionLevel <= 6
          ? p.sectionLevel
          : 2,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable in private mode; settings simply don't persist.
  }
}

const lightQuery = matchMedia("(prefers-color-scheme: light)");

export function applySettings(s: Settings): void {
  const root = document.documentElement;
  const theme = s.theme === "system" ? (lightQuery.matches ? "light" : "dark") : s.theme;
  root.dataset.theme = theme;
  root.style.setProperty("--font-scale", String(s.fontScale));
  root.dataset.width = s.lineWidth;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = theme === "dark" ? "#14161a" : "#f6f5f1";
}

export function watchSystemTheme(onChange: () => void): void {
  lightQuery.addEventListener("change", onChange);
}
