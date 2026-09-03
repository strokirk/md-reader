// Triggered by: the project's definition of done requires reopening the app
// "from the home screen offline" and landing exactly where you left off —
// which a plain page reload doesn't actually verify, since a reload can
// succeed from HTTP cache/IndexedDB/OPFS alone without the service worker
// ever being exercised. This script goes network-offline for real
// (`context.setOffline(true)`, not just a devtools flag) and confirms the
// service worker's precache is what serves the reload.
//
// Usage: node scripts/verify-offline.mjs <corpus-dir> [url]
// (requires `npm run build && npm run preview` running at `url` — the dev
// server doesn't run a service worker)
import { chromium } from "playwright";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [corpusDir, url = "http://localhost:4173/"] = process.argv.slice(2);
if (!corpusDir) {
  console.error("usage: node scripts/verify-offline.mjs <corpus-dir> [url]");
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

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "allow",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.waitForSelector(".library-view");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click("text=Add files"),
  ]);
  const files = walk(corpusDir);
  await chooser.setFiles(files);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".book-row").length >= n,
    files.length,
    { timeout: 60000 },
  );

  await page.click(".book-row .book-main");
  await page.waitForSelector(".reader-view:not([hidden])");
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1200); // let the debounced reading-position save flush
  const crumbBefore = await page.textContent(".crumb");

  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const names = await caches.keys();
    let entries = 0;
    for (const n of names) entries += (await (await caches.open(n)).keys()).length;
    return { active: !!reg.active, cacheNames: names, entries };
  });
  console.log("service worker:", JSON.stringify(sw));
  if (!sw.active || sw.entries === 0)
    throw new Error("service worker not active or precache empty before going offline");

  await context.setOffline(true);
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  const reloadMs = Date.now() - t0;
  await page.waitForSelector(".reader-view:not([hidden])", { timeout: 10000 });
  await page.waitForFunction(
    () => (document.querySelector(".crumb")?.textContent ?? "").length > 0,
    null,
    {
      timeout: 10000,
    },
  );
  const crumbAfter = await page.textContent(".crumb");
  console.log(`offline reload: ${reloadMs} ms`);
  console.log(
    `reading position restored: ${crumbAfter === crumbBefore ? "yes" : "NO"} ("${crumbAfter}")`,
  );

  await page.click('button[aria-label="Back to library"]');
  await page.waitForSelector(".library-view:not([hidden])");
  const bookCount = await page.evaluate(() => document.querySelectorAll(".book-row").length);
  console.log(`library still lists ${bookCount}/${files.length} books while offline`);

  const ok = crumbAfter === crumbBefore && bookCount === files.length && errors.length === 0;
  console.log(ok ? "OK" : "FAILED");
  if (!ok) process.exitCode = 1;
} finally {
  if (errors.length) console.log("page errors:\n" + errors.join("\n"));
  await browser.close();
}
