# Roadmap

## Done

- Import via `showDirectoryPicker()` / `<input webkitdirectory>` fallback /
  drag-and-drop / Web Share Target / launch queue ("Open with").
- Parse-once-at-import pipeline: Markdown → flat `Block[]` + contiguous
  text, persisted in OPFS; metadata in IndexedDB. No re-parsing on reopen.
- Linear regex search over the persisted text, streamed per file, with
  case-sensitivity / whole-word / regex toggles per term, any/all/all-in-
  section boolean combination, and library- or single-book-scoped search.
- Saved search sets, persisted in IndexedDB.
- Reader: lazy per-chunk rendering with `content-visibility: auto`, CSS
  Custom Highlight API highlighting (with a `<mark>` fallback), TOC drawer
  with jump-to-chapter search, sticky breadcrumb, prev/next match
  navigation with a counter, remembered reading position per book, font
  size / line width / theme controls.
- PWA shell: manifest, service worker (app-shell precache + Web Share
  Target), safe-area-aware layout, `dvh` viewport handling.
- GitHub Pages deploy workflow.

## Near-term

- **Automated browser tests.** `scripts/e2e-smoke.mjs` is a manual
  Playwright script, not wired into CI. Turning its core assertions (import
  completes, search returns hits, highlighting is present, reload restores
  position) into a real `@playwright/test` suite that runs in CI would
  catch regressions like the heading-highlight bug (see `LEARNINGS.md` #9)
  automatically instead of by chance.
- **Real-device iOS verification.** Everything here has been validated in
  a mobile-viewport headless Chromium, which is not the same as actual
  Safari/WebKit — in particular, OPFS quota behaviour, the CSS Custom
  Highlight API (WebKit's support/perf profile differs from Chromium's),
  and `hidden="until-found"` + `beforematch` should all be spot-checked on
  a real iPhone before calling iOS support done.
- **`<mark>`-fallback path is untested end-to-end.** The native CSS Custom
  Highlight path is what's been exercised; the fallback for browsers
  without `CSS.highlights` (older Safari, older Firefox) has unit-level
  logic but hasn't been driven through a real browser lacking the API.
- **Import diffing on re-sync.** `resync()` currently compares by file size
  and `lastModified`; a file edited in place with the same size and an
  unchanged/backdated mtime (e.g. some sync tools) would be missed. Content
  hashing would be more robust but costs a full read of every file on every
  re-sync.

## Ideas / backlog

- Export/import saved search sets as JSON, for sharing a standing set of
  highlight rules between devices or people.
- Per-book highlight-colour overrides (a term could mean something
  different in different games/systems).
- A "recently viewed sections" list, separate from the single remembered
  reading position, for jumping back to something read earlier in a
  session.
- Search-within-results (narrow an already-run library search further
  without re-running the full scan).
- Bulk book management (rename, reorder, tag/group books in the library
  view) beyond the current flat list.
- Investigate `SharedArrayBuffer`/Atomics for the worker boundary if a much
  larger corpus (tens of MB) ever makes the current Comlink RPC streaming
  a bottleneck — not needed at the current 6 MB / "search under 100 ms"
  target, based on the synthetic-corpus benchmarks in
  `scripts/e2e-smoke.mjs` (~50–90 ms at 6 MB across 7 books).
