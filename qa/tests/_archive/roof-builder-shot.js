// Screenshot harness for the roof estimator's "Build an estimate" card.
//
// Logs into the local dev server ONCE (the session is cached on disk for an
// hour — the login route allows 8 attempts per email per 15 minutes), opens
// /dashboard/roof-estimator, enters a hand takeoff (squares + pitch → "Price
// by hand") so the card mounts without EagleView, optionally clicks things,
// then shoots the card and the page. Each run launches its own headless
// Chromium, so several runs can go at once.
//
//   node qa/tests/_archive/roof-builder-shot.js --builder=a --width=1440 --out=C:/tmp/a-1440
//
//   --builder   a | b | c | current   → /dashboard/roof-estimator?builder=<x>
//   --width     viewport width; 1440 (default, desk) or 390 (handheld)
//   --out       path prefix; writes <out>-card.png ([data-build-card] element,
//               full height) and <out>-page.png (the viewport)
//   --click     Playwright selector to click before shooting, repeatable
//               e.g. --click="[data-build-card] button:has-text('Edges')"
//   --type      selector=text to fill before shooting, repeatable
//   --hide      selector to hide (visibility) before the card shot, repeatable;
//               the shell's sticky header is hidden by default
//   --hover     selector to hover last, just before the shots (repeatable; last wins)
//   --wait      ms to settle after the clicks (default 600)
//   --squares   roof size for the hand takeoff (default 24)
//   --pitch     pitch option for the hand takeoff (default 6/12)
//   --email / --password   login (default qa@acme.test / qa-pass-2026)
//   --fresh     ignore the cached session and log in again
//
// Prints console errors and the card's rendered size.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright-core");

const args = {};
const multi = { click: [], type: [], hide: [], hover: [] };
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  if (m[1] in multi) multi[m[1]].push(m[2] ?? "");
  else args[m[1]] = m[2] ?? "1";
}
const builder = args.builder || "current";
const width = Number(args.width || 1440);
const height = width <= 480 ? 844 : 900;
const out = args.out || path.join(process.cwd(), `roof-builder-${builder}-${width}`);
const wait = Number(args.wait || 600);
const squares = args.squares || "24";
const pitch = args.pitch || "6/12";
const email = args.email || "qa@acme.test";
const password = args.password || "qa-pass-2026";
const base = args.base || QA_BASE;
const hides = ["header.topbar", ...multi.hide];

const exe = [
  path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"),
  path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe"),
  path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe"),
].find((p) => fs.existsSync(p));
if (!exe) {
  console.error("No Playwright Chromium found under ~/AppData/Local/ms-playwright.");
  process.exit(1);
}

// One login per hour per account: the session cookies are kept next to the
// harness and reused, so parallel runs do not trip the login rate limit.
const sessionFile = path.join(os.tmpdir(), `jobflex-qa-session-${email.replace(/[^a-z0-9]/gi, "_")}.json`);
const sessionFresh = () => {
  try {
    return !args.fresh && fs.existsSync(sessionFile) && Date.now() - fs.statSync(sessionFile).mtimeMs < 60 * 60 * 1000;
  } catch {
    return false;
  }
};

(async () => {
  const browser = await chromium.launch({ executablePath: exe });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ...(sessionFresh() ? { storageState: sessionFile } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));

  const url = base + "/dashboard/roof-estimator" + (builder === "current" ? "" : `?builder=${builder}`);
  const login = async () => {
    // Desk width: the handheld login page has other ids.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/auth/login", { waitUntil: "domcontentloaded" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 45000 }), page.click('button[type="submit"]')]);
    await context.storageState({ path: sessionFile });
  };

  await page.setViewportSize({ width, height });
  let resp = await page.goto(url, { waitUntil: "networkidle" });
  if (/\/auth\/login/.test(page.url()) || (resp && resp.status() >= 400)) {
    await login();
    await page.setViewportSize({ width, height });
    resp = await page.goto(url, { waitUntil: "networkidle" });
  }
  await page.waitForSelector("#manSquares", { timeout: 45000 });
  await page.fill("#manSquares", squares);
  await page.selectOption("#manPitch", pitch);
  await page.click("#manualBtn");
  const cardSel = "[data-build-card], .rf-build";
  await page.waitForSelector(cardSel, { state: "visible", timeout: 30000 });
  await page.waitForTimeout(900); // reveal cascade + catalog load

  for (const t of multi.type) {
    const i = t.indexOf("=");
    await page.fill(t.slice(0, i), t.slice(i + 1));
  }
  for (const sel of multi.click) {
    await page.click(sel, { timeout: 15000 });
    await page.waitForTimeout(250);
  }
  if (multi.click.length || multi.type.length) await page.waitForTimeout(wait);

  const card = page.locator(cardSel).first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "-page.png", fullPage: false });
  // The sticky header would paint over the head of a tall card in an element
  // shot (Playwright scrolls the element through the viewport).
  await page.addStyleTag({ content: hides.map((s) => `${s}{visibility:hidden!important}`).join("") });
  // `.main` is the page scroller, not the window, so an element taller than
  // the viewport comes out clipped: grow the viewport to the card first
  // (fluid zoom keys off the width only, so the composition is unchanged).
  let box = await card.boundingBox();
  if (box && box.height + 120 > height) {
    await page.setViewportSize({ width, height: Math.min(Math.ceil(box.height) + 160, 8000) });
    await page.waitForTimeout(300);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    box = await card.boundingBox();
  }
  for (const sel of multi.hover) {
    await page.hover(sel, { timeout: 15000 });
    await page.waitForTimeout(250);
  }
  await card.screenshot({ path: out + "-card.png" });

  console.log("url:", url);
  console.log("card:", box ? `${Math.round(box.width)}×${Math.round(box.height)} px` : "no box");
  console.log("saved:", out + "-card.png", "and", out + "-page.png");
  console.log("console errors:", errors.length ? "\n  " + errors.join("\n  ") : "none");
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
