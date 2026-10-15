// THE SIDEBAR MOVES (2026-10-11). The desk sidebar's motion, frame by frame, in WebKit (Safari's
// engine) and Chromium against a PRODUCTION build (./_prod-server, the same .cache/next-sweep dist
// as mobile-sweep). Fails when:
//   · the plate (.sb-indicator) jumps instead of sliding to a clicked row: fewer than two frames
//     between its start and its end, an overshoot past the row, or its slide restarted on the way
//     (a transitioncancel on `transform` — the 2026-10-10 regression: the estimator trees opened
//     and closed only when the next page committed, so the plate was aimed at the old layout and
//     corrected a frame later, in Safari a long one);
//   · the plate is not on its row (±1px) when it settles, or settles later than its 320ms slide
//     plus the longest frame the engine took;
//   · the shell remounts on a navigation (the sidebar element is replaced);
//   · the fold (⌘\ / Ctrl+\) does not animate the rail, or the plate trails the folding rail
//     instead of staying on its row.
// Signs in only as qa@acme.test (QA Co) and only reads; it clicks sidebar rows and the fold.
// Rebuilds first when src/ is newer than the build (a few minutes).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/visual/sidebar-motion.check.ts
//   QA_SIDEBAR_URL=http://localhost:3312 … — against a production server already running
// The full matrix (1280/1440/1728, wide and folded, scroll and hover) is .cache/sidebar-motion/measure.ts.
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { ensureBuild, playwright, startServer, stopServer } from "../_lib/_prod-server";

const PORT = Number(process.env.QA_SIDEBAR_PORT || 3313);
// QA_SIDEBAR_URL: a production server already running (no build, no start) — e.g. an older build, to
// see this check fail on the regression.
const GIVEN = process.env.QA_SIDEBAR_URL?.replace(/\/$/, "");
const BASE = GIVEN || `http://localhost:${PORT}`;
process.env.QA_BASE_URL = BASE; // ./_qa reads it once, on load
const req = createRequire(__filename);
const qa = req("../_lib/_qa.js");
const SLIDE_MS = 320;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);

// In-page recorder (a string: tsx would wrap a function in helpers the page does not have).
// Samples the plate, the clicked row and the rail every animation frame; logs the plate's and the
// layout's transition events; flags a replaced sidebar or plate.
const RECORD = `window.__record = (ms, href, act) => new Promise((done) => {
  const ind = document.getElementById("sbIndicator"), sb = document.querySelector(".sb"), lay = document.querySelector(".layout");
  const row = href ? document.querySelector('.sb-link[href="' + href + '"]') : null;
  const out = { fr: [], ev: [], at: null };
  const t0 = performance.now();
  const log = (e) => out.ev.push([Math.round(performance.now() - t0), e.type.slice(10), e.propertyName, e.target === ind ? "plate" : "layout"]);
  const types = ["transitionrun", "transitioncancel", "transitionend"];
  types.forEach((t) => { ind.addEventListener(t, log); lay.addEventListener(t, log); });
  const f = () => {
    const t = performance.now() - t0, p = ind.getBoundingClientRect(), a = document.querySelector(".sb-link.active");
    const q = (a || ind).getBoundingClientRect();
    out.fr.push({ t, y: p.top, h: p.height, w: p.width, ry: q.top, rh: q.height, rw: q.width, rail: sb.getBoundingClientRect().width });
    if (t < ms) requestAnimationFrame(f); else {
      types.forEach((t) => { ind.removeEventListener(t, log); lay.removeEventListener(t, log); });
      out.sameSb = document.querySelector(".sb") === sb; out.samePlate = document.getElementById("sbIndicator") === ind;
      out.path = location.pathname; out.active = a ? a.getAttribute("href") : null;
      done(out);
    }
  };
  requestAnimationFrame(f);
  setTimeout(() => { out.at = performance.now() - t0; act === "fold" ? null : row.click(); }, 80);
});`;

type Fr = { t: number; y: number; h: number; w: number; ry: number; rh: number; rw: number; rail: number };
/** What window.__record hands back: the frames, [ms, run|cancel|end, property, plate|layout], and who survived. */
type Rec = { fr: Fr[]; ev: Array<[number, string, string, string]>; at: number; sameSb: boolean; samePlate: boolean; path: string; active: string | null };
/** Frames strictly between the start and the end value, the biggest overshoot past the end, when it stopped moving. */
function travel(fr: Fr[], key: keyof Fr, from: number) {
  const i0 = Math.max(0, fr.findIndex((f) => f.t >= from) - 1);
  const a = fr.slice(i0); const start = a[0][key], end = a[a.length - 1][key], dir = Math.sign(end - start);
  let mid = 0, over = 0, settled = a[0].t, gap = 0;
  for (let i = 1; i < a.length; i++) {
    const v = a[i][key];
    if (Math.abs(v - start) > 0.5 && Math.abs(v - end) > 0.5) mid++;
    over = Math.max(over, (v - end) * dir);
    if (Math.abs(v - a[i - 1][key]) > 0.05) settled = a[i].t;
    gap = Math.max(gap, a[i].t - a[i - 1].t);
  }
  return { span: Math.abs(end - start), mid, over, settled: settled - from, gap };
}

async function main() {
  const pw = playwright();
  let server: ChildProcess | null = null;
  try {
    if (!GIVEN) {
      ensureBuild(note);
      server = await startServer(PORT, {}, "QA_SIDEBAR_PORT");
    }
    const chrome = await qa.launch({ channel: "chrome" }).catch(() => qa.launch());
    const signer = await chrome.newContext(); const sp = await signer.newPage();
    await qa.signIn(sp); const cookies = await signer.cookies(); await chrome.close();
    for (const engine of ["webkit", "chromium"]) {
      const browser = engine === "webkit" ? await pw.webkit.launch() : await qa.launch({ channel: "chrome" }).catch(() => qa.launch());
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      await ctx.addCookies([...cookies, { name: "jf_sb", value: "0", url: BASE }]);
      await qa.forbidControls(ctx);
      await ctx.addInitScript(RECORD);
      const page = await ctx.newPage();
      page.on("dialog", (d: { dismiss: () => Promise<void> }) => d.dismiss().catch(() => {}));
      const go = async (path: string) => {
        await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForSelector("#sbIndicator.ready", { timeout: 30000 }).catch(() => {});
        for (const sel of ['[data-consent="accept-all"]', '[data-consent="got-it"]']) { const b = page.locator(sel).first(); if (await b.count().catch(() => 0)) await b.click({ timeout: 1500 }).catch(() => {}); }
        await sleep(2500);
      };
      await go("/dashboard");
      const tr = String(await page.evaluate(`getComputedStyle(document.getElementById("sbIndicator")).transition`));
      check(`${engine} plate carries its slide`, /transform 0\.32s/.test(tr), tr.slice(0, 80));

      // (a) The plate. "^": the list scrolled to its end first, from an estimator page whose tree is
      // open — the tree above the clicked row closes on the way (the regression's case).
      const steps: Array<[string, string]> = [
        ["/dashboard/jobs", "/dashboard/clients"],
        ["/dashboard/clients", "/dashboard/roof-estimator"],
        ["/dashboard/roof-estimator", "^/dashboard/reports"],
        ["/dashboard/fence-estimator", "^/dashboard/referrals"],
        ["/dashboard/hvac-estimator", "/dashboard/messages"],
        ["/dashboard/messages", "/dashboard/fence-estimator"],
      ];
      for (const [from, step] of steps) {
        const to = step.replace(/^\^/, "");
        await go(from);
        if (step.startsWith("^")) await page.evaluate(`document.querySelector(".sb-scroll").scrollTop = 1e5`);
        else await page.evaluate(`document.querySelector('.sb-link[href="${to}"]').scrollIntoView({ block: "center" })`);
        await sleep(400);
        const r = (await page.evaluate(`window.__record(1500, ${JSON.stringify(to)})`)) as Rec;
        const m = travel(r.fr, "y", r.at);
        const last = r.fr[r.fr.length - 1];
        const cancels = r.ev.filter((e) => e[3] === "plate" && e[1] === "cancel" && e[2] === "transform").length;
        const name = `${engine} ${from.replace("/dashboard/", "")} → ${step.replace("/dashboard/", "")}`;
        check(`${name}: slides`, m.span < 1 || (m.mid >= 2 && m.over <= 2 && cancels === 0), `${m.mid} frames between, overshoot ${m.over.toFixed(1)}px, ${cancels} restart(s)`);
        check(`${name}: lands on its row`, r.active === to && Math.abs(last.y - last.ry) <= 1 && Math.abs(last.h - last.rh) <= 1 && m.settled <= SLIDE_MS + m.gap + 40, `active ${r.active}, off by ${(last.y - last.ry).toFixed(1)}px, settled ${Math.round(m.settled)}ms (longest frame ${Math.round(m.gap)}ms)`);
        check(`${name}: shell kept`, r.sameSb && r.samePlate);
      }

      // The shell is one tree on every route: the deck inventory (not a handheld route) and back.
      await go("/dashboard/deck-estimator");
      const deckInv = page.locator('.sb-link[href="/dashboard/deck-estimator/inventory"]').first();
      if (await deckInv.isVisible().catch(() => false)) {
        const k = (await page.evaluate(`window.__record(2500, "/dashboard/deck-estimator/inventory")`)) as Rec;
        const k2 = (await page.evaluate(`window.__record(2500, "/dashboard/phone")`).catch(() => ({ sameSb: false }))) as Pick<Rec, "sameSb">;
        check(`${engine} no remount through the deck inventory`, k.sameSb && k2.sameSb, `${k.path} ${k.sameSb ? "kept" : "remounted"}, back ${k2.sameSb ? "kept" : "remounted"}`);
      } else note(`${engine} deck inventory row`, "not shown to QA Co — remount case skipped");

      // (b) The fold, both ways, by the shortcut.
      await go("/dashboard/jobs");
      for (const way of ["fold", "unfold"]) {
        const rec = page.evaluate(`window.__record(1100, null, "fold")`);
        await sleep(120);
        await page.keyboard.press("Control+Backslash");
        const r = (await rec) as Rec;
        const rail = travel(r.fr, "rail", r.at);
        const plate = travel(r.fr, "w", r.at);
        const last = r.fr[r.fr.length - 1];
        const ran = r.ev.some((e) => e[3] === "layout" && e[1] === "run" && e[2] === "grid-template-columns");
        check(`${engine} ${way}: the rail animates`, ran && rail.span > 100 && rail.mid >= 1, `${Math.round(rail.span)}px, ${rail.mid} frame(s) between, transition ${ran ? "ran" : "did not run"}`);
        check(`${engine} ${way}: the plate stays on its row`, Math.abs(last.w - last.rw) <= 1 && Math.abs(last.y - last.ry) <= 1 && plate.settled - rail.settled <= rail.gap + 20, `plate settled ${Math.round(plate.settled - rail.settled)}ms after the rail (longest frame ${Math.round(rail.gap)}ms)`);
        await sleep(500);
      }
      await ctx.close();
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
  console.log(bad ? `${bad} failed` : "all passed");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
