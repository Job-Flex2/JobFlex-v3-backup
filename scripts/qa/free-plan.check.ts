// THE FREE PLAN OPENS NOTHING A CANCELLED COMPANY COULD NOT OPEN (owner,
// 2026-10-13; lib/freePlan).
//
//   npx tsx --tsconfig tsconfig.json scripts/qa/free-plan.check.ts
//
// Real code on the local dev database (./_actionHarness: network OFF, every
// key blank), throwaway companies removed at the end:
//
//   · a company reaches the Free plan the real way — the owner's
//     cancelSubscription() books it, the webhook's markSubscriptionCanceled()
//     ends it — and EVERY door answers it exactly as it answers a company
//     cancelled the way it was before this change: the page gate, requirePage
//     for each add-on, the feature tier, the limits (the "free" catalog row),
//     planEnded / planOpen / texting, the own-number gate, the trial lock, the
//     estimators (EagleView, Cool Calc, Smart Proposal), recognition, the
//     parcel tiles and the phone codes. A paying company (and one with the
//     switch only booked) is the control: the same doors are open for it;
//   · a card-less trial that was cancelled ends on Free, not in the trial
//     lock, and gets no "add a card" mail;
//   · webhooks delivered again or out of order do not move a company from
//     Free back to its paid plan, nor from a new paid plan back to Free;
//   · what the status FREE would have opened (the reason Free is not that).
import { actAs, check, outcome, summary } from "./_actionHarness";
import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { db } from "../../src/lib/db";
import { cancelSubscription } from "../../src/actions/billing";
import { markSubscriptionCanceled, syncSubscriptionFromStripe } from "../../src/lib/stripeSync";
import { mirrorStatusFor } from "../../src/lib/stripeStatus";
import { getBlockedCustomPages, requirePage } from "../../src/lib/customPageAccess";
import { CUSTOM_PAGES, type CustomPageId } from "../../src/lib/customPlan";
import { getOrgPlanById } from "../../src/lib/orgPlan";
import { getOrgPlanContext } from "../../src/lib/planCatalogServer";
import { getOrgLimitUsage } from "../../src/lib/limitsEngine";
import { planEnded, planOpen, orgMayText } from "../../src/lib/paidCaps";
import { companyIsPaying } from "../../src/lib/sms/registration";
import { cardlessTrialState, isTrialWriteLocked } from "../../src/lib/trialState";
import { onFreePlan, freeSwitchBooked } from "../../src/lib/freePlan";
import { measureRoofInstant } from "../../src/actions/roofMeasurement";
import { requestHvacPermitReport, readHvacNameplate } from "../../src/actions/hvacEstimator";
import { startPhoneVerification } from "../../src/actions/sms";
import { analyzeJobPhoto } from "../../src/actions/photoAnalysis";
import * as tiles from "../../src/app/api/parcel-tiles/[z]/[x]/[y]/route";

const tag = `qa-free-${Date.now()}`;
const rid = () => randomBytes(6).toString("hex");
const DAY = 864e5;
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const made: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

async function company(letter: string) {
  const org = await db.organization.create({ data: { name: `${tag} ${letter}`, slug: `${tag}-${letter.toLowerCase()}`, isInternal: true } });
  const owner = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}@qa.test`, name: `Owner ${letter}`, activeOrgId: org.id } });
  await db.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  made.orgs.push(org.id);
  made.users.push(owner.id);
  return { org, owner };
}
type Co = Awaited<ReturnType<typeof company>>;
const as = (c: Co) => actAs({ id: c.owner.id, activeOrgId: c.org.id });

/** A Stripe subscription as the webhook hands it over — the fields the mirror reads. */
function stripeSub(id: string, orgId: string, over: Partial<Stripe.Subscription> & { periodEnd: number }): Stripe.Subscription {
  const { periodEnd, ...rest } = over;
  return {
    id,
    object: "subscription",
    customer: `cus_${tag}`,
    status: "active",
    metadata: { organizationId: orgId },
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    trial_end: null,
    created: Math.floor((Date.now() - 40 * DAY) / 1000),
    default_payment_method: null,
    discounts: [],
    items: { object: "list", data: [{ price: { id: `price_${tag}`, recurring: { interval: "month" } }, quantity: 1, current_period_end: periodEnd, current_period_start: periodEnd - 30 * 86400 }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}

/** Every door, as it answers this company now. */
async function doors(c: Co, est: string, photoId: string) {
  const org = c.org.id;
  as(c);
  const pages: Record<string, string> = {};
  for (const p of CUSTOM_PAGES) {
    const r = await outcome(() => requirePage(org, p.id as CustomPageId));
    pages[p.id] = r.refused ? (/ended/.test(r.text) ? "closed:ended" : "closed:not-included") : "open";
  }
  const limits = Object.fromEntries((await getOrgLimitUsage(org, { actorId: null })).map((u) => [u.resource, u.limit]));
  const roof = await outcome(() => measureRoofInstant({ address: `${rid()} Free St`, city: "Springfield", state: "IL", zip: "62701" }));
  const hvac = await outcome(() => requestHvacPermitReport({ estimateId: est }));
  const nameplate = await outcome(() => readHvacNameplate({ dataUrl: TINY_PNG, hint: "outdoor" }));
  const photo = await outcome(() => analyzeJobPhoto(photoId));
  const phone = await outcome(() => startPhoneVerification("(206) 555-0142"));
  const tile = (await tiles.GET(new Request("http://local/api/parcel-tiles/18/1/1"), { params: Promise.resolve({ z: "18", x: "1", y: "1" }) })).status;
  const closedByPlan = (o: { refused: boolean; text: string }) => (o.refused && /plan has ended|needs an active plan|isn't in your plan|active plan/i.test(o.text) ? "closed" : "open");
  return {
    blocked: JSON.stringify(await getBlockedCustomPages(org)),
    pages: JSON.stringify(pages),
    tier: await getOrgPlanById(org),
    contextTier: (await getOrgPlanContext(org)).tier,
    limits: JSON.stringify(limits),
    planEnded: await planEnded(org),
    planOpen: await planOpen(org, c.owner.id),
    texts: await orgMayText(org),
    ownNumber: await companyIsPaying(org),
    trialLock: await isTrialWriteLocked(org),
    roof: closedByPlan(roof),
    coolcalc: closedByPlan(hvac),
    nameplate: closedByPlan(nameplate),
    photoAi: closedByPlan(photo),
    phoneCode: closedByPlan(phone),
    parcelTiles: tile === 402 ? "closed" : "open",
  };
}
type Doors = Awaited<ReturnType<typeof doors>>;

async function setup(c: Co) {
  const est = await db.hvacEstimate.create({ data: { organizationId: c.org.id, createdById: c.owner.id, address: `${rid()} Plan St, Springfield, IL 62701`, siteFactsJson: "{}", modelJson: "{}", engineJson: "{}", draftJson: "{}" } });
  const job = await db.job.create({ data: { organizationId: c.org.id, title: `Job ${tag}` } });
  const photo = await db.jobPhoto.create({ data: { jobId: job.id, url: TINY_PNG, kind: "BEFORE" } });
  return { est: est.id, photo: photo.id };
}

async function main() {
  for (const k of ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID"]) process.env[k] = "qa-dummy";
  try {
    const now = Math.floor(Date.now() / 1000);

    // ── A: Free, the real way: booked by the owner, ended by the webhook ──
    const A = await company("A");
    const subA = `sub_${tag}_a`;
    const endA = now + 20 * 86400;
    await db.subscription.create({ data: { organizationId: A.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: subA, externalCustomerId: `cus_${tag}`, currentPeriodEnd: new Date(endA * 1000) } });
    const kitA = await setup(A);
    as(A);
    const booked = await cancelSubscription();
    const rowBooked = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("the owner books the switch to Free: the row is still ACTIVE, the date is the end of the paid cycle", booked.ok && rowBooked?.status === "ACTIVE" && freeSwitchBooked(rowBooked) && rowBooked.currentPeriodEnd?.getTime() === endA * 1000, booked);
    const doorsBooked = await doors(A, kitA.est, kitA.photo);

    // The paid cycle runs out; Stripe ends the subscription (cancel_at_period_end).
    const endedPayload = stripeSub(subA, A.org.id, { status: "canceled", cancel_at_period_end: true, canceled_at: now - 5 * 86400, ended_at: now - 3600, metadata: { organizationId: A.org.id, jf_to_free: "1" }, periodEnd: now - 3600 });
    await db.subscription.update({ where: { organizationId: A.org.id }, data: { currentPeriodEnd: new Date((now - 3600) * 1000) } });
    await markSubscriptionCanceled(endedPayload);
    const rowFree = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("after the end the company is on the Free plan; the plan it had and its dates are kept", onFreePlan(rowFree) && rowFree?.plan === "PROFESSIONAL" && rowFree.canceledAt?.getTime() === (now - 5 * 86400) * 1000 && rowFree.currentPeriodEnd?.getTime() === (now - 3600) * 1000, rowFree);
    const doorsFree = await doors(A, kitA.est, kitA.photo);

    // ── B: cancelled the way it was before this change (the baseline) ──
    const B = await company("B");
    await db.subscription.create({ data: { organizationId: B.org.id, plan: "PROFESSIONAL", status: "CANCELED", provider: "STRIPE", externalSubId: `sub_${tag}_b`, canceledAt: new Date(), currentPeriodEnd: new Date(Date.now() - 2 * DAY) } });
    const kitB = await setup(B);
    const doorsCanceled = await doors(B, kitB.est, kitB.photo);

    // ── C: paying (the control) ──
    const C = await company("C");
    await db.subscription.create({ data: { organizationId: C.org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: `sub_${tag}_c`, currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
    const kitC = await setup(C);
    const doorsPaying = await doors(C, kitC.est, kitC.photo);

    const keys = Object.keys(doorsFree) as Array<keyof Doors>;
    const table = keys.map((k) => `${k.padEnd(12)} Free ${String(doorsFree[k]).slice(0, 60).padEnd(62)} cancelled ${String(doorsCanceled[k]).slice(0, 60).padEnd(62)} paying ${String(doorsPaying[k]).slice(0, 60)}`);
    console.log("── the doors ──\n" + table.join("\n"));
    for (const k of keys) {
      check(`door "${k}": Free answers exactly as a cancelled company`, JSON.stringify(doorsFree[k]) === JSON.stringify(doorsCanceled[k]), { free: doorsFree[k], canceled: doorsCanceled[k] });
    }
    const sensitive = keys.filter((k) => JSON.stringify(doorsPaying[k]) !== JSON.stringify(doorsFree[k]));
    check("control: a paying company finds these doors open (the doors are real)", ["roof", "coolcalc", "photoAi", "phoneCode", "parcelTiles", "planOpen", "texts", "ownNumber", "tier", "pages", "blocked"].every((k) => sensitive.includes(k as keyof Doors)), sensitive);
    check("control: with the switch only booked, every door is still open as for a paying company", keys.every((k) => JSON.stringify(doorsBooked[k]) === JSON.stringify(doorsPaying[k])), keys.filter((k) => JSON.stringify(doorsBooked[k]) !== JSON.stringify(doorsPaying[k])));
    const freeRow = await db.pricingPlan.findFirst({ where: { slug: "free" }, select: { limitsJson: true } });
    if (freeRow?.limitsJson) {
      const want = JSON.parse(freeRow.limitsJson) as Record<string, number>;
      const got = JSON.parse(doorsFree.limits) as Record<string, number | null>;
      check("Free's limits are the \"free\" catalog row's", Object.entries(want).every(([k, v]) => got[k] === v), { want, got });
    }

    // ── webhooks: again, and out of order ──
    await markSubscriptionCanceled(endedPayload);
    const again = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("the deletion delivered again writes the same row (same dates, still Free)", onFreePlan(again) && again?.canceledAt?.getTime() === rowFree?.canceledAt?.getTime() && again?.currentPeriodEnd?.getTime() === rowFree?.currentPeriodEnd?.getTime());
    const stale = stripeSub(subA, A.org.id, { status: "active", cancel_at_period_end: true, canceled_at: now - 5 * 86400, metadata: { organizationId: A.org.id, jf_to_free: "1" }, periodEnd: now - 3600 });
    await syncSubscriptionFromStripe(stale, null);
    const afterStale = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("an older \"updated: active\" arriving after the deletion does not put Free back on Professional", onFreePlan(afterStale), afterStale?.status);

    // Back from Free: a new paid subscription; the old one's events arrive late.
    const subA2 = `sub_${tag}_a2`;
    await db.subscription.update({ where: { organizationId: A.org.id }, data: { status: "ACTIVE", externalSubId: subA2, canceledAt: null, currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
    await markSubscriptionCanceled(endedPayload);
    await syncSubscriptionFromStripe(stripeSub(subA, A.org.id, { status: "canceled", cancel_at_period_end: true, canceled_at: now - 5 * 86400, ended_at: now - 3600, created: now - 60 * 86400, periodEnd: now - 3600 }), null);
    const back = await db.subscription.findUnique({ where: { organizationId: A.org.id } });
    check("back on a paid plan, the old subscription's late deletion and update do not send the company to Free", back?.status === "ACTIVE" && back.externalSubId === subA2, back);

    // ── a card-less trial, cancelled: Free at the trial's end, not the lock ──
    const T = await company("T");
    const subT = `sub_${tag}_t`;
    const trialEnd = now + 3 * 86400;
    await db.subscription.create({ data: { organizationId: T.org.id, plan: "PROFESSIONAL", status: "TRIALING", provider: "STRIPE", externalSubId: subT, externalCustomerId: `cus_${tag}`, trialEndsAt: new Date(trialEnd * 1000), currentPeriodEnd: new Date(trialEnd * 1000) } });
    await db.syncState.create({ data: { key: `cardlessTrial:${T.org.id}`, cursor: JSON.stringify({ subId: subT, customerId: `cus_${tag}`, planSlug: "professional", interval: "MONTH", customPages: [], mode: "test", trialDays: 7, startedAt: new Date(Date.now() - 4 * DAY).toISOString(), endsAt: new Date(trialEnd * 1000).toISOString() }) } });
    as(T);
    const tb = await cancelSubscription();
    const tState = await cardlessTrialState(T.org.id);
    check("a card-less trial cancelled: booked, still trialing, no \"add a card\" reminders (toFree)", tb.ok && tState?.kind === "trialing" && tState.toFree === true, tState);
    const lapse = stripeSub(subT, T.org.id, { status: "canceled", cancel_at_period_end: true, canceled_at: now - 86400, ended_at: trialEnd, trial_end: trialEnd, metadata: { organizationId: T.org.id, jf_cardless: "1", jf_to_free: "1" }, periodEnd: trialEnd });
    const plainLapse = stripeSub(subT, T.org.id, { status: "canceled", ended_at: trialEnd, trial_end: trialEnd, metadata: { organizationId: T.org.id, jf_cardless: "1" }, periodEnd: trialEnd });
    check("its end reads CANCELED (Free), while a card-less trial that simply ran out still reads TRIAL_ENDED", mirrorStatusFor(lapse) === "CANCELED" && mirrorStatusFor(plainLapse) === "TRIAL_ENDED");
    await markSubscriptionCanceled(lapse);
    const rowT = await db.subscription.findUnique({ where: { organizationId: T.org.id } });
    check("the cancelled card-less trial is on Free and not write-locked", onFreePlan(rowT) && !(await isTrialWriteLocked(T.org.id)), rowT?.status);

    // ── why Free is not the status FREE ──
    const F = await company("F");
    await db.subscription.create({ data: { organizationId: F.org.id, plan: "FREE", status: "FREE", provider: "MANUAL" } });
    const kitF = await setup(F);
    const doorsStatusFree = await doors(F, kitF.est, kitF.photo);
    const opened = keys.filter((k) => JSON.stringify(doorsStatusFree[k]) !== JSON.stringify(doorsCanceled[k]));
    console.log(`note: the status FREE would answer differently from a cancelled company on: ${opened.join(", ") || "nothing"}`);
  } finally {
    for (const k of ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID"]) process.env[k] = "";
    const del = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* next */ } };
    for (const orgId of made.orgs) {
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
