// Functional pass over /dashboard/referrals. The code and its 3 conversions are QA Co fixtures (./_world).
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn, withWorld } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));

withWorld(async (world) => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  const clip = async () => { try { return await page.evaluate(() => navigator.clipboard.readText()); } catch { return ""; } };

  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/referrals", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  // ---- 1. Hero: real code + copy paths ----
  const code = ((await page.locator(".code-val, #codeVal").first().textContent()) || "").trim();
  log(code === world.referralCode, "hero: real referral code renders", code);
  await page.locator(".code-val, #codeVal").first().click();
  await page.waitForTimeout(400);
  log((await clip()) === world.referralCode, "hero: clicking the code copies it", await clip());
  await page.waitForTimeout(1800); // the code's own "copied" state has to clear first
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.locator(".code-copy").click();
  await page.waitForTimeout(500);
  const copied = await clip();
  log(copied.includes(world.referralCode), "hero: Copy button copies the code", copied.slice(0, 60));
  const doneState = await page.locator(".code-copy.done").count();
  log(doneState === 1, "hero: Copy button shows done state");

  // (2. The two link chips left the page with the 2026-09 redesign: the code and Share are the ways out.)

  // ---- 3. Share button (headless: clipboard fallback) ----
  await page.evaluate(() => navigator.clipboard.writeText(""));
  // The system Chrome has navigator.share (a sheet nobody can answer in headless); without it the
  // button falls back to copying — that fallback is what is under test.
  await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await page.waitForTimeout(1800);
  await page.click("#shareBtn");
  await page.waitForTimeout(600);
  const shared = await clip();
  log(shared.includes(world.referralCode), "share: falls back to copying the code", shared.slice(0, 60));

  // ---- 4. KPIs reflect seeded conversions ----
  const kpiText = (await page.locator(".content").innerText()).replace(/\s+/g, " ");
  log(/Code uses[^0-9]*3/i.test(kpiText), "kpi: Code uses = 3");
  log(/Converted[^0-9]*1/i.test(kpiText), "kpi: Converted = 1");
  log(/Pending[^0-9]*1/i.test(kpiText), "kpi: Pending = 1");

  // ---- 5. Conversions table + rf-chip filters ----
  const rows = () => page.locator("#convList > li:visible").count();
  log(await rows() === 3, "table: 3 conversion rows render", String(await rows()));
  const chips = page.locator(".rf-chip");
  const chipTexts = (await chips.allTextContents()).map(t => t.trim());
  log(chipTexts.length >= 3, "chips: filter chips render", chipTexts.join("/"));
  await chips.filter({ hasText: /Pending/i }).first().click();
  await page.waitForTimeout(400);
  log(await rows() === 1, "chips: Pending filters to 1", String(await rows()));
  await chips.filter({ hasText: /Converted/i }).first().click();
  await page.waitForTimeout(400);
  log(await rows() === 1, "chips: Converted filters to 1", String(await rows()));
  await chips.filter({ hasText: /All/i }).first().click();
  await page.waitForTimeout(400);
  log(await rows() === 3, "chips: All restores 3", String(await rows()));

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  await page.screenshot({ path: "referrals_final.png", fullPage: true });
  await browser.close();
}).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
