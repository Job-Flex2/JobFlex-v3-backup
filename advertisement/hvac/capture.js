// Film set: the real HVAC estimator on the stand, step by step, at 2x.
// Every screen is the app as it answers — the lookup, the plate reads, the load,
// the unit, the checks, the lines and the proposal are computed live.
//   node capture.js            → assets/*.png + assets/boxes.json
// Needs: the stand running (stand/serve.cjs on :3488 over its own copy of dev.db),
// a signed-in qa@acme.test session (stand/login.cjs), and
// NODE_PATH pointing at a node_modules with playwright-core. See README.txt.
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "assets");
const STATE = path.join(ROOT, ".cache/hvac-ad/state.json");
const DB = path.join(ROOT, ".cache/hvac-ad/hvac-ad.db");
const BASE = process.env.BASE || "http://localhost:3488";
// a real house (King County assessor record, building footprint at the pin)
const ADDR = process.env.ADDR || "12629 NE 100th Pl, Kirkland, WA 98033";
const W = 1440, H = 1300;
const T = 180000;
const CLEAN = "nextjs-portal{display:none!important}[data-trial-watermark]{display:none!important}*{caret-color:transparent!important}";

const boxes = {};
// the figures as the page printed them, for the film's callouts (assets/facts.json)
const facts = {};
// a KPI strip's cells: label · value · hint, as printed
const cells = (loc) => loc.locator("[class*='hero-cell']").evaluateAll((els) => els.map((c) => ({ label: c.querySelector("[class*='kpi-lbl']")?.textContent?.trim(), value: c.querySelector("[class*='hero-v']")?.textContent?.trim(), hint: c.querySelector("[class*='hero-h']")?.textContent?.trim() })));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ storageState: STATE, viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  // the bell counts nothing older than "now" (the shop's notifications are test rows)
  await ctx.addInitScript(() => { try { localStorage.setItem("jf.bell.seenAt", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));

  const rect = async (loc) => { const r = await loc.first().boundingBox().catch(() => null); return r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const idle = () => page.mouse.move(W - 4, H - 4);
  async function snap(name, marks = {}) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const m = {};
    for (const [k, loc] of Object.entries(marks)) m[k] = await rect(typeof loc === "string" ? page.locator(loc) : loc);
    boxes[name] = m;
    console.log(name, JSON.stringify(m));
  }
  // the page scrolls in its own container: bring a target to a y offset in the viewport
  async function bring(loc, y = 140) {
    await loc.first().evaluate((el, top) => {
      let s = el.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      const box = el.getBoundingClientRect();
      if (s) s.scrollTop += box.top - top; else window.scrollBy(0, box.top - top);
    }, y);
    await page.waitForTimeout(400);
  }
  const rail = (i) => page.locator("ol[aria-label=Steps] > li").nth(i);
  const aside = page.locator("aside[aria-label='Estimate summary']");

  await page.goto(`${BASE}/dashboard/hvac-estimator`, { waitUntil: "domcontentloaded", timeout: T });
  await page.waitForSelector("#hv-addr", { state: "attached", timeout: T });
  await page.addStyleTag({ content: CLEAN });
  await page.waitForTimeout(3000);

  // ── 1 · ENTER THE ADDRESS ─────────────────────────────────────────────
  await page.getByRole("button", { name: /^Continue/ }).first().click(); // the job: Full system (the default)
  await page.waitForTimeout(800);
  await idle();
  await snap("h-empty", { addr: "#hv-addr", lookup: page.getByRole("button", { name: "Look up the house", exact: true }), step: "section#hv-site", aside, rail: "ol[aria-label=Steps]" });
  await page.click("#hv-addr");
  await page.keyboard.type(ADDR, { delay: 60 });
  const sug = page.locator("ul[role=listbox] li[role=option]");
  await sug.first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await snap("h-sug", { addr: "#hv-addr", option: sug.filter({ hasText: ADDR.split(",")[0] }).first(), list: "ul[role=listbox]" });
  // the house itself, not the street the first row offers
  // by its index: a hover repaints the list under the pointer (Enter would also run the lookup)
  const mains = await sug.allInnerTexts();
  const at = mains.findIndex((t) => t.includes(ADDR.split(",")[0]));
  if (at >= 0) await page.locator(`ul[role=listbox] button[data-i="${at}"]`).click();
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  console.log("picked", await page.inputValue("#hv-addr"));
  await page.waitForTimeout(500);
  await idle();
  await snap("h-typed", { addr: "#hv-addr", lookup: page.getByRole("button", { name: "Look up the house", exact: true }) });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Look up the house", exact: true }).click();
  // the lookup lands when the house step's summary carries the area (it then moves on by itself)
  await page.waitForFunction(() => /sq ft/.test(document.querySelector("ol[aria-label=Steps] > li:nth-child(2)")?.textContent ?? ""), null, { timeout: T });
  facts.lookupMs = Date.now() - t0;
  console.log("lookup took", facts.lookupMs, "ms");
  await page.waitForTimeout(1200);
  await rail(1).click();
  await page.waitForTimeout(700);
  await bring(page.locator("section#hv-site"), 70);
  await idle();
  await snap("h-found", {
    src: "ul[aria-label='What the lookup found']",
    rows: "ul[aria-label='What the lookup found'] > li",
    r0: page.locator("ul[aria-label='What the lookup found'] > li").nth(0),
    r1: page.locator("ul[aria-label='What the lookup found'] > li").nth(1),
    r2: page.locator("ul[aria-label='What the lookup found'] > li").nth(2),
    r3: page.locator("ul[aria-label='What the lookup found'] > li").nth(3),
    hero: page.locator("section#hv-site [class*='hero']").first(),
    county: "#hv-county", aside, step: "section#hv-site",
  });
  fs.writeFileSync(path.join(OUT, "h-found.txt"), await page.locator("section#hv-site").innerText());
  facts.address = await page.inputValue("#hv-addr");
  facts.sources = await page.locator("ul[aria-label='What the lookup found'] > li").evaluateAll((els) => els.map((li) => ({ k: li.querySelector("[class*='src-k']")?.textContent?.trim(), v: li.querySelector("[class*='src-v']")?.textContent?.trim(), state: li.querySelector("[class*='src-s']")?.textContent?.trim() })));
  facts.house = await cells(page.locator("section#hv-site [class*='hero']").first());

  // ── 2 · REVIEW THE INPUTS ─────────────────────────────────────────────
  await rail(2).click();
  await page.waitForTimeout(700);
  await page.getByRole("tab", { name: /Plate/ }).click();
  await page.waitForTimeout(500);
  await bring(page.locator("section#hv-intake"), 70);
  const zones = page.locator("section#hv-intake label:has(input[type=file][accept='image/*'])");
  await idle();
  await snap("i-empty", { z0: zones.nth(0), z1: zones.nth(1), z2: zones.nth(2), tabs: "section#hv-intake [role=tablist]", aside });
  const inputs = page.locator("section#hv-intake input[type=file][accept='image/*']");
  const plates = ["plate-outdoor.png", "plate-indoor.png", "plate-panel.png"];
  for (let i = 0; i < 3; i++) { await inputs.nth(i).setInputFiles(path.join(OUT, plates[i])); await page.waitForTimeout(350); }
  await page.waitForTimeout(300);
  await idle();
  await snap("i-reading", { z0: zones.nth(0), z1: zones.nth(1), z2: zones.nth(2) });
  const r0 = Date.now();
  await page.waitForFunction(() => !/reading…/i.test(document.querySelector("section#hv-intake")?.innerText ?? ""), null, { timeout: T });
  facts.readMs = Date.now() - r0;
  await page.waitForTimeout(900);
  await snap("i-read", { z0: zones.nth(0), z1: zones.nth(1), z2: zones.nth(2), cov: "section#hv-intake details:has(summary [class*='cov'])", aside });
  fs.writeFileSync(path.join(OUT, "i-read.txt"), await page.locator("section#hv-intake").innerText());
  facts.plates = await zones.evaluateAll((els) => els.map((z) => ({ title: z.querySelector("[class*='zone-t']")?.firstChild?.textContent?.trim(), conf: z.querySelector("[class*='chip']")?.textContent?.trim(), read: z.querySelector("[class*='zone-h']")?.textContent?.trim() })));
  await page.waitForTimeout(6000); // the toasts go
  // the house and its factors, as the engine will use them
  const more = page.locator("section#hv-intake details", { hasText: "More about the house" }).first();
  await more.locator("summary").click();
  const exist = page.locator("section#hv-intake details", { hasText: "Existing system" }).first();
  await exist.locator("summary").click();
  await page.waitForTimeout(500);
  const confirm = page.locator("section#hv-intake [class*='confirm']").first();
  await bring(confirm, 70);
  await idle();
  const fieldOf = (id) => page.locator(`label:has(#${id})`).first();
  await snap("i-confirm", { confirm, win: fieldOf("hv-windowType"), attic: fieldOf("hv-ceilingInsulation"), walls: fieldOf("hv-wallInsulation"), tight: fieldOf("hv-tightness"), sqft: fieldOf("hv-conditionedSqft"), year: fieldOf("hv-yearBuilt"), aside, price: aside.locator("dd").last() });
  // one correction by the contractor: what the windows really are
  const before = (await aside.locator("dd").last().innerText()).trim();
  const winBefore = await page.locator("#hv-windowType option:checked").innerText();
  await page.selectOption("#hv-windowType", process.env.WINDOWS || "double-lowe");
  await page.locator("#hv-windowType").blur();
  await page.waitForTimeout(900);
  await idle();
  const after = (await aside.locator("dd").last().innerText()).trim();
  await snap("i-edited", { confirm, win: fieldOf("hv-windowType"), attic: fieldOf("hv-ceilingInsulation"), aside, price: aside.locator("dd").last() });
  boxes.edit = { before, after };
  facts.edit = { field: "Windows", from: winBefore, to: await page.locator("#hv-windowType option:checked").innerText(), before, after };
  console.log("price", before, "→", after);

  // ── 3 · CHECK THE RESULTS ─────────────────────────────────────────────
  await page.getByRole("button", { name: /Continue to the design/ }).click();
  await page.waitForTimeout(1200);
  await bring(page.locator("section#hv-design"), 70);
  const kinds = page.locator("section#hv-design [role=radiogroup][aria-label='System type'] [role=radio]");
  const tiers = page.locator("section#hv-design [role=radiogroup][aria-label='Good, better, best'] [role=radio]");
  const hero = page.locator("section#hv-design [class*='hero']").first();
  await idle();
  await snap("d-ac", { hero, kinds: "section#hv-design [role=radiogroup][aria-label='System type']", k0: kinds.nth(0), k1: kinds.nth(1), tiers: "section#hv-design [role=radiogroup][aria-label='Good, better, best']", aside });
  // the heat pump: one tap, the whole estimate re-prices
  if (await kinds.count() > 1) { await kinds.nth(1).click(); await page.waitForTimeout(900); }
  await idle();
  await snap("d-hp", { hero, kinds: "section#hv-design [role=radiogroup][aria-label='System type']", k0: kinds.nth(0), k1: kinds.nth(1), tiers: "section#hv-design [role=radiogroup][aria-label='Good, better, best']", t0: tiers.nth(0), t1: tiers.nth(1), t2: tiers.nth(2), aside });
  fs.writeFileSync(path.join(OUT, "d-hp.txt"), await page.locator("section#hv-design").innerText());
  facts.design = await cells(hero);
  facts.kinds = await kinds.evaluateAll((els) => els.map((k) => ({ name: k.querySelector("[class*='kind-t']")?.firstChild?.textContent?.trim(), price: k.querySelector("[class*='kind-v']")?.textContent?.trim(), on: k.getAttribute("aria-checked") === "true" })));
  facts.tiers = await tiers.evaluateAll((els) => els.map((t) => ({ tier: t.querySelector("[class*='tier-k']")?.textContent?.trim(), unit: t.querySelector("[class*='tier-t']")?.textContent?.trim(), spec: t.querySelector("[class*='tier-m']")?.textContent?.trim(), price: t.querySelector("[class*='tier-v']")?.textContent?.trim(), on: t.getAttribute("aria-checked") === "true" })));
  facts.unit = (await page.locator("section#hv-design [class*='unit-t']").first().innerText()).trim();
  facts.chart = await page.locator("section#hv-design svg[aria-label^='Heat pump capacity'] text").allTextContents();
  const chart = page.locator("section#hv-design svg[aria-label^='Heat pump capacity']");
  const unit = page.locator("section#hv-design [class*='unit']").first();
  await bring(unit, 90);
  await idle();
  await snap("d-chart", { unit, chart, checks: "section#hv-design [class*='chk-sum']", aside });
  // a state rule, opened: Washington's Manual J / Manual S requirement
  const passFold = page.locator("section#hv-design details", { hasText: /passed/ }).last();
  await passFold.locator("summary").click();
  await page.waitForTimeout(400);
  const ruleRow = page.locator("section#hv-design li", { hasText: process.env.RULE || "Manual J load and Manual S selection" }).first();
  await ruleRow.locator("button").first().click();
  await page.waitForTimeout(500);
  await bring(ruleRow, 260);
  await idle();
  await snap("d-rule", { row: ruleRow, rule: ruleRow.locator("[class*='check-r']"), checks: "section#hv-design [class*='chk-sum']" });
  fs.writeFileSync(path.join(OUT, "d-rule.txt"), await ruleRow.innerText());
  facts.rule = { status: (await ruleRow.locator("[class*='chip']").first().innerText()).trim(), title: (await ruleRow.locator("[class*='chk-t']").first().innerText()).trim(), source: (await ruleRow.locator("[class*='check-r']").innerText()).trim() };

  // ── 4 · CREATE THE PROPOSAL ───────────────────────────────────────────
  await page.getByRole("button", { name: /Continue to the estimate/ }).click();
  await page.waitForTimeout(1200);
  await bring(page.locator("section#hv-ledger"), 70);
  await idle();
  await snap("e-lines", { step: "section#hv-ledger", aside });
  const total = page.locator("section#hv-ledger [class*='bo-total']").first();
  await bring(total, H - 360);
  await idle();
  await snap("e-total", { total, convert: total.getByRole("button", { name: "Convert to proposal" }), aside });
  fs.writeFileSync(path.join(OUT, "e-lines.txt"), await page.locator("section#hv-ledger").innerText());
  facts.subtotal = (await total.locator("[class*='bo-total-v']").innerText()).trim();
  await total.getByRole("button", { name: "Convert to proposal" }).click();
  await page.waitForURL(/manual-blueprint\?proposal=/, { timeout: T });
  const proposalId = new URL(page.url()).searchParams.get("proposal");
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: CLEAN });
  await idle();
  await snap("p-builder", { title: page.locator("h1").first(), total: page.locator("text=/^Grand total$/i").locator("xpath=..").filter({ visible: true }).last(), send: page.getByRole("button", { name: /Save & send/i }) });
  facts.grandTotal = (await page.locator("text=Grand total").locator("xpath=..").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  console.log("proposal", proposalId);
  const publicId = execFileSync("python", ["-c", `import sqlite3;print(sqlite3.connect(r'${DB}').execute("select publicId from Proposal where id=?",('${proposalId}',)).fetchone()[0])`]).toString().trim();
  boxes.proposal = { id: proposalId, publicId };

  // the client's copy: desk and phone
  const desk = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const dp = await desk.newPage();
  await dp.goto(`${BASE}/portal/q/${publicId}`, { waitUntil: "domcontentloaded", timeout: T });
  await dp.waitForTimeout(5000);
  await dp.addStyleTag({ content: CLEAN });
  await dp.screenshot({ path: path.join(OUT, "c-desk.png") });
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/portal/q/${publicId}`, { waitUntil: "domcontentloaded", timeout: T });
  await pp.waitForTimeout(5000);
  await pp.addStyleTag({ content: CLEAN });
  await pp.screenshot({ path: path.join(OUT, "c-phone.png") });
  fs.writeFileSync(path.join(OUT, "c-phone.txt"), await pp.locator("body").innerText());
  boxes.phoneAccept = await pp.locator("button", { hasText: /Accept/ }).first().boundingBox().catch(() => null);

  fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes, null, 1));
  facts.portal = (await pp.locator("body").innerText()).split("\n").slice(0, 12);
  fs.writeFileSync(path.join(OUT, "facts.json"), JSON.stringify(facts, null, 1));
  // the film reads both from a script tag (a file:// page cannot fetch JSON)
  fs.writeFileSync(path.join(OUT, "film-data.js"), `window.FACTS = ${JSON.stringify(facts)};
window.BOXES = ${JSON.stringify(boxes)};
`);
  await b.close();
  if (errors.length) console.log("PAGE ERRORS:", errors.slice(0, 5).join(" | "));
})().catch((e) => { console.error("CAPTURE ERROR", e.message.split("\n")[0]); process.exit(1); });
