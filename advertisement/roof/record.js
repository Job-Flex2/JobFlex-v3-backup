// The camera for the roof estimator's landing demo videos: walks the real roof estimator on
// the stand (a production build, own port, own copy of dev.db) and records it. Same camera as
// advertisement/hvac/record.js (its class is copied here unchanged, so the two films move alike).
//   node record.js 16x9   → rec/16x9/<seg>/NNNNN.png + rec/16x9/tape.json
//   node record.js 4x5    → rec/4x5/…   (the handheld layout: 390×488 CSS px, touch, at 1080 px wide)
// Nothing is drawn on the page: every frame is a CDP screenshot of the app as it answers. The
// pointer, the taps, the captions and the end card are the film's (film-demo.html), placed from
// what this script logs (tape.json).
//
// The clock: each segment has a film clock T that runs with the wall clock while the page is live
// (typing, the measurement, the sheets — real pace, nothing sped up); a scroll is stepped frame by
// frame (a static page, so every frame is exact); a page load is cut out (the next frame cross-fades in).
// Segments are filmed in the order the data needs (the shop's own price is entered in the price
// book before the estimate prices from it) and played in the script's order (est → inv → send).
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FMT = process.argv[2] === "4x5" ? "4x5" : "16x9";
const PHONE = FMT === "4x5";
const ROOT = path.resolve(__dirname, "../..");
const STAND = path.join(ROOT, process.env.STAND || ".cache/roof-rec");
const DB = path.join(STAND, process.env.DBNAME || "rec.db");
const BASE = process.env.BASE || "http://localhost:3511";
const REC = path.join(__dirname, "rec", FMT);
// a real house in Kirkland (the stored EagleView answer for it is in the shop's ledger: stand/make-db.py)
const TYPED = "9903 117th Pl NE"; // typed; the town comes from the suggestion
// the price-book scene: the shop's own material price for its architectural shingle (the built-in book says $125 a square)
const BOOK_ROW = "Architectural shingle · 30-yr";
const BOOK_FROM = "125";
const BOOK_COST = "132";
const CLIENT_ID = "roofrec_client"; // stand/make-db.py
const CLIENT_NAME = "Mark Ellison";

const VW = PHONE ? 390 : 1920, VH = PHONE ? 488 : 1080;
const DSF = PHONE ? 1080 / 390 : 1;
const FPS = 30, FRAME_MS = 1000 / FPS;
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// set dressing, in the browser only: the desktop film hides the sidebar so the page takes the frame;
// the floating help button and any dev chrome go in both
const CSS = [
  ".jfsup-fab{display:none!important}nextjs-portal{display:none!important}[data-trial-watermark]{display:none!important}",
  // the "Files for <client>" chip: on a phone of this height it floats mid-frame over the page — the builder shows the client anyway
  "[class*='filing-chip-module'][class*='__chip']{display:none!important}",
  PHONE ? "" : "aside.sb{display:none!important}.layout{grid-template-columns:minmax(0,1fr)!important}",
].join("");
const T_OUT = 180000;
// the desktop caption plate takes the bottom of the frame, x 420–1500, from here down (film-demo.html): what is shown stays above it
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
const flat = (s) => s.replace(/\s+/g, " ").trim();
const scrollTop = (page) => page.evaluate(() => document.querySelector("[data-film-scroller]")?.scrollTop ?? 0);

const facts = {};
(async () => {
  fs.mkdirSync(REC, { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  const ctx = await context(b);
  // the estimate is started from the client's record (what the estimator picker writes): the proposal files to him
  await ctx.addCookies([{ name: "jf_file_to", value: encodeURIComponent(JSON.stringify({ clientId: CLIENT_ID, clientName: CLIENT_NAME })), url: BASE }]);

  // ── 07 · the price book: the shop's own price for its shingle (filmed first; played after the estimate) ──
  const inv = new Cam("inv");
  {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(`${BASE}/dashboard/roof-estimator/inventory`, { waitUntil: "domcontentloaded", timeout: T_OUT });
    await settle(page, 1800);
    await inv.attach(page);
    const q = page.getByPlaceholder(/Find an item/i).first();
    // the price schedule up: the search, the roof types under it
    await inv.jump(q, PHONE ? 150 : 330);
    await inv.snap(true);
    inv.mark("07");
    inv.platePos("bottom");
    if (!PHONE) inv.at(VW * 0.55, VH * 0.62);
    await inv.live(350);
    // the book's size: the schedule's "All" filter counts every row
    facts.bookCount = flat(await page.getByRole("button", { name: /^All\s*\d+$/ }).first().innerText().catch(() => ""));
    const row = page.getByText(BOOK_ROW, { exact: true }).first();
    if (PHONE) {
      // a phone opens the row in place, and its Edit opens the sheet (the caption goes up: the row, the sheet and its buttons are low)
      inv.platePos("top");
      await inv.click(row);
      await inv.live(400);
      const edit = page.getByRole("button", { name: /^Edit$/i }).first();
      if (await edit.isVisible().catch(() => false)) await inv.click(edit);
    } else {
      // the drawer opens at the right edge: the caption moves left, clear of it
      inv.platePos("left");
      await inv.click(row);
    }
    await inv.live(500);
    const drawer = page.locator("aside, [role=dialog], [class*=drawer], [class*=sheet], [class*=panel]").filter({ hasText: /Save to company/i }).last();
    const ins = drawer.locator("input:visible");
    let costIn = null;
    for (let i = 0, n = await ins.count(); i < n; i++) if ((await ins.nth(i).inputValue()) === BOOK_FROM) { costIn = ins.nth(i); break; }
    if (!costIn) throw new Error(`the material field ($${BOOK_FROM}) is not in the drawer`);
    await inv.click(costIn);
    await page.keyboard.press("Control+A");
    await inv.type(BOOK_COST, 9);
    await inv.live(250);
    await inv.click(page.getByRole("button", { name: /Save to company/i }).first());
    await inv.live(600);
    inv.platePos("bottom");
    await inv.live(950); // the row now carries the shop's own figure
    facts.bookRow = (await page.locator(".content").innerText().catch(() => "")).split("\n").filter((l) => l.includes(BOOK_ROW)).slice(0, 3);
    console.log("price book:", JSON.stringify(facts.bookRow));
    await page.close();
  }

  // ── 01–06 · the estimate ──
  const est = new Cam("est");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.goto(`${BASE}/dashboard/roof-estimator`, { waitUntil: "domcontentloaded", timeout: T_OUT });
  await page.waitForSelector("#addr", { state: "attached", timeout: T_OUT });
  await settle(page, 2000);
  await est.attach(page);
  const addr = page.locator("#addr");
  await est.snap(true);
  est.mark("01");
  if (!PHONE) est.at(VW * 0.62, VH * 0.6);
  await est.live(PHONE ? 400 : 300);
  // a phone's suggestion list runs down to where the caption sits: the field goes up under the top bar, the caption to the top
  if (PHONE) { est.platePos("top"); await est.bring(addr, 100, 0.6); }
  await est.click(addr);
  await est.type(TYPED, 14);
  const list = page.locator("ul[role=listbox]");
  await est.live(2500, () => list.isVisible());
  await est.live(350);
  const opts = await page.locator("ul[role=listbox] li[role=option]").evaluateAll((els) => els.map((li) => ({ main: li.querySelector(".bp-sug-main")?.textContent ?? "", sub: li.querySelector(".bp-sug-sub")?.textContent ?? "" })));
  // the house itself: the same number and street exist in Marysville and Arlington, and Places also offers NE 117th Street
  const at = opts.findIndex((o) => /^9903 (117th Pl NE|Northeast 117th Place)$/.test(o.main.trim()) && /Kirkland/.test(o.sub));
  if (at < 0) throw new Error("the house is not among the suggestions: " + JSON.stringify(opts));
  await est.click(page.locator(`ul[role=listbox] button[data-i="${at}"]`));
  await est.live(300);
  facts.address = [await page.inputValue("#addr"), await page.inputValue("#city"), await page.inputValue("#state"), await page.inputValue("#zip")].join(", ");
  if (!/Kirkland, WA, 98033/.test(facts.address)) throw new Error("picked the wrong house: " + facts.address);
  // the pin on the roof (the satellite tiles load live), then the button under it
  if (PHONE) est.platePos("bottom");
  const measure = page.locator("#instantBtn");
  await est.live(700);
  if (PHONE) {
    await est.bring(addr, 70, 0.6);
    await est.live(800);
  } else {
    const m = await measure.boundingBox();
    if (m.y + m.height > SAFE_Y - 30) await est.scrollPage((await scrollTop(page)) + (m.y + m.height - (SAFE_Y - 40)), 0.6);
    await est.live(400);
  }

  // 02 · the measurement
  est.mark("02");
  const tiles = page.getByText(/^Roofing squares$/i).first();
  const measured = () => tiles.isVisible();
  await est.click(measure);
  const m0 = Date.now();
  await est.live(9000, measured);
  if (!(await measured())) {
    // a slow answer: the wait past 9 s is cut, not played fast
    await tiles.waitFor({ timeout: T_OUT });
    est.cut(0.3);
  }
  facts.measureMs = Date.now() - m0;
  console.log("measure", facts.measureMs, "ms");
  const tileRow = page.locator("[class*='hero']").filter({ hasText: /Roofing squares/i }).first();
  facts.tiles = flat(await tileRow.innerText().catch(() => ""));
  if (PHONE) {
    await est.live(800);
    // the other figures under the first two
    await est.bring(page.getByText(/^Valleys$/i).first(), 210, 0.8);
    await est.live(900);
  } else {
    await est.live(500);
    const c = await est.center(tiles, 0.5, 3.0);
    await est.moveTo(c.x, c.y);
    await est.live(800);
  }

  // 03 · the roof: eave height, material, condition, age, the chimney — beside the map
  est.mark("03");
  const details = page.locator("#rfDetails");
  facts.details = flat(await details.innerText());
  if (PHONE) {
    await est.bring(details, 70, 0.7);
    await est.live(800);
    await est.bring(page.getByText(/^Roof details$/).first(), 70, 0.7);
    await est.live(1000);
  } else {
    const d = await details.boundingBox();
    // the whole card above the caption
    await est.bring(details, Math.max(90, SAFE_Y - 14 - d.height), 0.7);
    const c = await est.center(details.getByText(/^Condition$/).first(), 3, 0.5);
    await est.moveTo(c.x, c.y);
    await est.live(1100);
  }

  // 04 · the system: roof type, system, the brands ranked for the state
  est.mark("04");
  const sysCard = page.getByText(/^Roof system$/i).first();
  const brands = page.getByText(/^Top picks for /).first();
  facts.brandsHead = flat(await brands.innerText().catch(() => ""));
  if (PHONE) {
    await est.bring(sysCard, 70, 0.8);
    await est.live(800);
    await est.bring(brands, 70, 0.8);
    await est.live(1100);
  } else {
    // the roof types, the system and the four brands, all above the caption
    await est.bring(sysCard, 100, 0.8);
    await est.live(300);
    const c = await est.center(page.getByText(/^Top pick$/i).first(), 0.5, 0.5).catch(() => null);
    if (c) await est.moveTo(c.x, c.y);
    await est.live(1100);
  }

  // 05 · the takeoff: every part of the roof, one row each
  est.mark("05");
  const under = page.getByText(/^Underlayment$/).first();
  if (PHONE) {
    await est.bring(under, 70, 0.8);
    await est.live(900);
    await est.bring(page.getByText(/^Vents$/).first(), 70, 0.7);
    await est.live(900);
  } else {
    await est.bring(under, 110, 0.8);
    const c = await est.center(page.getByText(/^Vents$/).first(), 2.6, 0.5);
    await est.moveTo(c.x, c.y);
    await est.live(1100);
  }
  facts.parts = await page.evaluate(() => [...document.querySelectorAll(".content *")].filter((e) => e.children.length === 0 && /^(Roof system|Underlayment|Edges|Flashing|Vents|Tear-off & extras|Commercial job|Custom lines)$/i.test(e.textContent.trim())).map((e) => { let p = e; for (let i = 0; i < 4 && p.parentElement && p.innerText.length < 40; i++) p = p.parentElement; return p.innerText.replace(/\s+/g, " ").trim().slice(0, 170); }));

  // 06 · the price: every line, down to the total
  est.mark("06");
  const review = page.getByRole("button", { name: /Review \d+ lines/i }).first();
  facts.reviewLabel = flat(await review.innerText());
  // the button, and then the total and its Convert, are at the foot of the frame: the caption goes up
  est.platePos("top");
  await est.click(review);
  // the page builds the lines and moves to them by itself
  await est.live(1100);
  await est.scrollPage(1e6, PHONE ? 2.6 : 2.1);
  await est.live(300);
  const totalRow = page.getByText(/^Estimate total$/i).first();
  if (!PHONE) { const c = await est.center(page.getByRole("button", { name: "Convert to proposal" }).last(), 0.5, 0.5); await est.moveTo(c.x - 180, c.y - 4); }
  await est.live(1000);
  facts.total = flat(await totalRow.locator("xpath=..").innerText().catch(() => ""));
  fs.writeFileSync(path.join(REC, "lines.txt"), await page.locator(".content").innerText());

  // ── 08 · the client: convert, send, his copy (played after the price book) ──
  const send = new Cam("send");
  await send.attach(page);
  await send.snap(true);
  send.mark("08");
  send.platePos("top");
  if (!PHONE) send.at(est.pos.x, est.pos.y);
  await send.live(250);
  await send.click(page.getByRole("button", { name: "Convert to proposal" }).last());
  await send.live(500);
  await page.waitForURL(/manual-blueprint\?proposal=/, { timeout: T_OUT });
  const proposalId = new URL(page.url()).searchParams.get("proposal");
  await settle(page, 3500);
  await send.attach(page);
  await send.jumpTop();
  send.cut(0.3);
  send.platePos("bottom");
  await send.snap(true);
  if (!PHONE) send.at(VW * 0.6, VH * 0.55);
  await send.live(400);
  // a phone shows the masthead first; the client card is a scroll away
  if (PHONE) { await send.bring(page.getByText(/The client/i).first(), 70, 0.7); await send.live(600); }
  const sendBtn = page.getByRole("button", { name: /Save & send/i }).first();
  // Save & send sits in the sticky bar at the foot: on a phone it is under the caption (the desktop's is at the right
  // edge, clear of it, and Grand total at the left)
  if (PHONE) send.platePos("top");
  await send.click(sendBtn);
  await send.live(4000, () => page.getByText(/was sent to/i).first().isVisible());
  await send.live(1000);
  facts.sent = flat(await page.getByText(/was sent to/i).first().innerText().catch(() => ""));
  facts.grandTotal = flat(await page.getByText(/^Grand total$/i).first().locator("xpath=..").innerText().catch(() => ""));
  console.log("sent:", facts.sent, "·", facts.grandTotal);
  const publicId = db("select publicId from Proposal where id=?", proposalId);
  facts.proposal = { id: proposalId, publicId };

  // his copy — the client's own link, no contractor session
  const hctx = await context(b, { signedIn: false });
  const hp = await hctx.newPage();
  await hp.goto(`${BASE}/portal/q/${publicId}`, { waitUntil: "domcontentloaded", timeout: T_OUT });
  await settle(hp, 2500);
  facts.portal = (await hp.locator("body").innerText()).split("\n").filter(Boolean).slice(0, 14);
  await send.attach(hp);
  // the roof's figures, the name field and Accept in view
  await send.jump(hp.getByText(/as measured from the air/i).first(), PHONE ? 60 : 150);
  send.platePos("bottom");
  send.cut(0.4);
  await send.snap(true);
  const accept = hp.getByRole("button", { name: /Accept/i }).first();
  if (!PHONE) { send.at(VW * 0.72, VH * 0.82); const c = await send.center(accept); await send.moveTo(c.x, c.y, 0.7); }
  await send.live(PHONE ? 1500 : 1150);

  const tape = { fmt: FMT, vw: VW, vh: VH, dsf: DSF, fps: FPS, order: ["est", "inv", "send"], segs: { est: est.json(), inv: inv.json(), send: send.json() }, facts };
  fs.writeFileSync(path.join(REC, "tape.json"), JSON.stringify(tape, null, 1));
  // the film reads it from a script tag (a file:// page cannot fetch JSON)
  fs.writeFileSync(path.join(REC, "tape.js"), `window.TAPE = ${JSON.stringify(tape)};\n`);
  console.log("segments:", Object.entries(tape.segs).map(([k, s]) => `${k} ${s.dur.toFixed(2)}s/${s.shots.length} frames`).join(" · "));
  await b.close();
  if (errors.length) console.log("PAGE ERRORS:", errors.slice(0, 5).join(" | "));
})().catch((e) => { console.error("RECORD ERROR", e.message.split("\n")[0]); process.exit(1); });
