// The camera for the fence estimator's landing demo videos: walks the real Fence
// studio on the stand (a production build, own port, own copy of dev.db) and records it.
//   node record.js 16x9   → rec/16x9/<seg>/NNNNN.jpg + rec/16x9/tape.json
//   node record.js 4x5    → rec/4x5/…   (the handheld layout: 390×488 CSS px, touch, at 1080 px wide)
// Nothing is drawn on the page: every frame is a CDP screenshot of the app as it
// answers. The pointer, the taps, the captions and the end card are the film's
// (film-demo.html), placed from what this script logs (tape.json).
//
// The clock: each segment has a film clock T that runs with the wall clock while
// the page is live (typing, the lookup, the drawing — real pace, nothing sped up);
// a scroll is stepped frame by frame (a static page, so every frame is exact);
// a page load, and a wait on a lookup past a couple of seconds, is cut out (the
// next frame cross-fades in).
// Segments are filmed in the order the data needs (the shop's own rate goes into
// the price book before the estimate prices from it) and played in the script's
// order (film-demo.html: est → inv → send).
//
// The map: the page builds its own Google map; an init script keeps a handle on
// it (read only — nothing is moved through it) so a lot corner's lat/lng can be
// turned into the screen pixel a person would click.
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FMT = process.argv[2] === "4x5" ? "4x5" : "16x9";
const PHONE = FMT === "4x5";
const ROOT = path.resolve(__dirname, "../..");
const STAND = path.join(ROOT, process.env.STAND || ".cache/fence-rec");
const DB = path.join(STAND, process.env.DBNAME || "rec.db");
const BASE = process.env.BASE || "http://localhost:3536";
const REC = path.join(__dirname, "rec", FMT);
// a real house on a real lot: the county parcel is in the app's parcel cache, the satellite,
// the contours (USGS lidar) and the address suggestions are live
const TYPED = "9903 117th Pl NE"; // typed; the town comes from the suggestion (Kirkland's is the first)
const MATCH = (t) => /9903 117th Pl(ace)? (NE|Northeast)/i.test(t.replace(/Northeast/g, "NE")) && /Kirkland/.test(t);
// the price book scene: the shop's own material rate on the type the estimate uses
const TYPE = "Board-on-board";
const MATERIAL_COST = "26.40"; // the catalog's is $28 a linear foot
const CLIENT_ID = "fencerec_client"; // stand/make-db.py
const CLIENT_NAME = "Megan Ortiz";

const VW = PHONE ? 390 : 1920, VH = PHONE ? 488 : 1080;
const DSF = PHONE ? 1080 / 390 : 1;
const FPS = 30, FRAME_MS = 1000 / FPS;
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// set dressing, in the browser only: the desktop film hides the sidebar so the page takes the frame;
// the floating help button and any dev chrome go in both
const CSS = [
  ".jfsup-fab{display:none!important}nextjs-portal{display:none!important}[data-trial-watermark]{display:none!important}",
  // the "Files for <client>" chip floats over the page (mid-frame on a phone of this height) — the builder shows the client anyway
  "[class*='filing-chip-module'][class*='__chip']{display:none!important}",
  // the parcel line under "Property sides" prints the recorded owner's name: a real person, not in an advert
  "#parcelMeta{visibility:hidden!important}",
  PHONE ? "" : "aside.sb{display:none!important}.layout{grid-template-columns:minmax(0,1fr)!important}",
].join("");
const T_OUT = 180000;
// the desktop caption plate takes the bottom of the frame, x 420–1500, from here down (film-demo.html)
const SAFE_Y = 900;
// the phone's caption plate, at the bottom, starts here (CSS px of 488: film-demo.html, 1350 − 16 − 232 film px)
const PLATE_TOP = Math.floor((1350 - 16 - 232) / (1080 / 390));
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
    // JPEG at q92: the satellite makes a 1080p PNG 2 MB and too slow to grab at a person's pace
    const o = { format: "jpeg", quality: 92, optimizeForSpeed: true };
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
    const f = `${String(this.n++).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(this.dir, f), buf);
    const s = { f, t: +this.T.toFixed(4) };
    if (this.pendingFade) { s.fade = this.pendingFade; this.pendingFade = 0; }
    this.shots.push(s); this.last = buf;
    return true;
  }
  /** Film the page live for `ms` of wall time (or until `until` says so), T running with the clock.
   *  `each(T)` runs before every frame (the pointer that drags the real mouse along). */
  async live(ms, until, each) {
    const w0 = Date.now(), T0 = this.T;
    for (;;) {
      const el = Date.now() - w0;
      this.T = T0 + el / 1000;
      if (each) await each(this.T);
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
  /** The caption plate's place: bottom (default) or top. */
  platePos(pos) { this.plate.push({ t: +this.T.toFixed(3), pos }); }

  // where a locator is, in CSS px
  async center(loc, dx = 0.5, dy = 0.5) {
    const r = await loc.first().boundingBox();
    if (!r) throw new Error(`${this.name}: no box for ${loc}`);
    return { x: r.x + r.width * dx, y: r.y + r.height * dy, r };
  }
  // ── the pointer (desktop) ──
  at(x, y) { this.pos = { x, y }; this.moves.push({ t0: this.T, t1: this.T, x0: x, y0: y, x1: x, y1: y }); }
  /** The pointer travels; the real mouse goes with it frame by frame, so hovers and the
   *  map's rubber band follow it the way they follow a hand. */
  async moveTo(x, y, dur) {
    const p = this.pos ?? { x: VW * 0.8, y: VH * 0.75 };
    const d = Math.hypot(x - p.x, y - p.y);
    dur = dur ?? Math.min(0.75, 0.3 + d / 2600);
    const t0 = this.T;
    this.moves.push({ t0: +t0.toFixed(4), t1: +(t0 + dur).toFixed(4), x0: p.x, y0: p.y, x1: x, y1: y });
    this.pos = { x, y };
    await this.live(dur * 1000, null, async (T) => {
      const q = io(Math.min(1, (T - t0) / dur));
      await this.page.mouse.move(p.x + (x - p.x) * q, p.y + (y - p.y) * q);
    });
    await this.page.mouse.move(x, y);
    await this.live(90); // the hover lands
  }
  async clickAt(x, y, o = {}) {
    if (PHONE) return this.tap(x, y);
    await this.moveTo(x, y, o.dur);
    this.clicks.push({ t: +this.T.toFixed(4), x, y });
    if (o.double) {
      await this.page.mouse.dblclick(x, y, { delay: 40 });
      this.clicks.push({ t: +(this.T + 0.12).toFixed(4), x, y });
      await this.live(120);
      return;
    }
    await this.page.mouse.down();
    await this.live(70);
    await this.page.mouse.up();
  }
  async click(loc, o = {}) {
    // off screen: the page scrolls to it first, as a person would
    const r = await loc.first().boundingBox();
    if (!r) throw new Error(`${this.name}: no box for ${loc}`);
    if (r.y < (PHONE ? 64 : 74) || r.y + r.height > VH) await this.bring(loc, o.top ?? (PHONE ? 140 : 110), 0.6);
    const c = await this.center(loc, o.dx, o.dy);
    return this.clickAt(c.x, c.y, o);
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
  /** Scroll the element's page scroller so that its top sits at `top` (CSS px from the viewport top). */
  async bring(loc, top, dur = 0.7) {
    const plan = await loc.first().evaluate((el, top) => {
      let s = el.parentElement;
      // the page's own scroller, not a strip that scrolls sideways or the ticket's own list
      while (s && !(s.scrollHeight > s.clientHeight + 4 && s.clientHeight > innerHeight * 0.75 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
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
  /** Scroll one element's own scroller (the desktop ticket) to y. */
  async scrollIn(sel, y, dur = 0.8) {
    const plan = await this.page.evaluate(({ sel, y }) => {
      const s = document.querySelector(sel);
      document.querySelectorAll("[data-film-scroller]").forEach((e) => e.removeAttribute("data-film-scroller"));
      s.setAttribute("data-film-scroller", "1");
      return { from: s.scrollTop, want: Math.max(0, Math.min(s.scrollHeight - s.clientHeight, y === "end" ? 1e9 : y)) };
    }, { sel, y });
    await this.scrollFrames(plan.from, plan.want, dur);
  }
  /** Off camera: put the element's top at `top` with no frames (before a segment's first frame). */
  async jump(loc, top) {
    await loc.first().evaluate((el, top) => {
      let s = el.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 4 && s.clientHeight > innerHeight * 0.75 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
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
  /** Scroll the page's own scroller to y. */
  async scrollPage(y, dur = 0.7) {
    const plan = await this.page.evaluate((y) => {
      const all = [...document.querySelectorAll("*")].filter((s) => s.scrollHeight > s.clientHeight + 4 && s.clientHeight > innerHeight * 0.75 && /(auto|scroll)/.test(getComputedStyle(s).overflowY));
      const s = all.sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
      document.querySelectorAll("[data-film-scroller]").forEach((e) => e.removeAttribute("data-film-scroller"));
      s.setAttribute("data-film-scroller", "1");
      return { from: s.scrollTop, want: Math.max(0, Math.min(s.scrollHeight - s.clientHeight, y === "end" ? 1e9 : y)) };
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
  // a read-only handle on the map the page builds (lat/lng → screen px); the page's own Map class, subclassed
  await ctx.addInitScript(() => {
    const iv = setInterval(() => {
      const gm = window.google && window.google.maps;
      if (!gm || !gm.importLibrary || gm.__filmHooked) return;
      gm.__filmHooked = true; clearInterval(iv);
      const orig = gm.importLibrary.bind(gm);
      gm.importLibrary = (lib) => orig(lib).then((r) => {
        if (lib !== "maps" || r.__film) return r;
        const Base = r.Map;
        class FilmMap extends Base { constructor(...a) { super(...a); (window.__filmMaps = window.__filmMaps || []).push(this); } }
        const out = {}; for (const k of Object.getOwnPropertyNames(r)) out[k] = r[k]; out.Map = FilmMap; out.__film = true; return out;
      });
    }, 5);
  });
  return ctx;
}
async function settle(page, extra = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(extra);
}
/** [lat, lng] → viewport CSS px, through the page's own map. */
const toPx = (page, pts) => page.evaluate((pts) => {
  const m = window.__filmMaps[window.__filmMaps.length - 1];
  const proj = m.getProjection(), bb = m.getBounds(), s = 2 ** m.getZoom();
  const tl = proj.fromLatLngToPoint(new google.maps.LatLng(bb.getNorthEast().lat(), bb.getSouthWest().lng()));
  const div = m.getDiv(), r = div.getBoundingClientRect(), k = r.width / div.offsetWidth;
  return pts.map(([lat, lng]) => { const p = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng)); return { x: r.left + (p.x - tl.x) * s * k, y: r.top + (p.y - tl.y) * s * k }; });
}, pts);
const lerp = (a, z, k) => ({ x: a.x + (z.x - a.x) * k, y: a.y + (z.y - a.y) * k });
const db = (sql, ...args) => execFileSync("python", ["-c", `import sqlite3,sys,json;r=sqlite3.connect(sys.argv[1]).execute(sys.argv[2],json.loads(sys.argv[3])).fetchone();print(r[0] if r else '')`, DB, sql, JSON.stringify(args)]).toString().trim();
const one = (s) => s.replace(/\s+/g, " ").trim();

const facts = {};
(async () => {
  fs.mkdirSync(REC, { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  const ctx = await context(b);
  // the estimate is started from the client's record (what the estimator picker writes): the proposal files to her
  await ctx.addCookies([{ name: "jf_file_to", value: encodeURIComponent(JSON.stringify({ clientId: CLIENT_ID, clientName: CLIENT_NAME })), url: BASE }]);

  // ── 07 · the price book: the shop's own material rate (filmed first; played after the estimate) ──
  const inv = new Cam("inv");
  {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(`${BASE}/dashboard/fence-estimator/inventory`, { waitUntil: "domcontentloaded", timeout: T_OUT });
    await settle(page, 1800);
    await inv.attach(page);
    // a desk lists the book as a table, a phone as a list of rows that open in place
    const row = page.locator("tr, [role=listitem]").filter({ hasText: TYPE }).first();
    // the phone: the price schedule's wood rows up under the header
    if (PHONE) await inv.jump(page.locator("[role=listitem]").filter({ hasText: "Cedar privacy" }).first(), 76);
    await inv.snap(true);
    inv.mark("07");
    if (!PHONE) inv.at(VW * 0.55, VH * 0.62);
    await inv.live(250);
    facts.bookBefore = one(await row.innerText());
    if (PHONE) {
      // the row opens in place (labor, group, Edit), and its Edit opens the sheet
      await inv.click(row, { dy: 0.3 });
      await inv.live(400);
      await inv.click(page.getByRole("button", { name: /^Edit$/i }).first());
    } else {
      // the row's pencil
      await inv.click(row.getByRole("button").last());
    }
    await inv.live(350);
    const drawer = page.locator("aside, [role=dialog], [class*=drawer], [class*=sheet], [class*=panel]").filter({ hasText: /Save to company/i }).last();
    const costIn = drawer.locator("input:visible").first();
    await inv.click(costIn);
    await page.keyboard.press("Control+A");
    await inv.type(MATERIAL_COST, 9);
    await inv.live(150);
    // the phone's sheet keeps Save at its foot, under the caption: the caption goes up for the tap
    if (PHONE) { inv.platePos("top"); await inv.live(200); }
    await inv.click(page.getByRole("button", { name: /Save to company/i }).first());
    await inv.live(400);
    if (PHONE) inv.platePos("bottom");
    await inv.live(750); // the row now carries the shop's own figure, marked COMPANY
    facts.bookAfter = one(await row.innerText());
    console.log("book:", facts.bookBefore, "→", facts.bookAfter);
    await page.close();
  }

  // ── 01–06 · the estimate ──
  const est = new Cam("est");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  let parcel = null;
  page.on("response", async (r) => { if (r.url().includes("/api/parcels")) { try { parcel = await r.json(); } catch {} } });
  await page.goto(`${BASE}/dashboard/fence-estimator`, { waitUntil: "domcontentloaded", timeout: T_OUT });
  await page.waitForSelector("#addrInput", { state: "attached", timeout: T_OUT });
  await settle(page, 2000);
  await est.attach(page);
  await est.snap(true);

  // 01 · the lot
  est.mark("01");
  // a phone's suggestion list runs down to where the caption sits: the caption goes up for this step
  if (PHONE) est.platePos("top");
  if (!PHONE) est.at(VW * 0.62, VH * 0.6);
  await est.live(PHONE ? 400 : 500);
  const addr = page.locator("#addrInput");
  await est.click(addr, { dx: 0.3 });
  await est.type(TYPED, 14);
  const list = page.locator("ul[role=listbox]");
  await est.live(2500, () => list.isVisible());
  await est.live(350);
  const mains = await page.locator("ul[role=listbox] li[role=option]").allInnerTexts();
  const at = mains.findIndex(MATCH);
  if (at < 0) throw new Error("the house is not among the suggestions: " + JSON.stringify(mains));
  await est.click(page.locator(`ul[role=listbox] button[data-i="${at}"]`));
  facts.address = await page.inputValue("#addrInput");
  // the satellite opens on the lot; the property lines and the contours come with it
  const l0 = Date.now();
  const ready = () => page.evaluate(() => !!(window.__filmMaps && window.__filmMaps.length) && !document.querySelector("#topoLegend")?.classList.contains("is-hidden") && !document.querySelector("#parcelPanel")?.classList.contains("is-hidden"));
  await est.live(1100, ready);
  if (!(await ready())) {
    // a slow source (the contours wait for the lot): the wait past 1.1 s is cut, not played fast
    await page.waitForFunction(() => !document.querySelector("#topoLegend")?.classList.contains("is-hidden") && !document.querySelector("#parcelPanel")?.classList.contains("is-hidden"), null, { timeout: T_OUT });
    await page.waitForTimeout(1200); // the tiles land
    est.cut(0.35);
  }
  facts.lotMs = Date.now() - l0;
  console.log("lot", facts.lotMs, "ms");
  if (!parcel?.rings?.length) throw new Error("no parcel answer");
  await est.live(400);
  // the map up where the whole stage can be seen: the desktop's above the caption, the phone's under the header
  const stage = page.locator("#stageCanvas");
  if (PHONE) { est.platePos("top"); await est.bring(stage, 100, 0.8); }
  else { const s = await stage.boundingBox(); await est.bring(stage, Math.min(205, SAFE_Y - s.height), 0.7); }
  await est.live(600);
  facts.topo = one(await page.locator("#topoLegend").innerText());
  facts.sides = one(await page.locator("#parcelPanel").innerText());

  // 02 · the fence: along the property line, corner to corner
  est.mark("02");
  const ring = parcel.rings[0];
  const c = await toPx(page, ring);
  const by = (f) => c.reduce((a, p) => (f(p) > f(a) ? p : a));
  const NW = by((p) => -(p.x + p.y)), NE = by((p) => p.x - p.y), SE = by((p) => p.x + p.y), SW = by((p) => p.y - p.x);
  const pts = [lerp(NE, NW, 0.38), NW, SW, lerp(SE, SW, 0.38)];
  facts.clicks = pts.map((p) => [Math.round(p.x), Math.round(p.y)]);
  if (!PHONE) { const a = lerp(pts[0], { x: VW * 0.62, y: VH * 0.6 }, 0.4); await est.moveTo(a.x, a.y, 0.35); }
  for (let i = 0; i < pts.length; i++) {
    const last = i === pts.length - 1;
    await est.clickAt(pts[i].x, pts[i].y, { double: last && !PHONE, dur: i === 0 ? 0.5 : 0.7 });
    // a phone taps quicker than a pointer travels: each dot is held a moment so the run reads
    await est.live(last ? 250 : PHONE ? 700 : 320);
  }
  if (PHONE) {
    // the run ends with Finish, under the map
    await est.click(page.locator('#drawCtl [data-draft="finish"]'));
    await est.live(300);
  }
  await est.live(1400); // the three runs, their lengths and slopes; the total in the ticket
  facts.runs = one(await page.locator("#runsList").innerText());
  facts.afterDraw = one(await page.locator("#tkTotal").innerText()) + " · " + one(await page.locator("#tkSub").innerText());

  // 03 · the gate: on the south run, beside the house
  est.mark("03");
  if (PHONE) {
    // the tool row sits over the map: up a little so the Gate button and the south run are both in view
    await est.bring(page.locator('[data-menu="gate"]'), 150, 0.6);
  }
  await est.click(page.locator('[data-menu="gate"]'));
  await est.live(450);
  facts.gates = one(await page.locator("#popGate").innerText());
  await est.click(page.locator('#popGate [data-add-open]').first());
  await est.live(300);
  const c2 = await toPx(page, ring);
  const by2 = (f) => c2.reduce((a, p) => (f(p) > f(a) ? p : a));
  const SW2 = by2((p) => p.y - p.x), SE2 = by2((p) => p.x + p.y);
  const g = lerp(SW2, lerp(SE2, SW2, 0.38), 0.72);
  await est.clickAt(g.x, g.y, { dur: 0.6 });
  await est.live(900);
  facts.openings = one(await page.locator("#openList").innerText());

  // 04 · the fence type and its height
  est.mark("04");
  // from here the phone's working rows sit in the upper part of the frame: the caption back down
  if (PHONE) est.platePos("bottom");
  const typeRow = page.locator("#matList [data-mat]").filter({ hasText: TYPE }).first();
  if (PHONE) {
    // a phone lists the types under the takeoff: a long way down
    await est.bring(typeRow, 170, 1.3);
    await est.live(200);
    await est.click(typeRow);
    await est.live(600);
    // the heights this type comes in, under the types
    await est.bring(page.locator("#heights"), 190, 0.8);
    await est.live(700);
  } else {
    // the rail's type list stays beside the map; then the page down to the height row
    await est.click(typeRow, { dx: 0.35 });
    await est.live(500);
    await est.bring(page.locator("#heights"), 560, 0.7);
    const h = page.locator("#heights button.on, #heights [aria-pressed=true], #heights .on").first();
    if (await h.count()) { const hc = await est.center(h); await est.moveTo(hc.x, hc.y, 0.45); }
    await est.live(500);
  }
  facts.type = one(await page.locator("#matList [data-mat].on").innerText());
  facts.heights = one(await page.locator("#heights").innerText());

  // 05 · the takeoff: every post, rail and bag
  est.mark("05");
  const takeoff = page.locator("#takeoffCard");
  if (PHONE) {
    // the card is taller than the phone: its head first, then its foot just above the caption (398 CSS px)
    await est.bring(takeoff, 76, 1.0);
    await est.live(800);
    const tb = await takeoff.boundingBox();
    if (tb.y + tb.height > PLATE_TOP) { await est.bring(takeoff, PLATE_TOP - 6 - tb.height, 0.9); await est.live(900); }
  } else {
    // the page's foot: the takeoff runs down to the bottom of the frame, so the caption goes up
    est.platePos("top");
    await est.scrollPage("end", 0.8);
    const m = await est.center(takeoff.locator("#takeoffMeta"), 0.5, 0.5);
    await est.moveTo(m.x, m.y + 40, 0.45);
    await est.live(1200);
  }
  facts.takeoff = one(await takeoff.innerText());
  facts.bom = await takeoff.locator("#bomList > li").evaluateAll((els) => els.map((li) => [...li.children].map((c) => c.textContent.trim())));
  facts.strip = one(await page.locator("#statStrip").innerText());

  // 06 · the price: every line, down to the total and Convert
  est.mark("06");
  if (!PHONE) est.platePos("bottom");
  const tk = page.locator(".tk");
  if (PHONE) {
    await est.bring(tk, 76, 1.0);
    await est.live(1000);
    await est.bring(page.locator("#convertBtn"), PLATE_TOP - 60, 0.9);
    await est.live(600);
  } else {
    const tt = await est.center(page.locator("#tkTotal"), 0.4, 0.5);
    await est.moveTo(tt.x, tt.y, 0.5);
    await est.live(500);
    await est.scrollIn(".fs-rail > .tk", "end", 1.1);
    await est.live(400);
  }
  facts.ticket = one(await tk.innerText());
  facts.total = one(await page.locator("#tkTotal").innerText());
  fs.writeFileSync(path.join(REC, "ticket.txt"), await tk.innerText());

  // ── 08 · the client: convert, send, her copy (played after the price book) ──
  const send = new Cam("send");
  await send.attach(page);
  await send.snap(true);
  send.mark("08");
  if (!PHONE) send.at(est.pos.x, est.pos.y);
  await send.live(150);
  await send.click(page.locator("#convertBtn"));
  await send.live(350);
  await page.waitForURL(/manual-blueprint\?proposal=/, { timeout: T_OUT });
  const proposalId = new URL(page.url()).searchParams.get("proposal");
  await settle(page, 2500);
  await send.attach(page);
  // the builder from its top: the proposal, the client it files to
  await send.jumpTop();
  send.cut(0.3);
  await send.snap(true);
  if (!PHONE) send.at(VW * 0.6, VH * 0.55);
  await send.live(400);
  // a phone shows the masthead first; the client card is a scroll away (the desktop has both in view)
  if (PHONE) { await send.bring(page.getByText(/The client/i).first(), 150, 0.7); await send.live(400); }
  // Save & send is in the builder's bar at the foot: the caption goes up
  if (PHONE) { send.platePos("top"); await send.live(200); }
  const sendBtn = page.getByRole("button", { name: /Save & send/i }).first();
  await send.click(sendBtn);
  await send.live(4000, () => page.getByText(/was sent/i).first().isVisible());
  await send.live(800);
  facts.sent = one(await page.getByText(/was sent/i).first().innerText().catch(() => ""));
  console.log("sent:", facts.sent);
  const publicId = db("select publicId from Proposal where id=?", proposalId);
  facts.proposal = { id: proposalId, publicId };

  // her copy — the client's own link, no contractor session: the total, the fence in 3D and on the lot
  const hctx = await context(b, { signedIn: false });
  const hp = await hctx.newPage();
  await hp.goto(`${BASE}/portal/q/${publicId}`, { waitUntil: "domcontentloaded", timeout: T_OUT });
  await settle(hp, 3000);
  await send.attach(hp);
  if (PHONE) send.platePos("bottom");
  send.cut(0.4);
  await send.snap(true);
  if (!PHONE) send.at(VW * 0.72, VH * 0.7);
  await send.live(900);
  const accept = hp.getByRole("button", { name: /Accept/i }).first();
  if (PHONE) {
    await send.bring(hp.getByText(/Your fence on the lot/i).first(), 120, 0.9);
    await send.live(900);
  } else {
    await send.bring(accept, SAFE_Y - 130, 0.9);
    const a = await send.center(accept); await send.moveTo(a.x, a.y, 0.5);
    await send.live(700);
  }
  facts.portal = (await hp.locator("body").innerText()).split("\n").filter(Boolean).slice(0, 16);

  const tape = { fmt: FMT, vw: VW, vh: VH, dsf: DSF, fps: FPS, order: ["est", "inv", "send"], segs: { est: est.json(), inv: inv.json(), send: send.json() }, facts };
  fs.writeFileSync(path.join(REC, "tape.json"), JSON.stringify(tape, null, 1));
  // the film reads it from a script tag (a file:// page cannot fetch JSON)
  fs.writeFileSync(path.join(REC, "tape.js"), `window.TAPE = ${JSON.stringify(tape)};
`);
  console.log("segments:", Object.entries(tape.segs).map(([k, s]) => `${k} ${s.dur.toFixed(2)}s/${s.shots.length} frames`).join(" · "));
  await b.close();
  if (errors.length) console.log("PAGE ERRORS:", errors.slice(0, 5).join(" | "));
})().catch((e) => { console.error("RECORD ERROR", e.message.split("\n")[0]); process.exit(1); });
