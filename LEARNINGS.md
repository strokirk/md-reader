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

## Process notes (not code bugs)

### 10. A Playwright test timeout that wasn't an app bug

After the fix above, a follow-up validation script (`probe4.mjs`) twice hit
a plain 30 s `waitForFunction` timeout waiting for imported books to
appear — looking exactly like a regression. Before assuming the fix broke
something, a fully-instrumented pass (`console`/`pageerror`/`requestfailed`
listeners, explicit per-step timeouts, polling via `evaluate` instead of
`waitForFunction`) showed the import actually completing in under 3
seconds; re-running the original unmodified script immediately after
succeeded too. `ps`/`free` showed no orphaned Chromium processes and ample
free memory, ruling out resource exhaustion from repeated `chromium.launch()`
calls (a real risk when a script exits via an uncaught exception before its
`browser.close()` runs — worth guarding with `try/finally` regardless).
**Caught statically?** N/A — this was environmental flakiness in headless
Chromium cold-starts under a sandboxed container, not a code issue at all.
The lesson is procedural: when a browser-automation check fails, add
instrumentation and retry with generous timeouts before concluding the
application regressed, especially when nothing in the diff plausibly
explains the failure mode.
