// Functional pass over the rebuilt Fence Studio (/dashboard/fence-estimator) — rewritten
// 2026-10-01: typed run rows, the materials catalogue, heights and job options, gates and
// doors from the canvas toolbar, 3D, the price-book link, a lot from the parcel CACHE, convert
// to a proposal, and Reset. Good / Better / Best has its own pass (fence-tiers-test.js).
//
// No uncached address is ever searched (that is a paid property lookup, and QA Co has 30 an
// hour): Find uses a lot already in the parcel cache. Convert makes a real proposal in QA Co;
// it is found by this run's start time and removed at the end, pass or fail.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { PrismaClient } = require("@prisma/client");
const { launch, signIn, qaOrg } = require("../_lib/_qa");

let fails = 0;
const log = (ok, name, extra = "") => {
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (s) => Number(String(s || "").replace(/[^0-9.]/g, ""));
const URL = QA_BASE + "/dashboard/fence-estimator";
const CACHED_LOT = "12117 202nd St SE, Snohomish, WA 98296";

(async () => {
  const prisma = new PrismaClient();
  const org = await qaOrg(prisma);
  const startedAt = new Date();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

  // The summary counts up to its number: read it once it has stopped moving.
  const total = async () => {
    let last = -1;
    for (let i = 0; i < 14; i++) {
      const now = money(await page.locator("#tkTotal").textContent());
      if (now === last) return now;
      last = now;
      await sleep(220);
    }
    return last;
  };
  const stat = async (label) => (await page.locator("#statStrip .stat-cell", { hasText: label }).locator(".stat-v").textContent().catch(() => "")).trim();
  const addRun = async (ft) => {
    await page.locator('[data-act="add-run"]').click();
    await sleep(300);
    const input = page.locator("#runsList [data-run-ft]").last();
    await input.fill(String(ft));
    await input.press("Tab");
    await sleep(600);
  };

  try {
    await signIn(page);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await sleep(3500);
    await page.locator('button:has-text("Essential only")').click({ timeout: 1500 }).catch(() => {});
    await page.locator("#resetBtn").click();
    await sleep(600);

    log(await page.locator("#addrInput").isVisible(), "studio: opens on the address step and the canvas");
    log((await page.locator("#runsList [data-run]").count()) === 0 && (await page.locator("#runsEmpty").isVisible()), "runs: an empty studio says so");

    // ---- runs ----
    await addRun(100);
    const t1 = await total();
    log((await stat("Total")) === "100 ft" && (await stat("Runs")) === "1" && t1 > 0, "runs: a 100 ft run is measured and priced", `${await stat("Total")} · $${t1}`);
    await addRun(50);
    const t2 = await total();
    log((await stat("Total")) === "150 ft" && t2 > t1, "runs: a second 50 ft run adds to both", `${await stat("Total")} · $${t1} → $${t2}`);
    await page.locator("#runsList [data-run]").last().locator("[data-del-run]").click();
    await sleep(600);
    const t3 = await total();
    log((await stat("Runs")) === "1" && t3 === t1, "runs: removing it puts the total back", `$${t2} → $${t3}`);

    // ---- materials, heights, options ----
    const mats = await page.evaluate(() => Array.from(document.querySelectorAll("#matList [data-mat]")).map((li) => ({ id: li.dataset.mat, on: li.classList.contains("on") })));
    log(mats.length >= 5 && mats.filter((m) => m.on).length === 1, "materials: the catalogue lists types, one picked", `${mats.length} types`);
    const other = mats.find((m) => !m.on);
    await page.locator(`#matList [data-mat="${other.id}"]`).click();
    await sleep(600);
    const t4 = await total();
    log((await page.locator(`#matList [data-mat="${other.id}"]`).getAttribute("class")).includes("on") && t4 !== t3, `materials: ${other.id} picks and reprices`, `$${t3} → $${t4}`);
    await page.locator('#heights [data-h="8"]').click();
    await sleep(600);
    const t5 = await total();
    log((await page.locator('#heights [data-h="8"]').getAttribute("class")).includes("on") && t5 !== t4, "heights: 8 ft picks and reprices", `$${t4} → $${t5}`);
    for (const [id, name] of [["#demoTgl", "tear-out of the old fence"], ["#clearTgl", "clearing the line"], ["#haulTgl", "hauling the soil"]]) {
      const tgl = page.locator(id);
      if (!(await tgl.isVisible().catch(() => false))) { log(false, `options: ${name} switch missing`); continue; }
      const before = await total();
      await tgl.click(); await sleep(600);
      const on = await total();
      await tgl.click(); await sleep(600);
      const off = await total();
      log(on !== before && off === before, `options: ${name} adds and comes off again`, `$${before} → $${on} → $${off}`);
    }
    const terrain = page.locator("#groundRow [data-terrain]").last();
    if (await terrain.count()) {
      const before = await total();
      await terrain.click(); await sleep(600);
      log((await terrain.getAttribute("class")).includes("on"), "options: ground can be set", `${await terrain.textContent()} · $${before} → $${await total()}`);
      await page.locator('#groundRow [data-terrain="auto"]').click().catch(() => {});
      await sleep(400);
    }

    // ---- gates and doors from the canvas toolbar ----
    const beforeGate = await total();
    await page.locator('[data-menu="gate"]').click();
    await sleep(400);
    const gateItems = await page.locator("#popGate.open [data-add-open]").count();
    log(gateItems > 0, "gates: the Gate menu lists gate types", String(gateItems));
    await page.locator("#popGate.open [data-add-open]").first().click();
    await sleep(600);
    const afterGate = await total();
    log((await page.locator("#openList [data-op]").count()) === 1 && (await stat("Openings")) === "1" && afterGate > beforeGate, "gates: one gate goes on the job and on the price", `$${beforeGate} → $${afterGate}`);
    await page.locator('[data-menu="door"]').click();
    await sleep(400);
    log((await page.locator("#popDoor.open [data-add-open]").count()) > 0, "doors: the Door menu lists door types");
    await page.keyboard.press("Escape");
    await page.locator("h1").first().click().catch(() => {});
    await sleep(300);
    await page.locator("#openList [data-op] [data-del-op]").click();
    await sleep(600);
    log((await page.locator("#openList [data-op]").count()) === 0 && (await total()) === beforeGate, "gates: removing it takes it off the price");

    // ---- 3D before anything is traced: an honest empty state ----
    await page.locator('#modeSwitch [data-mode="3d"]').click();
    await sleep(1200);
    log(/Nothing traced yet/i.test(await page.locator("#stage3d").innerText()) && (await page.locator("#stage3d canvas").count()) === 0, "3D: with typed runs only it says nothing is traced yet");
    await page.locator('#modeSwitch [data-mode="draw"]').click();
    await sleep(600);

    // ---- the price book lives on the Inventory page ----
    log(((await page.locator("#matBook").getAttribute("href")) || "").startsWith("/dashboard/inventory?trade=fence"), "price book: links to the fence price book on Inventory");

    // ---- a lot from the parcel cache ----
    await page.locator("#addrInput").fill(CACHED_LOT);
    await page.locator("#findBtn").click();
    const sides = await page.waitForFunction(() => document.querySelectorAll("#parcelPanel [data-side]").length > 0, null, { timeout: 60000 }).then(() => true).catch(() => false);
    log(sides, "find: the cached lot loads and lists its sides", String(await page.locator("#parcelPanel [data-side]").count()));

    // ---- convert, 1: the typed run, with the lot now loaded ----
    // What the summary shows is what the proposal must carry. (2026-10-01: it does not —
    // once a lot is loaded the convert prices the typed run at the lot's regional rate
    // while the summary keeps the default one.)
    const convert = async () => {
      const t0 = new Date();
      await page.locator("#convertBtn").click();
      const ok = await page.waitForURL(/\/dashboard\/(proposals\/|manual-blueprint\?proposal=)/, { timeout: 40000 }).then(() => true).catch(() => false);
      const row = await prisma.proposal.findFirst({ where: { organizationId: org.id, createdAt: { gte: t0 } }, orderBy: { createdAt: "desc" } });
      return { ok, row };
    };
    const typedPrice = await total();
    const c1 = await convert();
    log(c1.ok, "convert: a proposal opens", page.url().replace(QA_BASE, ""));
    log(!!c1.row && Math.round(c1.row.subtotal) === Math.round(typedPrice), "convert: a typed run on a loaded lot — the proposal carries the price the summary shows", `proposal ${c1.row ? Math.round(c1.row.subtotal) : "none"} / summary ${typedPrice}`);

    // ---- the fence on the lot: runs from its sides, 3D, convert, 2 ----
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    await page.locator("#resetBtn").click();
    await sleep(500);
    await page.locator("#addrInput").fill(CACHED_LOT);
    await page.locator("#findBtn").click();
    await page.waitForFunction(() => document.querySelectorAll("#parcelPanel [data-side]").length > 0, null, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    await page.locator("#fenceBtn").click();
    await sleep(3000);
    const traced = Number(await stat("Runs"));
    log(traced > 0 && (await total()) > 0, "lot: Put down the fence traces runs along the lot lines", `${traced} runs · ${await stat("Total")}`);
    await page.locator('#modeSwitch [data-mode="3d"]').click();
    await sleep(4000);
    log((await page.locator("#stage3d canvas").count()) > 0, "3D: the traced fence mounts on the ground model");
    await page.locator('#modeSwitch [data-mode="draw"]').click();
    await sleep(600);
    const lotPrice = await total();
    const c2 = await convert();
    log(c2.ok && !!c2.row && Math.round(c2.row.subtotal) === Math.round(lotPrice), "convert: the traced fence's proposal carries the summary's price, in QA Co", `proposal ${c2.row ? Math.round(c2.row.subtotal) : "none"} / summary ${lotPrice}`);

    // ---- Reset: this property over ----
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    await addRun(40);
    await page.locator("#resetBtn").click();
    await sleep(700);
    log((await page.locator("#runsList [data-run]").count()) === 0 && (await page.locator('#heights [data-h="6"]').getAttribute("class")).includes("on"), "reset: runs cleared, the spec back to its defaults");

    log(errors.length === 0, "no console errors", errors.join(" / "));
    await page.screenshot({ path: "fence_final.png" });
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
