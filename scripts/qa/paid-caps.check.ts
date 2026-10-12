// Ceilings on paid outside services, and the plan they need (money audit
// 2026-10-12: P0-7, P0-8, P1-8).
//
//   npx tsx --tsconfig tsconfig.json scripts/qa/paid-caps.check.ts
//
// Real server actions and routes as a throwaway company's owner on the local
// dev database (./_actionHarness: network OFF, every key blank). Nothing here
// can reach EagleView, Cool Calc, Twilio, ReportAll or OpenAI — where a check
// needs a service to look "configured", a dummy key is set and the network
// refusal stands in for the provider's answer.
//
// Each ceiling is shown to hold at N and to refuse at N+1, per company, with a
// refusal a person can read, RETURNED (not thrown):
//   · a new roof measurement (EagleView): 30 a day; "measure again": 5 a day;
//     reopening a roof already measured is never counted;
//   · a Cool Calc report: 20 an hour and 30 a day;
//   · a verification text: +1 US / Canada only, and only with an open plan;
//   · a parcel tile: only with an open plan;
//   · after the plan ends: nameplate, photo and receipt reading, and texts
//     from the company's own number, are closed;
//   · the plan matrix: every way a company holds a plan (card-less trial,
//     trial, each paid plan, past due, grant, comp, platform admin, booked
//     cancellation) passes; an ended one is refused.
import { actAs, check, outcome, summary } from "./_actionHarness";
import { randomBytes } from "node:crypto";
import { db } from "../../src/lib/db";
import { PAID_CAPS, takePaidCap, takeRoofOrderCap, takeHvacReportCap } from "../../src/lib/paidCaps";
import { isUsCanadaNumber } from "../../src/lib/phone";
import { measureRoofInstant } from "../../src/actions/roofMeasurement";
import { requestHvacPermitReport, readHvacNameplate } from "../../src/actions/hvacEstimator";
import { startPhoneVerification } from "../../src/actions/sms";
import { analyzeJobPhoto } from "../../src/actions/photoAnalysis";
import { scanReceipt } from "../../src/actions/receiptOcr";
import { sendText } from "../../src/lib/sms/send";
import * as tiles from "../../src/app/api/parcel-tiles/[z]/[x]/[y]/route";

const tag = `qa-paid-${Date.now()}`;
const rid = () => randomBytes(6).toString("hex");
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const made: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

async function company(letter: string, sub?: "ACTIVE" | "CANCELED") {
  const org = await db.organization.create({ data: { name: `${tag} ${letter}`, slug: `${tag}-${letter.toLowerCase()}`, isInternal: true } });
  const owner = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}@qa.test`, name: `Owner ${letter}`, activeOrgId: org.id } });
  await db.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  made.orgs.push(org.id);
  made.users.push(owner.id);
  if (sub) await setPlan(org.id, sub);
  return { org, owner };
}
async function setPlan(organizationId: string, status: "ACTIVE" | "CANCELED") {
  const ends = new Date(Date.now() + (status === "ACTIVE" ? 20 : -20) * 864e5);
  await db.subscription.upsert({
    where: { organizationId },
    create: { organizationId, plan: "PRO", status, provider: "STRIPE", currentPeriodEnd: ends },
    update: { status, currentPeriodEnd: ends },
  });
}
type Co = Awaited<ReturnType<typeof company>>;
const as = (c: Co) => actAs({ id: c.owner.id, activeOrgId: c.org.id });

/** Call `take` n times, then once more: the n pass, the (n+1)th is refused with words. */
async function holdsAtN(name: string, n: number, take: () => Promise<{ ok: boolean; error?: string }>) {
  let passed = 0;
  for (let i = 0; i < n; i++) if ((await take()).ok) passed++;
  const over = await take();
  check(`${name}: ${n} pass`, passed === n, `${passed} of ${n} passed`);
  check(`${name}: call ${n + 1} is refused with a reason`, !over.ok && typeof over.error === "string" && over.error.length > 20, over);
}

// ── THE PLAN MATRIX (2026-10-12): every way a company holds — or held — a plan ──
// "Действующий план" must mean what it means everywhere else in the app
// (lib/planStatus over lib/subscriptionAccess, grants read, a platform admin
// in their own company exempt as in lib/limitsEngine): cases 1–8 pass the
// phone code and the parcel tiles, case 9 is refused. The roof and Cool Calc
// ceilings answer within their limits in 1–8, and the card-less trial's own
// ceilings (lib/trialMeter takeTrialCap) stand as they were.
type Setup = (orgId: string, userId: string) => Promise<void>;
const day = 864e5;
const stripeRow = (organizationId: string, status: string, plan: string, extra: Record<string, unknown> = {}) =>
  db.subscription.create({ data: { organizationId, plan, status, provider: "STRIPE", currentPeriodEnd: new Date(Date.now() + 20 * day), ...extra } as never });
const cardless = (orgId: string, subId: string, extra: Record<string, unknown> = {}) =>
  db.syncState.create({ data: { key: `cardlessTrial:${orgId}`, cursor: JSON.stringify({ subId, customerId: "cus_qa", planSlug: "professional", interval: "MONTH", customPages: [], mode: "test", trialDays: 7, startedAt: new Date(Date.now() - 2 * day).toISOString(), endsAt: new Date(Date.now() + 5 * day).toISOString(), ...extra }) } });
const grant = (orgId: string, endsAt: string | null) =>
  db.syncState.create({ data: { key: `planGrant:${orgId}`, cursor: JSON.stringify({ plan: "PROFESSIONAL", grantedAt: new Date().toISOString(), endsAt, fallback: "free", reason: "qa" }) } });

const CASES: Array<{ n: string; name: string; open: boolean; trialCapped?: boolean; setup: Setup }> = [
  { n: "1", name: "card-less trial, running, no card", open: true, trialCapped: true, setup: async (o) => { const s = `sub_qa_${rid()}`; await stripeRow(o, "TRIALING", "PROFESSIONAL", { externalSubId: s, trialEndsAt: new Date(Date.now() + 5 * day) }); await cardless(o, s); } },
  { n: "2", name: "card-less trial, card added", open: true, setup: async (o) => { const s = `sub_qa_${rid()}`; await stripeRow(o, "TRIALING", "PROFESSIONAL", { externalSubId: s, trialEndsAt: new Date(Date.now() + 5 * day) }); await cardless(o, s, { cardAt: new Date().toISOString() }); } },
  { n: "3", name: "trial with a card (TRIALING)", open: true, setup: async (o) => { await stripeRow(o, "TRIALING", "PROFESSIONAL", { trialEndsAt: new Date(Date.now() + 5 * day) }); } },
  { n: "4a", name: "paid ACTIVE — Starter", open: true, setup: async (o) => { await stripeRow(o, "ACTIVE", "STARTER"); } },
  { n: "4b", name: "paid ACTIVE — Professional", open: true, setup: async (o) => { await stripeRow(o, "ACTIVE", "PROFESSIONAL"); } },
  { n: "4c", name: "paid ACTIVE — Advanced", open: true, setup: async (o) => { await stripeRow(o, "ACTIVE", "ENTERPRISE"); } },
  { n: "4d", name: "paid ACTIVE — Custom (roof + HVAC pages)", open: true, setup: async (o) => { await stripeRow(o, "ACTIVE", "CUSTOM"); await db.syncState.create({ data: { key: `orgPages:${o}`, cursor: JSON.stringify(["roof-estimator", "hvac-estimator"]) } }); } },
  { n: "5", name: "PAST_DUE while Stripe retries", open: true, setup: async (o) => { await stripeRow(o, "PAST_DUE", "PROFESSIONAL", { currentPeriodEnd: new Date(Date.now() + 10 * day) }); } },
  { n: "6a", name: "admin grant with an end date", open: true, setup: async (o) => { const end = new Date(Date.now() + 30 * day); await db.subscription.create({ data: { organizationId: o, plan: "PROFESSIONAL", status: "ACTIVE", provider: "MANUAL", currentPeriodEnd: end } }); await grant(o, end.toISOString()); } },
  { n: "6b", name: "admin grant, no end date (row's old date in the past)", open: true, setup: async (o) => { await db.subscription.create({ data: { organizationId: o, plan: "PROFESSIONAL", status: "ACTIVE", provider: "MANUAL", currentPeriodEnd: new Date(Date.now() - 10 * day) } }); await grant(o, null); } },
  { n: "6c", name: "comp: MANUAL ACTIVE, no end, no grant record", open: true, setup: async (o) => { await db.subscription.create({ data: { organizationId: o, plan: "ENTERPRISE", status: "ACTIVE", provider: "MANUAL", currentPeriodEnd: null } }); } },
  { n: "7", name: "platform admin in their own company (no subscription)", open: true, setup: async (_o, u) => { await db.user.update({ where: { id: u }, data: { isPlatformAdmin: true } }); } },
  { n: "8", name: "cancelled, paid period still running", open: true, setup: async (o) => { await stripeRow(o, "ACTIVE", "PROFESSIONAL", { canceledAt: new Date(), currentPeriodEnd: new Date(Date.now() + 10 * day) }); } },
  { n: "9a", name: "cancelled, period over", open: false, setup: async (o) => { await stripeRow(o, "CANCELED", "PROFESSIONAL", { canceledAt: new Date(Date.now() - 15 * day), currentPeriodEnd: new Date(Date.now() - 10 * day) }); } },
  { n: "9b", name: "card-less trial ended without a card (TRIAL_ENDED)", open: false, setup: async (o) => { const s = `sub_qa_${rid()}`; await stripeRow(o, "TRIAL_ENDED", "PROFESSIONAL", { externalSubId: s, trialEndsAt: new Date(Date.now() - day), currentPeriodEnd: new Date(Date.now() - day) }); await cardless(o, s, { endsAt: new Date(Date.now() - day).toISOString(), endedAt: new Date().toISOString() }); } },
  { n: "9c", name: "card-less trial past its end, no card, webhook not in yet", open: false, setup: async (o) => { const s = `sub_qa_${rid()}`; await stripeRow(o, "TRIALING", "PROFESSIONAL", { externalSubId: s, trialEndsAt: new Date(Date.now() - 3600e3), currentPeriodEnd: new Date(Date.now() - 3600e3) }); await cardless(o, s, { endsAt: new Date(Date.now() - 3600e3).toISOString() }); } },
];

/** What an estimator call answered: the provider was reached (refused here only by the network), or which gate stopped it. */
function gateOf(v: unknown): "reached" | "plan" | "trial-cap" | "ceiling" {
  const o = (v ?? {}) as { ok?: boolean; error?: string; capped?: boolean; trialCap?: string };
  if (o.ok) return "reached";
  if (o.capped) return "ceiling";
  if (o.trialCap) return "trial-cap";
  if (/plan has ended|isn't in your plan|needs an active plan/i.test(o.error ?? "")) return "plan";
  return "reached";
}

async function planMatrix() {
  process.env.EAGLEVIEW_CLIENT_ID = "qa-dummy";
  process.env.EAGLEVIEW_CLIENT_SECRET = "qa-dummy";
  process.env.COOLCALC_CLIENT_ID = "qa-dummy";
  process.env.COOLCALC_API_KEY = "qa-dummy";
  process.env.COOLCALC_DEALER_ID = "qa-dummy";
  const rows: string[] = [];
  try {
    for (const c of CASES) {
      const co = await company(`M${c.n}`);
      await c.setup(co.org.id, co.owner.id);
      const est = await db.hvacEstimate.create({ data: { organizationId: co.org.id, createdById: co.owner.id, address: `${c.n} Plan St, Springfield, IL 62701`, siteFactsJson: "{}", modelJson: "{}", engineJson: "{}", draftJson: "{}" } });
      as(co);
      const phone = await outcome(() => startPhoneVerification("(206) 555-0142"));
      const tileStatus = (await tiles.GET(new Request("http://local/api/parcel-tiles/18/1/1"), { params: Promise.resolve({ z: "18", x: "1", y: "1" }) })).status;
      const tilePass = tileStatus !== 401 && tileStatus !== 402;
      const roof = await outcome(() => measureRoofInstant({ address: `${c.n}00 Matrix Ave`, city: "Springfield", state: "IL", zip: "62701" }));
      const hvac = await outcome(() => requestHvacPermitReport({ estimateId: est.id }));
      const roofGate = gateOf(roof.value ?? { ok: false, error: roof.text });
      const hvacGate = gateOf(hvac.value ?? { ok: false, error: hvac.text });
      rows.push(`${c.n.padEnd(3)} ${c.name.padEnd(58)} phone ${phone.refused ? "REFUSES" : "passes "}  tiles ${tilePass ? "passes " : "REFUSES"} (${tileStatus})  roof ${roofGate.padEnd(9)} coolcalc ${hvacGate}`);
      check(`plan ${c.n} (${c.name}): phone code ${c.open ? "passes" : "is refused"}`, c.open ? !phone.refused : phone.refused && /active plan/.test(phone.text), phone.text);
      check(`plan ${c.n} (${c.name}): parcel tiles ${c.open ? "pass" : "are refused"}`, c.open ? tilePass : tileStatus === 402, tileStatus);
      if (c.open) {
        // Within the limits: the provider is reached — but for the card-less trial's own ceilings, unchanged.
        check(`plan ${c.n}: a new roof measurement reaches the provider`, roofGate === "reached", roof.text);
        const hvacWant = c.trialCapped ? "trial-cap" : "reached";
        check(`plan ${c.n}: a Cool Calc report ${c.trialCapped ? "stays behind the card-less trial's own ceiling (0 without a card)" : "reaches the provider"}`, hvacGate === hvacWant, hvac.text);
      } else {
        check(`plan ${c.n}: a new roof measurement is closed`, roofGate === "plan" || roofGate === "trial-cap", roof.text);
        check(`plan ${c.n}: a Cool Calc report is closed`, hvacGate === "plan" || hvacGate === "trial-cap", hvac.text);
      }
    }
  } finally {
    for (const k of ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID"]) process.env[k] = "";
    console.log("── the plan matrix ──\n" + rows.join("\n"));
  }
}

async function main() {
  try {
    // ── the ceilings themselves ──
    check("ceilings as the owner set them", PAID_CAPS.roofNew.max === 30 && PAID_CAPS.roofReorder.max === 5 && PAID_CAPS.hvacReportHour.max === 20 && PAID_CAPS.hvacReportDay.max === 30);
    await holdsAtN("new roof measurements a day", 30, async () => takeRoofOrderCap(`${tag}-roof-${"a"}`, false));
    await holdsAtN("roof re-measures a day", 5, async () => takeRoofOrderCap(`${tag}-roof-${"b"}`, true));
    check("another company is not charged for the first one's ceiling", (await takeRoofOrderCap(`${tag}-roof-c`, false)).ok);
    await holdsAtN("Cool Calc reports an hour", 20, async () => takeHvacReportCap(`${tag}-hvac-a`));
    await holdsAtN("Cool Calc reports a day", 30, async () => takePaidCap("hvacReportDay", `${tag}-hvac-b`));

    // ── measureRoofInstant: only an ORDER counts; reopening a measured roof never does ──
    process.env.EAGLEVIEW_CLIENT_ID = "qa-dummy";
    process.env.EAGLEVIEW_CLIENT_SECRET = "qa-dummy";
    const R = await company("R", "ACTIVE");
    const measured = { address: "100 Main St", city: "Springfield", state: "IL", zip: "62701" };
    const fresh = { address: "200 Oak Ave", city: "Springfield", state: "IL", zip: "62701" };
    const instant = {
      requestId: `qa-${rid()}`, address: "100 Main St, Springfield, IL 62701", lat: 39.8, lng: -89.6, imagery: [],
      structures: [{ areaSqft: 2000, squares: 20, pitch: "6/12", footprintSqft: 1800, outline: [{ lat: 39.8, lng: -89.6 }, { lat: 39.8001, lng: -89.6 }, { lat: 39.8001, lng: -89.6001 }] }],
      totals: { areaSqft: 2000, squares: 20, predominantPitch: 6, pitchLabel: "6/12", footprintSqft: 1800 },
    };
    await db.roofMeasurement.create({ data: { organizationId: R.org.id, source: "instant", modelJson: "{}", instantJson: JSON.stringify(instant), ...measured } as never });
    as(R);
    const first = (await measureRoofInstant(fresh)) as { ok: boolean; capped?: boolean; error?: string };
    check("roof: an order under the ceiling goes to the provider (refused here only by the network)", !first.capped, first.error);
    for (let i = 0; i < 29; i++) await takeRoofOrderCap(R.org.id, false);
    const reopen = (await measureRoofInstant(measured)) as { ok: boolean; capped?: boolean; error?: string };
    check("roof: at the ceiling, a roof already measured still opens (never counted)", !reopen.capped, reopen.error);
    const over = (await outcome(() => measureRoofInstant(fresh))) as { refused: boolean; value?: { capped?: boolean; error?: string } };
    check("roof: at the ceiling, a new measurement is refused — as a result, with words", over.refused && over.value?.capped === true && /30 new roof measurements/.test(over.value?.error ?? ""), over.value);
    const R2 = await company("R2", "ACTIVE");
    as(R2);
    for (let i = 0; i < 5; i++) await takeRoofOrderCap(R2.org.id, true);
    const again = (await outcome(() => measureRoofInstant(fresh, { forceNewOrder: true }))) as { refused: boolean; value?: { capped?: boolean; error?: string } };
    check("roof: a 6th \"measure again\" in a day is refused with words", again.refused && again.value?.capped === true && /re-measured 5 roofs/.test(again.value?.error ?? ""), again.value);
    process.env.EAGLEVIEW_CLIENT_ID = "";
    process.env.EAGLEVIEW_CLIENT_SECRET = "";

    // ── requestHvacPermitReport: the 21st report in an hour is a returned refusal ──
    process.env.COOLCALC_CLIENT_ID = "qa-dummy";
    process.env.COOLCALC_API_KEY = "qa-dummy";
    process.env.COOLCALC_DEALER_ID = "qa-dummy";
    const H = await company("H", "ACTIVE");
    const est = await db.hvacEstimate.create({ data: { organizationId: H.org.id, createdById: H.owner.id, address: "300 Elm St, Springfield, IL 62701", siteFactsJson: "{}", modelJson: "{}", engineJson: "{}", draftJson: "{}" } });
    as(H);
    let reached = 0;
    for (let i = 0; i < 20; i++) {
      const r = await outcome(() => requestHvacPermitReport({ estimateId: est.id }));
      if (!/Cool Calc reports/.test(r.text)) reached++;
    }
    check("Cool Calc: 20 requests in an hour reach the provider (refused here only by the network)", reached === 20, `${reached} of 20`);
    const hv = await outcome(() => requestHvacPermitReport({ estimateId: est.id }));
    check("Cool Calc: the 21st in an hour is refused — as a result, with words", hv.refused && /20 Cool Calc reports this hour/.test(hv.text) && !hv.text.startsWith("Error"), hv.text);
    process.env.COOLCALC_CLIENT_ID = "";
    process.env.COOLCALC_API_KEY = "";
    process.env.COOLCALC_DEALER_ID = "";

    // ── verification texts: +1 US / Canada only, and an open plan ──
    check("number: a US mobile is +1 US/Canada", isUsCanadaNumber("+12065550100") && isUsCanadaNumber("+14165550100"));
    check("number: Jamaica (+1 876), the Dominican Republic (+1 809), 900 and a UK number are not", !isUsCanadaNumber("+18765550100") && !isUsCanadaNumber("+18095550100") && !isUsCanadaNumber("+19005550100") && !isUsCanadaNumber("+442071234567"));
    const P0 = await company("P0");
    as(P0);
    const noPlan = await outcome(() => startPhoneVerification("(206) 555-0100"));
    check("phone: a company without a plan sends no code", noPlan.refused && /active plan/.test(noPlan.text), noPlan.text);
    const P = await company("P", "ACTIVE");
    as(P);
    for (const [label, raw] of [["a UK number", "+44 20 7123 4567"], ["a Jamaican +1 number", "+1 876 555 0100"], ["a 900 number", "1-900-555-0100"]] as const) {
      const r = await outcome(() => startPhoneVerification(raw));
      check(`phone: ${label} gets no code`, r.refused && /US or Canadian/.test(r.text), r.text);
    }
    const us = await outcome(() => startPhoneVerification("(206) 555-0100"));
    check("phone: a US number on an open plan goes on (Twilio is off here)", !us.refused, us.text);
    await setPlan(P.org.id, "CANCELED");
    const ended = await outcome(() => startPhoneVerification("(206) 555-0101"));
    check("phone: after the plan ends, no code", ended.refused && /active plan/.test(ended.text), ended.text);

    // ── parcel tiles: only with an open plan ──
    const tile = (c: Co | null) => {
      actAs(c ? { id: c.owner.id, activeOrgId: c.org.id } : null);
      return tiles.GET(new Request("http://local/api/parcel-tiles/18/1/1"), { params: Promise.resolve({ z: "18", x: "1", y: "1" }) });
    };
    check("tiles: signed out → 401", (await tile(null)).status === 401);
    const noPlanTile = await tile(P0);
    check("tiles: no plan → 402 with words, never cached", noPlanTile.status === 402 && /active plan/.test(await noPlanTile.text()) && noPlanTile.headers.get("cache-control") === "no-store");
    check("tiles: a cancelled plan → 402", (await tile(P)).status === 402);
    const T = await company("T", "ACTIVE");
    check("tiles: an open plan passes the gate (503 here: no ReportAll key)", (await tile(T)).status === 503);

    // ── after the plan ends: vision reads and the company's own texts ──
    const V = await company("V", "CANCELED");
    const job = await db.job.create({ data: { organizationId: V.org.id, title: `Job ${tag}` } });
    const photo = await db.jobPhoto.create({ data: { jobId: job.id, url: TINY_PNG, kind: "BEFORE" } });
    as(V);
    for (const [name, fn] of [
      ["readHvacNameplate", () => readHvacNameplate({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", hint: "outdoor" })],
      ["analyzeJobPhoto", () => analyzeJobPhoto(photo.id)],
      ["scanReceipt", () => scanReceipt({ jobId: job.id, dataUrl: TINY_PNG })],
    ] as const) {
      const r = await outcome(fn as () => Promise<unknown>);
      check(`after the plan ended: ${name} is closed, with words`, r.refused && /plan has ended/.test(r.text), r.text);
    }
    await setPlan(V.org.id, "ACTIVE");
    for (const [name, fn] of [
      ["analyzeJobPhoto", () => analyzeJobPhoto(photo.id)],
      ["scanReceipt", () => scanReceipt({ jobId: job.id, dataUrl: TINY_PNG })],
    ] as const) {
      const r = await outcome(fn as () => Promise<unknown>);
      check(`control, an open plan: ${name} answers (the stub — OpenAI is off here)`, !r.refused, r.text);
    }
    await db.organization.update({ where: { id: V.org.id }, data: { smsFromNumber: "+12065550199" } });
    await setPlan(V.org.id, "CANCELED");
    const txt = await sendText({ organizationId: V.org.id, to: `+1206555${String(Math.floor(Math.random() * 9000) + 1000)}`, body: `qa ${rid()}`, kind: "test" });
    check("after the plan ended: a text from the company's own number is not sent", !txt.ok && txt.reason === "plan-ended", txt);
    await setPlan(V.org.id, "ACTIVE");
    const txt2 = await sendText({ organizationId: V.org.id, to: `+1206555${String(Math.floor(Math.random() * 9000) + 1000)}`, body: `qa ${rid()}`, kind: "test" });
    check("control, an open plan: the text is not stopped for the plan", txt2.ok || txt2.reason !== "plan-ended", txt2);

    await planMatrix();
  } finally {
    const del = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* next */ } };
    for (const orgId of made.orgs) {
      await del(() => db.smsMessage.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.activityEvent.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.jobPhoto.deleteMany({ where: { job: { organizationId: orgId } } }));
      await del(() => db.job.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.hvacEstimate.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.instantOrder.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.roofMeasurement.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.subscription.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.membership.deleteMany({ where: { organizationId: orgId } }));
      await del(() => db.syncState.deleteMany({ where: { key: { contains: orgId } } }));
      await del(() => db.organization.delete({ where: { id: orgId } }));
    }
    await del(() => db.syncState.deleteMany({ where: { key: { contains: tag } } }));
    await del(() => db.phoneVerification.deleteMany({ where: { userId: { in: made.users } } }));
    await del(() => db.user.deleteMany({ where: { id: { in: made.users } } }));
    await db.$disconnect();
  }
  process.exit(summary() ? 1 : 0);
}

void main();
