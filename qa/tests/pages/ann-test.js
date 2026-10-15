// Functional pass over the platform console's Announcements board — rewritten 2026-10-01.
// Announcements left the contractor dashboard for /admin/announcements (9fa8b94); a published
// one is a banner on EVERY organisation's dashboard, so this script never publishes and never
// retires. It checks the board against the database, the dialog, the live preview, and that
// the dialog refuses an empty announcement in the field — with a watch on the network and a
// row count that fail the run if anything were written.
//
// The console has no login form: the script signs the `jf_admin` cookie for the passwordless
// platform-admin row the way src/lib/adminAuth.ts does (NEXTAUTH_SECRET from .env.local).
// The contractor side is checked as qa@acme.test (QA Co) through ./_qa.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { launch, signIn, forbidControls } = require("../_lib/_qa");
const { assertLocalDatabase } = require("../_lib/_world");

let fails = 0;
const log = (ok, name, extra = "") => {
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envLocal(name) {
  for (const file of [".env.local", ".env"]) {
    try {
      const m = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", file), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
      if (m) return m[1].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    } catch { /* next */ }
  }
  return process.env[name] || null;
}

/** The console's cookie for the passwordless platform-admin row (lib/adminAuth signAdminToken). */
async function adminCookie(prisma) {
  const secret = envLocal("NEXTAUTH_SECRET") || envLocal("AUTH_SECRET");
  if (!secret) throw new Error("NEXTAUTH_SECRET missing");
  const admin = await prisma.user.findFirst({ where: { isPlatformAdmin: true, hashedPassword: null, email: { endsWith: "@platform.jobflex.local" } }, select: { id: true } });
  if (!admin) throw new Error("no passwordless platform-admin row — open /admin/login once on this database");
  const payload = `${admin.id}.${Date.now() + 30 * 60_000}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return { name: "jf_admin", value: `${payload}.${sig}`, domain: new URL(QA_BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" };
}

(async () => {
  const prisma = new PrismaClient();
  await assertLocalDatabase(prisma);
  const now = new Date();
  const platform = await prisma.announcement.findMany({ where: { scope: "PLATFORM" }, select: { id: true, expiresAt: true } });
  const activeDb = platform.filter((a) => !a.expiresAt || a.expiresAt > now).length;
  const pastDb = platform.length - activeDb;
  const rowsBefore = await prisma.announcement.count();

  const browser = await launch();

  // ---- the contractor side: the board is gone from the dashboard, the console is closed to it ----
  const qaCtx = await browser.newContext({ viewport: { width: 1728, height: 1000 } });
  const qaPage = await qaCtx.newPage();
  await signIn(qaPage);
  const old = await qaPage.goto(QA_BASE + "/dashboard/announcements", { waitUntil: "domcontentloaded" });
  log(old && old.status() === 404, "dashboard: /dashboard/announcements is gone (404)", String(old && old.status()));
  await qaPage.goto(QA_BASE + "/admin/announcements", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  log(!/\/admin\/announcements/.test(new URL(qaPage.url()).pathname) || (await qaPage.locator("#newAnnBtn").count()) === 0, "console: a contractor session does not reach the board", new URL(qaPage.url()).pathname);
  await qaCtx.close();

  // ---- the console ----
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 } });
  await forbidControls(ctx);
  await ctx.addCookies([await adminCookie(prisma)]);
  const page = await ctx.newPage();
  const errors = [];
  const writes = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  await page.goto(QA_BASE + "/admin/announcements", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  // From here on, any server action is a write this script must not make.
  page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) writes.push(r.url().slice(0, 80)); });

  log(/\/admin\/announcements/.test(page.url()) && (await page.locator("#newAnnBtn").isVisible()), "console: the board opens for the platform admin");
  const shownActive = Number(((await page.locator("#activeCount").textContent()) || "").trim());
  const banners = await page.locator("#activeList [data-ann]").count();
  log(shownActive === activeDb && banners === activeDb, "board: active banners match the database", `count ${shownActive}, banners ${banners}, db ${activeDb}`);
  log(activeDb > 0 || (await page.locator("#activeEmpty").isVisible()), "board: an empty board says so");
  log((await page.locator("#activeList [data-retire]").count()) === activeDb, "board: every active banner has its retire control", String(activeDb));
  const archVisible = await page.locator("#archiveCard").isVisible();
  const archRows = await page.locator("#archiveList > li").count();
  log(pastDb === 0 ? !archVisible : archVisible && archRows === pastDb, "board: the archive matches the database", `rows ${archRows}, db ${pastDb}`);

  // ---- the dialog ----
  await page.locator("#newAnnBtn").click();
  await sleep(700);
  const dlg = page.locator("#annMdl");
  log(await dlg.locator("#annTitle").isVisible(), "dialog: New announcement opens it");
  log((await dlg.locator("#annTitle, #annBody, #annPriority, #annExpires, #publishBtn").count()) === 5, "dialog: title, body, priority, expiry and Publish");
  // Refused in the field, before anything is sent: no title, then no body.
  await dlg.locator("#publishBtn").click();
  await sleep(400);
  const err1 = ((await dlg.locator("#annErr").textContent()) || "").trim();
  log(/title/i.test(err1) && (await dlg.locator("#annErr").isVisible()), "dialog: an empty announcement is refused (title)", err1);
  await dlg.locator("#annTitle").fill("QA preview — never published");
  await dlg.locator("#publishBtn").click();
  await sleep(400);
  const err2 = ((await dlg.locator("#annErr").textContent()) || "").trim();
  log(/body/i.test(err2), "dialog: a title alone is refused (body)", err2);
  // The live preview follows the fields.
  await dlg.locator("#annBody").fill("QA preview body line.");
  await sleep(300);
  const preview = ((await dlg.locator("#annPreview").innerText()) || "").replace(/\s+/g, " ");
  log(/QA preview — never published/.test(preview) && /QA preview body line/.test(preview), "dialog: the preview draws the banner as typed");
  const opts = await dlg.locator("#annPriority option").count();
  if (opts > 1) {
    const before = await dlg.locator("#annPreview").innerHTML();
    // The shared blueprint select (components/v3/shared/select-popover): the native
    // <select> is hidden and holds the value; its trigger opens the option list.
    await dlg.locator(".bp-sel .spk-btn").click();
    await sleep(300);
    await page.locator(".spk-pop.is-open .spk-item").last().click();
    await sleep(300);
    log((await dlg.locator("#annPriority").inputValue()) === String(opts - 1), "dialog: the priority picker writes the choice", await dlg.locator("#annPriority").inputValue());
    log((await dlg.locator("#annPreview").innerHTML()) !== before, "dialog: priority changes the preview", `${opts} levels`);
  }
  log((await dlg.locator("#annPreview [data-retire]").count()) === 0, "dialog: the preview has no retire control");
  // Cancel closes, and reopening starts clean.
  await dlg.locator('.mdl-foot [data-mdl="close"], button[data-mdl="close"]').last().click();
  await sleep(700);
  log(!(await dlg.locator("#annTitle").isVisible()), "dialog: Cancel closes it");
  await page.locator("#newAnnBtn").click();
  await sleep(700);
  log(((await dlg.locator("#annTitle").inputValue()) || "") === "" && !(await dlg.locator("#annErr").isVisible()), "dialog: reopened clean");
  await page.keyboard.press("Escape");
  await sleep(600);
  if (await dlg.locator("#annTitle").isVisible()) { await dlg.locator(".mdl-x").click(); await sleep(600); }
  log(!(await dlg.locator("#annTitle").isVisible()), "dialog: closes again (Escape or ×)");

  log(writes.length === 0, "nothing was sent to the server", writes.join(" · "));
  log((await prisma.announcement.count()) === rowsBefore, "no announcement row was written", String(rowsBefore));
  log(errors.length === 0, "no console errors", errors.join(" / "));
  await page.screenshot({ path: "announcements_final.png" });
  await browser.close();
  await prisma.$disconnect();
  console.log(`\n${fails ? fails + " failed" : "all passed"}`);
  if (fails) process.exit(1);
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
