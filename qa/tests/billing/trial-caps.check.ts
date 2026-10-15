// The card-less trial's protections (owner, 2026-10-02), through the REAL
// modules and the dev database — no browser, no Stripe, no paid call, no mail
// out (the support alert lands in a scratch outbox).
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/trial-caps.check.ts
//
//   · TRIAL_CAPS: every ceiling counts its uses on a card-less trial with no
//     card and refuses past it with a PlanLimitFailure that names the ceiling;
//     a card lifts them all; an ended trial is on the Free plan (owner,
//     2026-10-14): its ceilings give way and lib/planStatus closes everything
//     paid, as for a cancelled company; an
//     organization with no card-less trial is never counted.
//   · a point asked twice is one fence use; a refund gives a use back; a
//     coveredBy claim made outside a request covers nothing.
//   · texts: only the verification code goes on a card-less trial.
//   · the spend: priced from lib/paidApiCosts, recorded only while TRIALING.
//   · throwaway mailboxes: the list, subdomains, the trial refusal.
//   · the day's ceiling on card-less trials, and the one support alert at 80%.
//
// Three throwaway organisations ("QA Trial Caps …"), their SyncState rows and
// the trial-start rows this run writes are removed at the end, pass or fail.
import "../_lib/_server-only";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { TRIAL_CAPS, TRIAL_CAP_KEYS, TRIAL_CAP_TITLE, trialCapAllowance, trialCapHref, trialCapMessage, type TrialCapKey } from "../../../src/lib/trialCaps";
import { meterSpendCents, notePaidCall, readTrialMeter, readTrialMeters, takeTrialCap, trialBlocksText, trialCapScope, trialCapUsage, trialMeterKey, trialPointKey, TrialCapError } from "../../../src/lib/trialMeter";
import { openAiChatCents, unitCents, formatSpend } from "../../../src/lib/paidApiCosts";
import { isPlanLimitFailure } from "../../../src/lib/planLimits";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "../../../src/lib/disposableEmail";
import { cardlessTrialRefusal } from "../../../src/lib/trialGuard";
import { cardlessTrialsPaused, cardlessStartsInLastDay, noteCardlessTrialStarted } from "../../../src/lib/trialDailyCap";
import { cardlessKey } from "../../../src/lib/trialState";
import { planEnded } from "../../../src/lib/paidCaps";

const db = new PrismaClient();
const PID = process.pid;
const outbox = mkdtempSync(join(tmpdir(), "qa-trial-caps-"));
process.env.EMAIL_DEV_OUTBOX = outbox;
process.env.DEV_EMAIL_OVERRIDE = "";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);

const made: string[] = [];
const startRows: string[] = [];
let savedStamp: { key: string; cursor: string } | null = null;

/** An organization on a card-less trial: the Subscription mirror plus the
 *  SyncState record lib/trialState reads. */
async function trialOrg(tag: string, opts: { card?: boolean; endsInDays?: number; cardless?: boolean } = {}) {
  const org = await db.organization.create({ data: { slug: `qa-trial-caps-${tag}-${PID}`, name: `QA Trial Caps ${tag}` }, select: { id: true } });
  made.push(org.id);
  const endsAt = new Date(Date.now() + (opts.endsInDays ?? 5) * 86_400_000);
  const subId = `sub_qa_caps_${tag}_${PID}`;
  await db.subscription.create({ data: { organizationId: org.id, plan: "starter", status: "TRIALING", externalSubId: subId, trialEndsAt: endsAt, currentPeriodEnd: endsAt } });
  if (opts.cardless !== false) {
    const rec = { subId, customerId: `cus_qa_${PID}`, planSlug: "starter", interval: "MONTH", customPages: [], mode: "test", startedAt: new Date().toISOString(), endsAt: endsAt.toISOString(), cardAt: opts.card ? new Date().toISOString() : null };
    await db.syncState.create({ data: { key: cardlessKey(org.id), cursor: JSON.stringify(rec) } });
  }
  return org.id;
}

async function main() {
  head("the numbers and the words");
  ok("every ceiling is a whole number ≥ 0, and the owner's examples hold", TRIAL_CAP_KEYS.every((k) => Number.isInteger(TRIAL_CAPS[k]) && TRIAL_CAPS[k] >= 0) && TRIAL_CAPS.roofMeasurements === 3 && TRIAL_CAPS.fenceLookups === 3 && TRIAL_CAPS.hvacLookups === 3 && TRIAL_CAPS.aiCalls === 10 && TRIAL_CAPS.eagleViewOrders === 0 && TRIAL_CAPS.smsOutbound === 0, JSON.stringify(TRIAL_CAPS));
  ok("a refusal says the allowance and asks for a card", trialCapMessage("roofMeasurements").includes("3 roof measurements") && trialCapMessage("roofMeasurements").includes(TRIAL_CAP_TITLE) && trialCapMessage("eagleViewOrders").startsWith("The free trial without a card includes no EagleView"), trialCapMessage("roofMeasurements"));
  ok("the screen it sends to is the trial page with the ceiling named", trialCapHref("aiCalls") === "/dashboard/trial?cap=aiCalls" && trialCapAllowance("smsOutbound") === "no outgoing texts");

  const capped = await trialOrg("a");
  const carded = await trialOrg("b", { card: true });
  const plain = await trialOrg("c", { cardless: false });

  head("the ceilings, on a card-less trial with no card");
  ok("scopes: no card → capped, card on file → none, no card-less trial → none", (await trialCapScope(capped)) === "capped" && (await trialCapScope(carded)) === "none" && (await trialCapScope(plain)) === "none");
  for (const key of TRIAL_CAP_KEYS as TrialCapKey[]) {
    const n = TRIAL_CAPS[key];
    let allowed = 0;
    for (let i = 0; i < n; i++) if ((await takeTrialCap(capped, key)).ok) allowed++;
    const past = await takeTrialCap(capped, key);
    const refused = !past.ok && isPlanLimitFailure(past.failure) && past.failure.trialCap === key && !past.failure.trialEnded && past.failure.error === trialCapMessage(key);
    ok(`${key}: ${n} allowed, the next refused with the ceiling named`, allowed === n && refused, `allowed ${allowed}/${n}`);
  }
  const usage = await trialCapUsage(capped);
  ok("the trial page reads every ceiling at its number", usage.every((u) => u.used === u.cap), JSON.stringify(usage.map((u) => [u.key, u.used, u.cap])));

  head("dedupe, refund, coveredBy");
  const fresh = await trialOrg("d");
  const pt = trialPointKey(47.6101234, -122.2015678);
  const first = await takeTrialCap(fresh, "fenceLookups", { dedupe: pt });
  const again = await takeTrialCap(fresh, "fenceLookups", { dedupe: trialPointKey(47.61012, -122.20157) });
  ok("one point asked twice (eleven metres apart at most) is one fence use", first.ok && first.counted && again.ok && !again.counted && (await readTrialMeter(fresh)).uses.fenceLookups === 1);
  const r = await takeTrialCap(fresh, "roofMeasurements");
  if (r.ok) await r.refund();
  ok("a refund gives the use back (a stored measurement reused)", (await readTrialMeter(fresh)).uses.roofMeasurements === 0);
  const nocover = await takeTrialCap(fresh, "fenceLookups", { dedupe: trialPointKey(40, -100), coveredBy: ["hvacLookups"] });
  ok("coveredBy claimed outside a request covers nothing — the use is counted", nocover.ok && nocover.counted && (await readTrialMeter(fresh)).uses.fenceLookups === 2);
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => takeTrialCap(fresh, "hvacLookups")));
  ok("six presses at once take exactly three uses (compare-and-swap)", concurrent.filter((g) => g.ok).length === 3 && (await readTrialMeter(fresh)).uses.hvacLookups === 3);

  head("a card lifts them; an ended trial is on the Free plan, where everything paid is closed");
  const cardGates = await Promise.all([takeTrialCap(carded, "eagleViewOrders"), takeTrialCap(carded, "smsOutbound"), takeTrialCap(carded, "aiCalls")]);
  ok("with a card on file nothing is refused and nothing counted (the plan's limits apply)", cardGates.every((g) => g.ok && !g.counted) && !(await db.syncState.findUnique({ where: { key: trialMeterKey(carded) } })));
  await db.subscription.update({ where: { organizationId: fresh }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });
  const endedGate = await takeTrialCap(fresh, "aiCalls");
  ok("past the end with no card: the trial's ceilings give way to the Free plan's limits (nothing counted)", endedGate.ok && !endedGate.counted && (await trialCapScope(fresh)) === "none");
  ok("…and the plan rule closes everything paid, as for a cancelled company", await planEnded(fresh));
  const thrown = new TrialCapError("aiCalls");
  ok("the thrown form carries Next's redirect to the trial page", thrown.digest === "NEXT_REDIRECT;push;/dashboard/trial?cap=aiCalls;303;" && new TrialCapError("aiCalls", true).digest.includes("/dashboard/trial?locked=1"));

  head("texts");
  ok("the verification code goes; every other text is held back", !(await trialBlocksText(capped, "verify")) && (await trialBlocksText(capped, "welcome")) && (await trialBlocksText(capped, "crew-assigned")));
  ok("with a card, and for the platform's own replies, texts go", !(await trialBlocksText(carded, "crew-assigned")) && !(await trialBlocksText(null, "help")) && !(await trialBlocksText(plain, "test")));

  head("the spend");
  ok("prices: gpt-4.1 10k in / 1k out = 2.8¢; Solar data layers 7.5¢; a ReportAll parcel 12.5¢", Math.abs(openAiChatCents("gpt-4.1-2025-04-14", 10_000, 1_000) - 2.8) < 1e-9 && unitCents("google-solar", "dataLayers") === 7.5 && unitCents("reportall", "parcel", 2) === 25 && unitCents("google-solar", "raster") === 0);
  await notePaidCall("openai", "chat", { orgId: capped, cents: 2.8 });
  await notePaidCall("reportall", "parcel", { orgId: capped, units: 3 });
  await notePaidCall("google-solar", "dataLayers", { orgId: capped });
  const m = await readTrialMeter(capped);
  ok("a trial's calls add up by service, with their counts", Math.abs((m.spend.openai ?? 0) - 2.8) < 1e-9 && m.spend.reportall === 37.5 && m.calls.reportall === 1 && m.spend["google-solar"] === 7.5 && Math.abs(meterSpendCents(m) - 47.8) < 1e-9, JSON.stringify(m.spend));
  await db.subscription.update({ where: { organizationId: plain }, data: { status: "ACTIVE" } });
  await notePaidCall("openai", "chat", { orgId: plain, cents: 5 });
  ok("an organization not on a trial is not recorded", !(await db.syncState.findUnique({ where: { key: trialMeterKey(plain) } })));
  const both = await readTrialMeters([capped, carded, plain]);
  ok("the admin list reads every meter in one query", both.size === 1 && both.has(capped) && formatSpend(meterSpendCents(both.get(capped))) === "$0.48" && formatSpend(0.4) === "<$0.01");

  head("throwaway mailboxes");
  ok("the list catches the services and their subdomains, not the mailboxes people use", isDisposableEmail("joe@mailinator.com") && isDisposableEmail("Joe@X.MAILINATOR.COM") && isDisposableEmail("a@yopmail.fr") && isDisposableEmail("a@10minutemail.com") && !isDisposableEmail("pat@gmail.com") && !isDisposableEmail("sam@ridgeline-roofing.com") && !isDisposableEmail("a@outlook.com") && !isDisposableEmail("not-an-email"));
  ok("the trial refuses one with the sentence step 1 shows", (await cardlessTrialRefusal("pat@guerrillamail.com")) === DISPOSABLE_EMAIL_MESSAGE && /temporary email/i.test(DISPOSABLE_EMAIL_MESSAGE));

  head("the day's ceiling on card-less trials");
  // A stamp from an earlier alert would silence this one: set aside, put back.
  savedStamp = await db.syncState.findUnique({ where: { key: "trial-daily-alert" } });
  if (savedStamp) await db.syncState.delete({ where: { key: "trial-daily-alert" } });
  const before = await cardlessStartsInLastDay();
  process.env.CARDLESS_TRIALS_PER_DAY = String(before + 5);
  ok("below the ceiling trials run without a card", !(await cardlessTrialsPaused()));
  const fake = (i: number) => `qa-caps-start-${PID}-${i}`;
  const counts: Array<{ count: number; alerted: boolean }> = [];
  for (let i = 0; i < 5; i++) {
    startRows.push(`trial-start:${fake(i)}`);
    counts.push(await noteCardlessTrialStarted(fake(i)));
  }
  const alertAt = Math.ceil((before + 5) * 0.8);
  const firstAlert = counts.findIndex((c) => c.alerted);
  ok(`support hears once, at 80% (${alertAt} of ${before + 5})`, counts[firstAlert]?.count === alertAt && counts.filter((c) => c.alerted).length <= 1, JSON.stringify(counts));
  const mail = readdirSync(outbox);
  ok("the alert went to the outbox, not out", mail.length === (firstAlert >= 0 ? 1 : 0) && (mail[0] ?? "").includes("card-less-trials"), mail.join(", "));
  ok("at the ceiling new trials take a card", await cardlessTrialsPaused());
  process.env.CARDLESS_TRIALS_PER_DAY = "0";
  ok("0 pauses card-less trials outright", await cardlessTrialsPaused());
}

async function cleanup() {
  for (const id of made) {
    await db.syncState.deleteMany({ where: { key: { in: [trialMeterKey(id), cardlessKey(id)] } } }).catch(() => {});
    await db.subscription.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await db.organization.delete({ where: { id } }).catch(() => {});
  }
  if (startRows.length) {
    await db.syncState.deleteMany({ where: { key: { in: startRows } } }).catch(() => {});
    // The alert stamp this run wrote goes; the one set aside comes back.
    await db.syncState.deleteMany({ where: { key: "trial-daily-alert" } }).catch(() => {});
    if (savedStamp) await db.syncState.create({ data: { key: savedStamp.key, cursor: savedStamp.cursor } }).catch(() => {});
  }
  rmSync(outbox, { recursive: true, force: true });
  await db.$disconnect();
}

main()
  .catch((err) => {
    failures++;
    console.error("HARNESS FAIL", err);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"} — ${passes} passed`);
    process.exit(failures ? 1 : 0);
  });
