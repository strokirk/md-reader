# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Conventions

- Commit directly to `main` and push eagerly as you go — don't batch work into one big commit at the end.
- Read `LEARNINGS.md` before nontrivial work. Add an entry for every difficulty or bug you hit, noting whether it could have been caught statically (`tsc`/ESLint) — this is a standing project requirement, not optional.
- Keep `docs/ROADMAP.md` and `docs/ISSUES.md` current as things change.
- One-off diagnostic/dev scripts (Playwright checks, fixture generators) go in `scripts/`, committed, not in `/tmp` — see `scripts/README.md`.

## Commands

- `npm run check` — typecheck + lint + format check + unit tests. Run this before considering anything done.
- `npm test` — Vitest (`tests/**/*.test.ts`). Single test: `npx vitest run tests/search.test.ts -t "name"`.
- `npm run build && npm run preview` — needed for anything touching the service worker; the dev server doesn't run one.

## Architecture

- `src/core/` — pure logic, no DOM (`parser.ts`, `search.ts`, `types.ts`). The only place that needs unit tests.
- `src/worker/` — all parsing/searching and all OPFS/IndexedDB access happens in `library.worker.ts`, off the main thread, exposed via Comlink (`api.ts`'s `LibraryApi`). Search results stream back per file, not as one batch.
- `src/ui/` — main thread, rendering only. Talks to the library exclusively through the worker proxy (`Store.api`); never parses or searches directly.
- **Data model**: each file becomes a flat `Block[]`, not a tree (`core/types.ts`). Every block carries its full heading ancestry (`headingPath`/`headingIds`) — that's what lets "expand a search hit to its containing chapter" work without a separate tree structure.
- **Search** (`core/search.ts`): linear regex scan over each file's contiguous text, no inverted index — fast enough at this corpus size. Matches map back to blocks via binary search on `charStart`.
- **Rendering** (`ui/render.ts`): every block stays in the DOM (not virtualized); `content-visibility: auto` keeps scrolling cheap. Headings render synchronously at book-open time; **highlighting them must be deferred until after the book's container is attached to the live DOM** — creating a `Range` against a node still inside a detached `DocumentFragment` gets silently corrupted when that node is later moved. See `LEARNINGS.md` #9 before touching `BlockList.build()`.
- **Highlighting** (`ui/highlight.ts`): CSS Custom Highlight API (`CSS.highlights`/`::highlight()`), not DOM mutation. `<mark>`-wrapping fallback for browsers without it.

See `README.md` for the full picture, `docs/ROADMAP.md`/`docs/ISSUES.md` for what's left.
