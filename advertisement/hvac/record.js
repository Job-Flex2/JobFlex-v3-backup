// The camera for the hvac2 landing's demo videos: walks the real HVAC estimator on
// the stand (a production build, own port, own copy of dev.db) and records it.
//   node record.js 16x9   → rec/16x9/<seg>/NNNNN.png + rec/16x9/tape.json
//   node record.js 4x5    → rec/4x5/…   (the handheld layout: 390×488 CSS px, touch, at 1080 px wide)
// Nothing is drawn on the page: every frame is a CDP screenshot of the app as it
// answers. The pointer, the taps, the captions and the end card are the film's
// (film-demo.html), placed from what this script logs (tape.json).
//
// The clock: each segment has a film clock T that runs with the wall clock while
// the page is live (typing, the lookup, the sheets — real pace, nothing sped up);
// a scroll is stepped frame by frame (a static page, so every frame is exact);
// a page load is cut out (the next frame cross-fades in).
// Segments are filmed in the order the data needs (the shop cost is entered in
// the inventory before the estimate prices from it) and played in the script's
// order (film-demo.html: est → inv → send).
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FMT = process.argv[2] === "4x5" ? "4x5" : "16x9";
const PHONE = FMT === "4x5";
const ROOT = path.resolve(__dirname, "../..");
const STAND = path.join(ROOT, process.env.STAND || ".cache/hvac-rec");
const DB = path.join(STAND, process.env.DBNAME || "rec.db");
const BASE = process.env.BASE || "http://localhost:3492";
const REC = path.join(__dirname, "rec", FMT);
// a real house: King County Assessor record, building footprint at the pin
const ADDR = "12629 NE 100th Pl, Kirkland, WA 98033";
const TYPED = "12629 NE 100th Pl, Kirk"; // typed; the rest comes from the suggestion
// the inventory scene: the shop's own price for line set (the rate card's typical is $9 a foot)
const MATERIAL_Q = "line set";
const MATERIAL_ROW = "typical $9";
const MATERIAL_COST = "8.40";
const CLIENT_ID = "hvacrec_client"; // stand/rec-dress.py
const CLIENT_NAME = "Jenna Brooks";

const VW = PHONE ? 390 : 1920, VH = PHONE ? 488 : 1080;
const DSF = PHONE ? 1080 / 390 : 1;
const FPS = 30, FRAME_MS = 1000 / FPS;
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// set dressing, in the browser only: the desktop film hides the sidebar so the page takes the frame;
// the floating help button and any dev chrome go in both
const CSS = [
  ".jfsup-fab{display:none!important}nextjs-portal{display:none!important}[data-trial-watermark]{display:none!important}",
  // the "Files for <client>" chip: on the desktop it sits under the caption plate, on a phone of this
  // height it floats mid-frame (84 px over the bottom of a tall phone) — the builder shows the client anyway
  "[class*='filing-chip-module'][class*='__chip']{display:none!important}",
  PHONE ? "" : "aside.sb{display:none!important}.layout{grid-template-columns:minmax(0,1fr)!important}",
].join("");
const T_OUT = 180000;
// the desktop caption plate takes the bottom of the frame, x 420–1500, up to here (film-demo.html): what is shown stays above it
const SAFE_Y = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ── the camera ────────────────────────────────────────────────────────────
class Cam {
  constructor(name) {
    this.name = name; this.T = 0; this.n = 0; this.last = null; this.pendingFade = 0;
    this.shots = []; this.moves = []; this.clicks = []; this.taps = []; this.swipes = []; this.marks = []; this.plate = []; this.pos = null;
    this.dir = path.join(REC, name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }
  async attach(page) { this.page = page; this.cdp = await page.context().newCDPSession(page); this.last = null; }
  async grab() {
    const o = { format: "png", optimizeForSpeed: true };
    // a plain CDP capture comes back in CSS px; the phone's device pixels need a clip at its scale
    // (the clip is in page coordinates: from where the visual viewport sits)
    if (DSF !== 1) { const v = (await this.cdp.send("Page.getLayoutMetrics")).cssVisualViewport; o.clip = { x: v.pageX, y: v.pageY, width: VW, height: VH, scale: DSF }; }
    const r = await this.cdp.send("Page.captureScreenshot", o);
    return Buffer.from(r.data, "base64");
  }
  /** One frame at T, unless the page looks exactly as the last one did. */
  async snap(force = false) {
    const buf = await this.grab();
    if (!force && !this.pendingFade && this.last && buf.equals(this.last)) return false;
    const f = `${String(this.n++).padStart(5, "0")}.png`;
    fs.writeFileSync(path.join(this.dir, f), buf);
    const s = { f, t: +this.T.toFixed(4) };
    if (this.pendingFade) { s.fade = this.pendingFade; this.pendingFade = 0; }
    this.shots.push(s); this.last = buf;
    return true;
  }
  /** Film the page live for `ms` of wall time (or until `until` says so), T running with the clock. */
  async live(ms, until) {
    const w0 = Date.now(), T0 = this.T;
    for (;;) {
      const el = Date.now() - w0;
      this.T = T0 + el / 1000;
      await this.snap();
      if (el >= ms) break;
      if (until && (await until().catch(() => false))) break;
      const next = (Math.floor((Date.now() - w0) / FRAME_MS) + 1) * FRAME_MS;
      await sleep(Math.max(0, next - (Date.now() - w0)));
    }
    this.T = T0 + (Date.now() - w0) / 1000;
  }
  /** The next frame cross-fades in (a cut: what happened off camera is not in the film). */
  cut(fade = 0.35) { this.pendingFade = fade; }
  mark(id) { this.marks.push({ id, t: +this.T.toFixed(3) }); console.log(`[${this.name}] ${id} @ ${this.T.toFixed(2)}s`); }
  /** The 4:5 caption plate's place: bottom (default), top, or off. */
  platePos(pos) { this.plate.push({ t: +this.T.toFixed(3), pos }); }

  // where a locator is, in CSS px
  async center(loc, dx = 0.5, dy = 0.5) {
    const r = await loc.first().boundingBox();
    if (!r) throw new Error(`${this.name}: no box for ${loc}`);
    return { x: r.x + r.width * dx, y: r.y + r.height * dy, r };
  }
  // ── the pointer (desktop) ──
  at(x, y) { this.pos = { x, y }; this.moves.push({ t0: this.T, t1: this.T, x0: x, y0: y, x1: x, y1: y }); }
  async moveTo(x, y, dur) {
    const p = this.pos ?? { x: VW * 0.8, y: VH * 0.75 };
    const d = Math.hypot(x - p.x, y - p.y);
    dur = dur ?? Math.min(0.7, 0.28 + d / 3000);
    this.moves.push({ t0: +this.T.toFixed(4), t1: +(this.T + dur).toFixed(4), x0: p.x, y0: p.y, x1: x, y1: y });
    this.pos = { x, y };
    await this.live(dur * 1000);
    await this.page.mouse.move(x, y);
    await this.live(100); // the hover lands
  }
  async click(loc, o = {}) {
    // off screen: the page scrolls to it first, as a person would (a sticky bar's button is on screen already)
    const r = await loc.first().boundingBox();
    if (r && (r.y < (PHONE ? 64 : 74) || r.y + r.height > VH)) await this.bring(loc, o.top ?? (PHONE ? 140 : 110), 0.6);
    const c = await this.center(loc, o.dx, o.dy);
    if (PHONE) return this.tap(c.x, c.y, o);
    await this.moveTo(c.x, c.y, o.dur);
    this.clicks.push({ t: +this.T.toFixed(4), x: c.x, y: c.y });
    await this.page.mouse.down();
    await this.live(70);
    await this.page.mouse.up();
  }
  // ── the finger (handheld) ──
  async tap(x, y) {
    // the finger comes down where it will tap: 0.25 s of approach, then the touch
    this.taps.push({ t: +(this.T + 0.25).toFixed(4), x, y });
    await this.live(250);
    await this.page.touchscreen.tap(x, y);
  }
  // ── typing, at a person's pace ──
  async type(text, cps = 12) {
    let k = 0;
    for (const ch of text) {
      const w0 = Date.now();
      await this.page.keyboard.type(ch);
      // a little unevenness, the same every run
      const dt = (1 / cps) * (0.75 + 0.5 * ((Math.sin(++k * 12.9898) * 43758.5453) % 1 + 1) % 1);
      await this.snap();
      const left = dt * 1000 - (Date.now() - w0);
      if (left > 0) await sleep(left);
      this.T += Math.max(dt, (Date.now() - w0) / 1000);
    }
    await this.snap();
  }
  // ── scrolling, frame by frame ──
  /** Scroll the element's scroller so that its top sits at `top` (CSS px from the viewport top). */
  async bring(loc, top, dur = 0.7) {
    const plan = await loc.first().evaluate((el, top) => {
      let s = el.parentElement;
      // the page's own scroller, not a strip that scrolls sideways (the step rail)
      while (s && !(s.scrollHeight > s.clientHeight + 4 && s.clientHeight > innerHeight * 0.5 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      if (!s) s = document.scrollingElement;
      document.querySelectorAll("[data-film-scroller]").forEach((e) => e.removeAttribute("data-film-scroller"));
      s.setAttribute("data-film-scroller", "1");
      const max = s.scrollHeight - s.clientHeight;
      const want = Math.max(0, Math.min(max, s.scrollTop + el.getBoundingClientRect().top - top));
      return { from: s.scrollTop, want };
    }, top);
    await this.scrollFrames(plan.from, plan.want, dur);
    return plan;
  }
  /** Off camera: put the element's top at `top` with no frames (before a segment's first frame). */
  async jump(loc, top) {
    await loc.first().evaluate((el, top) => {
      let s = el.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 4 && s.clientHeight > innerHeight * 0.5 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      if (!s) s = document.scrollingElement;
      s.style.scrollBehavior = "auto";
      s.scrollTop += el.getBoundingClientRect().top - top;
    }, top);
    await this.page.waitForTimeout(300);
  }
  async jumpTop() {
    await this.page.evaluate(() => { for (const s of [...document.querySelectorAll("*"), document.scrollingElement]) if (s && s.scrollTop) { s.style.scrollBehavior = "auto"; s.scrollTop = 0; } });
    await this.page.waitForTimeout(300);
  }
  /** Scroll the page's own scroller to y (0 = the top: where the step rail sits in the flow). */
  async scrollPage(y, dur = 0.7) {
    const plan = await this.page.evaluate((y) => {
      const all = [...document.querySelectorAll("*")].filter((s) => s.scrollHeight > s.clientHeight + 4 && s.clientHeight > innerHeight * 0.5 && /(auto|scroll)/.test(getComputedStyle(s).overflowY));
      const s = all.sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
      document.querySelectorAll("[data-film-scroller]").forEach((e) => e.removeAttribute("data-film-scroller"));
      s.setAttribute("data-film-scroller", "1");
      return { from: s.scrollTop, want: Math.max(0, Math.min(s.scrollHeight - s.clientHeight, y)) };
    }, y);
    await this.scrollFrames(plan.from, plan.want, dur);
  }
  async scrollFrames(from, want, dur) {
    if (Math.abs(want - from) < 2) return;
    const N = Math.max(2, Math.round(dur * FPS));
    if (PHONE) {
      // the finger that scrolls: it drags the page, so it travels the other way
      const span = Math.max(-240, Math.min(240, from - want));
      const x = VW * 0.62, y0 = VH * 0.55 - span / 2;
      this.swipes.push({ t0: +this.T.toFixed(4), t1: +(this.T + dur).toFixed(4), x, y0, y1: y0 + span });
    }
    for (let k = 1; k <= N; k++) {
      const y = from + (want - from) * io(k / N);
      await this.page.evaluate((y) => { const s = document.querySelector("[data-film-scroller]") || document.scrollingElement; s.style.scrollBehavior = "auto"; s.scrollTop = y; }, y);
      this.T += 1 / FPS;
      await this.snap();
    }
  }
  json() {
    return { name: this.name, dir: this.name, dur: +this.T.toFixed(4), shots: this.shots, moves: this.moves, clicks: this.clicks, taps: this.taps, swipes: this.swipes, marks: this.marks, plate: this.plate };
  }
}

// ── the stand ─────────────────────────────────────────────────────────────
async function context(b, o = {}) {
  const opts = PHONE
    ? { viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, userAgent: UA_PHONE }
    : { viewport: { width: VW, height: VH }, deviceScaleFactor: DSF };
  const ctx = await b.newContext({ ...(o.signedIn === false ? {} : { storageState: path.join(STAND, "state.json") }), ...opts, locale: "en-US", timezoneId: "America/Los_Angeles" });
  // the bell counts nothing older than "now" (the shop's notifications are test rows)
  await ctx.addInitScript(() => { try { localStorage.setItem("jf.bell.seenAt", String(Date.now() + 864e5)); } catch {} });
  await ctx.addInitScript((css) => {
    const put = () => { if (document.getElementById("film-css")) return; const s = document.createElement("style"); s.id = "film-css"; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put); else put();
  }, CSS);
  return ctx;
}
async function settle(page, extra = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(extra);
}
const db = (sql, ...args) => execFileSync("python", ["-c", `import sqlite3,sys,json;r=sqlite3.connect(sys.argv[1]).execute(sys.argv[2],json.loads(sys.argv[3])).fetchone();print(r[0] if r else '')`, DB, sql, JSON.stringify(args)]).toString().trim();

const facts = {};
(async () => {
  fs.mkdirSync(REC, { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  const ctx = await context(b);
  // the estimate is started from the client's record (what the estimator picker writes): the proposal files to her
  await ctx.addCookies([{ name: "jf_file_to", value: encodeURIComponent(JSON.stringify({ clientId: CLIENT_ID, clientName: CLIENT_NAME })), url: BASE }]);

  // ── 07 · the inventory: the shop's own cost on a material (filmed first; played after the estimate) ──
  // (not on the unit: saving a US-catalog unit from this drawer drops its tier and family, and the
  // estimate's Good · Better · Best moves — reported, not filmed)
  const inv = new Cam("inv");
  {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(`${BASE}/dashboard/hvac-estimator/inventory`, { waitUntil: "domcontentloaded", timeout: T_OUT });
    await settle(page, 1800);
    await inv.attach(page);
    const q = page.getByPlaceholder(/Find an item/i).first();
    // the price schedule up: the search, the units under it
    await inv.jump(q, PHONE ? 150 : 330);
    await inv.snap(true);
    inv.mark("07");
    if (!PHONE) inv.at(VW * 0.55, VH * 0.62);
    await inv.live(300);
    const row = page.getByText(MATERIAL_ROW, { exact: true }).first();
    if (PHONE) {
      // the search; a phone opens the row in place, and its Edit opens the sheet (the caption goes up:
      // the row, the sheet and its buttons are all in the lower half)
      await inv.click(q);
      await inv.type(MATERIAL_Q, 13);
      await inv.live(300);
      inv.platePos("top");
      await inv.click(row);
      await inv.live(350);
      await inv.click(page.getByRole("button", { name: /^Edit$/i }).first());
    } else {
      // the materials filter: the rate card's materials, a list long enough to scroll to the row
      await inv.click(page.getByRole("button", { name: /Rate card · materials/ }).first());
      await inv.live(450);
      await inv.bring(row, 560, 0.5);
      await inv.click(row);
    }
    await inv.live(450);
    const drawer = page.locator("aside, [role=dialog], [class*=drawer], [class*=sheet], [class*=panel]").filter({ hasText: /Save to company/i }).last();
    const costIn = drawer.locator("input:visible").first();
    await inv.click(costIn);
    await page.keyboard.press("Control+A");
    await inv.type(MATERIAL_COST, 9);
    await inv.live(150);
    await inv.click(page.getByRole("button", { name: /Save to company/i }).first());
    await inv.live(500);
    if (PHONE) inv.platePos("bottom");
    await inv.live(950); // the row now carries the shop's own figure
    facts.inventoryRows = (await page.locator(".content").innerText().catch(() => "")).split("\n").filter((l) => /Line set/i.test(l));
    console.log("inventory:", JSON.stringify(facts.inventoryRows));
    await page.close();
  }

  // ── 01–06 · the estimate ──
  const est = new Cam("est");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.goto(`${BASE}/dashboard/hvac-estimator`, { waitUntil: "domcontentloaded", timeout: T_OUT });
  await page.waitForSelector("#hv-addr", { state: "attached", timeout: T_OUT });
  await settle(page, 2000);
  await est.attach(page);
  const rail = (i) => page.locator("ol[aria-label=Steps] > li").nth(i);
  await est.snap(true);
  est.mark("01");
  if (!PHONE) est.at(VW * 0.62, VH * 0.6);
  await est.live(PHONE ? 400 : 600);
  const cont = page.getByRole("button", { name: /^Continue/ }).first();
  if (PHONE) await est.bring(cont, 300, 0.5);
  await est.click(cont);
  await est.live(600);

  // 02 · the house
  est.mark("02");
  // a phone's suggestion list runs down to where the caption sits: the caption goes up for this step
  if (PHONE) est.platePos("top");
  const addr = page.locator("#hv-addr");
  // under the step rail, so the suggestions open whole above the caption
  if (PHONE) await est.bring(addr, 138, 0.4);
  await est.click(addr);
  await est.type(TYPED, 14);
  const list = page.locator("ul[role=listbox]");
  await est.live(2500, () => list.isVisible());
  await est.live(300);
  const mains = await page.locator("ul[role=listbox] li[role=option]").allInnerTexts();
  // the house itself: same number and street exist in Redmond too
  const norm = (t) => t.replace(/Northeast/g, "NE").replace(/\bPlace\b/g, "Pl");
  const at = mains.findIndex((t) => norm(t).includes("12629 NE 100th Pl") && t.includes("Kirkland"));
  if (at < 0) throw new Error("the house is not among the suggestions: " + JSON.stringify(mains));
  await est.click(page.locator(`ul[role=listbox] button[data-i="${at}"]`));
  await est.live(300);
  facts.address = await page.inputValue("#hv-addr");
  if (!/Kirkland/.test(facts.address)) throw new Error("picked the wrong house: " + facts.address);
  const look = page.getByRole("button", { name: "Look up the house", exact: true });
  await est.click(look);
  const l0 = Date.now();
  const found = () => page.evaluate(() => /sq ft/.test(document.querySelector("ol[aria-label=Steps] > li:nth-child(2)")?.textContent ?? ""));
  await est.live(2500, found);
  if (!(await found())) {
    // a slow source: the wait past 2.5 s is cut, not played fast
    await page.waitForFunction(() => /sq ft/.test(document.querySelector("ol[aria-label=Steps] > li:nth-child(2)")?.textContent ?? ""), null, { timeout: T_OUT });
    est.cut(0.3);
  }
  facts.lookupMs = Date.now() - l0;
  console.log("lookup", facts.lookupMs, "ms");
  await est.live(550); // the page moves on to the next step by itself

  // 03 · the details: back to the house step, what the lookup found
  est.mark("03");
  if (PHONE) est.platePos("bottom");
  // the rail is in the flow at the top of the page (scrolled, it sits under the top bar)
  if (!PHONE) await est.scrollPage(0, 0.6);
  await est.click(rail(1));
  await est.live(500);
  const site = page.locator("section#hv-site");
  const kpi = site.locator("[class*='hero']").filter({ hasText: /Conditioned area/i }).first();
  const srcs = site.locator("ul[aria-label='What the lookup found']");
  if (PHONE) {
    await est.bring(srcs, 138, 0.5);
    await est.live(1100);
    await est.bring(kpi, 136, 0.5);
  } else {
    // the found list and the house's figures, both above the caption
    const k = await kpi.boundingBox();
    await est.bring(kpi, SAFE_Y - 12 - k.height, 0.5);
    const c = await est.center(kpi, 0.3, 0.45);
    await est.moveTo(c.x, c.y);
  }
  await est.live(PHONE ? 1300 : 1200);
  facts.sources = await srcs.locator("> li").evaluateAll((els) => els.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
  facts.house = (await kpi.innerText()).replace(/\s+/g, " ").trim();

  // 04 · the load
  est.mark("04");
  if (!PHONE) await est.scrollPage(0, 0.6);
  await est.click(rail(3));
  await est.live(600);
  const design = page.locator("section#hv-design");
  const hero = design.locator("[class*='hero']").filter({ hasText: /Cooling load/i }).first();
  if (PHONE) await est.bring(hero, 140, 0.4);
  await est.live(PHONE ? 1400 : 1200);
  facts.load = (await hero.innerText()).replace(/\s+/g, " ").trim();

  // 05 · the equipment
  est.mark("05");
  const tiers = design.locator("[role=radiogroup][aria-label='Good, better, best']");
  const unit = design.locator("[class*='unit']").filter({ hasText: /of the .* load/i }).first();
  const sys = design.locator("[role=radiogroup][aria-label='System type']");
  if (PHONE) await est.bring(tiers, 140, 0.6);
  else await est.bring(sys, 130, 0.6);
  const picked = tiers.locator("[role=radio][aria-checked=true]").first();
  if (!PHONE) { const c = await est.center(picked, 0.5, 0.45); await est.moveTo(c.x, c.y); }
  await est.live(PHONE ? 1000 : 1700);
  if (PHONE) { await est.bring(unit, 140, 0.6); await est.live(1300); }
  facts.tiers = await tiers.locator("[role=radio]").evaluateAll((els) => els.map((t) => ({ text: t.innerText.replace(/\s+/g, " ").trim(), on: t.getAttribute("aria-checked") === "true" })));
  facts.unit = (await unit.innerText()).replace(/\s+/g, " ").trim();

  // 06 · the price: every line, down to the total
  est.mark("06");
  if (PHONE) {
    const toEst = page.getByRole("button", { name: /Continue to the estimate/ });
    await est.bring(toEst, 300, 0.5);
    await est.click(toEst);
  } else {
    // the desktop's Continue sits at the foot of the design, under the caption: the rail instead
    await est.scrollPage(0, 0.6);
    await est.click(rail(4));
  }
  await est.live(600);
  const ledger = page.locator("section#hv-ledger");
  const total = ledger.locator("[class*='bo-total']").first();
  await est.bring(total, PHONE ? 150 : 300, PHONE ? 2.4 : 1.8);
  if (!PHONE) { const c = await est.center(total.locator("[class*='bo-total-v']").first()); await est.moveTo(c.x, c.y); }
  await est.live(800);
  facts.subtotal = (await total.innerText()).replace(/\s+/g, " ").trim();
  fs.writeFileSync(path.join(REC, "ledger.txt"), await ledger.innerText());

  // ── 08 · the client: convert, send, her copy (played after the inventory) ──
  const send = new Cam("send");
  await send.attach(page);
  await send.snap(true);
  send.mark("08");
  if (!PHONE) send.at(est.pos.x, est.pos.y);
  const conv = total.getByRole("button", { name: "Convert to proposal" });
  const convBtn = (await conv.count()) ? conv : page.getByRole("button", { name: "Convert to proposal" }).last();
  await send.live(250);
  await send.click(convBtn);
  await send.live(500);
  await page.waitForURL(/manual-blueprint\?proposal=/, { timeout: T_OUT });
  const proposalId = new URL(page.url()).searchParams.get("proposal");
  await settle(page, 2500);
  await send.attach(page);
  // the builder from its top: the proposal, the client it files to
  await send.jumpTop();
  send.cut(0.3);
  await send.snap(true);
  if (!PHONE) send.at(VW * 0.6, VH * 0.55);
  await send.live(500);
  // a phone shows the masthead first; the client card is a scroll away (the desktop has both in view)
  if (PHONE) { await send.bring(page.getByText(/The client/i).first(), 150, 0.7); await send.live(500); }
  const sendBtn = page.getByRole("button", { name: /Save & send/i }).first();
  if (PHONE) send.platePos("top");
  await send.click(sendBtn);
  await send.live(4000, () => page.getByText(/was sent/i).first().isVisible());
  await send.live(850);
  facts.sent = (await page.getByText(/was sent/i).first().innerText().catch(() => "")).trim();
  console.log("sent:", facts.sent);
  const publicId = db("select publicId from Proposal where id=?", proposalId);
  facts.proposal = { id: proposalId, publicId };

  // her copy — the client's own link, no contractor session
  const hctx = await context(b, { signedIn: false });
  const hp = await hctx.newPage();
  await hp.goto(`${BASE}/portal/q/${publicId}`, { waitUntil: "domcontentloaded", timeout: T_OUT });
  await settle(hp, 2500);
  await send.attach(hp);
  if (PHONE) send.platePos("bottom");
  send.cut(0.4);
  await send.snap(true);
  const accept = hp.getByRole("button", { name: /Accept/i }).first();
  if (!PHONE) { send.at(VW * 0.72, VH * 0.82); const c = await send.center(accept); await send.moveTo(c.x, c.y, 0.7); }
  await send.live(PHONE ? 1600 : 1100);
  facts.portal = (await hp.locator("body").innerText()).split("\n").filter(Boolean).slice(0, 14);

  const tape = { fmt: FMT, vw: VW, vh: VH, dsf: DSF, fps: FPS, order: ["est", "inv", "send"], segs: { est: est.json(), inv: inv.json(), send: send.json() }, facts };
  fs.writeFileSync(path.join(REC, "tape.json"), JSON.stringify(tape, null, 1));
  // the film reads it from a script tag (a file:// page cannot fetch JSON)
  fs.writeFileSync(path.join(REC, "tape.js"), `window.TAPE = ${JSON.stringify(tape)};
`);
  console.log("segments:", Object.entries(tape.segs).map(([k, s]) => `${k} ${s.dur.toFixed(2)}s/${s.shots.length} frames`).join(" · "));
  await b.close();
  if (errors.length) console.log("PAGE ERRORS:", errors.slice(0, 5).join(" | "));
})().catch((e) => { console.error("RECORD ERROR", e.message.split("\n")[0]); process.exit(1); });
