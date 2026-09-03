// Browser smoke test: imports a corpus through the <input type=file> path,
// runs a three-term search, opens the reader, navigates matches, scrolls,
// reloads, and reports timings. Usage:
//   node scripts/e2e-smoke.mjs <corpus-dir> <out-dir> [url]
import { chromium } from "playwright";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [corpusDir, outDir, url = "http://localhost:4173/"] = process.argv.slice(2);
if (!corpusDir || !outDir) {
  console.error("usage: node scripts/e2e-smoke.mjs <corpus-dir> <out-dir> [url]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const statusDone = () =>
  page.waitForFunction(
    () => {
      const t = document.querySelector(".status")?.textContent ?? "";
      return /match/.test(t) && !/…/.test(t);
    },
    null,
    { timeout: 30000 },
  );

await page.goto(url);
await page.waitForSelector(".library-view");
await shot("01-empty");

const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.click("text=Add files"),
]);
const t0 = Date.now();
await chooser.setFiles(files);
await page.waitForFunction(
  (n) => document.querySelectorAll(".book-row").length >= n,
  files.length,
  { timeout: 120000 },
);
console.log(`import ${files.length} files: ${Date.now() - t0} ms`);
await page.waitForTimeout(300);
await shot("02-library");

await page.click('button[aria-label="Search"]');
await page.waitForSelector(".panel:not([hidden])");
const terms = ["grapple", "fireball", "saving throw"];
for (let i = 0; i < terms.length; i++) {
  if (i > 0) await page.click("text=Add term");
  await page.locator("input.term-input").nth(i).fill(terms[i]);
}
await page.keyboard.press("Enter");
await statusDone();
console.log("any:", await page.textContent(".status"));
await page.waitForTimeout(200);
await shot("03-search-any");
await page.click("text=All in section");
await statusDone();
console.log("all-section:", await page.textContent(".status"));
await shot("04-search-section");
console.log(
  "highlights:",
  await page.evaluate(() =>
    CSS.highlights
      ? [...CSS.highlights.entries()].map(([k, v]) => `${k}:${v.size}`).join(" ")
      : "no-api",
  ),
);
const expand = page.locator(".expand").first();
if (await expand.count()) {
  await expand.click();
  await page.waitForTimeout(400);
  await shot("05-expanded");
}
await page.locator(".group-blocks .hit").first().click();
await page.waitForSelector(".reader-view:not([hidden])");
await page.waitForTimeout(600);
console.log("hash:", await page.evaluate(() => location.hash));
console.log("counter:", await page.textContent(".counter"));
console.log("crumb:", await page.textContent(".crumb"));
await shot("06-reader");
console.log(
  "dom:",
  JSON.stringify(
    await page.evaluate(() => ({
      blocks: document.querySelectorAll(".blk").length,
      chunks: document.querySelectorAll(".chunk").length,
      rendered: document.querySelectorAll(".chunk.rendered").length,
    })),
  ),
);
for (let i = 0; i < 3; i++) {
  await page.click('button[aria-label="Next match"]');
  await page.waitForTimeout(150);
}
console.log("counter after next:", await page.textContent(".counter"));
await shot("07-next");
const scrollStats = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  let raf = 0;
  const tick = (t) => {
    frames.push(t - last);
    last = t;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const start = performance.now();
  for (let i = 0; i < 80; i++) {
    window.scrollBy(0, 900);
    await new Promise((r) => setTimeout(r, 16));
  }
  cancelAnimationFrame(raf);
  frames.sort((a, b) => a - b);
  const q = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1);
  return {
    totalMs: Math.round(performance.now() - start),
    p50: q(0.5),
    p95: q(0.95),
    max: q(1),
    frames: frames.length,
    scrollY: Math.round(scrollY),
  };
});
console.log("scroll:", JSON.stringify(scrollStats));
await page.waitForTimeout(1200);
console.log("crumb after scroll:", await page.textContent(".crumb"));
await page.click('button[aria-label="Table of contents"]');
await page.waitForTimeout(300);
await shot("08-toc");
await page.fill(".drawer input", "chapter 3");
await page.waitForTimeout(200);
await page.locator(".toc-item").first().click();
await page.waitForTimeout(500);
console.log("crumb after toc jump:", await page.textContent(".crumb"));
await page.waitForTimeout(1200);
const t1 = Date.now();
await page.reload();
await page.waitForSelector(".reader-view:not([hidden])");
await page.waitForFunction(() => (document.querySelector(".crumb")?.textContent ?? "").length > 0);
console.log(`reload → reader: ${Date.now() - t1} ms, crumb: ${await page.textContent(".crumb")}`);
await shot("09-reload");
await page.click('button[aria-label="Display settings"]');
await page.waitForTimeout(300);
await page.click("text=Light");
await page.waitForTimeout(300);
await shot("10-settings-light");
await page.click('.sheet-wrap button[aria-label="Close"]');
await page.click('button[aria-label="Back to library"]');
await page.waitForSelector(".library-view:not([hidden])");
await shot("11-library-light");
const problems = logs.filter((l) => !l.startsWith("[log]") && !l.startsWith("[debug]"));
console.log(problems.length ? problems.join("\n") : "(no console errors)");
await browser.close();
