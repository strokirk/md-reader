# Architecture

Vite + TypeScript (strict mode) + vanilla DOM (no framework — see
`src/ui/dom.ts` for the small `h()` element-builder this app uses instead).

```
src/
  core/         Pure, framework-free logic — unit tested, no DOM.
    types.ts      Shared data model (Block, SearchQuery, FileMeta, ...).
    parser.ts     Markdown -> flat Block[] list, via markdown-it's tokenizer.
    search.ts     Regex scan, offset->block mapping, boolean combination.
  worker/       Everything that touches OPFS/IndexedDB or does real parsing
                or searching runs here, off the main thread, wired to the UI
                via Comlink (see api.ts for the RPC surface).
    library.worker.ts
    api.ts
  storage/      OPFS (parsed text + blocks per file) and IndexedDB (file
                metadata, saved directory handle, saved searches) helpers.
    opfs.ts
    db.ts
  ui/           Main-thread rendering only. No parsing or searching happens
                here — it calls into the worker and renders what comes back.
    render.ts      BlockList: mounts a book as lazily-rendered chunks.
    highlight.ts    Highlighter: CSS Custom Highlight API wrapper, with a
                     <mark>-wrapping fallback for browsers without it.
    reader-view.ts, search-panel.ts, library-view.ts, toc.ts,
    settings-sheet.ts, store.ts, import.ts, dom.ts, settings.ts
  main.ts       Wires it all together: routing, drag-and-drop, share target,
                launch queue, toasts.
  sw.ts         Service worker (via vite-plugin-pwa, injectManifest mode):
                app-shell precaching + Web Share Target handling.
```

## Data model

Each file is parsed once, at import time, into a **flat list of blocks**
(`Block[]` in `core/types.ts`), not a document tree. Every block carries its
full heading ancestry (`headingPath` / `headingIds`), which is what lets one
index serve both search granularities: match at block level, then expand
any hit up to its containing heading with one tap, because the ancestry is
already on the block — no separate tree walk needed at query time.

Two things are written to OPFS per file: the block list (JSON, without the
redundant `text` field — see `StoredBlock` — since that's recovered by
slicing) and the plain-text concatenation of every block as one contiguous
string. Search scans that contiguous string directly (see below); rendering
uses each block's `md` (source Markdown) field, via `markdown-it`, lazily.

## Search

At this corpus size a **linear regex scan in a worker is the right answer**
— there's no inverted index. `core/search.ts` compiles each term to a
`RegExp` (escaped for literal mode, or used raw in regex mode; whole-word
adds Unicode-aware lookaround since `\b` is ASCII-only in JS), scans the
per-file contiguous text once per term, then maps absolute match offsets
back to blocks via binary search over each block's `charStart` (see
`blockIndexForOffset`). Results stream in per file
(`LibraryApi.search`'s `onFileHits` callback via Comlink), so the first
hits appear before the whole library has been scanned.

Boolean combination (`combineHits`) supports any-of, all-of, and
all-of-within-the-same-section, where "section" means "shares the nearest
ancestor heading at or above a configurable level" (`sectionKeyByLevel`).

## Rendering

`ui/render.ts`'s `BlockList` mounts an entire book as nested `<section>`
elements (one per heading), with paragraph/list/table/etc. blocks grouped
into ~40-block chunks. Every block stays in the DOM — nothing is virtualized
— which is what keeps scroll anchoring, in-page find, and text selection
working. What keeps this fast at 60 fps despite a huge DOM is
`content-visibility: auto` with `contain-intrinsic-size` on both the
section wrappers and the chunks: the browser skips layout/paint for
anything off-screen. Chunks render their Markdown to HTML lazily, via an
`IntersectionObserver`, only as they approach the viewport.

Headings are the one exception: they render their text **synchronously**
at book-open time (so the page doesn't flash empty headings while
scrolling), while their body content still renders lazily. See
`LEARNINGS.md` #9 for a real bug this caused with highlighting.

## Highlighting

`ui/highlight.ts`'s `Highlighter` registers one `Highlight` per colour slot
via the CSS Custom Highlight API (`CSS.highlights.set("term-N", ...)`,
styled with `::highlight(term-N)` in `style.css`) and never mutates the
rendered DOM to paint a match — it walks each block's text nodes with a
`TreeWalker`, builds an offset map, runs the term regexes, and maps matches
back to `Range` objects. Re-highlighting on term changes is just
clearing/re-adding Ranges, not touching the DOM tree, so it stays cheap
even while scrolling. A `<mark>`-wrapping fallback (`if (!CSS.highlights)`)
covers browsers without the API.

## Testing

`tests/parser.test.ts` and `tests/search.test.ts` cover the pure logic
(Markdown → blocks, offset mapping, the search matcher, boolean
combination) with Vitest — no DOM, no browser needed, part of `pnpm run
check`.

There's no automated browser/UI test suite wired into CI — see
`scripts/README.md` for the manual Playwright scripts used during
development instead (generating a test corpus, a general import/search/
read/reload smoke pass, and a genuine offline-reload check against the
service worker). Run any of them against a local preview build (the dev
server doesn't run a service worker, so use `preview` for the offline one):

```sh
pnpm run build && pnpm run preview &
node scripts/gen-test-corpus.mjs /tmp/corpus
node scripts/e2e-smoke.mjs /tmp/corpus /tmp/out
node scripts/verify-offline.mjs /tmp/corpus
```

## iOS notes

- `showDirectoryPicker()` is used where available; iOS Safari only has
  `<input type=file webkitdirectory multiple>`, so that fallback is treated
  as the primary import path, not a degraded one (see `ui/import.ts`).
  Drag-and-drop and the Web Share Target (`share-target` in the manifest,
  handled in `sw.ts`) are additional import paths.
- Viewport height uses `100dvh` (with `-webkit-fill-available` as a
  belt-and-suspenders fallback), all fixed chrome pads with
  `env(safe-area-inset-*)`, and `-webkit-text-size-adjust: 100%` plus
  relative (`em`/`%`) sizing throughout respects Dynamic Type.
- `Settings → Storage` surfaces `navigator.storage.estimate()` and calls
  `navigator.storage.persist()` on import so the library isn't evicted
  under pressure; a quota error during import is caught and reported
  rather than silently losing files (see `QuotaExceededError` in
  `storage/opfs.ts`).
