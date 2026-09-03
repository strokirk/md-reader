import type { Remote } from "comlink";
import type {
  Combine,
  FileMeta,
  SavedSearch,
  SearchQuery,
  SearchScope,
  TermSpec,
} from "../core/types.ts";
import type { LibraryApi } from "../worker/api.ts";
import { Highlighter } from "./highlight.ts";
import { applySettings, loadSettings, saveSettings, type Settings } from "./settings.ts";

export interface AppState {
  library: FileMeta[];
  terms: TermSpec[];
  combine: Combine;
  scope: SearchScope;
  savedSearches: SavedSearch[];
  currentFileId: string | null;
  settings: Settings;
}

export type StateKey = keyof AppState;
type Listener = (key: StateKey) => void;

let termCounter = 0;
export function newTerm(pattern = "", colour?: number): TermSpec {
  termCounter++;
  return {
    id: `t${Date.now().toString(36)}${termCounter}`,
    pattern,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    colour: colour ?? 0,
  };
}

export class Store {
  readonly state: AppState;
  readonly highlighter = new Highlighter();
  private readonly listeners = new Set<Listener>();

  constructor(readonly api: Remote<LibraryApi>) {
    this.state = {
      library: [],
      terms: [],
      combine: "any",
      scope: { kind: "library" },
      savedSearches: [],
      currentFileId: null,
      settings: loadSettings(),
    };
    applySettings(this.state.settings);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set<K extends StateKey>(key: K, value: AppState[K]): void {
    this.state[key] = value;
    if (key === "terms") this.highlighter.setTerms(this.state.terms);
    if (key === "settings") {
      applySettings(this.state.settings);
      saveSettings(this.state.settings);
    }
    for (const fn of this.listeners) fn(key);
  }

  updateSettings(patch: Partial<Settings>): void {
    this.set("settings", { ...this.state.settings, ...patch });
  }

  /** Terms with a non-empty pattern, in colour-slot order. */
  activeTerms(): TermSpec[] {
    return this.state.terms.filter((t) => t.pattern.trim().length > 0);
  }

  query(scope?: SearchScope): SearchQuery {
    return {
      terms: this.activeTerms(),
      combine: this.state.combine,
      scope: scope ?? this.state.scope,
      sectionLevel: this.state.settings.sectionLevel,
    };
  }

  fileMeta(id: string): FileMeta | undefined {
    return this.state.library.find((f) => f.id === id);
  }

  async refreshLibrary(): Promise<void> {
    this.set("library", await this.api.listFiles());
  }
}
