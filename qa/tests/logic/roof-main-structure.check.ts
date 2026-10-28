// THE BUILDING A ROOF MEASUREMENT IS ABOUT, CHOSEN BY THE PERSON (2026-10-26, ticket 8KETUL: an apartment complex
// came back as 25 buildings, EagleView's point stood on the garage, and nothing on the page could change it).
//
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-main-structure.check.ts
//
// Real server actions as a throwaway company's owner on the local dev database (../_lib/_actionHarness: network
// OFF, every key blank — nothing here can reach EagleView or Google):
//   · setMainStructure — "Make main": the figures follow the chosen building, the old main joins the list
//     unticked, other ticks stay, the same keys a new measurement writes; refusals for a foreign row, a bad index,
//     a one-building estimate;
//   · saveIncludedStructures — the ticks kept on the row, the main one and junk dropped;
//   · an EagleView "Invalid address" answer: a plain click and a paid re-measure both say "Address not found" and
//     order nothing; the planner places no detail packs after an area answer with no roof;
//   · an order still pending after 10 minutes: closed as failed and taken off the spend count; a fresh one stays.
import { actAs, check, outcome, summary } from "../_lib/_actionHarness";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../../../src/lib/db";
import { measureRoofInstant, saveIncludedStructures, setMainStructure } from "../../../src/actions/roofMeasurement";
import { expireStaleInstantOrders, EXPIRED_ORDER_ERROR } from "../../../src/lib/instantOrderExpiry";
import { orderPacksFor, PENDING_EXPIRE_MS, type OrderDeps } from "../../../src/lib/eagleviewOrder";
import { instantAddressNotFound, instantAddressKey, PD_PACK, type InstantRoofData, type InstantStructure } from "../../../src/lib/eagleview";
import { instantTotalsOf } from "../../../src/lib/roofDiagram/instantTotals";
import { utcDay } from "../../../src/lib/apiSpend";
import { unitCents } from "../../../src/lib/paidApiCosts";

const tag = `qa-main-${Date.now()}`;
const rid = () => randomBytes(6).toString("hex");
const made: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

async function company(letter: string) {
  const org = await db.organization.create({ data: { name: `${tag} ${letter}`, slug: `${tag}-${letter.toLowerCase()}`, isInternal: true } });
  const owner = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}@qa.test`, name: `Owner ${letter}`, activeOrgId: org.id } });
  await db.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  await db.subscription.create({ data: { organizationId: org.id, plan: "PRO", status: "ACTIVE", provider: "STRIPE", currentPeriodEnd: new Date(Date.now() + 20 * 864e5) } });
  made.orgs.push(org.id);
  made.users.push(owner.id);
  return { org, owner };
}

const lot = JSON.parse(readFileSync(path.join(__dirname, "../_lib/fixtures/roof-complex-25.json"), "utf8")) as { lat: number; lng: number; structures: InstantStructure[] };
const instant: InstantRoofData = { requestId: `qa-${rid()}`, address: "1 Fixture Way, Testville, KS 67000", lat: lot.lat, lng: lot.lng, structures: lot.structures, imagery: [], totals: instantTotalsOf(lot.structures) };
const prov = (main: number, how: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ calibration: null, provenance: { mainStructure: { index: main, how, others: 24, othersSqft: 0 }, parcelSource: "none", instantPacks: { have: [PD_PACK.ROOF_AREA, PD_PACK.OUTLINES], denied: [], failed: [], missing: [] }, ...extra } });

async function main() {
  const A = await company("A");
  const B = await company("B");
  const row = await db.roofMeasurement.create({
    data: {
      organizationId: A.org.id, source: "instant+recon", address: "1 Fixture Way", city: "Testville", state: "KS", zip: "67000",
      lat: lot.lat, lng: lot.lng, areaSqft: lot.structures[13].areaSqft, squares: lot.structures[13].squares, predominantPitch: "4/12",
      instantRequestId: instant.requestId, instantJson: JSON.stringify(instant), modelJson: "{}", chimneyJson: "[]",
      provenanceJson: prov(13, "at-pin", { included: [22, 4] }),
    },
  });
  const old = await db.roofMeasurement.create({
    data: { organizationId: A.org.id, source: "instant+recon", address: "1 Fixture Way", lat: lot.lat, lng: lot.lng, areaSqft: 1, squares: 0.01, instantJson: JSON.stringify(instant), modelJson: "{}", chimneyJson: "[]", provenanceJson: JSON.stringify({ calibration: null, provenance: {} }) },
  });
  const solar = await db.roofMeasurement.create({
    data: { organizationId: A.org.id, source: "solar", address: "1 Fixture Way", lat: lot.lat, lng: lot.lng, areaSqft: 2000, squares: 20, instantJson: JSON.stringify({ ...instant, structures: [lot.structures[0]] }), modelJson: "{}", chimneyJson: "[]", provenanceJson: "{}" },
  });

  // ── Make main ──
  actAs({ id: A.owner.id, activeOrgId: A.org.id });
  const made0 = await outcome(() => setMainStructure(row.id, 0));
  const m = (made0.value as { ok: true; measurement: { areaSqft: number | null; provenance: Record<string, unknown> } } | undefined)?.measurement;
  check("Make main: accepted", !made0.refused, made0.text);
  const ms = m?.provenance.mainStructure as { index: number; how: string } | undefined;
  check("…the chosen building is main, said as chosen", ms?.index === 0 && ms.how === "chosen", ms);
  check("…the row's figures are the chosen building's", m?.areaSqft === lot.structures[0].areaSqft, m?.areaSqft);
  check("…the old main joins the list unticked; the other ticks stay", JSON.stringify(m?.provenance.included) === "[22,4]", m?.provenance.included);
  check("…the same keys a new measurement writes (userPin, included, mainStructure, instantPacks)", !!m && "userPin" in m.provenance && "included" in m.provenance && "instantPacks" in m.provenance);
  const reread = await db.roofMeasurement.findUnique({ where: { id: row.id } });
  check("…kept: read back from the database", reread?.areaSqft === lot.structures[0].areaSqft && /"how":"chosen"/.test(reread?.provenanceJson ?? ""));
  const to22 = await outcome(() => setMainStructure(row.id, 22));
  const p22 = (to22.value as { measurement?: { provenance: Record<string, unknown> } })?.measurement?.provenance;
  check("Make main on a ticked building: it leaves the ticks (it is main now); the old main is unticked", JSON.stringify(p22?.included) === "[4]" && (p22?.mainStructure as { index: number })?.index === 22, p22?.included);
  const backTo13 = await outcome(() => setMainStructure(row.id, 13));
  const p13 = (backTo13.value as { measurement?: { provenance: Record<string, unknown> } })?.measurement?.provenance;
  check("…and back to the first one", JSON.stringify(p13?.included) === "[4]" && (p13?.mainStructure as { index: number })?.index === 13, p13?.included);
  const again = await outcome(() => setMainStructure(row.id, 13));
  check("…the same building again: nothing changes", !again.refused);
  check("a building that is not in the answer is refused", (await outcome(() => setMainStructure(row.id, 99))).refused);
  check("an older row without the keys: Make main works on it", !(await outcome(() => setMainStructure(old.id, 2))).refused);
  check("a Google estimate (one building) is refused", (await outcome(() => setMainStructure(solar.id, 0))).refused);
  actAs({ id: B.owner.id, activeOrgId: B.org.id });
  check("another company's measurement is refused", (await outcome(() => setMainStructure(row.id, 1))).refused);
  check("…and its ticks too", (await outcome(() => saveIncludedStructures(row.id, [1]))).refused);
  actAs({ id: A.owner.id, activeOrgId: A.org.id });

  // ── the ticks kept on the row ──
  const ticks = await outcome(() => saveIncludedStructures(row.id, [13, 5, 5, 99, -1, 7]));
  check("ticks: kept without the main one, doubles or junk", JSON.stringify((ticks.value as { included?: number[] })?.included) === "[5,7]", ticks.text);
  const tickRow = await db.roofMeasurement.findUnique({ where: { id: row.id } });
  check("…on the row, figures untouched", /"included":\[5,7\]/.test(tickRow?.provenanceJson ?? "") && tickRow?.areaSqft === lot.structures[13].areaSqft);

  // ── "Invalid address" ──
  process.env.EAGLEVIEW_CLIENT_ID = "qa-dummy";
  process.env.EAGLEVIEW_CLIENT_SECRET = "qa-dummy";
  const bad = { address: "438 South Side", city: "Testville", state: "KS", zip: "67000" };
  const refused: InstantRoofData = { requestId: `qa-${rid()}`, address: "", lat: 0, lng: 0, structures: [], imagery: [], totals: instantTotalsOf([]) };
  check("a stored answer from before the flag (no structures, 0,0) reads as not found", instantAddressNotFound(refused) && !instantAddressNotFound(instant));
  await db.instantOrder.create({ data: { organizationId: A.org.id, addressKey: instantAddressKey(bad), address: bad.address, requestId: refused.requestId, status: "complete", instantJson: JSON.stringify(refused), packs: JSON.stringify([PD_PACK.ROOF_AREA]) } });
  const before = await db.instantOrder.count({ where: { organizationId: A.org.id } });
  const plain = (await outcome(() => measureRoofInstant(bad))).value as { ok: boolean; error?: string; addressNotFound?: boolean } | undefined;
  check("Invalid address: a plain click says so and goes back to the address", plain?.ok === false && plain.addressNotFound === true && plain.error === "Address not found — pick it from the suggestions", plain);
  const paid = (await outcome(() => measureRoofInstant(bad, { forceNewOrder: true }))).value as { ok: boolean; addressNotFound?: boolean } | undefined;
  check("…a paid re-measure too — the same words would be refused again", paid?.ok === false && paid.addressNotFound === true, paid);
  check("…and nothing was ordered", (await db.instantOrder.count({ where: { organizationId: A.org.id } })) === before);

  // ── "Make main" = the full measurement again from the stored order (owner, 2026-10-26) ──
  const fix = { address: "1 Fixture Way", city: "Testville", state: "KS", zip: "67000" };
  await db.instantOrder.create({ data: { organizationId: A.org.id, addressKey: instantAddressKey(fix), address: fix.address, requestId: `qa-${rid()}`, status: "complete", instantJson: JSON.stringify(instant), packs: JSON.stringify([PD_PACK.ROOF_AREA, PD_PACK.OUTLINES, PD_PACK.PITCH_EAVE]) } });
  const ordersBefore = await db.instantOrder.count({ where: { organizationId: A.org.id } });
  const rowsBefore = await db.roofMeasurement.count({ where: { organizationId: A.org.id } });
  const re = (await outcome(() => measureRoofInstant(fix, { mainIndex: 3, included: [5, 3, 99] }))).value as { ok: boolean; measurement?: { id: string; areaSqft: number | null; provenance: Record<string, unknown> }; reusedInstant?: { how: string } } | undefined;
  const reMain = re?.measurement?.provenance.mainStructure as { index: number; how: string; pin?: unknown } | undefined;
  check("Make main remeasures: a new measurement from the stored order, nothing ordered", re?.ok === true && re.reusedInstant?.how === "stored" && (await db.instantOrder.count({ where: { organizationId: A.org.id } })) === ordersBefore && (await db.roofMeasurement.count({ where: { organizationId: A.org.id } })) === rowsBefore + 1, re);
  check("…about the chosen building, said as chosen, with a pin on it", reMain?.index === 3 && reMain.how === "chosen" && !!reMain.pin && re?.measurement?.areaSqft === lot.structures[3].areaSqft, reMain);
  check("…the ticks carried over, without the new main one or junk", JSON.stringify(re?.measurement?.provenance.included) === "[5]", re?.measurement?.provenance.included);

  const placed: string[][] = [];
  const deps: OrderDeps = {
    submit: async (_i, packs) => {
      placed.push(packs);
      return { requestId: `qa-${rid()}`, completeAddress: "x" };
    },
    poll: async () => ({ ...refused, notFound: true }),
    ledger: { create: async () => {}, complete: async () => {}, fail: async () => {} },
    entitlements: { read: async () => new Map(), mark: async () => {} },
    isTerminalFailure: () => false,
    sleep: async () => {},
  };
  const planned = await orderPacksFor(bad, deps, { collectBudgetMs: 0 });
  check("the planner: an area answer with no roof places no other pack", placed.length === 1 && placed[0].join() === PD_PACK.ROOF_AREA && planned.instant.notFound === true, placed);

  // ── an order that never arrived ──
  const key = instantAddressKey({ address: "9 Slow Rd", city: "Testville", state: "KS", zip: "67000" });
  const placedAt = new Date(Date.now() - PENDING_EXPIRE_MS - 60_000);
  // The roof is counted once, when its AREA pack is accepted ($2.40, lib/paidApiCosts); an expired area order gives it back.
  const stale = await db.instantOrder.create({ data: { organizationId: A.org.id, addressKey: key, requestId: `qa-${rid()}`, packs: JSON.stringify([PD_PACK.ROOF_AREA, "property_data_id_002", "property_data_id_003", "property_data_id_004", "property_data_id_005", "property_data_id_007"]), createdAt: placedAt } });
  const freshOrder = await db.instantOrder.create({ data: { organizationId: A.org.id, addressKey: key, requestId: `qa-${rid()}`, packs: JSON.stringify([PD_PACK.ROOF_AREA]) } });
  const cents = unitCents("eagleview", "roof");
  await db.apiSpendDaily.create({ data: { organizationId: A.org.id, day: utcDay(placedAt), service: "eagleview", op: "roof", calls: 2, cents: cents + 1500 } });
  const closed = await expireStaleInstantOrders({ organizationId: A.org.id });
  const s1 = await db.instantOrder.findUnique({ where: { id: stale.id } });
  const s2 = await db.instantOrder.findUnique({ where: { id: freshOrder.id } });
  check("pending over 10 minutes: closed as failed, with the reason", closed === 1 && s1?.status === "failed" && (s1.error ?? "").startsWith(EXPIRED_ORDER_ERROR), s1);
  check("…a fresh order stays pending", s2?.status === "pending");
  const spend = await db.apiSpendDaily.findFirst({ where: { organizationId: A.org.id, service: "eagleview", op: "roof" } });
  check("…taken off the spend count of the day it was placed", spend?.calls === 1 && Math.abs((spend?.cents ?? 0) - 1500) < 0.01, spend);
  check("…once: a second sweep closes nothing", (await expireStaleInstantOrders({ organizationId: A.org.id })) === 0);
}

main()
  .catch((err) => check("the check ran", false, err instanceof Error ? err.stack : err))
  .finally(async () => {
    for (const orgId of made.orgs) {
      await db.instantOrder.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await db.apiSpendDaily.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await db.syncState.deleteMany({ where: { OR: [{ key: { contains: orgId } }] } }).catch(() => {});
      await db.organization.delete({ where: { id: orgId } }).catch(() => {});
    }
    await db.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
    const failed = summary();
    await db.$disconnect();
    process.exit(failed ? 1 : 0);
  });
