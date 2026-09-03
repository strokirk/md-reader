# MD Reader

A static, client-side web app for reading and searching a personal library
of Markdown files — mostly tabletop RPG books. Import a folder of Markdown,
enter a few keywords, and read only the passages where they appear, with
every term highlighted in its own colour. No backend, no build-time content
baking, no accounts: everything lives in your browser.

It's designed to work beautifully on iPhone (installable to the home
screen, fully usable offline once a library is imported) and to stay fast
even on a large library — search over several megabytes of Markdown
returns in well under 100 ms.

## Getting it running

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

`pnpm dev` is enough for everyday development. A couple of things need a
real production build instead, because the dev server doesn't run a
service worker:

```sh
pnpm build        # production build to dist/
pnpm preview      # serve the production build locally
```

Deploying: any static host works. A GitHub Actions workflow
(`.github/workflows/deploy.yml`) builds and deploys `dist/` to GitHub Pages
on every push to `main` — see that file for the equivalent Cloudflare Pages
settings (build command `pnpm run build`, output directory `dist`).

## Using it

- **Add books.** From the library screen, add a folder (or individual
  files) of `.md`/`.markdown`/`.txt` files — or just drop them onto the
  page, or share them to the app from another app on iOS. Everything is
  parsed once and stored in your browser; reopening the app doesn't
  re-import anything.
- **Search.** Enter one or more terms, each gets its own colour. Per term:
  case-sensitive, whole-word, or regex matching. Combine terms as any-of,
  all-of, or all-within-the-same-section. Search either the current book
  or the whole library, and save a set of terms to reuse later.
- **Read.** Tap a result to jump straight to it in the reader, highlighted.
  Expand any hit up to its containing chapter with one tap. A table of
  contents drawer, prev/next match navigation, and font size/line
  width/light-dark controls are all in the reader. Your reading position
  is remembered per book.
- **Install it.** On iPhone, use Safari's Share → Add to Home Screen to
  install it as a standalone app; it works fully offline afterward.

## Project docs

- `docs/ARCHITECTURE.md` — how the app is built: the worker/storage/UI
  split, the data model, why search is a linear scan, how rendering and
  highlighting stay fast, iOS-specific notes.
- `CLAUDE.md` — guidance for Claude Code sessions working in this repo.
- `LEARNINGS.md` — difficulties hit during development and whether each
  could have been caught statically.
- `docs/ROADMAP.md` — near-term plan and backlog.
- `docs/ISSUES.md` — known gaps and bugs not yet fixed.
- `scripts/README.md` — what the committed one-off dev scripts are and why
  each was written.

## Built with

[Vite](https://vitejs.dev), [markdown-it](https://github.com/markdown-it/markdown-it),
[Comlink](https://github.com/GoogleChromeLabs/comlink) for the worker
boundary, [idb](https://github.com/jakearchibald/idb) for IndexedDB, and
[vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) /
[Workbox](https://github.com/GoogleChrome/workbox) for the service worker.
