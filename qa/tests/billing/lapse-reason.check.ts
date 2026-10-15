// Why a lapsed account lapsed (2026-10-05, lib/lapseReason): Stripe's own word,
// read into one sentence.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/billing/lapse-reason.check.ts
import "../_lib/_server-only";
import type Stripe from "stripe";
import { stripeLapseWords } from "../../../src/lib/lapseReason";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sub = (p: Partial<Stripe.Subscription> & { cancellation_details?: Partial<Stripe.Subscription.CancellationDetails> | null }) => ({ status: "canceled", cancellation_details: null, ...p }) as unknown as Stripe.Subscription;

check("a first payment never completed", /never completed/.test(stripeLapseWords(sub({ status: "incomplete_expired" }), false) ?? ""));
check("payments failed", /Payments failed/.test(stripeLapseWords(sub({ cancellation_details: { reason: "payment_failed" } }), false) ?? ""));
check("a dispute", /disputed/.test(stripeLapseWords(sub({ cancellation_details: { reason: "payment_disputed" } }), false) ?? ""));
check("canceled on request by the owner from Billing", stripeLapseWords(sub({ cancellation_details: { reason: "cancellation_requested" } }), true) === "The owner canceled it from their Billing page.");
check("canceled on request elsewhere names where it could have been", /billing portal, the Stripe dashboard or the admin console/.test(stripeLapseWords(sub({ cancellation_details: { reason: "cancellation_requested" } }), false) ?? ""));
const said = stripeLapseWords(sub({ cancellation_details: { reason: "cancellation_requested", feedback: "too_expensive", comment: "  Need a cheaper plan  " } }), true) ?? "";
check("the customer's feedback and comment are quoted", /reason given: too expensive/.test(said) && /“Need a cheaper plan”/.test(said), said);
check("nothing from Stripe → no sentence (the app's own record answers)", stripeLapseWords(sub({}), false) === null);

console.log(bad === 0 ? "\nAll lapse reason checks passed." : `\n${bad} lapse reason check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
