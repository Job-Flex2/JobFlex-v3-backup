// Paid Lead Center leads — data-level check of the unlock (lib/leadCenter/purchase).
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/lead-purchase.check.ts
//
// Drives completeLeadPurchase — the one place every route to "paid" lands
// (the card-on-file answer, the return page, both webhook events) — against
// dev.db with throwaway organizations, removed at the end, pass or fail.
// No network: the Stripe client is the file-backed mock (it has no refunds,
// so the refund path is checked for what it must do when Stripe fails), mail
// and texts are switched off.
//
// Covered:
//   1. a paid offer opens: the lead (contacts + scope) is the shop's, CLAIMED;
//      the offer is ACCEPTED with unlockedAt; the platform lead is MATCHED
//   2. the record: PaymentIntent id, amount, date, organization, payer, mode
//   3. the shop's books: one "Lead purchase" expense, APPROVED, the amount
//   4. idempotent: the same payment again (webhook after the sync answer)
//      changes nothing — one lead, one expense
//   5. concurrent: two deliveries at once still make one lead, one expense
//   6. a payment that clears after the 24h window, the lead still unplaced,
//      is honoured
//   7. a payment for a lead another shop holds is not handed over; when the
//      refund cannot be made, nothing is recorded, so a retry refunds
//   8. the admin ledger finds the payment by platform lead
import "../_lib/_server-only";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Before the app's modules load: no mail, no texts, Stripe = the mock.
for (const k of ["SMTP_HOST", "SMTP_USER", "RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) process.env[k] = "";
const mockDir = mkdtempSync(join(tmpdir(), "jf-lead-purchase-"));
process.env.STRIPE_MOCK_FILE = join(mockDir, "stripe.json");
writeFileSync(process.env.STRIPE_MOCK_FILE, "{}");

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TAG = "qa-leadpay";

let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
};

async function makeOrg(name: string) {
  return db.organization.create({
    data: {
      name: `${TAG} ${name}`,
      slug: `${TAG}-${name.toLowerCase()}-${Date.now()}`,
      leadOffersEnabled: true,
      lat: 47.68,
      lng: -122.2,
      tradeTypesJson: JSON.stringify(["Roofing"]),
    },
  });
}

async function makeOffer(orgId: string, opts: { priceCents: number; status?: string; expiresAt?: Date; plStatus?: string; matchedOrgId?: string }) {
  const pl = await db.platformLead.create({
    data: {
      name: `${TAG} homeowner`,
      email: "qa-leadpay@example.test",
      address: "12621 NE 100th Pl",
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      detectedTrade: "Roofing",
      scope: "Tear off and replace an asphalt shingle roof, about 1,800 sq ft.",
      status: opts.plStatus ?? "OFFERED",
      matchedOrgId: opts.matchedOrgId ?? null,
      priceCents: opts.priceCents,
      attemptCount: 1,
    },
  });
  const offer = await db.leadOffer.create({
    data: {
      platformLeadId: pl.id,
      organizationId: orgId,
      attempt: 1,
      score: 0.8,
      status: opts.status ?? "OFFERED",
      priceCents: opts.priceCents,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 24 * 3600_000),
    },
  });
  return { pl, offer };
}

async function cleanup() {
  const orgs = await db.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  const pls = await db.platformLead.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const offers = await db.leadOffer.findMany({ where: { platformLeadId: { in: pls.map((p) => p.id) } }, select: { id: true } });
  await db.syncState.deleteMany({ where: { key: { in: offers.map((o) => `leadPurchase:${o.id}`) } } });
  await db.leadOffer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
  await db.platformLead.deleteMany({ where: { id: { in: pls.map((p) => p.id) } } });
  await db.jobExpense.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.lead.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
}

async function main() {
  const { completeLeadPurchase, readPurchase, purchasesByPlatformLead, LEAD_EXPENSE_PURPOSE } = await import(
    "../../../src/lib/leadCenter/purchase"
  );
  await cleanup();
  const shop = await makeOrg("Shop");
  const other = await makeOrg("Other");
  const fact = (offerId: string, pi: string, amountCents = 4500) => ({
    offerId,
    paymentIntentId: pi,
    amountCents,
    currency: "usd",
    mode: "test" as const,
    checkoutSessionId: null,
    payerUserId: null,
    receiptEmail: "payer@example.test",
    via: "card-on-file" as const,
  });

  // ── 1–3 · a paid offer opens ─────────────────────────────────────────────
  console.log("\nA paid offer opens the lead:");
  const a = await makeOffer(shop.id, { priceCents: 4500 });
  const res = await completeLeadPurchase(fact(a.offer.id, "pi_qa_paid_1"));
  const offerA = await db.leadOffer.findUnique({ where: { id: a.offer.id } });
  const plA = await db.platformLead.findUnique({ where: { id: a.pl.id } });
  const leadA = res.leadId ? await db.lead.findUnique({ where: { id: res.leadId } }) : null;
  check("unlocked", res.status === "unlocked" && !!res.leadId, res.status);
  check("the lead is the shop's, CLAIMED, with contacts and scope", leadA?.organizationId === shop.id && leadA?.status === "CLAIMED" && leadA?.email === "qa-leadpay@example.test" && leadA?.address === "12621 NE 100th Pl" && !!leadA?.scope);
  check("offer ACCEPTED with unlockedAt", offerA?.status === "ACCEPTED" && !!offerA?.unlockedAt);
  check("platform lead MATCHED to the shop", plA?.status === "MATCHED" && plA?.matchedOrgId === shop.id && plA?.matchedLeadId === res.leadId);
  const rec = await readPurchase(a.offer.id);
  check(
    "record: PaymentIntent, amount, date, organization",
    rec?.paymentIntentId === "pi_qa_paid_1" && rec?.amountCents === 4500 && rec?.organizationId === shop.id && !!rec?.paidAt && rec?.mode === "test" && rec?.leadId === res.leadId,
  );
  const exp = await db.jobExpense.findMany({ where: { organizationId: shop.id } });
  check(
    "one 'Lead purchase' expense, APPROVED, $45",
    exp.length === 1 && exp[0].category === "Lead purchase" && exp[0].purpose === LEAD_EXPENSE_PURPOSE && exp[0].status === "APPROVED" && exp[0].amount === 45 && exp[0].jobId === null,
    JSON.stringify(exp.map((e) => [e.category, e.status, e.amount])),
  );

  // ── 4 · idempotent ───────────────────────────────────────────────────────
  console.log("\nThe same payment again changes nothing:");
  const again = await completeLeadPurchase({ ...fact(a.offer.id, "pi_qa_paid_1"), via: "checkout" });
  check("answers 'already' with the same lead", again.status === "already" && again.leadId === res.leadId);
  check("still one lead, one expense", (await db.lead.count({ where: { organizationId: shop.id } })) === 1 && (await db.jobExpense.count({ where: { organizationId: shop.id } })) === 1);

  // ── 5 · concurrent ───────────────────────────────────────────────────────
  console.log("\nTwo deliveries at once:");
  const c = await makeOffer(shop.id, { priceCents: 2500 });
  const both = await Promise.allSettled([
    completeLeadPurchase(fact(c.offer.id, "pi_qa_conc", 2500)),
    completeLeadPurchase(fact(c.offer.id, "pi_qa_conc", 2500)),
  ]);
  const leadsC = await db.lead.count({ where: { organizationId: shop.id } });
  const expC = await db.jobExpense.count({ where: { organizationId: shop.id } });
  check("one lead and one expense more", leadsC === 2 && expC === 2, `leads ${leadsC}, expenses ${expC}, ${both.map((b) => b.status).join("/")}`);
  const ids = both.map((b) => (b.status === "fulfilled" ? b.value.leadId : null));
  check("both deliveries answer with the same lead (no false 'unavailable')", !!ids[0] && ids[0] === ids[1], JSON.stringify(ids));

  // ── 6 · lapsed but unplaced ──────────────────────────────────────────────
  console.log("\nPaid a minute after the window closed:");
  const l = await makeOffer(shop.id, { priceCents: 3000, status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000), plStatus: "MANUAL_QUEUE" });
  const lap = await completeLeadPurchase(fact(l.offer.id, "pi_qa_lapsed", 3000));
  check("honoured — the lead opens", lap.status === "unlocked" && !!lap.leadId, lap.status);

  // ── 7 · another shop holds it ────────────────────────────────────────────
  console.log("\nPaid for a lead another shop already holds:");
  const t = await makeOffer(shop.id, { priceCents: 4000, status: "CANCELLED", plStatus: "MATCHED", matchedOrgId: other.id });
  let threw = false;
  try {
    await completeLeadPurchase(fact(t.offer.id, "pi_qa_taken", 4000));
  } catch {
    threw = true; // the mock has no refunds: the refund fails, loudly
  }
  const recT = await readPurchase(t.offer.id);
  check("not handed over: no lead for the paying shop", (await db.lead.count({ where: { organizationId: shop.id } })) === 3);
  check("refund failed → error raised and no record left (a retry refunds)", threw && recT === null);

  // ── 8 · admin ledger ─────────────────────────────────────────────────────
  console.log("\nThe admin ledger:");
  const ledger = await purchasesByPlatformLead([a.pl.id, t.pl.id]);
  check("finds the paid lead, not the unpaid one", ledger.get(a.pl.id)?.paymentIntentId === "pi_qa_paid_1" && !ledger.has(t.pl.id));

  await cleanup();
  console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
