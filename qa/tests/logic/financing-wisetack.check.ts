// The Wisetack module (lib/financing/provider + wisetack, 2026-10-28): off without all three env values; every
// Wisetack status name lands on one of ours; a webhook is believed only with a good signature.
// The HTTP shape is ASSUMED until Wisetack's partner docs — this check pins our side of it.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-wisetack.check.ts
import { getProvider } from "../../../src/lib/financing/provider";
import { LOAN_STATUS, MERCHANT_STATUS, signBody, wisetackProvider } from "../../../src/lib/financing/wisetack";
import type { LoanState, MerchantState } from "../../../src/lib/financing/state";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const MERCHANT: MerchantState[] = ["none", "started", "review", "needs_info", "approved", "declined", "paused"];
const LOAN: LoanState[] = ["sent", "started", "needs_action", "approved", "accepted", "done_asked", "paid", "declined", "expired", "canceled", "refunded"];

check("no env → no provider (financing hidden everywhere)", getProvider({} as NodeJS.ProcessEnv) === null);
check("a missing secret → no provider", getProvider({ WISETACK_API_BASE: "http://x", WISETACK_API_KEY: "k" } as unknown as NodeJS.ProcessEnv) === null);
check("all three → a provider", getProvider({ WISETACK_API_BASE: "http://x", WISETACK_API_KEY: "k", WISETACK_WEBHOOK_SECRET: "s" } as unknown as NodeJS.ProcessEnv) !== null);

check("every merchant status maps to a state of ours", Object.values(MERCHANT_STATUS).every((s) => MERCHANT.includes(s)));
check("every state of ours but 'none' has a Wisetack name", MERCHANT.filter((s) => s !== "none").every((s) => Object.values(MERCHANT_STATUS).includes(s)));
check("every loan status maps to a state of ours", Object.values(LOAN_STATUS).every((s) => LOAN.includes(s)));
check("every loan state of ours has a Wisetack name", LOAN.every((s) => Object.values(LOAN_STATUS).includes(s)));

const p = wisetackProvider({ base: "http://wisetack.test", key: "k", secret: "s" });
const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, headers: new Headers({ "x-wisetack-signature": signBody(raw, "s") }) };
};

const m = signed({ id: "ev1", type: "merchant.updated", data: { merchantRef: "m1", status: "APPROVED", requirements: [], minAmount: 50_000, maxAmount: 6_500_000, feeBps: 390, prequalUrl: "https://wisetack.test/prequal/m1" } });
const mev = p.parseWebhook(m.raw, m.headers);
check(
  "a signed merchant update → one merchant event, approved, with its limits and link",
  !!mev && mev.length === 1 && mev[0].kind === "merchant" && mev[0].id === "ev1" && mev[0].merchantRef === "m1" && mev[0].snapshot.state === "approved" && mev[0].snapshot.minMinor === 50_000 && mev[0].snapshot.maxMinor === 6_500_000 && mev[0].snapshot.feeBps === 390 && mev[0].snapshot.prequalUrl === "https://wisetack.test/prequal/m1",
  JSON.stringify(mev),
);
check("a wrong signature → refused", p.parseWebhook(m.raw, new Headers({ "x-wisetack-signature": signBody(m.raw, "other") })) === null);
check("no signature → refused", p.parseWebhook(m.raw, new Headers()) === null);
check("a body changed after signing → refused", p.parseWebhook(m.raw.replace("APPROVED", "DECLINED"), m.headers) === null);
const u = signed({ id: "ev2", type: "something.else", data: {} });
check("an event type we do not know → nothing to do", JSON.stringify(p.parseWebhook(u.raw, u.headers)) === "[]");

const at = "2026-10-28T12:00:00.000Z";
const t = signed({ id: "ev3", type: "transaction.updated", data: { transactionId: "t1", status: "SETTLED", approvedAmount: 1_400_000, fundings: [{ id: "f1", amount: 500_000, at }], expiresAt: "2027-01-26T00:00:00.000Z" } });
const tev = p.parseWebhook(t.raw, t.headers);
check(
  "a signed transaction update → a loan event with its payout",
  !!tev && tev.length === 1 && tev[0].kind === "loan" && tev[0].loanRef === "t1" && tev[0].snapshot.state === "paid" && tev[0].snapshot.approvedMinor === 1_400_000 && JSON.stringify(tev[0].snapshot.fundings) === JSON.stringify([{ id: "f1", amountMinor: 500_000, at }]) && tev[0].snapshot.expiresAt === "2027-01-26T00:00:00.000Z",
  JSON.stringify(tev),
);
const q = signed({ id: "ev4", type: "prequal.completed", data: { merchantRef: "m1", customer: { name: "Dana Reyes", phone: "+15550001111", email: null }, amount: 2_000_000 } });
const qev = p.parseWebhook(q.raw, q.headers);
check("a pre-qualified person → a prequal event", !!qev && qev[0]?.kind === "prequal" && qev[0].merchantRef === "m1" && qev[0].person.name === "Dana Reyes" && qev[0].amountMinor === 2_000_000, JSON.stringify(qev));
const batch = signed({ events: [{ id: "a", type: "merchant.updated", data: { merchantRef: "m1", status: "UNDER_REVIEW" } }, { id: "b", type: "transaction.updated", data: { transactionId: "t1", status: "AUTHORIZED", approvedAmount: 900_000 } }] });
const bev = p.parseWebhook(batch.raw, batch.headers);
check("a batch of events → each one", !!bev && bev.length === 2 && bev[0].kind === "merchant" && bev[1].kind === "loan");
check("an unknown status name is skipped, not guessed", (() => {
  const x = signed({ id: "ev5", type: "transaction.updated", data: { transactionId: "t1", status: "SOMETHING_NEW" } });
  return JSON.stringify(p.parseWebhook(x.raw, x.headers)) === "[]";
})());

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
