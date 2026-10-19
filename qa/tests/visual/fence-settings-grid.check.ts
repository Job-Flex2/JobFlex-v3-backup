// THE FENCE SETTINGS CARDS STAY PACKED (2026-10-18). /dashboard/fence-estimator's option cards
// (Height, Site, Posts, Boards & fasteners, Ground) on a PRODUCTION build (./_prod-server — the
// shell's margin/padding reset lands in another order there than in `next dev`). Fails when:
//   · two cards that follow each other in a column are more than MAX_GAP apart (or overlap) — the
//     2026-09-23 regression: a hand-placed grid (nth-child row spans) met a fifth card and left
//     holes between short cards and a ragged grid;
//   · the gaps differ between columns, or a column does not start at the block's top;
//   · the columns are not of one width, or there are not as many as the width asks for
//     (3 at ≥1400, 2 at 1101–1399, 1 below);
//   · the rail (Estimated total, the type list) leaves the right of the centre column, or the
//     Runs/Gates block (Total · Runs · Openings) does not follow the cards;
//   · anything is wider than a 390 phone.
// Each width is measured empty, with runs and a gate typed in (a wood type — the Boards card
// shows), and the same with a chain-link type (the Boards card hidden). Nothing is saved: the
// runs are typed, no address is looked up, nothing is converted.
// Signs in only as qa@acme.test (QA Co). Rebuilds first when src/ is newer than the build.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/visual/fence-settings-grid.check.ts
//   QA_FENCEGRID_URL=http://localhost:3318 … — against a production server already running
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { ensureBuild, playwright, startServer, stopServer } from "../_lib/_prod-server";

const PORT = Number(process.env.QA_FENCEGRID_PORT || 3318);
const GIVEN = process.env.QA_FENCEGRID_URL?.replace(/\/$/, "");
const BASE = GIVEN || `http://localhost:${PORT}`;
process.env.QA_BASE_URL = BASE; // ./_qa reads it once, on load
const req = createRequire(__filename);
const qa = req("../_lib/_qa.js");
const URL = BASE + "/dashboard/fence-estimator";
const MAX_GAP = 24;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);

const VIEWS = [
  { name: "1920", width: 1920, height: 1080, cols: 3 },
  { name: "1440", width: 1440, height: 900, cols: 3 },
  { name: "1280", width: 1280, height: 800, cols: 2 },
  { name: "390", width: 390, height: 844, cols: 1, phone: true },
];

// In-page measure (a string: tsx would wrap a function in helpers the page does not have).
const MEASURE = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const box = document.getElementById("fsSettings");
  const cards = [...box.querySelectorAll(":scope > .fs-set")].filter((el) => el.getClientRects().length).map((el) => ({ name: el.querySelector(".ledger-head")?.textContent?.trim() || "?", ...r(el) }));
  const q = (s) => { const el = document.querySelector(s); return el && el.getClientRects().length ? r(el) : null; };
  const content = document.querySelector(".content");
  return { box: r(box), cards, main: q(".fs-main"), rail: q(".fs-rail"), tk: q(".fs-rail > .tk"), types: q(".fs-types"), ledgers: q(".fs-ledgers"), runs: q(".fs-ledgers > .fs-card"), strip: q("#statStrip"),
    vw: document.documentElement.clientWidth, overflow: content ? content.scrollWidth - content.clientWidth : 0 };
})()`;
type Box = { l: number; t: number; r: number; b: number; w: number; h: number };
type Card = Box & { name: string };
type M = { box: Box; cards: Card[]; main: Box | null; rail: Box | null; tk: Box | null; types: Box | null; ledgers: Box | null; runs: Box | null; strip: Box | null; vw: number; overflow: number };

function judge(tag: string, m: M, cols: number, phone: boolean) {
  // Columns: cards grouped by their left edge.
  const byCol = new Map<number, Card[]>();
  for (const c of m.cards) {
    const key = [...byCol.keys()].find((k) => Math.abs(k - c.l) <= 2) ?? c.l;
    byCol.set(key, [...(byCol.get(key) || []), c]);
  }
  const columns = [...byCol.entries()].sort((a, b) => a[0] - b[0]).map(([, cs]) => cs.sort((a, b) => a.t - b.t));
  check(`${tag}: ${cols} column(s) of cards`, columns.length === cols, `${columns.length} — ${columns.map((c) => c.map((x) => x.name).join("/")).join(" | ")}`);
  const widths = m.cards.map((c) => c.w);
  check(`${tag}: one column width`, Math.max(...widths) - Math.min(...widths) <= 1, widths.map((w) => w.toFixed(1)).join(", "));
  const gaps: number[] = [];
  for (const col of columns) for (let i = 1; i < col.length; i++) gaps.push(col[i].t - col[i - 1].b);
  check(`${tag}: cards packed, ≤ ${MAX_GAP}px apart, never overlapping`, gaps.every((g) => g >= 4 && g <= MAX_GAP), gaps.length ? gaps.map((g) => g.toFixed(1)).join(", ") + " px" : "one card a column");
  check(`${tag}: one gap everywhere`, !gaps.length || Math.max(...gaps) - Math.min(...gaps) <= 1, gaps.map((g) => g.toFixed(0)).join(", "));
  if (!phone) {
    const tops = columns.map((c) => c[0].t - m.box.t);
    check(`${tag}: every column starts at the block's top`, tops.every((t) => Math.abs(t) <= 1), tops.map((t) => t.toFixed(1)).join(", "));
    const tallest = Math.max(...columns.map((c) => c[c.length - 1].b));
    // Chrome's column balancing leaves a few px of slack under the tallest column (6px at 1280).
    check(`${tag}: the block ends with its tallest column`, m.box.b - tallest >= -1 && m.box.b - tallest <= 8, `block ${m.box.b.toFixed(1)}, column ${tallest.toFixed(1)}`);
    if (m.ledgers) check(`${tag}: Runs/Gates follow the tallest column`, m.ledgers.t >= tallest && m.ledgers.t - tallest <= MAX_GAP, `${(m.ledgers.t - tallest).toFixed(1)} px below`);
    const { main, rail, tk, types } = m;
    check(`${tag}: the rail holds beside the centre`, !!(main && rail && tk && types) && rail.l >= main.r + 8 && Math.abs(rail.t - main.t) <= 1 && tk.b <= types.t, main && rail ? `centre ${main.l.toFixed(0)}–${main.r.toFixed(0)}, rail ${rail.l.toFixed(0)}–${rail.r.toFixed(0)} at ${(rail.t - main.t).toFixed(1)}` : "missing");
    check(`${tag}: the cards stay inside the centre column`, !!main && m.cards.every((c) => c.l >= main.l - 1 && c.r <= main.r + 1));
  }
  const { ledgers, runs, strip } = m;
  // Phone: the blocks are one column with the rail between; the cards come last.
  if (!phone) check(`${tag}: Runs/Gates follow the cards`, !!ledgers && ledgers.t >= m.box.b && ledgers.t - m.box.b <= MAX_GAP, ledgers ? `${(ledgers.t - m.box.b).toFixed(1)} px below` : "missing");
  check(`${tag}: Total · Runs · Openings strip inside its card`, !!(runs && strip) && strip.l >= runs.l - 1 && strip.r <= runs.r + 1 && strip.t >= runs.t - 1);
  if (phone) check(`${tag}: nothing wider than the phone`, m.overflow <= 0 && m.cards.every((c) => c.l >= 0 && c.r <= m.vw + 0.5), `overflow ${m.overflow}px, cards ${m.cards.map((c) => `${c.l.toFixed(0)}–${c.r.toFixed(0)}`).join(" ")}`);
}

async function main() {
  playwright();
  let server: ChildProcess | null = null;
  try {
    if (!GIVEN) {
      ensureBuild(note);
      server = await startServer(PORT, {}, "QA_FENCEGRID_PORT");
    }
    const browser = await qa.launch({ channel: "chrome" }).catch(() => qa.launch());
    const signer = await browser.newContext(); const sp = await signer.newPage();
    await qa.signIn(sp); const cookies = await signer.cookies(); await signer.close();
    for (const v of VIEWS) {
      const ctx = await browser.newContext(v.phone
        ? { viewport: { width: v.width, height: v.height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
        : { viewport: { width: v.width, height: v.height } });
      await ctx.addCookies(cookies);
      await qa.forbidControls(ctx);
      const page = await ctx.newPage();
      page.on("dialog", (d: { dismiss: () => Promise<void> }) => d.dismiss().catch(() => {}));
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForSelector("#fsSettings .fs-set", { timeout: 30000 });
      for (const sel of ['[data-consent="accept-all"]', '[data-consent="got-it"]', 'button:has-text("Essential only")']) { const b = page.locator(sel).first(); if (await b.count().catch(() => 0)) await b.click({ timeout: 1500 }).catch(() => {}); }
      await sleep(2500);
      await page.locator("#resetBtn").click().catch(() => {});
      await sleep(600);
      const pick = async (id: string) => { await page.evaluate(`document.querySelector('#matList [data-mat="${id}"]')?.click()`); await sleep(500); };
      await pick("cedar-privacy");
      const measure = async (state: string) => { await page.evaluate("window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0)"); await sleep(300); judge(`${v.name} ${state}`, (await page.evaluate(MEASURE)) as M, v.cols, !!v.phone); };
      await measure("empty");
      for (const ft of [120, 60]) {
        await page.evaluate(`document.querySelector('[data-act="add-run"]').click()`);
        await sleep(300);
        const input = page.locator("#runsList [data-run-ft]").last();
        await input.fill(String(ft));
        await input.press("Tab");
        await sleep(500);
      }
      await page.evaluate(`document.querySelector('.tool-pop [data-add-open]')?.click()`);
      await sleep(600);
      const filled = String(await page.locator("#statStrip").textContent().catch(() => ""));
      if (!/180/.test(filled)) note(`${v.name} filled`, `the strip reads "${filled.replace(/\s+/g, " ").trim()}" — runs not taken?`);
      await measure("filled · cedar");
      await pick("chain-link-galv");
      await measure("filled · chain link");
      await ctx.close();
    }
    await browser.close();
  } finally {
    stopServer(server);
  }
  console.log(bad ? `${bad} failed` : "all passed");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
