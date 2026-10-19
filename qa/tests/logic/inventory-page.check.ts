// The Inventory page (2026-09-29; one page per trade under its estimator since
// 2026-10-10): the price book's rows and writes for the three trades, the company's documents the estimators read, who may
// write, and the old URLs answering 308. Since the audit of 2026-09-30 also:
// what leaves the shelf for a job and at what price, the stock search, the
// schedule's numbers under 600 rows, the service menu pricing the estimate.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/inventory-page.check.ts
//
// Runs in **QA Co** (slug `qa-co`): its FenceCatalog / RoofCatalog /
// HvacSettings / HvacCatalogItem rows are snapshotted first and put back at
// the end, pass or fail. The row builders and document updaters are pure
// (lib/priceBook); the writes here go through the same tables the actions
// write (fenceCatalog.saveFenceCatalog, roofCatalog.saveRoofCatalog,
// hvacEstimator.saveHvacCatalogItem / saveHvacRateCard). Section G makes one
// item and one job of its own in QA Co and removes them. The redirects are
// checked against the dev server QA_BASE_URL names, and skipped when it is
// not set (this machine's :3000 may be another project's).

import "../_lib/_server-only";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  bookNumbers, canEditBook, fenceBookRows, fenceDocWith, fenceDocWithout, groupRows, hvacBookRows, hvacCardWith, hvacRateRows, nextCustomFenceId,
  roofBookRows, roofDocWith, roofDocWithout, roofLists, rowKey, rowStanding, shownGroups, slugId, FENCE_TYPE_IDS,
} from "../../../src/lib/priceBook";
import { fenceCatalogSchema } from "../../../src/lib/fence/catalogSchema";
import { roofCatalogSchema } from "../../../src/lib/roofPackage/catalogSchema";
import { effectiveRate, standardRate } from "../../../src/lib/fence/rates";
import { ROOF_SYSTEMS, UNDERLAYMENTS } from "../../../src/lib/roofPackage/catalog";
import { DEFAULT_RATE_CARD, STARTER_CATALOG, normalizeRateCard } from "../../../src/lib/hvac/ledger";
import { parseTab } from "../../../src/lib/inventoryPage";
import { isPathAllowed, ROLE_ROUTE_GATES } from "../../../src/lib/roleRoutes";
import { issueFromShelf, pickList, stockMatches, type StockItem } from "../../../src/lib/inventory";
import { jobCostOf, movementPrice } from "../../../src/lib/jobCost";
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger } from "../../../src/lib/hvac/ledger";
import { modelFromSite } from "../../../src/lib/hvac/intake";

const db = new PrismaClient();
let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);

async function main() {
  const org = await db.organization.findUnique({ where: { slug: "qa-co" }, select: { id: true } });
  if (!org) throw new Error("QA Co (qa-co) is not seeded");
  const orgId = org.id;
  const saved = {
    fence: await db.fenceCatalog.findUnique({ where: { organizationId: orgId } }),
    roof: await db.roofCatalog.findUnique({ where: { organizationId: orgId } }),
    hvac: await db.hvacSettings.findUnique({ where: { organizationId: orgId } }),
    items: await db.hvacCatalogItem.findMany({ where: { organizationId: orgId } }),
  };

  try {
    /* ── A. fence ── */
    head("A · fence: 15 catalog types as rows, a rate override, a type of our own, back to the catalog");
    let rows = fenceBookRows(null);
    ok("A 15 catalog types, none a company default", rows.length === 15 && rows.every((r) => !r.companyDefault && r.unit === "lf" && r.price === standardRate(r.id as never).materialPerLf));
    const ORDER = ["Wood", "Vinyl", "Composite", "Chain link", "Aluminum", "Steel", "Rail", "Your own"];
    ok("A grouped by category in the studio's order", groupRows(rows, ORDER).map((g) => g.label).join(",") === "Wood,Vinyl,Composite,Chain link,Aluminum,Steel,Rail");
    // The group filter (owner, 2026-09-30): the group's rows and its divider only; a row keeps the number it has in the whole book.
    const nums = bookNumbers(rows, ORDER);
    const wood = shownGroups(rows, ORDER, "", "Wood");
    ok("A the Wood filter keeps its 6 rows and its divider only", wood.length === 1 && wood[0].label === "Wood" && wood[0].rows.length === 6, `${wood.length} groups, ${wood[0]?.rows.length} rows`);
    ok("A the filtered rows keep the book's own No. (Wood 1–6, Vinyl 7–8)", wood[0].rows.map((r) => nums.get(rowKey(r))).join(",") === "1,2,3,4,5,6" && shownGroups(rows, ORDER, "", "Vinyl")[0].rows.map((r) => nums.get(rowKey(r))).join(",") === "7,8");
    const cedarWood = shownGroups(rows, ORDER, "cedar", "Wood").flatMap((g) => g.rows);
    ok("A the search and the filter intersect", cedarWood.length > 0 && cedarWood.every((r) => r.group === "Wood" && /cedar/i.test(r.name)) && shownGroups(rows, ORDER, "cedar", "Vinyl").length === 0, `${cedarWood.length} cedar rows in Wood`);
    ok("A an empty group filter is every group", shownGroups(rows, ORDER, "", "").length === 7);
    let doc = fenceDocWith(null, { id: "cedar-privacy", materialPerLf: 25, laborPerLf: standardRate("cedar-privacy").laborPerLf, gateSingle: standardRate("cedar-privacy").gateSingle });
    ok("A an override keeps only the field that differs", JSON.stringify(doc.rates) === JSON.stringify({ "cedar-privacy": { materialPerLf: 25 } }), JSON.stringify(doc.rates));
    ok("A the studio's own reader prices it at 25", effectiveRate("cedar-privacy", doc.rates as never).materialPerLf === 25);
    ok("A the document passes the studio's schema", fenceCatalogSchema.safeParse(doc).success);
    rows = fenceBookRows(doc);
    ok("A the row is now a company default at $25", rows.find((r) => r.id === "cedar-privacy")?.companyDefault === true && rows.find((r) => r.id === "cedar-privacy")?.price === 25);
    const cid = nextCustomFenceId(doc);
    doc = fenceDocWith(doc, { id: cid, label: "QA cedar premium 8'", like: "cedar-privacy", materialPerLf: 40, laborPerLf: 18, gateSingle: 600, color: "#c4914a" });
    ok("A a custom type is custom-1, built like a catalog type", cid === "custom-1" && doc.custom.length === 1 && doc.custom[0].like === "cedar-privacy" && fenceCatalogSchema.safeParse(doc).success);
    rows = fenceBookRows(doc);
    ok("A the custom type is a row under Your own", rows.some((r) => r.id === "custom-1" && r.custom && r.group === "Your own" && r.price === 40));
    await db.fenceCatalog.upsert({ where: { organizationId: orgId }, update: { catalogJson: JSON.stringify(doc) }, create: { organizationId: orgId, catalogJson: JSON.stringify(doc) } });
    const back = fenceCatalogSchema.parse(JSON.parse((await db.fenceCatalog.findUnique({ where: { organizationId: orgId } }))!.catalogJson));
    ok("A written to the organization and read back", back.custom[0].label === "QA cedar premium 8'" && back.rates["cedar-privacy"]?.materialPerLf === 25);
    doc = fenceDocWithout(doc, "custom-1");
    doc = fenceDocWithout(doc, "cedar-privacy");
    ok("A delete + reset leave the catalog book", doc.custom.length === 0 && Object.keys(doc.rates).length === 0 && !fenceBookRows(doc).some((r) => r.companyDefault));
    ok("A the built-in ids are the studio's", FENCE_TYPE_IDS.length === 15 && FENCE_TYPE_IDS.includes("cedar-privacy"));

    /* ── B. roof ── */
    head("B · roof: systems and underlayments, an edit, a system of our own, reset");
    rows = roofBookRows(null);
    ok("B every built-in system and underlayment is a row", rows.length === ROOF_SYSTEMS.length + UNDERLAYMENTS.length && rows.every((r) => r.unit === "sq" && !r.companyDefault));
    let rdoc = roofDocWith(null, { system: { id: "architectural", label: "Architectural shingle · 30-yr", family: "asphalt", matPerSq: 140, laborPerSq: 200, wastePct: 12, capPerFt: 2.1 } });
    ok("B an edited system keeps the whole list and passes the builder's schema", rdoc.systems.length === ROOF_SYSTEMS.length && rdoc.underlayments.length === UNDERLAYMENTS.length && roofCatalogSchema.safeParse(rdoc).success);
    ok("B the row is a company default at $140", roofBookRows(rdoc).find((r) => r.id === "architectural")?.companyDefault === true && roofBookRows(rdoc).find((r) => r.id === "architectural")?.price === 140);
    // One word for the saved row on the desk and on the phone (2026-10-19: the phone list said "Default" for "Company").
    const saved = roofBookRows(rdoc).find((r) => r.id === "architectural")!;
    ok("B a saved row stands as Company; a built-in one as catalog; an HVAC rate as typical", rowStanding(saved).label === "Company" && rowStanding(saved).own && rowStanding(roofBookRows(null)[0]).label === "catalog" && rowStanding({ companyDefault: false, kind: "hvac-rate" }).label === "typical");
    const invSrc = readFileSync("src/components/v3/inventory-blueprint/inventory-content.tsx", "utf8");
    ok("B the desk table and the phone list draw the same standing chip", (invSrc.match(/<Standing row=\{r\} \/>/g) ?? []).length === 2 && !/>Default</.test(invSrc) && !/pstatus--accepted">Company</.test(invSrc));
    const sid = slugId("QA solar tile", roofLists(rdoc).systems.map((s) => s.id));
    rdoc = roofDocWith(rdoc, { system: { id: sid, label: "QA solar tile", family: "tile", matPerSq: 900, laborPerSq: 600, wastePct: 10, capPerFt: 9 } });
    ok("B a system of our own is appended with a fresh id", sid === "qa_solar_tile" && rdoc.systems.some((s) => s.id === sid) && roofBookRows(rdoc).find((r) => r.id === sid)?.custom === true);
    rdoc = roofDocWith(rdoc, { underlayment: { id: "synthetic", label: "Synthetic underlayment", perSq: 35 } });
    ok("B an underlayment price moves", rdoc.underlayments.find((u) => u.id === "synthetic")?.perSq === 35);
    await db.roofCatalog.upsert({ where: { organizationId: orgId }, update: { catalogJson: JSON.stringify(rdoc) }, create: { organizationId: orgId, catalogJson: JSON.stringify(rdoc) } });
    const rback = roofCatalogSchema.parse(JSON.parse((await db.roofCatalog.findUnique({ where: { organizationId: orgId } }))!.catalogJson));
    ok("B written to the organization and read back", rback.systems.find((s) => s.id === "architectural")?.matPerSq === 140 && rback.systems.some((s) => s.id === sid));
    rdoc = roofDocWithout(rdoc, "roof-system", sid);
    rdoc = roofDocWithout(rdoc, "roof-system", "architectural");
    ok("B delete + reset put the built-in figures back", !rdoc.systems.some((s) => s.id === sid) && rdoc.systems.find((s) => s.id === "architectural")?.matPerSq === ROOF_SYSTEMS.find((s) => s.id === "architectural")!.matPerSq);
    const lone = roofDocWithout({ version: 1, systems: [{ id: "only", label: "Only", family: "asphalt", matPerSq: 1, laborPerSq: 1, wastePct: 1, capPerFt: 1 }], underlayments: [UNDERLAYMENTS[0]], prefs: {} }, "roof-system", "only");
    ok("B a list never empties (the schema wants one row)", lone.systems.length === 1 && roofCatalogSchema.safeParse(lone).success);

    /* ── C. hvac ── */
    head("C · hvac: the starter ladder as rows, a shop unit, the rate card");
    rows = hvacBookRows(STARTER_CATALOG, false);
    ok("C every starter unit is a row, none the shop's", rows.length === STARTER_CATALOG.length && rows.every((r) => !r.companyDefault && r.unit === "each"));
    const shop = hvacBookRows([{ id: "qa-hp", kind: "heat-pump", brand: "QA", model: "HP-036", tons: 3, seer2: 16, cost: 3450, source: "shop" }], true);
    ok("C a shop unit with a cost is a company default priced at its cost", shop[0].companyDefault && shop[0].price === 3450 && /3 t · SEER2 16/.test(shop[0].specs));
    const rate = hvacRateRows(DEFAULT_RATE_CARD, DEFAULT_RATE_CARD);
    ok("C the rate card is rows in three sections, none changed", rate.length > 30 && rate.every((r) => !r.companyDefault) && rate.some((r) => r.id === "permitFee" && r.unit === "each") && rate.some((r) => r.id === "labor.linesetPerFt" && r.unit === "ft") && rate.some((r) => r.id === "equipmentMarkupPct" && r.unit === "%"));
    const card = hvacCardWith(DEFAULT_RATE_CARD, "permitFee", 300);
    const card2 = hvacCardWith(card, "labor.setCoil", 400);
    ok("C a top-level and a nested figure move, the rest stays", card2.permitFee === 300 && card2.labor.setCoil === 400 && card2.labor.setFurnace === DEFAULT_RATE_CARD.labor.setFurnace && normalizeRateCard(card2).permitFee === 300);
    ok("C the changed figures read as company defaults", hvacRateRows(card2, DEFAULT_RATE_CARD).filter((r) => r.companyDefault).map((r) => r.id).sort().join(",") === "labor.setCoil,permitFee");
    await db.hvacSettings.upsert({ where: { organizationId: orgId }, update: { rateCardJson: JSON.stringify(card2) }, create: { organizationId: orgId, rateCardJson: JSON.stringify(card2) } });
    ok("C written to the organization and read back", normalizeRateCard(JSON.parse((await db.hvacSettings.findUnique({ where: { organizationId: orgId } }))!.rateCardJson)).labor.setCoil === 400);

    /* ── D. who may write, and the page's own parsing ── */
    head("D · permissions and the URL");
    ok("D OWNER / MANAGER / ESTIMATOR may edit the book", canEditBook("OWNER") && canEditBook("MANAGER") && canEditBook("ESTIMATOR"));
    ok("D INSTALLER and SALES may not (the estimators' own rule)", !canEditBook("INSTALLER") && !canEditBook("SALES"));
    ok("D each trade's inventory, under its estimator, is allowed to the estimator role (2026-10-10)", ["/dashboard/roof-estimator/inventory", "/dashboard/fence-estimator/inventory", "/dashboard/hvac-estimator/inventory"].every((p) => isPathAllowed(ROLE_ROUTE_GATES.ESTIMATOR, p)));
    ok("D the route is allowed to the estimator role, not to sales or installers", isPathAllowed(ROLE_ROUTE_GATES.ESTIMATOR, "/dashboard/inventory") && !isPathAllowed(ROLE_ROUTE_GATES.SALES, "/dashboard/inventory") && !isPathAllowed(ROLE_ROUTE_GATES.INSTALLER, "/dashboard/inventory"));
    ok("D tab: services only for hvac, book by default", parseTab("services", "hvac") === "services" && parseTab("services", "fence") === "book" && parseTab(undefined, "roof") === "book" && parseTab("stock", "roof") === "stock");
    ok("D an unknown tab and a services tab off hvac fall back to the book", parseTab("cards", "hvac") === "book" && parseTab("services", "roof") === "book");

    /* ── F. what leaves the shelf for a job, the stock search ── */
    head("F · stock: the truck takes what the shelf has, never below zero; the search reads name, supplier, SKU");
    const shelf: StockItem[] = [
      { id: "i-sh", name: "Shingles", key: "shingles", unit: "bundle", onHand: 40, reorderPoint: null, supplierId: "s1", supplierName: "ABC Supply", supplierSku: "SH-01" },
      { id: "i-ul", name: "Underlayment", key: "underlayment", unit: "roll", onHand: 2, reorderPoint: null, supplierId: "s1", supplierName: "ABC Supply", supplierSku: "UL-02" },
      { id: "i-rc", name: "Ridge cap", key: "ridge cap", unit: "bundle", onHand: 0, reorderPoint: null, supplierId: null },
      { id: "i-dr", name: "Drip edge", key: "drip edge", unit: "piece", onHand: 3, reorderPoint: null, supplierId: null, stocked: false },
    ];
    const pick = pickList(shelf, [{ name: "Shingles", quantity: 12 }, { name: "Underlayment", quantity: 5 }, { name: "Ridge cap", quantity: 3 }, { name: "Drip edge", quantity: 8 }, { name: "Sealant nobody tracks", quantity: 2 }]);
    const issue = issueFromShelf(pick);
    const takeOf = (id: string) => issue.taken.find((r) => r.itemId === id)?.take ?? 0;
    ok("F a covered line leaves whole (12 shingles)", takeOf("i-sh") === 12);
    ok("F a short stocked line leaves only what is on the shelf (2 of 5 rolls)", takeOf("i-ul") === 2);
    ok("F an empty shelf gives nothing and books nothing (ridge cap)", !issue.taken.some((r) => r.itemId === "i-rc"));
    ok("F a per-job item leaves as far as it arrived (3 of 8)", takeOf("i-dr") === 3);
    ok("F an untracked line never leaves the warehouse", issue.taken.length === 3 && issue.taken.every((r) => r.itemId));
    ok("F no line takes more than is on hand — the count stays at 0 or above", issue.taken.every((r) => r.take <= Math.max(0, shelf.find((i) => i.id === r.itemId)!.onHand)));
    ok("F the short stocked lines are counted (underlayment, ridge cap; not the per-job item)", issue.short === 2, String(issue.short));
    ok("F search by name, supplier and SKU", stockMatches(shelf[0], "shing") && stockMatches(shelf[0], "abc supply") && stockMatches(shelf[1], "ul-02") && !stockMatches(shelf[2], "abc") && stockMatches(shelf[2], "  "));

    /* ── G. a job's stock cost at the issue price (QA Co rows of its own) ── */
    head("G · stock cost: the price stamped at issue holds when the price moves; leftovers come back at it");
    const gItem = await db.inventoryItem.create({ data: { organizationId: orgId, trade: "roof", name: "QA check issue price", key: "qa check issue price", unit: "each", onHand: 20, lastCost: 10 } });
    const gJob = await db.job.create({ data: { organizationId: orgId, title: "QA check stock cost" } });
    try {
      await db.inventoryMovement.create({ data: { itemId: gItem.id, kind: "PICKED", quantity: -5, jobId: gJob.id, unitCost: 10 } });
      ok("G 5 issued at $10 cost the job $50", (await jobCostOf(orgId, gJob.id)).stock === 50);
      await db.inventoryItem.update({ where: { id: gItem.id }, data: { lastCost: 20 } });
      ok("G the item's price moves to $20 — the job still costs $50", (await jobCostOf(orgId, gJob.id)).stock === 50);
      await db.inventoryMovement.create({ data: { itemId: gItem.id, kind: "RETURNED", quantity: 2, jobId: gJob.id, unitCost: 10 } });
      const gc = await jobCostOf(orgId, gJob.id);
      ok("G 2 back at the issue price: $30, taken 5, returned 2", gc.stock === 30 && gc.stockLines[0]?.taken === 5 && gc.stockLines[0]?.returned === 2, JSON.stringify(gc.stockLines));
      ok("G an older movement without a price reads the item's last cost; a bare one reads 0 and says so", movementPrice(null, 20).price === 20 && !movementPrice(null, null).priced);
    } finally {
      await db.inventoryItem.delete({ where: { id: gItem.id } });
      await db.job.delete({ where: { id: gJob.id } });
    }

    /* ── H. search and filter over a big book ── */
    head("H · 600 rows: the filter and the search stay instant, the numbers stay put");
    const base15 = fenceBookRows(null);
    const big = Array.from({ length: 600 }, (_, i) => ({ ...base15[i % 15], id: `r${i}`, name: `Row ${String(i).padStart(3, "0")} ${i % 3 ? "cedar" : "vinyl"}` }));
    const t0 = performance.now();
    const bigNums = bookNumbers(big, ORDER);
    const hit = shownGroups(big, ORDER, "cedar", "Wood").flatMap((g) => g.rows);
    const took = performance.now() - t0;
    ok("H numbering, search and a filter over 600 rows in under 50 ms", took < 50, `${took.toFixed(1)} ms`);
    ok("H a filtered row keeps the number it has in the whole book", hit.length > 0 && hit.every((r, i) => (bigNums.get(rowKey(r)) ?? 0) > 0 && (i === 0 || bigNums.get(rowKey(r))! > bigNums.get(rowKey(hit[i - 1]))!)), `${hit.length} rows`);
    const bigStock = Array.from({ length: 600 }, (_, i) => ({ name: `Item ${i}`, supplierName: i % 2 ? "ABC Supply" : null, supplierSku: `SKU-${i}` }));
    const t1 = performance.now();
    const found = bigStock.filter((r) => stockMatches(r, "sku-42"));
    const took1 = performance.now() - t1;
    ok("H the stock search over 600 rows in under 20 ms", took1 < 20 && found.length === 11, `${found.length} hits, ${took1.toFixed(1)} ms`);

    /* ── I. the service menu prices the estimate ── */
    head("I · service menu → the HVAC estimate");
    const m = modelFromSite({ address: "4518 Bluestem Hollow Dr, Frisco, TX 75034", state: "TX", county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
    m.existing = { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-410A", yearMade: 2008 };
    const svcCard = normalizeRateCard({ ...DEFAULT_RATE_CARD, serviceOverrides: { capacitor: { laborUsd: 199 } } });
    const svcIn = { service: { tasks: ["capacitor"] } };
    const svc = buildLedger(runEngine(m, { catalog: STARTER_CATALOG, job: "service", input: svcIn }), m, svcCard, STARTER_CATALOG, { job: "service", input: svcIn });
    const cap = svc.labor.find((l) => l.id === "l-svc-capacitor");
    ok("I a price typed on the menu is the estimate's line, marked as the shop's", cap?.unitPrice === 199 && /your menu price/.test(cap?.note ?? ""), JSON.stringify(cap));

    /* ── E. the old URLs answer 308 (when a dev server is up) ── */
    head("E · the old URLs");
    // Only against a server named explicitly: :3000 on this machine may be
    // another project's, which answers 404, not 308.
    const base = process.env.QA_BASE_URL || "";
    const moved: Array<[string, string]> = [
      // Each trade's own inventory under its estimator since 2026-10-10.
      ["/dashboard/roof-estimator/board", "/dashboard/roof-estimator/inventory?tab=stock"],
      ["/dashboard/fence-estimator/board", "/dashboard/fence-estimator/inventory?tab=stock"],
      ["/dashboard/hvac-estimator/board", "/dashboard/hvac-estimator/inventory?tab=stock"],
      ["/dashboard/hvac-estimator/services", "/dashboard/hvac-estimator/inventory?tab=services"],
      ["/mobile-hvac-inventory-v1", "/dashboard/hvac-estimator/inventory?tab=stock"],
    ];
    let up = Boolean(base);
    if (up) { try { await fetch(base + "/auth/login", { redirect: "manual" }); } catch { up = false; } }
    if (!up) console.log(`skip  ${base ? `no dev server on ${base}` : "QA_BASE_URL not set"} — the 308s are not checked here`);
    else {
      for (const [from, to] of moved) {
        const r = await fetch(base + from, { redirect: "manual" });
        ok(`E 308 ${from}`, r.status === 308 && (r.headers.get("location") ?? "").endsWith(to), `${r.status} → ${r.headers.get("location")}`);
      }
      const r = await fetch(base + "/dashboard/fence-estimator/board?group=ORDER&trade=roof", { redirect: "manual" });
      const loc = r.headers.get("location") ?? "";
      ok("E the old link's own query rides along; the trade is the new page's path and the tab its own", /group=ORDER/.test(loc) && /\/dashboard\/fence-estimator\/inventory\?/.test(loc) && !/trade=/.test(loc) && /tab=stock/.test(loc), loc);
    }
  } finally {
    await db.fenceCatalog.deleteMany({ where: { organizationId: orgId } });
    if (saved.fence) await db.fenceCatalog.create({ data: { organizationId: orgId, catalogJson: saved.fence.catalogJson } });
    await db.roofCatalog.deleteMany({ where: { organizationId: orgId } });
    if (saved.roof) await db.roofCatalog.create({ data: { organizationId: orgId, catalogJson: saved.roof.catalogJson } });
    await db.hvacSettings.deleteMany({ where: { organizationId: orgId } });
    if (saved.hvac) await db.hvacSettings.create({ data: { organizationId: orgId, rateCardJson: saved.hvac.rateCardJson } });
    await db.hvacCatalogItem.deleteMany({ where: { organizationId: orgId } });
    for (const it of saved.items) await db.hvacCatalogItem.create({ data: { organizationId: orgId, itemId: it.itemId, kind: it.kind, brand: it.brand, model: it.model, itemJson: it.itemJson } });
    await db.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
