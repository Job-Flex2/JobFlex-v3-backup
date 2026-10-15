// Shared by every Playwright script here: the browser, the ONE sign-in, and the
// organisation the run works in.
//
//  · launch()  — Playwright's own Chromium when its build is installed, the
//                system Chrome otherwise (an npx-cached Playwright is often a
//                revision ahead of the browsers on disk).
//  · signIn()  — qa@acme.test, once: the session cookies are kept in the temp
//                folder and reused by the next script. The sign-in brake allows
//                8 attempts per address per 15 minutes; a suite of fifteen
//                scripts that each log in locks itself out halfway.
//  · qaOrg()   — the QA Co organisation (slug qa-co). Automated runs work ONLY
//                there (CLAUDE.md, Test accounts): limits are per organisation,
//                and records a script needs are made there and removed after.
const fs = require("fs");
const os = require("os");
const path = require("path");

// The server under test: QA_BASE_URL in full, else localhost on QA_PORT (default 3000).
const BASE = process.env.QA_BASE_URL || `http://localhost:${process.env.QA_PORT || 3000}`;
const EMAIL = "qa@acme.test";
const PASSWORD = "qa-pass-2026";
const QA_ORG_SLUG = "qa-co";
// One kept session per server: cookies are per host, so localhost's session is no use on the LAN address.
const SESSION_FILE = path.join(os.tmpdir(), "jobflex-qa-session" + (new URL(BASE).host === "localhost:3000" ? "" : "-" + new URL(BASE).host.replace(/[^a-z0-9]/gi, "_")) + ".json");

async function launch(opts = {}) {
  const { chromium } = require("playwright"); // here, not at the top: ./_world uses this file without a browser
  try {
    return await chromium.launch(opts);
  } catch (err) {
    if (!/Executable doesn't exist/.test(String(err))) throw err;
    return chromium.launch({ ...opts, channel: "chrome" });
  }
}

/** Installs ./_world's FORBIDDEN_CONTROLS in every page of the context, before anything loads. */
async function forbidControls(ctx) {
  if (ctx.__qaForbid) return;
  ctx.__qaForbid = true;
  const { FORBIDDEN_CONTROLS } = require("./_world");
  await ctx.exposeBinding("__qaForbidden", (_src, what) => {
    console.error("HARNESS FAIL: QA guard — a script tried to press a forbidden control: " + what + ". The click was swallowed; nothing happened on the page.");
    process.exit(1);
  });
  await ctx.addInitScript(({ selectors, labels }) => {
    const rules = labels.map((l) => new RegExp(l.source, l.flags));
    const hit = (target) => {
      const el = target instanceof Element ? target.closest('button, a, [role="button"], input[type="submit"], input[type="button"], [data-act]') : null;
      if (!el) return null;
      for (const sel of selectors) { try { if (el.matches(sel) || el.closest(sel)) return sel; } catch { /* a selector this browser cannot parse */ } }
      const texts = [el.getAttribute("aria-label") || "", el.textContent || "", el.value || ""];
      for (const raw of texts) { const t = String(raw).replace(/\s+/g, " ").trim(); if (t && rules.some((x) => x.test(t))) return '"' + t.slice(0, 60) + '"'; }
      return null;
    };
    const stop = (ev) => {
      if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
      const what = hit(ev.target);
      if (!what) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.__qaForbidden(what);
    };
    for (const type of ["pointerdown", "mousedown", "click", "keydown", "touchstart"]) window.addEventListener(type, stop, true);
  }, { selectors: FORBIDDEN_CONTROLS.selectors, labels: FORBIDDEN_CONTROLS.labels.map((r) => ({ source: r.source, flags: r.flags })) });
}

async function signIn(page) {
  const ctx = page.context();
  // Before the first navigation and before a single click: the right database, the right
  // account in the right organisation, and the forbidden controls wired shut.
  {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    try { await require("./_world").assertSafe(prisma); } finally { await prisma.$disconnect(); }
  }
  await forbidControls(ctx);
  try {
    if (fs.existsSync(SESSION_FILE)) await ctx.addCookies(JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")));
  } catch { /* a stale file is not a reason to fail */ }
  await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  if (!/\/auth\/login/.test(page.url())) return assertSignedInAsQa(page);
  // In development the login form's state starts on owner@acme.test (the owner's own manual
  // account). Filled before React hydrates, the field is put back to it — and the press signs
  // in as the OWNER with a wrong password, spending the owner's brake (it happened, 2026-09-30).
  // So: wait for the form to settle, fill, and never press unless the field holds EMAIL.
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6; i++) {
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.waitForTimeout(500);
    if ((await page.inputValue('input[type="email"]')) === EMAIL) break;
  }
  if ((await page.inputValue('input[type="email"]')) !== EMAIL) throw new Error("QA guard: the email field would not hold " + EMAIL + " — nothing was submitted");
  // By PATH: the login URL itself carries "?next=/dashboard", which a /dashboard/ regex matches at once.
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  if (/\/auth\/login/.test(page.url())) throw new Error("sign-in refused for " + EMAIL + " (the brake? 8 attempts per 15 minutes)");
  fs.writeFileSync(SESSION_FILE, JSON.stringify(await ctx.cookies()));
  await assertSignedInAsQa(page);
}

/** Who the BROWSER is signed in as — a kept session could be anybody's. */
async function assertSignedInAsQa(page) {
  const who = await page.evaluate(async () => { try { return (await (await fetch("/api/auth/session")).json())?.user?.email ?? null; } catch { return null; } });
  if (who !== EMAIL) {
    try { fs.unlinkSync(SESSION_FILE); } catch { /* none kept */ }
    throw new Error(`QA guard: the browser is signed in as ${who || "nobody"}, not ${EMAIL} — nothing was clicked`);
  }
}

/** The QA Co organisation row, through the project's Prisma client. */
async function qaOrg(prisma) {
  const org = await prisma.organization.findUnique({ where: { slug: QA_ORG_SLUG } });
  if (!org) throw new Error('organisation "QA Co" (slug qa-co) is missing — run the seed');
  return org;
}

/** Run a script against the QA Co fixtures (./_world): made first, removed last — pass or fail. */
async function withWorld(run, opts = {}) {
  const world = require("./_world");
  try {
    // inside the try: an `up` that fails halfway (a schema the database has not caught up with)
    // must not leave its first rows behind
    const made = await world.up(undefined, opts);
    await run(made);
  } finally {
    await world.down();
  }
}

/** A script written against a page that has since been rebuilt or moved. It says so and steps
 *  aside (exit 0, one STALE line) instead of failing for reasons that are not regressions — or,
 *  worse, poking at a page that became real. `--force` runs it anyway. */
function stale(reason) {
  if (process.argv.includes("--force")) return;
  console.log("STALE | " + reason);
  process.exit(0);
}

module.exports = { launch, signIn, forbidControls, qaOrg, withWorld, stale, BASE, EMAIL, QA_ORG_SLUG };
