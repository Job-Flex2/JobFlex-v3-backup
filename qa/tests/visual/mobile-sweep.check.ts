// THE PHONE, CHECKED (2026-10-04). The core of the mobile sweep on every run-all --checks:
// WebKit with an iPhone's user agent, DPR 3, 390×844 and 390×700, against a PRODUCTION build
// (`next start`, its own dist dir — .cache/next-sweep — so another session's `next build`
// cannot swap the files under it). Fails when, on any page below:
//   · the page scrolls sideways;
//   · a bottom bar, a sheet's foot or its buttons are cut off by the end of the screen;
//   · at full scroll the content ends under a bottom bar or the screen;
//   · a sheet's body does not scroll to its last field;
//   · the app's top bar is not 12px from both edges, or a badge hangs out of its button;
//   · a phone-width root carries a zoom;
//   · (2026-10-12; 2026-10-14) on the sign-up's plan step (360×640, 390×844/700, 430×932) the same,
//     and its full cards stand in one swiped row, the most-picked one in the middle with its
//     neighbours at the edges, one dot per card, each card with its own list and start button,
//     nothing pinned;
//   · dev and prod draw the same page differently (stylesheet order) — when a dev server is up
//     (QA_DEV_URL, else localhost:3001 / :3000); without one that half is reported, not failed.
// Signs in only as qa@acme.test (QA Co); its records come from ./_world and ./_crewWorld and
// are removed after. Rebuilds first when src/ is newer than the build (a few minutes).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/visual/mobile-sweep.check.ts
// The full sweep (every route, every identity, every sheet) is .cache/mobile-sweep/run.sh.
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { ensureBuild, playwright, startServer, stopServer } from "../_lib/_prod-server";
import { db, makeCrewWorld } from "../_lib/_crewWorld";
import { localDayKey } from "../../../src/lib/jobProgressShared";

const PORT = Number(process.env.QA_SWEEP_PORT || 3311);
const BASE = `http://localhost:${PORT}`;
process.env.QA_BASE_URL = BASE; // ./_qa reads it once, on load
const req = createRequire(__filename);
const qa = req("../_lib/_qa.js");
const { PAGE, MARK, OVERLAY, PRINT, judge, judgeOverlay, diffPrint, settle } = req("../_lib/_mobile-probe.js");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);

async function devBase(): Promise<string | null> {
  const list = process.env.QA_DEV_URL ? [process.env.QA_DEV_URL] : ["http://localhost:3001", "http://localhost:3000"];
  for (const u of list) { try { const r = await fetch(u + "/auth/login", { signal: AbortSignal.timeout(4000) }); if (r.status < 500) return u.replace(/\/$/, ""); } catch { /* not this one */ } }
  return null;
}

/** The surfaces a page must open whole: each a chain of button labels (prefixes). */
type Route = { path: string; anon?: boolean; open?: string[][]; compare?: boolean };
function routes(ids: { job: string; token: string; assignment: string }): Route[] {
  return [
    { path: "/", anon: true, compare: true }, { path: "/pricing", anon: true }, { path: "/homeowner", anon: true }, { path: "/auth/login", anon: true, compare: true }, { path: "/auth/register", anon: true },
    { path: "/dashboard", open: [["New estimate"], ["Notifications"]], compare: true },
    { path: "/dashboard/proposals", open: [["Actions for"]] },
    { path: "/dashboard/clients", open: [["New client"], ["Actions for", "Edit client"], ["Filter"]], compare: true },
    { path: "/dashboard/jobs", open: [["New job"], ["Actions for", "Assign crew"]], compare: true },
    { path: `/dashboard/jobs/${ids.job}` },
    { path: "/dashboard/leads", open: [["New lead"], ["Actions for"]] },
    { path: "/dashboard/calendar", open: [["New event"]] },
    { path: "/dashboard/workers", open: [["Invite worker"]] },
    { path: "/dashboard/company", open: [["Edit identity"]] },
    { path: "/dashboard/financials", open: [["Actions"]] },
    { path: "/dashboard/inventory", open: [["Add item"]] },
    // The desk pages inside the handheld frame: where the production CSS order bit (2026-10-04).
    { path: "/dashboard/fence-estimator", compare: true }, { path: "/dashboard/roof-estimator", compare: true }, { path: "/dashboard/hvac-estimator" },
    { path: "/dashboard/projects" }, { path: "/dashboard/messages" }, { path: "/dashboard/settings" }, { path: "/dashboard/crm" }, { path: "/dashboard/reports" },
    { path: `/w/${ids.token}/jobs/${ids.assignment}`, anon: true, open: [["Close day"]] },
  ];
}

async function press(page: any, label: string, inside: boolean) {
  const h = await page.evaluateHandle(({ l, inside }: { l: string; inside: boolean }) => [...document.querySelectorAll(inside ? "[data-sweep-overlay] button, [data-sweep-overlay] [role=menuitem]" : "button, [role=button], [aria-haspopup]")]
    .find((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().startsWith(l) && !(e as HTMLButtonElement).disabled && (inside || !e.closest('[role=dialog], [aria-modal="true"]'))) || null, { l: label, inside });
  const el = h.asElement(); if (!el) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  // A list that loads late moves the control under the finger: press once it holds still and is on top.
  for (let i = 0; i < 12; i++) {
    const still = await el.evaluate(async (b: Element) => { const r1 = b.getBoundingClientRect(); await new Promise((r) => setTimeout(r, 250)); const r2 = b.getBoundingClientRect(); const at = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2); return r1.top === r2.top && !!at && (b === at || b.contains(at)); }).catch(() => false);
    if (still) break;
  }
  await el.click({ timeout: 4000 }).catch(() => el.evaluate((b: HTMLElement) => b.click()));
  return true;
}
async function load(page: any, url: string) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page, { first: 800 });
  return res ? res.status() : 0;
}
const say = (issues: Array<{ el?: string; what: string; soft?: boolean }>) => issues.filter((i) => !i.soft).map((i) => (i.el ? i.el + ": " : "") + i.what).join(" | ");

/** The crew world (two installers on a job, ./_crewWorld) for the length of `run`. */
async function withCrew(run: (crew: Awaited<ReturnType<typeof makeCrewWorld>>) => Promise<void>) {
  const crew = await makeCrewWorld("sweep");
  try { await run(crew); } finally { await crew.cleanup(); }
}

/** Playwright is resolved at run time (./_prod-server): its objects are untyped here. */
type Loose = ReturnType<typeof playwright>;

/** THE SIGN-UP'S PLAN STEP (owner, 2026-10-14): the full cards in one swiped row — the most-picked
 *  card in the middle, its neighbours showing at the edges, a dot per card — each with its own list
 *  and start button, the page scrolling down, nothing pinned. Reached as a new visitor (its own
 *  made-up IP; its pending signup removed after), judged like every page. */
const SWEEP_MAIL = `sweep${Date.now()}.test`;
async function planStep(webkit: Loose, H: number, W = 390) {
  const ip = `10.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const ctx = await webkit.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  await ctx.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: "localhost", path: "/" }]);
  await ctx.route("**/*", (route: Loose) => (route.request().url().startsWith(BASE) ? route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }) : route.continue()));
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + "/auth/register", { waitUntil: "load", timeout: 120000 });
    await page.locator("#nextBtn").waitFor({ timeout: 60000 });
    await sleep(800);
    await page.getByPlaceholder("First and last").fill("Sweep Plan");
    await page.getByPlaceholder("you@yourshop.com").fill(`plan.${H}@${SWEEP_MAIL}`);
    const pw = page.locator('input[autocomplete="new-password"]');
    for (let i = 0; i < (await pw.count()); i++) if (await pw.nth(i).isVisible()) await pw.nth(i).fill("SweepPlan-2026!");
    await page.locator("#nextBtn").click();
    await page.getByPlaceholder("Company name").waitFor({ state: "visible", timeout: 60000 });
    await page.getByPlaceholder("Company name").fill("Sweep Plan Co");
    await page.getByPlaceholder("Street, city, state, ZIP").fill("142 Alder Ridge Rd, Seattle, WA 98101");
    await sleep(400);
    await page.keyboard.press("Escape");
    await page.getByPlaceholder("Phone number").fill("2065550123");
    if (!(await page.locator("#step2 .chip.on").count())) await page.locator("#step2 .chip").first().click();
    await page.locator("#createBtn").click();
    await page.locator("section.plan-sheet.is-in [data-plan-card]").first().waitFor({ timeout: 60000 });
    await sleep(1500);
    const p = await page.evaluate(PAGE);
    const issues = judge(p);
    const grid = await page.evaluate(() => {
      const root = document.querySelector("section.plan-sheet.is-in")!;
      const railEl = root.querySelector<HTMLElement>(".pw-plans")!;
      const rail = railEl.getBoundingClientRect();
      const mid = (rail.left + rail.right) / 2;
      const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-plan-card]")).map((c) => { const b = c.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), l: b.left, r: b.right, hero: c.classList.contains("pw-plan--hero"), go: c.querySelectorAll(".pw-go").length, rows: c.querySelectorAll("[data-plan-feats] > *").length }; });
      const at = cards.findIndex((c) => Math.abs((c.l + c.r) / 2 - mid) <= 1);
      const peeks = at < 0 ? [] : [cards[at - 1] ? cards[at - 1].r - rail.left : null, cards[at + 1] ? rail.right - cards[at + 1].l : null].filter((x): x is number => x !== null);
      return { cards, at, hero: at >= 0 && cards[at].hero, peeks, swipes: railEl.scrollWidth > railEl.clientWidth + 1, dots: root.querySelectorAll("[data-plan-dot]").length, pinned: document.querySelectorAll("[data-plan-bar], [data-plan-tiles]").length };
    });
    const row = grid.cards.length >= 2 && grid.cards.every((c: Loose) => Math.abs(c.top - grid.cards[0].top) <= 1 && Math.abs(c.h - grid.cards[0].h) <= 1) && grid.swipes;
    const middle = grid.hero && grid.peeks.length > 0 && grid.peeks.every((x: number) => Math.abs(x - (24 + 0.05 * W)) <= 1.5);
    const own = grid.cards.every((c: Loose) => c.go === 1 && c.rows > 0) && grid.dots === grid.cards.length;
    check(`${W}×${H} /auth/register ▸ plan step`, !issues.filter((i: Loose) => !i.soft).length && !(p.bars || []).length && !grid.pinned && row && middle && own, `${say(issues)} · ${grid.cards.length} cards${row ? "" : " · not one swiped row of one height"}${middle ? "" : ` · the middle card ${grid.at} (most picked: ${grid.hero}), edges ${grid.peeks.map((x: number) => Math.round(x)).join("/")}px`}${own ? "" : ` · a card without its list or button, or ${grid.dots} dots`}${(p.bars || []).length || grid.pinned ? " · something pinned" : ""}`);
  } catch (e) {
    check(`${W}×${H} /auth/register ▸ plan step`, false, String((e as Error)?.message || e).split("\n")[0]);
  } finally {
    await ctx.close();
    await db.syncState.deleteMany({ where: { OR: [{ key: { startsWith: "signup:" }, cursor: { contains: SWEEP_MAIL } }, { key: { startsWith: "rl:", endsWith: ":" + ip } }] } }).catch(() => {});
  }
}

async function main() {
  const pw = playwright();
  ensureBuild(note);
  let server: ChildProcess | null = null;
  try {
    server = await startServer(PORT, {}, "QA_SWEEP_PORT");
    // ./_world first (it clears QA Co's jobs on its way up), then the crew world on top of it.
    await qa.withWorld(() => withCrew(async (crew) => {
      // The portal's job page wants an open day to show Close day — made by hand, nothing started.
      const A = crew.workers[0];
      await db.workDay.create({ data: { organizationId: crew.orgId, jobId: crew.jobId, date: localDayKey(new Date(), crew.tz), dayNumber: 1, status: "OPEN", openedById: A.userId, source: "worker" } });
      const asg = await db.jobAssignment.findFirstOrThrow({ where: { jobId: crew.jobId, workerId: A.workerId }, select: { id: true } });
      const job = await db.job.findFirst({ where: { organizationId: crew.orgId, title: { not: crew.jobTitle } }, orderBy: { createdAt: "desc" }, select: { id: true } });
      const list = routes({ job: job?.id ?? crew.jobId, token: A.token, assignment: asg.id });
      const chrome = await qa.launch({ channel: "chrome" }).catch(() => qa.launch());
      const signer = await chrome.newContext(); const sp = await signer.newPage();
      await qa.signIn(sp); const cookies = await signer.cookies(); await chrome.close();
      const webkit = await pw.webkit.launch();
      for (const H of [844, 700]) {
        const ctx = await webkit.newContext({ viewport: { width: 390, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
        await ctx.addCookies(cookies); await qa.forbidControls(ctx);
        const page = await ctx.newPage(); page.on("dialog", (d: any) => d.dismiss().catch(() => {}));
        for (const r of list) {
          const status = await load(page, BASE + r.path).catch(() => 0);
          if (status >= 400 || !status) { check(`${H} ${r.path} loads`, false, `HTTP ${status}`); continue; }
          const p = await page.evaluate(PAGE);
          const issues = judge(p);
          check(`${H} ${r.path}`, !issues.filter((i: any) => !i.soft).length, say(issues));
          for (const chain of r.open || []) {
            await load(page, BASE + r.path);
            await page.evaluate(MARK);
            let ok = await press(page, chain[0], false);
            for (const next of chain.slice(1)) {
              if (!ok) break;
              await sleep(900); await page.evaluate(OVERLAY); await page.evaluate(MARK);
              ok = await press(page, next, true);
            }
            if (!ok) { check(`${H} ${r.path} ▸ ${chain.join(" ▸ ")}`, false, "the control is not on the page"); continue; }
            await sleep(1100);
            await page.evaluate(() => document.querySelectorAll("[data-sweep-overlay]").forEach((e) => { e.removeAttribute("data-sweep-overlay"); e.setAttribute("data-sweep-was", "1"); }));
            const m = await page.evaluate(OVERLAY);
            if (m.none) { check(`${H} ${r.path} ▸ ${chain.join(" ▸ ")}`, false, "nothing opened"); continue; }
            const oi = judgeOverlay(m);
            check(`${H} ${r.path} ▸ ${chain.join(" ▸ ")}`, !oi.filter((i: any) => !i.soft).length, `“${m.label}” ${m.top}..${m.bottom}${oi.length ? " · " + say(oi) : ""}`);
          }
        }
        await ctx.close();
        await planStep(webkit, H);
      }
      for (const [W, H] of [[360, 640], [430, 932]]) await planStep(webkit, H, W);
      // DEV ↔ PROD — the same page drawn by both, when a dev server is up.
      const dev = await devBase();
      if (!dev) note("dev ↔ prod", "no dev server on QA_DEV_URL / :3001 / :3000 — not compared");
      else {
        const ctxs = await Promise.all([dev, BASE].map(async () => { const c = await webkit.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA }); await c.addCookies(cookies); return c; }));
        const [dp, pp] = await Promise.all(ctxs.map((c) => c.newPage()));
        for (const r of list.filter((x) => x.compare)) {
          const got: any[] = [];
          for (const [page, base, wait] of [[dp, dev, 4000], [pp, BASE, 1000]] as Array<[any, string, number]>) {
            await page.goto(base + r.path, { waitUntil: "domcontentloaded", timeout: 180000 });
            await settle(page, { first: wait, timeout: 120000 });
            got.push(await page.evaluate(PRINT));
          }
          const d = diffPrint(got[0], got[1]);
          check(`dev ↔ prod ${r.path}`, !d.length, d.slice(0, 5).join(" | "));
        }
        await Promise.all(ctxs.map((c) => c.close()));
      }
      await webkit.close();
    }));
  } finally {
    stopServer(server);
  }
  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("\n1 failing"); process.exit(1); });
