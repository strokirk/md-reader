# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server.
- `npm run check` — the gate to run before considering anything done: typecheck + lint + format check + unit tests, in that order. Runs each sub-command (`typecheck`, `lint`, `format:check`, `test`) individually too.
- `npm test` / `npm run test:watch` — Vitest, `tests/**/*.test.ts`. Single test: `npx vitest run tests/search.test.ts -t "name of it() block"`.
- `npm run build && npm run preview` — production build, served locally, for anything that needs a real service worker (the dev server doesn't run one).
- `node scripts/e2e-smoke.mjs <corpus-dir> <out-dir>` — manual Playwright pass against a running preview build (import → search → read → reload). Not part of `npm run check`; see `scripts/README.md`.

## Architecture

Three layers, strictly separated by where they run:

- **`src/core/`** — pure logic, no DOM, unit-tested directly (`parser.ts`, `search.ts`, `types.ts`). This is the only place that should ever need a new unit test.
- **`src/worker/`** — everything that touches OPFS/IndexedDB or does real parsing/searching runs in `library.worker.ts`, off the main thread. `api.ts` defines the `LibraryApi` RPC surface; `src/main.ts` gets a `Comlink.wrap`'d proxy to it, and every UI module talks to the library only through that proxy (`Store.api` in `src/ui/store.ts`). Search results stream back via a `Comlink.proxy()` callback per file, not a single batched return.
- **`src/ui/`** — main-thread rendering only. Never parses or searches; always calls into the worker and renders what comes back.

**Data model** (`core/types.ts`): each file is parsed once, at import, into a flat `Block[]` — not a tree. Every block carries its full heading ancestry (`headingPath: string[]` / `headingIds: string[]`), which is the single mechanism that makes both search granularities work: a search hit is a block, and "expand to the containing chapter" is just walking `headingIds` — no separate tree structure to keep in sync. `core/parser.ts` builds this by tracking a heading stack while iterating markdown-it's token stream once.

**Storage split**: `storage/opfs.ts` persists, per file, the plain-text concatenation of every block (one contiguous string) plus the block list as JSON (`StoredBlock` — `Block` minus `text`, which is recovered by slicing the contiguous string on load, so it isn't duplicated on disk). `storage/db.ts` (IndexedDB via `idb`) holds only metadata: `FileMeta`, the saved directory handle, saved search sets. Nothing is re-parsed on reopen — `library.worker.ts`'s `init()` just reads both back and reconstructs `Block[]` via `fromStored`.

**Search** (`core/search.ts`): a linear regex scan over each file's contiguous text — deliberately no inverted index, since a full scan of a ~6 MB library already returns in well under 100 ms. `compileTerms` builds one `RegExp` per term (whole-word uses Unicode-aware lookaround, not `\b`, which is ASCII-only). `scanText` finds all matches, `groupMatchesByBlock` maps absolute offsets back to blocks via binary search on `charStart`, and `combineHits` applies the any/all/all-in-section boolean rule — "section" means "shares the nearest ancestor heading at or above a configurable level," resolved via `sectionKeyByLevel`, not a fixed heading level.

**Rendering** (`ui/render.ts`, `BlockList`): mounts a whole book as nested `<section>`s (one per heading) with non-heading blocks grouped into fixed-size chunks. Every block stays in the DOM — this is not a virtual list — and `content-visibility: auto` + `contain-intrinsic-size` is what keeps scrolling cheap despite that; chunks render their Markdown lazily via `IntersectionObserver`. Headings are the deliberate exception: their text renders synchronously at book-open time so nothing flashes empty while scrolling, but **highlighting for headings must be deferred until after the book's `DocumentFragment` is attached to the live document** — creating a `Range` against a node still inside a detached fragment gets silently corrupted once that node is later moved (see `LEARNINGS.md` #9 for the exact DOM-spec mechanism). If you touch `BlockList.build()`, preserve that ordering.

**Highlighting** (`ui/highlight.ts`, `Highlighter`): one `Highlight` object per colour slot, registered via `CSS.highlights.set("term-N", ...)` and styled with `::highlight(term-N)` — never mutates the rendered DOM. Built by walking a block's text nodes with a `TreeWalker`, concatenating into one string with an offset map, running the compiled term regexes, and mapping matches back to `Range` objects. There's a `<mark>`-wrapping fallback behind `if (!CSS.highlights)` for browsers without the API; it isn't exercised in normal (Chromium) testing (see `docs/ISSUES.md`).

**iOS is the primary target, not a fallback**: `showDirectoryPicker()` is used where available, but `<input type=file webkitdirectory multiple>` (`ui/import.ts`) is treated as the primary import path rather than a degraded one, because iOS Safari only has it.

For the full picture (why linear-scan search is correct at this scale, the PWA/offline setup, testing approach) see `README.md`. For difficulties hit during development and whether each could have been caught statically, see `LEARNINGS.md`. For what's left and known gaps, see `docs/ROADMAP.md` and `docs/ISSUES.md`.
