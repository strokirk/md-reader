# Learnings

Every difficulty or error hit during development, in the order encountered,
with the fix and — as the project brief asks — whether it could have been
caught statically (by `tsc`/ESLint) rather than only at runtime or in a
browser.

## Tooling / dependency setup

### 1. `typescript@7` conflicts with `typescript-eslint`'s peer range

`npm install` failed with `ERESOLVE`: `typescript-eslint@8.69.0` peer-depends
on `typescript@>=4.8.4 <6.1.0`, but `npm view typescript version` resolved
to a `7.0.2` prerelease. Pinned `typescript` to the latest `5.x` (`~5.9.3`)
instead.
**Caught statically?** Yes, immediately, by npm's own resolver — before any
code was written. Not a code bug; an ecosystem-version mismatch. Lesson:
check a new toolchain's actual peer ranges before pinning "latest" for
every package.

### 2. `@types/markdown-it` conflicts with markdown-it's own bundled types

`markdown-it@15` ships its own TypeScript types; installing the separate
`@types/markdown-it` package too produced a real type conflict (its `Token`
type disagreed with the library's own `Token` on `attrs`' element type).
Removed `@types/markdown-it` and derived the `Token` type from the
library's own `parse()` return type instead
(`ReturnType<InstanceType<typeof MarkdownIt>["parse"]>[number]`), since the
public type export wasn't reachable via the expected subpath import.
**Caught statically?** Yes — `tsc` reported the exact conflicting property
before the app ever ran. Straightforward once diagnosed.

### 3. Missing DOM lib types for `FileSystemDirectoryHandle.keys()`/`.entries()` and `showDirectoryPicker`

TypeScript's bundled `lib.dom.d.ts` doesn't yet include the async iterator
methods on `FileSystemDirectoryHandle` or `Window.showDirectoryPicker`.
Added `src/types/fs-access.d.ts` with targeted `interface` augmentations
(and a `LaunchQueue`/`launchQueue` augmentation for the file-handling API).
**Caught statically?** Yes, `tsc` flagged every missing member before any
manual testing. Fixed by writing the missing ambient types once, rather
than reaching for `any`.

### 4. ESLint flagged a legitimate rest-destructure as unused

`const { text: _text, ...rest } = block` (used to drop `text` when writing
`StoredBlock`s) tripped `@typescript-eslint/no-unused-vars` on `_text`.
Added `ignoreRestSiblings: true` (plus `argsIgnorePattern`/`varsIgnorePattern:
"^_"` for the general case) to the rule config.
**Caught statically?** Yes, by design — this was ESLint doing its job; the
fix was a config adjustment, not a code change.

### 5. `no-confusing-void-expression` fought the project's event-handler style

Nearly every `on: { click: () => doSomething() }` inline handler (returning
`void`) tripped this rule across the whole UI layer — dozens of occurrences.
Rather than wrap every one-line handler in `{ }`, disabled the rule
project-wide as a style choice inconsistent with this codebase's terse
handler idiom.
**Caught statically?** Yes, correctly, by ESLint — this wasn't a bug, just a
rule whose opinion didn't match the chosen style. Worth deciding rule
config _before_ writing fifty call sites that all need the same override.

## Application bugs

### 6. Off-by-one errors in hand-written test fixtures

Early `search.test.ts` assertions asserted block indices (`[3, 9]` etc.)
that didn't match the actual flat block count of the sample document (I'd
miscounted while writing the fixture by hand). Vitest failed with clear
"expected X, got Y" diffs; fixed by correcting the expected indices, not
the implementation (the parser was right).
**Caught statically?** No — this is a data-correctness issue in a manually
authored test fixture, invisible to a type checker or linter. Only a
running test (or very careful manual counting) catches it. Lesson:
generate expected values from the same code path where practical, rather
than counting blocks by eye in a comment.

### 7. Toast notifications intercepted clicks on controls underneath them

`scripts/e2e-smoke.mjs`, driving a real Chromium, failed a click on a
segmented-control button ("All") with Playwright's "element intercepts
pointer events," pointing at a `<p>` from the search results — actually the
"Imported N files" toast, a `position: fixed` element with no
`pointer-events` rule, sitting on top of it. Fixed with `pointer-events:
none` on `.toast` (a toast should never be interactive, so this is
correct regardless of the bug it exposed).
**Caught statically?** No — this is a runtime layout/interaction issue.
Nothing in `tsc` or ESLint models element stacking or click interception;
only manual QA or browser automation surfaces it. This is the strongest
argument in this project for keeping `scripts/e2e-smoke.mjs` around even
though it isn't wired into CI.

### 8. Search-term `<input>` race under debounce

Typing in one term's input, then immediately clicking "Add term" or a
per-term toggle (Aa/ab/.*) on a _different_ row before the first input's
180 ms debounce fired, could drop the just-typed characters: the debounced
handler hadn't yet written the new pattern into `store.state.terms`, so the
next `commitTerms` call (triggered by the click) rebuilt the term list from
the _stale_ snapshot, overwriting the in-progress keystroke. Fixed by
reading live `<input>` values (`termsFromInputs()`) before any structural
change to the term list (add/remove/toggle), not just relying on the
debounced write path.
**Caught statically?** No — the types were correct throughout; this is a
logic bug about _when_ state is read relative to an async debounce, only
visible by actually typing quickly and clicking, or by reasoning carefully
about the debounce's timing window. No linter rule catches "you read stale
state before a debounced write lands."

### 9. Headings lost their search highlight — a DOM-fragment/Range bug (the interesting one)

**Symptom:** three-term search worked correctly and highlighted matches in
_paragraphs_, but a match inside a _heading_ text (e.g. "Chapter 3:
Grappling and Saving Throws") never showed any highlight colour — not even
after navigating to it as the "current match," which should always paint
with the accent colour regardless of term.

**Root cause:** `BlockList.build()` (`src/ui/render.ts`) constructs an
entire book inside a detached `DocumentFragment` for batching, then attaches
it to the live DOM once at the end via `this.root.replaceChildren(frag)`.
Regular paragraph/list/table blocks render their HTML _lazily_, via an
`IntersectionObserver` callback that can only fire once the element is
connected to the document (`IntersectionObserver` requires layout, which
requires connection) — so by the time their `onRender` callback (which
calls into the `Highlighter` and creates `Range` objects) runs, the DOM is
long since attached, and everything works. **Headings**, however, render
their text _synchronously_ during the initial `build()` pass, before the
fragment is attached — that's necessary so headings never flash in empty
partway through a scroll — and the code called `onRender` for them at that
same synchronous point, i.e. while they were still inside the detached
fragment.

The `Highlighter` creates a native `Range` object
(`document.createRange()` + `setStart`/`setEnd`) pointing at the heading's
text node, and registers it into a `Highlight` via
`CSS.highlights.get("term-N").add(range)`. Per the DOM Living Standard's
node-removal steps, when a node is later _removed_ from its parent — which
is exactly what happens, internally, the moment `replaceChildren` moves the
fragment's children into the live tree (a move is a remove-then-insert) —
any live `Range` whose boundary point lies _inside_ the removed subtree has
that boundary point reset to `(oldParent, oldIndex)`, i.e. it does **not**
follow the moved node to its new location. The `Range` doesn't throw or
become "detached" in any way TypeScript or a try/catch would surface — it
silently becomes a valid-looking but wrong `Range`, collapsed at
`(fragment, 0)` in the case observed. `CSS.highlights` then paints exactly
that empty, wrong range: nothing visible, no error anywhere.

This was invisible to `tsc` (`Range`'s type signature has no way to express
"this becomes invalid if the node is later moved elsewhere") and to
ESLint. It was only found by writing a throwaway Playwright script that
queried `[...CSS.highlights.get("term-2")]` and inspected each `Range`'s
`.collapsed`/`.startOffset`/`.toString()` directly in a live browser — the
kind of introspection no static tool can do, because the bug only exists
once real DOM mutation semantics run.

**Fix:** collect `{el, block}` pairs for headings during `build()` instead
of calling `onRender` immediately, then call `onRender` for all of them
_after_ `this.root.replaceChildren(frag)` — i.e. after the subtree is
genuinely connected and no further "move" will occur. Heading _text_ still
appears synchronously (no flash); only _highlighting_ is deferred by one
function call, imperceptible to the user.

**Caught statically?** No. This is a case where two individually reasonable
design choices — batch DOM construction via a fragment for performance,
and register highlights via live `Range` objects for correctness/perf per
the CSS Custom Highlight API's intended usage — combine into a bug that
only exists at the intersection of DOM mutation timing and highlight
registration timing. Neither `tsc` nor ESLint models DOM Range liveness or
document-fragment move semantics. The only ways to catch this are (a)
knowing the specific DOM spec clause in advance, or (b) exactly the kind of
runtime/browser instrumentation used here. Worth remembering generally:
**never create a `Range` (or `Selection`) against a node that will later be
moved between parents; only do so once the node is in its final, connected
position.**

### 12. TOC jumps on long files occasionally missed, and scroll-up was jittery — nested `content-visibility: auto` reporting a flat size guess

**Symptom:** on a file with many sections, jumping to a heading far down via
the TOC drawer occasionally landed far from the target instead of at the
top of the viewport, and scrolling back up afterward through the skipped
chapters was visibly jittery, sometimes throwing the reading position away
from where the reader actually was.

**Root cause:** `BlockList` renders each heading's content inside a
`<section class="sec">` wrapping a `<div class="sec-body">` of `<div
class="chunk">`s (`src/ui/render.ts`). `.chunk` already had `content-
visibility: auto` with a `contain-intrinsic-size` computed per chunk from
real block text length (`estimateHeight()`) — a reasonable guess. But `.sec`
_also_ had `content-visibility: auto`, with a flat, content-blind
`contain-intrinsic-size: auto 600px` (`src/style.css`). Per the CSS
Containment spec, a skipped `content-visibility: auto` element reports
_only_ its `contain-intrinsic-size` as its box — not the sum of its
(possibly also-skipped) children's sizes. So an off-screen chapter with far
more than 600px of real content (the common case — chapters routinely ran
to several thousand pixels in testing) reported exactly 600px regardless,
making the whole document's estimated layout dramatically shorter than
reality: measured at ~165,000px estimated vs. ~781,000px real for a
~3 MB/17,000-line synthetic book — roughly 4.7x off. Every such
still-skipped section between the current scroll position and a far-down
TOC target contributed that wrong number to the position the jump was
computed against, so `BlockList.scrollTo()`'s `el.scrollIntoView()` (and
its one-frame correction) could land far short of or past the real target.
Separately, as the reader scrolled up through those sections and each one's
`content-visibility` un-skipped (snapping from the 600px guess to its real
size), nothing compensated for the resulting layout shift — the app had no
resize-driven scroll-anchoring of its own, and nested `content-visibility`
is known to interact poorly with the browser's native CSS scroll anchoring
(a skipped ancestor's un-skip is a much larger, less "local" resize than
scroll anchoring is generally tuned for), producing visible, sometimes
large jumps.

**Fix:** dropped `content-visibility`/`contain-intrinsic-size` from `.sec`
entirely — only `.chunk` needs it, and letting `.sec`'s box be the real sum
of its (possibly still-skipped, but individually reasonably-estimated)
`.chunk` children's sizes fixed the ~4.7x low estimate. Added a
`ResizeObserver` in `BlockList` that watches every `.chunk` and, when one
resizes while positioned above the viewport, `scrollBy`s the delta so the
visible content doesn't jump — a manual, explicit version of what scroll
anchoring is supposed to provide, scoped to exactly the resize source that
was causing trouble. Also folded `.blk`'s own `margin: 0 0 1em` into
`estimateHeight()`'s per-block guess (previously omitted entirely), which
shrinks the size of the "surprise" each chunk's un-skip produces in the
first place and so shrinks how much the `ResizeObserver` compensation ever
has to correct for.

Verified with a new `scripts/diagnose-toc-scroll.mjs` (a synthetic ~3 MB/
17,000-line single book, `gen-test-corpus.mjs`) comparing before/after: TOC
jump landing offset went from 863px (target not visibly on screen) to
~40px; max visual jitter of the landed-on heading while scrolling up went
from 679px to ~83px, with zero >150px jumps (down from several). The
`ResizeObserver` compensation is not perfectly jitter-free even after the
fix — per the HTML spec, `ResizeObserver` callbacks run after that frame's
`requestAnimationFrame` callbacks, so a single frame of uncompensated
movement is possible before it catches up — but it bounds the damage
sharply. Documented as a known residual limitation in `docs/ISSUES.md`
rather than claimed as fully eliminated.

**Caught statically?** No. Nothing about `tsc` or ESLint models what a
skipped `content-visibility: auto` element reports as its own box size, or
that nesting it two levels deep changes that reporting from "sum of
children" to "the ancestor's own flat guess, full stop." This is exactly
the kind of interaction between two CSS containment rules that only shows
up by measuring real layout in a real browser at a realistic document size
— a small hand-written test fixture (a handful of headings/paragraphs)
would never have exposed a 600px-vs-thousands-of-pixels gap, since it takes
a chapter with meaningfully more than 600px of content, several chapters
deep and off-screen, to matter. Found by writing exactly that kind of
fixture (`gen-test-corpus.mjs`, already existing for this purpose) and
measuring `document.documentElement.scrollHeight` and element
`getBoundingClientRect()` before/after in a real headless-Chromium session
— the same category of "reach directly into the live browser state" tool
as `diagnose-heading-highlight.mjs` in #9.

## Process notes (not code bugs)

### 10. A Playwright test timeout that wasn't an app bug

After the fix above, a follow-up validation script hit a plain 30 s
`waitForFunction` timeout waiting for imported books to appear — twice in a
row, looking exactly like a regression. Before assuming the fix broke
something: `ps`/`free` first, to rule out the boring explanation (a leaked
`chromium.launch()` from an earlier script that exited via an uncaught
exception before reaching its `browser.close()` — a real risk with these
scripts, now mitigated by wrapping each in `try/finally`) — clean, nothing
leaked. Then a fully-instrumented rerun (`console`/`pageerror`/
`requestfailed` listeners, explicit per-step timeouts, polling instead of
`waitForFunction`) showed the import actually completing in under 3
seconds; the original unmodified script then succeeded immediately after
too.
**Caught statically?** N/A — environmental flakiness in headless-Chromium
cold starts under a sandboxed container, not a code issue. The takeaway:
when a browser-automation check fails right after a code change, check
process/resource state and add instrumentation before concluding the app
regressed — especially when nothing in the diff plausibly explains the
failure mode. See `scripts/README.md` for where these scripts live now.

### 11. Switching npm → pnpm broke the production build: a phantom dependency

`pnpm run build` failed with `Rolldown failed to resolve import
"workbox-window" from "/@vite-plugin-pwa/virtual:pwa-register"` — but
`pnpm run check` (typecheck/lint/tests) was entirely clean, and the exact
same source had built fine under npm moments earlier. `vite-plugin-pwa`
declares `workbox-window` as both a `dependency` (for its own Node-side
code) _and_ a `peerDependency` (because its `virtual:pwa-register` module
gets bundled into the app's own client code, so it needs to resolve from
the app's dependency graph, not the plugin's). This project never listed
`workbox-window` itself — under npm's flat, hoisted `node_modules` that
resolved anyway (something else's copy was reachable), silently. pnpm's
strict, symlink-isolated `node_modules` doesn't hoist like that: a peer
dependency has to be genuinely satisfied by the project, not just present
somewhere in the tree. Fixed by adding `workbox-window` as an explicit
devDependency (`pnpm add -D workbox-window@^7.4.1`, matching the other
`workbox-*` versions already pinned).
**Caught statically?** No — `tsc` and ESLint have no visibility into
runtime module resolution or bundler-level peer dependency enforcement;
this only surfaces when something actually tries to bundle/resolve the
import, which `pnpm run check` never does (only `build` does). This is a
known category of npm-vs-pnpm difference — "phantom dependencies," where
code relies on a transitive package that npm's hoisting happens to expose
but was never actually declared — worth specifically re-running a full
`build` (not just `check`) after any package-manager migration, since a
clean typecheck/lint/test pass doesn't exercise the bundler's module
resolution at all.
