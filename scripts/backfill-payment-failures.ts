// FAILED PLAN PAYMENTS OF THE LAST 90 DAYS → PaymentFailure (owner, 2026-10-21).
//
//   STRIPE_TEST_SECRET_KEY=sk_test_… npx tsx --tsconfig tsconfig.json scripts/backfill-payment-failures.ts           # dry run
//   STRIPE_TEST_SECRET_KEY=sk_test_… npx tsx --tsconfig tsconfig.json scripts/backfill-payment-failures.ts --write   # write
//   [--days 90]
//
// TEST MODE ONLY (owner, 2026-10-21): this script never touches the live
// Stripe account. The key is read from STRIPE_TEST_SECRET_KEY alone (never
// STRIPE_SECRET_KEY) and must start with sk_test_ — any other key ends the run
// with an error before anything is read, dry run included. The database must
// be a local SQLite file. A production backfill is a separate decision of the
// owner and is not this script.
//
// The webhook records every declined try from now on (lib/paymentFailures);
// this fills the window before it, through the SAME code — failedAttempts reads
// an invoice's tries, recordPaymentFailure writes them — so a backfilled row
// reads like a live one. Which invoices:
//   · open, uncollectible and void subscription invoices of the window that
//     Stripe tried at least once;
//   · paid ones with attempt_count > 1 (won back on a retry);
//   · every invoice behind a FAILED charge of the window — that also finds a
//     bill paid by hand after a decline (a new card from the payment banner
//     pays at once and leaves attempt_count at 1).
// An invoice that already has rows is left alone (the webhook wrote them), so
// a second run writes nothing. Each failed charge is one try, numbered in
// order; an invoice Stripe tried with no charge at all (no card on file) is
// one try with the payment intent's error. `ignored`: the invoice was never
// paid and its subscription is active or trialing — nothing was owed (a
// declined plan change). `recoveredAt`: the invoice's paid_at.
//
// DRY RUN BY DEFAULT — Stripe and the database are only read; the report says
// what --write would add. Stripe is never written. Report:
// .cache/backfill-payment-failures/report-local[-write].txt.

import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

const ROOT = path.resolve(__dirname, "..");

const OUT = path.join(ROOT, ".cache/backfill-payment-failures");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const WRITE = flag("--write");
const DAYS = Number(opt("--days") ?? 90);
if (!Number.isFinite(DAYS) || DAYS <= 0 || DAYS > 400) throw new Error("--days: 1–400");

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

async function main() {
  if (flag("--prod")) throw new Error("--prod is not supported: this script runs against Stripe TEST mode and a local database only");
  // Next's own loader: .env.local, then .env; a variable already set wins.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
  loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
  // The one key this script may use, checked before anything is read.
  const key = (process.env.STRIPE_TEST_SECRET_KEY ?? "").trim();
  if (!key.startsWith("sk_test_")) throw new Error("STRIPE_TEST_SECRET_KEY must be set to a Stripe TEST key (sk_test_…) — refusing to run");
  const url = process.env.DATABASE_URL ?? "";
  if (!/^file:/.test(url)) throw new Error("only a local SQLite database (DATABASE_URL=file:…) is allowed");
  const where = `local (${url.replace(/^file:/, "")})`;
  // Nothing the app's modules load may find a live key either.
  process.env.STRIPE_SECRET_KEY = "";
  process.env.STRIPE_SECRET_KEY_TEST = key;
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "";
  await import("./qa/_server-only");
  const { db } = await import("../src/lib/db");
  const { STRIPE_API_VERSION } = await import("../src/lib/sdk/stripe");
  const { invoiceSubscriptionId } = await import("../src/lib/stripeCompat");
  const pf = await import("../src/lib/paymentFailures");
  const { failureCode, failureLabel } = await import("../src/lib/paymentFailureShared");
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

  const since = Math.floor(Date.now() / 1000) - DAYS * 86_400;
  say(`Failed plan payments, last ${DAYS} days — ${where}, Stripe TEST, ${WRITE ? "WRITE" : "dry run"}`);
  say(`Run ${new Date().toISOString()}`);
  say();

  // ── which invoices ──────────────────────────────────
  const ids = new Set<string>();
  const why = new Map<string, string>();
  const take = (inv: Stripe.Invoice, reason: string) => {
    if (!inv.id || !invoiceSubscriptionId(inv) || (inv.amount_due ?? 0) <= 0) return;
    if (!ids.has(inv.id)) why.set(inv.id, reason);
    ids.add(inv.id);
  };
  for (const status of ["open", "uncollectible", "void"] as const) {
    for await (const inv of stripe.invoices.list({ status, created: { gte: since }, limit: 100 })) {
      if ((inv.attempt_count ?? 0) >= 1) take(inv, status);
    }
  }
  for await (const inv of stripe.invoices.list({ status: "paid", created: { gte: since }, limit: 100 })) {
    if ((inv.attempt_count ?? 0) > 1) take(inv, "paid after retries");
  }
  let failedCharges = 0;
  for await (const ch of stripe.charges.list({ created: { gte: since }, limit: 100 })) {
    if (ch.status !== "failed" || !ch.payment_intent) continue;
    failedCharges += 1;
    const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent.id;
    const pays = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 3 });
    for (const p of pays.data) {
      const invId = typeof p.invoice === "string" ? p.invoice : p.invoice?.id;
      if (!invId || ids.has(invId)) continue;
      const inv = await stripe.invoices.retrieve(invId);
      take(inv, inv.status === "paid" ? "paid after a declined charge" : `${inv.status} (charge)`);
    }
  }
  say(`${ids.size} subscription invoices with a failed try (${failedCharges} failed charges in the window).`);

  // ── each invoice ────────────────────────────────────
  type Planned = { invoiceId: string; attempt: number; failed: Awaited<ReturnType<typeof pf.failedAttempts>>["tries"][number] };
  let already = 0;
  let written = 0;
  let skipped = 0;
  const all: Array<Planned & { invoice: Stripe.Invoice; ignored: boolean; trial: boolean; org: string }> = [];
  for (const id of ids) {
    const have = await db.paymentFailure.count({ where: { stripeInvoiceId: id } }).catch((err: unknown) => {
      throw new Error(`PaymentFailure table not readable — apply prisma/sql/prod-2026-10-21-payment-failures.sql first (${err instanceof Error ? err.message : err})`);
    });
    if (have > 0) {
      already += 1;
      continue;
    }
    const attempts = await pf.failedAttempts(stripe, id);
    const invoice = attempts.invoice;
    const subId = invoiceSubscriptionId(invoice);
    const sub = subId ? await stripe.subscriptions.retrieve(subId).catch(() => null) : null;
    const ignored = invoice.status !== "paid" && Boolean(sub && (sub.status === "active" || sub.status === "trialing"));
    const trial = pf.isTrialEndInvoice(invoice, sub?.trial_end ?? null);
    const mirror = subId ? await db.subscription.findFirst({ where: { externalSubId: subId }, select: { organization: { select: { name: true } } } }) : null;
    const org = mirror?.organization.name ?? invoice.customer_name ?? invoice.customer_email ?? "(no company on record)";

    const planned: Planned[] = attempts.tries.map((t, i) => ({ invoiceId: id, attempt: i + 1, failed: t }));
    // The newest try carries the payment intent's own error (the webhook's reading).
    if (planned.length) planned[planned.length - 1].failed = pf.newestTry(attempts);
    else if ((invoice.attempt_count ?? 0) >= 1 && invoice.status !== "paid") planned.push({ invoiceId: id, attempt: invoice.attempt_count, failed: pf.newestTry(attempts, new Date(invoice.created * 1000)) });
    if (!planned.length) {
      skipped += 1;
      say(`  ${id}  ${org}: no failed try found — skipped`);
      continue;
    }
    for (const p of planned) {
      all.push({ ...p, invoice, ignored, trial, org });
      if (WRITE) {
        const r = await pf.recordPaymentFailure({ invoice, attempt: p.attempt, failed: p.failed, ignored, sub });
        if (r?.created) written += 1;
      }
    }
    const reasons = planned.map((p) => failureCode(p.failed)).join(", ");
    const card = planned[0].failed;
    say(
      `  ${day(new Date(invoice.created * 1000))}  ${id}  ${org.slice(0, 32).padEnd(32)} ${usd(invoice.amount_due).padStart(9)}  ` +
        `${planned.length} tr${planned.length === 1 ? "y" : "ies"}  ${reasons}  ${card.cardBrand ?? "?"} ${card.cardFunding}  ` +
        `${trial ? "TRIAL END  " : ""}${invoice.status}${ignored ? " (not owed)" : ""}  [${why.get(id)}]`,
    );
  }

  // ── summary ─────────────────────────────────────────
  const bills = new Map<string, (typeof all)[number][]>();
  for (const r of all) bills.set(r.invoiceId, [...(bills.get(r.invoiceId) ?? []), r]);
  const owed = [...bills.values()].filter((rs) => !rs[0].ignored);
  const count = (f: (rs: (typeof all)[number][]) => boolean) => owed.filter(f).length;
  const recovered = count((rs) => rs[0].invoice.status === "paid");
  say();
  say(`New: ${bills.size} invoices, ${all.length} tries (${bills.size - owed.length} not owed). Already on record: ${already}. Skipped: ${skipped}.`);
  say(`Missed bills: ${owed.length} · at trial end ${count((rs) => rs[0].trial)} · recovered ${recovered} (${owed.length ? Math.round((recovered / owed.length) * 100) : 0}%)`);
  const tally = (key: (rs: (typeof all)[number][]) => string) => {
    const m = new Map<string, { n: number; trial: number; paid: number }>();
    for (const rs of owed) {
      const k = key(rs);
      const c = m.get(k) ?? { n: 0, trial: 0, paid: 0 };
      c.n += 1;
      if (rs[0].trial) c.trial += 1;
      if (rs[0].invoice.status === "paid") c.paid += 1;
      m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };
  say("By reason (first try):");
  for (const [k, c] of tally((rs) => failureCode(rs[0].failed))) say(`  ${failureLabel(k).padEnd(28)} ${String(c.n).padStart(4)}   trial end ${c.trial}   recovered ${c.paid}`);
  say("By card type:");
  for (const [k, c] of tally((rs) => rs[0].failed.cardFunding)) say(`  ${k.padEnd(28)} ${String(c.n).padStart(4)}   trial end ${c.trial}   recovered ${c.paid}`);
  say();
  say(WRITE ? `Written: ${written} rows.` : "Dry run — nothing written. Add --write to record these.");

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `report-local${WRITE ? "-write" : ""}.txt`), lines.join("\n") + "\n");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
