# Known issues

Nothing here blocks the definition-of-done workflow (import → search →
read with highlights → expand to chapter → reload offline at the same
position), but these are gaps worth knowing about.

- **No automated CI test run against a real browser.** `npm run check`
  covers typecheck/lint/format/unit tests; there is no CI job that builds
  the app and drives it with Playwright. `scripts/e2e-smoke.mjs` exists for
  manual use but isn't scheduled or gated on. See `docs/ROADMAP.md`.
- **iOS Safari / WebKit specifics are unverified on a real device.** This
  project has been built and validated against headless Chromium in a
  mobile viewport + UA, which exercises layout and most JS APIs but is not
  a substitute for real Safari — in particular `CSS.highlights` support and
  performance, OPFS quota limits and eviction behaviour, and
  `hidden="until-found"`/`beforematch` support should be confirmed on an
  actual iPhone.
- **`resync()` change detection is size + mtime based**, not content-hash
  based (see `docs/ROADMAP.md`). A file replaced with different content but
  the same size and an unchanged or backdated modification time won't be
  picked up until the next full library removal/re-add.
- **The `<mark>`-wrapping highlight fallback (non-native browsers) is
  logic-tested but not exercised end-to-end** in a real browser lacking
  `CSS.highlights`. It shares the same term-matching logic as the native
  path (covered by unit tests) but its DOM-splitting/wrapping code
  (`wrapMarks`/`unwrapMarks` in `src/ui/highlight.ts`) has not been driven
  through a real render.
- **Very large single files (tens of MB) are untested.** The project's
  target is "libraries in the tens of megabytes," and the search design
  (linear scan) is chosen deliberately for that scale, but no single test
  file anywhere near that size has been exercised — only a synthetic ~6 MB
  library across several books.
