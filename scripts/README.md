# scripts/

One-off and semi-complex dev scripts live here, committed, instead of in a
throwaway temp directory. Two reasons: they're reusable the next time the
same kind of check is needed, and — the main one — this directory doubles
as a log of what triggered reaching for a script instead of a one-line
shell command, which is worth keeping visible in git history.

None of these run in CI or `pnpm run check`; they're manual tools for local
development against a running preview build (`pnpm run build && pnpm run
preview`, since the dev server doesn't run a service worker).

| Script                           | Triggered by                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gen-test-corpus.mjs`            | Needed a realistic multi-book, multi-megabyte Markdown corpus to validate the project's actual performance requirements (sub-100ms search, 60fps scroll on a real-sized library) without real content to hand.                                                                                                                                              |
| `e2e-smoke.mjs`                  | General import → search → read → navigate → reload pass with timing output, used repeatedly through development as the primary manual regression check.                                                                                                                                                                                                     |
| `diagnose-heading-highlight.mjs` | A three-term search highlighted matches in paragraphs but silently not in headings — no error anywhere. Found by reaching directly into the live `CSS.highlights` registry mid-test, something no unit test or type checker can do. See `LEARNINGS.md` #9 for the actual bug (a `Range` created against a node still inside a detached `DocumentFragment`). |
| `verify-offline.mjs`             | The project's definition of done specifically requires the app to work "reopened from the home screen, offline" — a plain page reload doesn't actually prove the service worker's precache is what's serving it (IndexedDB/OPFS alone would pass a reload test too). This goes genuinely network-offline (`context.setOffline(true)`) before reloading.     |

## Convention going forward

- Prefer plain shell (`grep`/`sed`/pipes) for anything a one-liner can do.
- Reach for a script here once something needs: a real browser (Playwright),
  generated fixture data, or more than a few lines of throwaway logic worth
  being able to re-run later.
- Start the file with a `// Triggered by: ...` comment explaining what
  prompted it — the point of keeping these is the "why," not just the code.
- Don't commit near-duplicate iterations of the same investigation. Several
  scratch variants of `diagnose-heading-highlight.mjs` were written while
  narrowing down that bug (progressively adding console/network
  instrumentation, then finally inspecting `CSS.highlights` directly); only
  the version that actually isolated the finding is kept.
