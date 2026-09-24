// Save a page's HTML as a real browser sees it. dol.gov answers 403 to plain HTTP
// clients, so the release watcher (.github/workflows/release-watch.yml) reads the DOL and
// USCIS listing pages through headless Chromium. Usage: node scripts/fetch-page.mjs URL OUT
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: fetch-page.mjs URL OUT");
  process.exit(2);
}
const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
if (!res || res.status() >= 400) {
  console.error(`${url}: HTTP ${res?.status()}`);
  process.exit(1);
}
writeFileSync(out, await page.content());
await browser.close();
