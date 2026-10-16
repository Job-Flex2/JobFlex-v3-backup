// THE PAYMENT LETTERS (owner, 2026-10-16: "doesn't look like we're just chasing their money — they need JobFlex more
// than we need their money"): lib/email/build/billing buildPaymentFailed leads with the shop's own work, says the
// amount once in passing, and is plain about what happens next.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/payment-emails.check.ts
import { buildPaymentFailed, type ShopOnJobflex } from "../../src/lib/email/build/billing";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const shop: ShopOnJobflex = { proposalsSent: 6, quotedCents: 1840000, clients: 14, jobsOpen: 3, leadsOffered: 0 };
const tools = ["Smart proposal generation", "Roof estimator", "Fence estimator"];
const base = { name: "Jordan Rivera", planName: "Professional", amountCents: 9500, href: "https://jobflex.app/dashboard/subscription" };
const all = (d: ReturnType<typeof buildPaymentFailed>) => [d.subject, d.headline, ...(d.prose ?? []), ...(d.after ?? [])].join(" ");
const boxText = (d: ReturnType<typeof buildPaymentFailed>) => (d.box ?? []).map((r) => ("label" in r ? `${r.label}: ${"value" in r ? r.value : "chip" in r ? r.chip : ""}` : "")).join(" | ");

const first = buildPaymentFailed({ ...base, nextAttemptAt: new Date("2026-10-25T17:00:00Z"), final: false, shop, tools });
check("first letter: the subject and headline are about the shop, not the money", !/\$/.test(first.subject) && /shop/i.test(first.subject) && first.headline === "Keep your shop running" && first.cta?.label === "Keep my shop running", first.subject);
check("…the amount is said once, in passing", (all(first).match(/\$95/g) ?? []).length === 1);
check("…nothing locked, nothing lost; the shop's own numbers lead", /Nothing is locked and nothing is lost/.test(all(first)) && /6 · \$18,400 quoted/.test(boxText(first)) && /Clients: 14/.test(boxText(first)) && /Jobs on the schedule: 3/.test(boxText(first)));
check("…a zero is never shown (no leads row)", !/Homeowner leads/.test(boxText(first)));
check("…the shop is open, and the next try is dated", /Open — nothing paused/.test(boxText(first)) && /Oct 25, 2026/.test(all(first)));
check("…no 'final', 'Free' or pressure words", !/Free|final|immediately|urgent|suspend|overdue/i.test(all(first)));

const fresh = buildPaymentFailed({ ...base, nextAttemptAt: new Date("2026-10-25T17:00:00Z"), final: false, shop: { proposalsSent: 0, quotedCents: 0, clients: 0, jobsOpen: 0, leadsOffered: 0 }, tools });
check("a brand-new shop (no numbers): the plan's own tools stand in", /In Professional: Smart proposal generation, Roof estimator and Fence estimator/.test(boxText(fresh)) && /right where you left them/.test(all(fresh)));

const last = buildPaymentFailed({ ...base, nextAttemptAt: null, final: true, shop, tools });
check("last letter: 'Everything you built is still here', Professional paused, on Free for now", last.headline === "Everything you built is still here" && /paused Professional and your shop is on the Free plan for now/.test(all(last)) && !/\$/.test(last.subject));
check("…nothing deleted, clients can still open and sign what was sent", /Nothing is deleted, and your clients can still open and sign/.test(all(last)));
check("…what's paused, short in the box and named in the text", /Paused for now: 3 Professional tools/.test(boxText(last)) && /Smart proposal generation, Roof estimator and Fence estimator come straight back/.test(all(last)));
check("…the way back, and a smaller plan offered", last.cta?.label === "Turn Professional back on" && /Need something smaller/.test(all(last)));

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
