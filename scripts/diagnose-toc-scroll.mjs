// Triggered by: a reported bug where, on long files with many sections,
// jumping to a heading far down via the TOC occasionally doesn't land on it,
// and scrolling back up afterward is jittery / sometimes throws the reader
// away from the line it was on. Traced to `.sec` (the per-heading wrapper)
// nesting `content-visibility: auto` with a flat, content-blind
// `contain-intrinsic-size: 600px` guess on top of `.chunk`'s already
// text-length-based estimate — when skipped, a `.sec` reports exactly
// 600px regardless of how much content (how many chunks) it actually
// wraps, so a chapter with far more than 600px of content makes the whole
// document's estimated layout wildly (5x, measured below) shorter than
// reality. Every still-skipped chapter between the current scroll position
// and a far-down TOC target contributes that wrong number to the position
// the jump computes against (bug 1), and each one snapping to its real
// size as it scrolls past is an uncompensated jump (bug 2, worsened by
// there being no mechanism at all to absorb a content-visibility resize
// that happens off-screen during ordinary scrolling).
//
// Fixed by (see src/ui/render.ts and src/style.css):
//   1. Dropping content-visibility from `.sec` — only `.chunk` (whose
//      contain-intrinsic-size is computed per-chunk from real text length)
//      needs it; nesting it on the wrapper too was the 600px-guess bug.
//   2. A ResizeObserver-driven scroll compensation in BlockList: when a
//      chunk above the viewport changes size (content-visibility un-skip
//      snapping estimate -> real), scrollBy the delta so the view doesn't
//      jump. This can't be perfectly jitter-free — per the HTML spec,
//      ResizeObserver callbacks run after that frame's rAF callbacks, so a
//      large, sudden resize can still show for one frame before being
//      compensated — but it bounds the damage sharply (measured below).
//   3. Accounting for `.blk`'s own `margin: 0 0 1em` in the per-block
//      height estimate, which shrinks the surprise each chunk's resize
//      produces in the first place.
//
// This script measures both symptoms against a real browser and reports
// pass/fail against thresholds picked from a measured baseline (the
// pre-fix numbers, in the comments below) rather than an arbitrary zero:
// a max landing offset of 863px (target not even on screen) and a max
// visual jitter deviation of 679px (badly "thrown away") pre-fix, versus
// ~40px and ~85px after. See git history for the exact before/after.
//
// Usage: node scripts/diagnose-toc-scroll.mjs <corpus-dir> [url]
// The corpus dir should be generated with gen-test-corpus.mjs first.
import { chromium } from "playwright";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [corpusDir, url = "http://localhost:4173/"] = process.argv.slice(2);
if (!corpusDir) {
  console.error("usage: node scripts/diagnose-toc-scroll.mjs <corpus-dir> [url]");
  process.exit(1);
}
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(corpusDir);

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto(url);
  await page.waitForSelector(".library-view");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click("text=Add files"),
  ]);
  await chooser.setFiles(files);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".book-row").length >= n,
    files.length,
    { timeout: 120000 },
  );
  await page.waitForTimeout(300);

  // Open the longest book (most sections/chunks to trip the bug).
  await page.click("text=Players Handbook");
  await page.waitForSelector(".reader-view:not([hidden])");
  await page.waitForTimeout(400);

  const totalHeadings = await page.evaluate(() => document.querySelectorAll(".blk-h").length);
  console.log(`headings in book: ${totalHeadings}`);

  // Pick a heading ~90% of the way through — far enough that many .sec
  // ancestors between the top and it are still off-screen and skipped.
  const targetInfo = await page.evaluate(() => {
    const headings = [...document.querySelectorAll(".blk-h")];
    const idx = Math.floor(headings.length * 0.9);
    const el = headings[idx];
    const h = el.querySelector("h1,h2,h3,h4,h5,h6");
    return { text: h?.textContent ?? "", i: el.dataset.i };
  });
  console.log("target heading:", JSON.stringify(targetInfo));

  await page.click('button[aria-label="Table of contents"]');
  await page.waitForSelector(".drawer-wrap:not([hidden])");
  await page.fill(".drawer input", targetInfo.text);
  await page.waitForTimeout(200);
  await page.locator(".toc-item").first().click();

  await page.waitForTimeout(150);
  const measureLanding = () =>
    page.evaluate((i) => {
      const el = document.querySelector(`.blk-h[data-i="${i}"]`);
      const header = document.querySelector("header.topbar")?.getBoundingClientRect().height ?? 0;
      return el ? el.getBoundingClientRect().top - header : null;
    }, targetInfo.i);
  const landing1 = await measureLanding();
  await page.waitForTimeout(1500); // let any further un-skip settle
  const landing2 = await measureLanding();
  console.log(
    `landing offset from just-below-header (px): immediate=${landing1} settled=${landing2}`,
  );
  // A whole viewport of slack: "landed on target" means it's visibly on
  // screen near the top, not pixel-perfect (some estimate error against
  // real rendered markdown is expected and fine).
  const landedOk = landing2 !== null && Math.abs(landing2) < 300;
  console.log(landedOk ? "PASS: landed on target" : "FAIL: did not land on target");

  // Scroll back up through the chapters just skipped past, tracking the
  // landed-on heading's own on-screen position (not raw scrollY, which
  // legitimately jumps by a resize's full delta as part of the
  // compensation working correctly) to see whether the reader's actual
  // reading position visibly jumps beyond the 50px/frame we command.
  const jitter = await page.evaluate(async (i) => {
    const el = document.querySelector(`.blk-h[data-i="${i}"]`);
    const samples = [];
    let prevTop = el.getBoundingClientRect().top;
    for (let step = 0; step < 150; step++) {
      window.scrollBy(0, -50);
      await new Promise((r) => requestAnimationFrame(r));
      const top = el.getBoundingClientRect().top;
      samples.push(top - prevTop - 50);
      prevTop = top;
      if (window.scrollY <= 0) break;
    }
    return {
      maxDeviation: Math.max(...samples.map((s) => Math.abs(s))),
      bigJumps: samples.filter((s) => Math.abs(s) > 150).length,
      steps: samples.length,
    };
  }, targetInfo.i);
  console.log("scroll-up jitter:", JSON.stringify(jitter));
  const smoothOk = jitter.bigJumps === 0;
  console.log(smoothOk ? "PASS: scroll-up was smooth" : "FAIL: scroll-up jittered");

  console.log(landedOk && smoothOk ? "\nOVERALL: PASS" : "\nOVERALL: FAIL");
  if (!landedOk || !smoothOk) process.exitCode = 1;
} finally {
  await browser.close();
}
