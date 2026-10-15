// Functional pass over the Roof estimator (/dashboard/roof-estimator) — rewritten 2026-10-01
// for the data-only page (Instant numbers, the satellite view, Build an estimate, convert).
//
// NOTHING IS BOUGHT. The page is driven from a SAVED measurement: seed-roof.js up puts one in
// QA Co (fixtures/roof-measurement.json) and "Recent measurements" reopens it without a lookup.
// Every control that orders — "Measure this roof", "Re-measure — new paid lookup", ordering a
// report — is in ./_world FORBIDDEN_CONTROLS: a press is swallowed in the page and the run
// fails. So this runs safely beside the live EagleView keys in .env.local; no stub stand needed.
// Convert makes a real proposal in QA Co; it is removed at the end, pass or fail.
//   node seed-roof.js up && node roof-test.js && node seed-roof.js down   (run-all does this)
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { PrismaClient } = require("@prisma/client");
const { launch, signIn, qaOrg, forbidControls } = require("../_lib/_qa");
const fixture = require("../_lib/fixtures/roof-measurement.json");

let fails = 0;
const log = (ok, name, extra = "") => {
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (s) => Number(String(s || "").replace(/[^0-9.]/g, ""));

(async () => {
  const prisma = new PrismaClient();
  const org = await qaOrg(prisma);
  const saved = await prisma.roofMeasurement.findFirst({ where: { organizationId: org.id, address: fixture.address } });
  if (!saved) {
    console.log("FAIL | the saved measurement is not seeded — node qa/tests/pages/seed-roof.js up");
    process.exit(1);
  }
  const startedAt = new Date();
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await forbidControls(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  const hero = async (label) => ((await page.locator("#rfHero .hero-cell", { hasText: label }).locator(".hero-v").textContent().catch(() => "")) || "").trim();
  const estTotal = async () => {
    let last = -1;
    for (let i = 0; i < 12; i++) {
      const now = money(await page.locator(".rbd-sum-v").first().textContent().catch(() => ""));
      if (now === last) return now;
      last = now;
      await sleep(250);
    }
    return last;
  };

  try {
    await signIn(page);
    await page.goto(QA_BASE + "/dashboard/roof-estimator", { waitUntil: "domcontentloaded" });
    await sleep(4500);

    // ---- intake ----
    log(await page.locator("#instantBtn").isVisible(), "intake: the address form and Measure this roof (a purchase — never pressed)");
    const recentRow = page.locator("#rfRecent .rf-recent-row", { hasText: fixture.address });
    log((await recentRow.count()) === 1, "recent: the saved measurement is listed", ((await recentRow.first().innerText().catch(() => "")) || "").replace(/\s+/g, " "));

    // ---- reopen it, free ----
    await recentRow.first().click();
    await page.waitForSelector("#rfHero", { timeout: 30000 }).catch(() => {});
    await sleep(2500);
    const area = money(await hero("Total area"));
    const squares = Number(await hero("Roofing squares"));
    log(Math.round(area) === Math.round(fixture.areaSqft) && Math.abs(squares - fixture.squares) < 0.06, "figures: area and squares are the saved ones", `${area} sq ft · ${squares} sq`);
    log((await hero("Predominant pitch")) === fixture.predominantPitch && Number(await hero("Roof facets")) === fixture.facetCount, "figures: pitch and facet count", `${await hero("Predominant pitch")} · ${await hero("Roof facets")}`);
    log(/ft$/.test(await hero("Eaves + rakes")) && /ft$/.test(await hero("Valleys")), "figures: linear footage by edge");
    const remeasure = ((await page.locator("#remeasureBtn").textContent().catch(() => "")) || "").trim();
    log(/paid/i.test(remeasure), "re-measure says it is a paid lookup (and is a forbidden control here)", remeasure);

    // ---- the view switch ----
    const views = page.locator("#viewSwitch [role=radio]");
    log((await views.count()) === 2, "view: Satellite and Aerial ortho");
    await views.nth(1).click();
    await sleep(800);
    log((await views.nth(1).getAttribute("aria-checked")) === "true" && (await views.nth(0).getAttribute("aria-checked")) === "false", "view: the ortho is picked");
    await views.nth(0).click();
    await sleep(500);

    // ---- build an estimate ----
    const t0 = await estTotal();
    const mat = money(await page.locator(".rbd-sum-r", { hasText: "Materials" }).locator("dd").textContent());
    const lab = money(await page.locator(".rbd-sum-r", { hasText: "Labor" }).locator("dd").textContent());
    log(t0 > 0 && Math.abs(mat + lab - t0) <= 1, "estimate: a total that is materials + labor", `$${mat} + $${lab} = $${t0}`);
    const metal = page.locator("[data-build-card] button", { hasText: /^Metal$/i }).first();
    if (await metal.count()) {
      await metal.click();
      await sleep(900);
      const t1 = await estTotal();
      log(t1 > 0 && t1 !== t0, "estimate: another roof type reprices", `$${t0} → $${t1}`);
      await page.locator("[data-build-card] button", { hasText: /^Asphalt shingle$/i }).first().click();
      await sleep(900);
      log((await estTotal()) === t0, "estimate: back to asphalt, back to its price", `$${await estTotal()}`);
    } else log(false, "estimate: roof types missing");
    const reviewBtn = page.locator("button", { hasText: /^Review \d+ lines/i }).first();
    const nLines = Number((((await reviewBtn.textContent()) || "").match(/\d+/) || [0])[0]);
    await reviewBtn.click();
    await sleep(1500);
    const rows = await page.locator(".bo-table tbody tr").count();
    log(nLines > 0 && rows >= nLines, "estimate: Review fills the line tables", `${nLines} lines · ${rows} rows`);

    // ---- convert ----
    const priced = await estTotal();
    await page.locator("button", { hasText: /^Convert to proposal$/i }).last().click();
    const navigated = await page.waitForURL(/\/dashboard\/(proposals\/|manual-blueprint\?proposal=)/, { timeout: 40000 }).then(() => true).catch(() => false);
    log(navigated, "convert: a proposal opens", page.url().replace(QA_BASE, ""));
    const made = await prisma.proposal.findFirst({ where: { organizationId: org.id, createdAt: { gte: startedAt } }, orderBy: { createdAt: "desc" }, include: { lineItems: { select: { id: true } } } });
    log(!!made && made.lineItems.length > 0, "convert: the proposal is in QA Co with its lines", made ? `${made.lineItems.length} lines · subtotal ${Math.round(made.subtotal)} · summary ${priced}` : "none");
    log(!!made && Math.abs(Math.round(made.subtotal) - Math.round(priced)) <= 1, "convert: it carries the summary's price", made ? `${Math.round(made.subtotal)} / ${priced}` : "");

    // ---- measure another: back to the intake ----
    await page.goto(QA_BASE + "/dashboard/roof-estimator", { waitUntil: "domcontentloaded" });
    await sleep(4000);
    await page.locator("#rfRecent .rf-recent-row", { hasText: fixture.address }).first().click();
    await page.waitForSelector("#againBtn", { timeout: 30000 }).catch(() => {});
    await page.locator("#againBtn").click();
    await sleep(1200);
    log(await page.locator("#instantBtn").isVisible(), "Measure another: back to the address form");

    log(errors.length === 0, "no console errors", errors.join(" / "));
    await page.screenshot({ path: "roof_final.png" });
  } finally {
    const mine = await prisma.proposal.findMany({ where: { organizationId: org.id, createdAt: { gte: startedAt } }, select: { id: true } });
    for (const p of mine) await prisma.proposal.delete({ where: { id: p.id } }).catch(() => {});
    log(true, "cleanup: this run's proposals removed", String(mine.length));
    await prisma.$disconnect();
    await browser.close();
  }
  console.log(`\n${fails ? fails + " failed" : "all passed"}`);
  if (fails) process.exit(1);
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
