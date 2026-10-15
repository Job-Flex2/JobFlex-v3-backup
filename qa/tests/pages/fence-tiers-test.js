// Good / Better / Best on the Fence studio: exactly ONE tier is ever picked.
//   node fence-tiers-test.js [--mobile]        (dev server on localhost:3000; from scripts/qa)
// The bug (2026-09-21): the picked state was worked out from "type and stain match", which two
// tiers can satisfy at once — Better beside Best with stain on, and every tier that shares the
// base type (composite, black chain-link, steel, 3-rail).
// No address is searched (a typed run is enough for a price), so no property lookup is spent.
// Convert makes a real proposal in QA Co; it is found by its title and removed at the end.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { PrismaClient } = require("@prisma/client");
const { launch, signIn, qaOrg } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
const MOBILE = process.argv.includes("--mobile");
const URL = QA_BASE + "/dashboard/fence-estimator";
const money = (s) => Number(String(s || "").replace(/[^0-9.]/g, ""));

(async () => {
  const prisma = new PrismaClient();
  const org = await qaOrg(prisma);
  const browser = await launch();
  const ctx = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  const tag = MOBILE ? "[390] " : "";
  const startedAt = new Date();

  try {
    await signIn(page);
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.locator('button:has-text("Essential only")').click({ timeout: 1500 }).catch(() => {});
    await page.evaluate(() => { try { sessionStorage.removeItem("jf.fence.tier"); } catch {} });
    await page.reload({ waitUntil: "networkidle" });

    const addRun = async (ft) => {
      await page.locator('[data-act="add-run"]').click();
      await page.waitForTimeout(300);
      const input = page.locator("#runsList [data-run-ft]").last();
      await input.fill(String(ft));
      await input.press("Tab");
      await page.waitForTimeout(500);
    };
    const tiers = () => page.evaluate(() => Array.from(document.querySelectorAll("#tkTiers .tier")).map((b) => ({ id: b.dataset.tier, on: b.classList.contains("on"), pressed: b.getAttribute("aria-pressed"), price: b.querySelector(".tier-v")?.textContent.trim() })));
    // the summary counts up to its number: read it once it has stopped moving
    const total = async () => {
      let last = -1;
      for (let i = 0; i < 12; i++) {
        const now = money(await page.locator("#tkTotal").textContent());
        if (now === last) return now;
        last = now;
        await page.waitForTimeout(220);
      }
      return last;
    };
    const pick = async (id) => { await page.locator(`#tkTiers [data-tier="${id}"]`).click(); await page.waitForTimeout(450); };
    const onlyOne = (list, id) => list.filter((t) => t.on).map((t) => t.id).join() === id && list.every((t) => t.pressed === String(t.id === id));

    await addRun(120);
    let list = await tiers();
    log(list.length === 3, tag + "three tiers render once there is a length", list.map((t) => t.id).join("/"));
    log(onlyOne(list, "better"), tag + "a fresh studio starts on Better, alone", JSON.stringify(list.filter((t) => t.on).map((t) => t.id)));

    // every type family that used to double up: wood (stain is the Best), and the ones whose Best or Good IS the base type
    const types = await page.evaluate(() => Array.from(document.querySelectorAll("#matList [data-mat]")).map((li) => li.dataset.mat));
    const wanted = ["cedar-privacy", "composite-privacy", "chain-link-black", "steel-ornamental", "ranch-rail-3", "pt-pine-privacy"].filter((t) => types.includes(t));
    for (const type of wanted.length ? wanted : types.slice(0, 3)) {
      await page.locator(`#matList [data-mat="${type}"]`).click();
      await page.waitForTimeout(400);
      for (const id of ["good", "better", "best", "better", "good"]) {
        await pick(id);
        list = await tiers();
        const lit = list.filter((t) => t.on).map((t) => t.id);
        const card = money(list.find((t) => t.id === id)?.price);
        const sum = await total();
        log(onlyOne(list, id), `${tag}${type}: click ${id} → only ${id} is picked`, "picked: " + lit.join("+"));
        log(card > 0 && card === sum, `${tag}${type}: ${id} — the summary shows that tier's price`, `card ${card} / summary ${sum}`);
      }
    }
    // the stain switch on a wood fence moves Better ⇄ Best, never both
    if (types.includes("cedar-privacy")) {
      await page.locator('#matList [data-mat="cedar-privacy"]').click();
      await page.waitForTimeout(300);
      await pick("better");
      const stain = page.locator("#stainTgl");
      if (await stain.isVisible().catch(() => false)) {
        await stain.click(); await page.waitForTimeout(400);
        list = await tiers();
        log(onlyOne(list, "best"), tag + "stain switched on by hand → Best, alone", list.filter((t) => t.on).map((t) => t.id).join("+"));
        await stain.click(); await page.waitForTimeout(400);
        list = await tiers();
        log(onlyOne(list, "better"), tag + "stain switched off → Better, alone", list.filter((t) => t.on).map((t) => t.id).join("+"));
      }
    }

    // reload: the pick (and the type it stands on) comes back
    await pick("best");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await addRun(120);
    list = await tiers();
    log(onlyOne(list, "best"), tag + "after a reload: Best is still the pick, alone", list.filter((t) => t.on).map((t) => t.id).join("+"));
    // (the height and the runs are not kept across a reload — only the pick is — so the number to
    // compare with is the restored tier's own card, not the total from before)
    const bestCard = money(list.find((x) => x.id === "best")?.price);
    const afterTotal = await total();
    log(bestCard > 0 && bestCard === afterTotal, tag + "after a reload: the summary is priced at the restored tier", `card ${bestCard} / summary ${afterTotal}`);

    // Convert: the proposal is priced at the picked tier
    await pick("good");
    const goodTotal = await total();
    await page.locator("#convertBtn").click();
    const navigated = await page.waitForURL(/\/dashboard\/(proposals\/|manual-blueprint\?proposal=)/, { timeout: 40000 }).then(() => true).catch(() => false);
    log(navigated, tag + "convert: a proposal opens", page.url().replace(QA_BASE, ""));
    const made = await prisma.proposal.findFirst({ where: { organizationId: org.id, createdAt: { gte: startedAt } }, orderBy: { createdAt: "desc" } });
    log(!!made && Math.round(made.subtotal) === Math.round(goodTotal), tag + "convert: the proposal's subtotal is the picked tier's price", `proposal ${made ? Math.round(made.subtotal) : "none"} / Good ${goodTotal}`);
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await addRun(120);
    list = await tiers();
    log(onlyOne(list, "good"), tag + "back from the proposal: Good is still the pick, alone", list.filter((t) => t.on).map((t) => t.id).join("+"));

    console.log("CONSOLE ERRORS: " + (errors.length ? errors.join(" | ") : "none"));
  } finally {
    // only what this run made, only in QA Co
    const mine = await prisma.proposal.findMany({ where: { organizationId: org.id, createdAt: { gte: startedAt }, title: { contains: " fence · " } }, select: { id: true } });
    for (const p of mine) await prisma.proposal.delete({ where: { id: p.id } }).catch(() => {});
    await prisma.$disconnect();
    await browser.close();
  }
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
