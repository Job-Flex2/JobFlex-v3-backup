// The partner hears when their money moves — approved, sent, declined, held by
// a dispute, taken back by a lost one — through the REAL handlers, no Stripe
// call, mail into a throw-away outbox.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-mail.check.ts
//
// Rows are written in **QA Co** (slug `qa-co`), prefixed `qa-mail-`, and deleted
// on the way out, pass or fail.

import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;
const OUTBOX = mkdtempSync(join(tmpdir(), "jf-outbox-"));
process.env.EMAIL_DEV_OUTBOX = OUTBOX;

import { PrismaClient } from "@prisma/client";
import { accrueForInvoice, holdForDispute, settleDispute } from "../../../src/lib/stripeSync";
import { processApprovedPayouts } from "../../../src/lib/payouts";
import { mailPayoutApproved, mailPayoutDeclined, nextPayoutRunDate } from "../../../src/lib/influencerMail";

const db = new PrismaClient();
const P = "qa-mail-";
const EMAIL = `${P}partner@jobflex.test`;

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);
const inbox = () =>
  readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => {
      const html = readFileSync(join(OUTBOX, f), "utf8");
      const m = html.match(/<!-- to: ([^|]+) \| subject: ([^\n]+?) -->/);
      return { file: f, to: m?.[1] ?? "", subject: m?.[2] ?? "", html };
    });
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#8203;|&#847;/g, "").replace(/\s+/g, " ");

async function cleanup() {
  const inf = await db.influencer.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (inf) {
    await db.commissionLedger.deleteMany({ where: { influencerId: inf.id } });
    await db.payoutTransfer.deleteMany({ where: { influencerId: inf.id } });
    await db.payoutRequest.deleteMany({ where: { influencerId: inf.id } });
    await db.attribution.deleteMany({ where: { influencerId: inf.id } });
    await db.promoCode.deleteMany({ where: { influencerId: inf.id } });
    await db.influencer.delete({ where: { id: inf.id } });
  }
  await db.syncState.deleteMany({ where: { key: { startsWith: `dispute:ch_${P}` } } });
  return inf ? 1 : 0;
}

async function main() {
  await cleanup();
  const qaOrg = await db.organization.findUnique({ where: { slug: "qa-co" }, select: { id: true, name: true } });
  if (!qaOrg) {
    console.error("FAIL  QA Co (slug qa-co) is not seeded in this database — run the seed first.");
    process.exit(1);
  }
  console.log(`partner mail · ${qaOrg.name} · real handlers · no Stripe calls · outbox ${OUTBOX}`);

  const inf = await db.influencer.create({
    data: {
      email: EMAIL, displayName: "Quinn Mailer", status: "ACTIVE", holdDays: 30, minPayoutCents: 100,
      payoutsEnabled: true, connectStatus: "ENABLED", connectAccountId: `acct_${P}7Q1X`,
      promoCodes: { create: { code: "QAMAIL20", stripeCouponId: `local_coupon_${P}`, stripePromotionCodeId: `local_promo_${P}`, commissionType: "PERCENT", commissionRateBps: 2000, commissionBasis: "NET", durationType: "FOREVER" } },
    },
    include: { promoCodes: true },
  });
  await db.attribution.create({ data: { influencerId: inf.id, promoCodeId: inf.promoCodes[0].id, organizationId: qaOrg.id, stripeCustomerId: `cus_${P}`, stripeSubscriptionId: `sub_${P}`, status: "ACTIVE" } });
  const invoice = (id: string, cents: number) => ({ id, subscription: `sub_${P}`, customer: `cus_${P}`, charge: `ch_${P}${id}`, paid: true, amount_paid: cents, subtotal: cents, currency: "usd", created: Math.floor(Date.now() / 1000), billing_reason: "subscription_cycle" }) as never;
  await accrueForInvoice(invoice("a", 7900));
  await accrueForInvoice(invoice("b", 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: inf.id }, data: { state: "CLEARED" } });

  head("1 · approved: the amount and the day of the next run");
  const req = await db.payoutRequest.create({ data: { influencerId: inf.id, amountCents: 3160, currency: "usd", status: "APPROVED", approvedAt: new Date() } });
  ok("approved by the admin → mail", await mailPayoutApproved(req.id));
  let m = inbox().at(-1)!;
  const expected = nextPayoutRunDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  ok("to the partner, subject with the amount, the body names the day it goes out",
    m.to === EMAIL && m.subject === "Your $31.60 payout is approved" && strip(m.html).includes(expected) && /Quinn/.test(m.html), `${m.subject} · ${expected}`);
  const early = nextPayoutRunDate(new Date("2026-09-22T05:00:00Z"));
  const late = nextPayoutRunDate(new Date("2026-09-22T07:00:00Z"));
  ok("the run is 06:30 UTC: before it, today; after it, tomorrow", early.toISOString().startsWith("2026-09-22T06:30") && late.toISOString().startsWith("2026-09-23T06:30"));
  const actions = readFileSync("src/actions/influencers.ts", "utf8");
  ok("approvePayoutRequest and rejectPayoutRequest send from the point that changes the status",
    /updateMany\(\{[\s\S]{0,300}status: PayoutRequestStatus\.APPROVED[\s\S]{0,400}await mailPayoutApproved\(id\)/.test(actions) &&
      /status: PayoutRequestStatus\.REJECTED[\s\S]{0,400}await mailPayoutDeclined\(id\)/.test(actions));

  head("2 · sent: from the payout run, after the books close — amount, the account's last 4, the reference");
  let sent = 0;
  await processApprovedPayouts({ async create(p) { sent += p.amount; return { id: `tr_${P}1` }; } });
  m = inbox().at(-1)!;
  ok("one transfer of $31.60 → one mail 'on its way' with ····7Q1X and tr_… reference",
    sent === 3160 && m.to === EMAIL && m.subject === "Your $31.60 payout is on its way" && strip(m.html).includes("····7Q1X") && strip(m.html).includes(`tr_${P}1`), m.subject);
  const paidReq = await db.payoutRequest.findUnique({ where: { id: req.id } });
  ok("…and the books did close (request PAID)", paidReq?.status === "PAID");

  head("3 · declined: the reason, in words");
  const req2 = await db.payoutRequest.create({ data: { influencerId: inf.id, amountCents: 1000, currency: "usd", status: "REJECTED", rejectedReason: "The balance includes a refunded charge still inside the hold window." } });
  ok("declined → mail", await mailPayoutDeclined(req2.id));
  m = inbox().at(-1)!;
  ok("subject with the amount, the reason in the body, the money stays in the balance",
    m.subject === "Your $10.00 payout request was declined" && strip(m.html).includes("refunded charge still inside the hold window") && /stays in your balance/.test(strip(m.html)), m.subject);

  head("4 · a dispute opens: 'on hold' with the date; lost: 'taken back' with the date");
  await accrueForInvoice(invoice("c", 7900));
  const opened = new Date("2026-09-20T00:00:00Z");
  const held = (await holdForDispute({ id: `du_${P}c`, charge: `ch_${P}c`, status: "needs_response", created: Math.floor(opened.getTime() / 1000) } as never, opened)) as { heldRows?: number };
  m = inbox().at(-1)!;
  ok(`charge.dispute.created → $15.80 on hold, dispute opened ${day(opened)}`,
    held.heldRows === 1 && m.subject === "$15.80 of your commission is on hold" && strip(m.html).includes(day(opened)) && m.to === EMAIL, m.subject);
  const n = inbox().length;
  await holdForDispute({ id: `du_${P}c`, charge: `ch_${P}c`, status: "needs_response", created: 0 } as never, opened);
  ok("a redelivered created event holds nothing new and sends nothing", inbox().length === n);
  const closed = new Date("2026-10-05T00:00:00Z");
  await settleDispute({ id: `du_${P}c`, charge: `ch_${P}c`, status: "lost", created: 0 } as never, `evt_${P}lost`, closed);
  m = inbox().at(-1)!;
  ok(`charge.dispute.closed (lost) → $15.80 taken back, dispute lost ${day(closed)}`,
    m.subject === "$15.80 of your commission was taken back" && strip(m.html).includes(day(closed)), m.subject);
  const n2 = inbox().length;
  await settleDispute({ id: `du_${P}c`, charge: `ch_${P}c`, status: "lost", created: 0 } as never, `evt_${P}lost2`, closed);
  ok("closing it again sends nothing", inbox().length === n2);
  ok("every mail went to the partner and nobody else", inbox().every((x) => x.to === EMAIL), `${inbox().length} mails`);

  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  rmSync(OUTBOX, { recursive: true, force: true });
  console.log(`      · cleaned up ${removed} partner(s) and the outbox`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\ncheck crashed:", err);
  try {
    await cleanup();
    rmSync(OUTBOX, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  await db.$disconnect();
  process.exit(2);
});
