// Set PLAYWRIGHT_MODULE to an installed Playwright module when it isn't in node_modules.
// Run: node scripts/redirect-gallery.e2e.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artworks = JSON.parse(await readFile(resolve(root, "internal/http/handler/gallery/artworks.json"), "utf8"));
assert.ok(Array.isArray(artworks) && artworks.length > 0, "the production gallery catalogue is not empty");
assert.equal(new Set(artworks.map(art => art.slug)).size, artworks.length, "artwork slugs are unique");
const screenshotArtworks = new Set();
const orientations = new Set();
for (const art of artworks) {
  assert.match(art.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "artwork slug is safe for a fixture filename");
  assert.ok(art.width > 0 && art.height > 0, "artwork dimensions are positive");
  const orientation = art.width === art.height ? "square" : art.width > art.height ? "landscape" : "portrait";
  if (!orientations.has(orientation)) {
    orientations.add(orientation);
    screenshotArtworks.add(art.slug);
  }
}
const output = resolve(root, "coverage/redirect-gallery-browser");
const fixtures = resolve(root, "coverage/redirect-gallery-fixtures");
await mkdir(output, { recursive: true });
execFileSync("go", ["test", "./internal/http/handler", "-run", "^TestGalleryBrowserFixtures$", "-count=1"], {
  cwd: root, env: { ...process.env, PURELS_GALLERY_FIXTURE_DIR: fixtures }, stdio: "pipe",
});
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (path === "/arrived") return response.end("<h1>Arrived</h1>");
  if (!/^\/[a-z0-9-]+\.html$/.test(path)) { response.writeHead(404); return response.end(); }
  try { response.end(await readFile(resolve(fixtures, basename(path)))); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(3175, "127.0.0.1", done); });
const browser = await chromium.launch({ headless: true });
const origin = "http://127.0.0.1:3175";
const destination = origin + "/arrived?keep=1&next=two#part";
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
page.on("pageerror", error => errors.push(error.message));
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  for (const art of artworks) {
    const { slug } = art;
    for (const [width, height, language] of [[1440, 900, "zh"], [390, 844, "zh"], [320, 844, "en"]]) {
      await page.setViewportSize({ width, height });
      const assets = [];
      const record = req => { if (req.resourceType() !== "document") assets.push(req.url()); };
      page.on("request", record);
      await page.goto(`${origin}/${slug}-${language}.html`);
      check(await page.locator("figure .art-mat > svg").count() === 1, "one inline artwork");
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${slug} has no horizontal overflow at ${width}px`);
      check(await page.locator("#continue-link").getAttribute("href") === destination, "manual destination preserves query and fragment");
      check(await page.locator("#pause-button").isHidden(), "preview has no pause action");
      check(assets.length === 0, "gallery is self-contained");
      check(await page.locator("#art-title").textContent() === (language === "zh" ? art.title : art.englishTitle), "the selected artwork has its localized title");
      // Every artwork is checked at all three widths; screenshots only capture
      // one landscape, portrait and square so the review output stays useful.
      if (screenshotArtworks.has(slug)) {
        await page.screenshot({ path: resolve(output, `${slug}-${language}-${width}.png`), animations: "disabled" });
      }
      page.off("request", record);
    }
  }
  await page.waitForTimeout(2200);
  check(!page.url().includes("/arrived"), "preview never redirects");
  await page.locator(".destination-details summary").click();
  await page.locator("#destination-url").evaluate(el => { el.textContent = "https://example.com/path?long=" + "x".repeat(8000); });
  check(await page.locator(".url-popover").evaluate(el => el.getBoundingClientRect().top >= 0 && el.scrollHeight > el.clientHeight), "long full address remains visible and scrollable");
  await page.keyboard.press("Escape");
  check(await page.locator(".destination-details").evaluate(el => !el.open), "Escape closes full address");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/interstitial-zh.html?review=1&mode=preview&art=fake`);
  check(await page.locator('meta[http-equiv="refresh"]').count() === 0, "JavaScript mode has no active meta refresh");
  await page.waitForTimeout(500);
  await page.locator("#pause-button").click();
  const progress = await page.locator("#progress-fill").getAttribute("style");
  await page.waitForTimeout(2300);
  check(!page.url().includes("/arrived"), "pause prevents real navigation");
  check(await page.locator("#progress-fill").getAttribute("style") === progress, "pause freezes remaining time");
  await page.screenshot({ path: resolve(output, "interstitial-paused.png"), animations: "disabled" });
  const resumedAt = Date.now();
  await page.locator("#pause-button").click();
  await page.waitForURL(destination);
  check(Date.now() - resumedAt < 1900, "resume continues remaining time instead of restarting");

  await page.goto(`${origin}/interstitial-en.html`);
  await page.locator("#continue-link").click();
  await page.waitForURL(destination);
  check(page.url() === destination, "manual continue reaches real target");

  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noJS.newPage();
  await fallback.goto(`${origin}/${artworks[0].slug}-zh.html`);
  check(await fallback.locator("figure .art-mat > svg").count() === 1, "art is visible without JavaScript");
  await fallback.waitForTimeout(2200);
  check(!fallback.url().includes("/arrived"), "no-JavaScript preview never redirects");
  await fallback.goto(`${origin}/interstitial-zh.html`);
  check(await fallback.locator("#pause-button").isHidden(), "no-JavaScript pause action stays hidden");
  await fallback.waitForURL(destination);
  check(fallback.url() === destination, "noscript auto-navigation preserves query and fragment");
  await noJS.close();
  check(errors.length === 0, `no JavaScript errors: ${errors.join(", ")}`);
  console.log(`PASS ${checks} production gallery browser checks across ${artworks.length} artworks. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
