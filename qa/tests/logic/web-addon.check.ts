// The website estimator add-ons' money rules (lib/webAddon): kinds, prices, lines told by jfKind, the record, the
// billing mode from a subscription row, and the one rule that says whether a trade serves the public.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/web-addon.check.ts
import {
  dollars,
  isWebAddonLine,
  parseWebAddonRecord,
  recordFromSubscription,
  webAddonCents,
  webAddonKind,
  webAddonName,
  webAddonPriceWords,
  webBillingMode,
  webBillingWords,
  webLineHeld,
  webModeBills,
  webTradeOfLine,
  webTradeServes,
} from "../../../src/lib/webAddon";
import { isDeckAddonLine, planLine, planLines } from "../../../src/lib/deckAddon";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

check("kinds and names", webAddonKind("roof") === "web-roof" && webAddonKind("deck") === "web-deck" && webAddonName("hvac") === "JobFlex HVAC estimator on your website");
check("the owner's prices", webAddonCents("deck") === 15000 && webAddonCents("roof") === 17900 && webAddonCents("hvac") === 7900 && webAddonCents("fence") === 9900);
check("a year is ten months", webAddonCents("roof", "YEAR") === 179000 && webAddonCents("hvac", "YEAR") === 79000);
check("dollars", dollars(17900) === "$179" && dollars(6130) === "$61.30" && dollars(179000) === "$1,790");
check("price words", webAddonPriceWords(17900) === "$179/mo" && webAddonPriceWords(179000, "YEAR") === "$1,790/yr" && webAddonPriceWords(7900, "MONTH", true) === "$79 a month");

const plan = { id: "si_plan", price: { id: "price_plan", unit_amount: 9500, recurring: { interval: "month" }, metadata: { planSlug: "professional" } } };
const roof = { id: "si_roof", price: { id: "price_roof", unit_amount: 17900, recurring: { interval: "month" }, metadata: { jfKind: "web-roof", interval: "MONTH" } } };
const deck = { id: "si_deck", price: { id: "price_deck", unit_amount: 7900, recurring: { interval: "month" }, metadata: { jfKind: "deck-addon" } } };
const odd = { id: "si_odd", price: { id: "price_odd", unit_amount: 100, recurring: { interval: "month" }, metadata: { jfKind: "web-lawn" } } };
check("a line is told by its kind", webTradeOfLine(roof) === "roof" && isWebAddonLine(roof) && !isWebAddonLine(plan) && !isWebAddonLine(deck) && webTradeOfLine(odd) === null && webTradeOfLine(null) === null);
check("the plan's lines leave every add-on out", planLines([plan, roof, deck]).length === 1 && planLine([roof, deck, plan])?.id === "si_plan" && planLine([roof])?.id === "si_roof" && isDeckAddonLine(deck));

{
  const now = "2026-10-27T20:00:00.000Z";
  const r = recordFromSubscription({ id: "sub_1", items: [plan, roof, deck] }, null, now);
  check("the record from a subscription", !!r && r.subId === "sub_1" && r.interval === "MONTH" && r.lines.roof?.itemId === "si_roof" && r.lines.roof.cents === 17900 && r.lines.roof.since === now && !r.lines.deck);
  const later = recordFromSubscription({ id: "sub_1", items: [plan, roof, { ...roof, id: "si_hvac", price: { ...roof.price, id: "price_hvac", unit_amount: 7900, metadata: { jfKind: "web-hvac" } } }] }, r, "2026-11-01T00:00:00.000Z");
  check("a line kept keeps its since; a new one dates today", later?.lines.roof?.since === now && later?.lines.hvac?.since === "2026-11-01T00:00:00.000Z");
  const yearly = recordFromSubscription({ id: "sub_2", items: [{ ...plan, price: { ...plan.price, recurring: { interval: "year" } } }, { ...roof, price: { ...roof.price, unit_amount: 179000 } }] }, r, now);
  check("a new subscription: its own term, no inherited since", yearly?.subId === "sub_2" && yearly.interval === "YEAR" && yearly.lines.roof?.cents === 179000 && yearly.lines.roof.since === now);
  check("no website line → no record", recordFromSubscription({ id: "sub_1", items: [plan, deck] }, r, now) === null);
  const parsed = parseWebAddonRecord(JSON.stringify(r));
  check("the record round-trips", !!parsed && parsed.lines.roof?.itemId === "si_roof" && parsed.interval === "MONTH");
  check("a bad record is null", parseWebAddonRecord("{}") === null && parseWebAddonRecord("nope") === null && parseWebAddonRecord(null) === null);
  check("held only on the current subscription", !!webLineHeld(r, "sub_1", "roof") && !webLineHeld(r, "sub_9", "roof") && !webLineHeld(r, "sub_1", "hvac") && !webLineHeld(null, "sub_1", "roof"));
}

const stripeOn = { open: true, onFree: false, stripeEnabled: true };
check("preview while the switch is off", webBillingMode({ status: "ACTIVE", provider: "STRIPE", externalSubId: "sub_1" }, { ...stripeOn, open: false }) === "preview");
check("free plan / no row", webBillingMode(null, stripeOn) === "free" && webBillingMode({ status: "TRIAL_ENDED", provider: "STRIPE", externalSubId: null }, { ...stripeOn, onFree: true }) === "free");
check("complimentary = grant", webBillingMode({ status: "ACTIVE", provider: "MANUAL", externalSubId: null }, stripeOn) === "grant");
check("card-less trial", webBillingMode({ status: "TRIALING", provider: "STRIPE", externalSubId: null }, stripeOn) === "trial-cardless");
check("card trial", webBillingMode({ status: "TRIALING", provider: "STRIPE", externalSubId: "sub_1" }, stripeOn) === "trial-card");
check("live card plan", webBillingMode({ status: "ACTIVE", provider: "STRIPE", externalSubId: "sub_1" }, stripeOn) === "card");
check("no stripe here = offline", webBillingMode({ status: "ACTIVE", provider: "STRIPE", externalSubId: "sub_1" }, { ...stripeOn, stripeEnabled: false }) === "offline" && webBillingMode({ status: "ACTIVE", provider: "PAYPAL", externalSubId: "x" }, stripeOn) === "offline");
check("which modes put a line on", webModeBills("card") && webModeBills("trial-card") && !webModeBills("grant") && !webModeBills("trial-cardless") && !webModeBills("preview"));

check("off never serves", !webTradeServes({ open: false, on: false, mode: "preview", held: false }) && !webTradeServes({ open: true, on: false, mode: "card", held: true }));
check("preview serves on", webTradeServes({ open: false, on: true, mode: "preview", held: false }));
check("open: card needs the line", !webTradeServes({ open: true, on: true, mode: "card", held: false }) && webTradeServes({ open: true, on: true, mode: "card", held: true }));
check("open: a card trial needs the line too", !webTradeServes({ open: true, on: true, mode: "trial-card", held: false }) && webTradeServes({ open: true, on: true, mode: "trial-card", held: true }));
check("open: card-less trial and a grant serve", webTradeServes({ open: true, on: true, mode: "trial-cardless", held: false }) && webTradeServes({ open: true, on: true, mode: "grant", held: false }));
check("open: free and offline never serve", !webTradeServes({ open: true, on: true, mode: "free", held: false }) && !webTradeServes({ open: true, on: true, mode: "offline", held: true }));

const w = (mode: Parameters<typeof webBillingWords>[0]["mode"], held: { itemId: string; cents: number; since: string } | null = null) =>
  webBillingWords({ mode, trade: "roof", interval: "MONTH", held, on: true, trialEndsAt: "2026-11-14T00:00:00.000Z" });
check("words: preview", w("preview") === "$179 a month · preview, not billed");
check("words: card, not held", /\$179 a month, added to your plan/.test(w("card")));
check("words: card, held at its own price", /On your plan · \$149 a month since October 2/.test(w("card", { itemId: "si", cents: 14900, since: "2026-10-02T12:00:00.000Z" })));
check("words: card trial", /Free until your trial ends November 1[34], then \$179 a month/.test(w("trial-card")));
check("words: card-less trial", /Free during your trial \(ends November 1[34]\) · \$179 a month after it/.test(w("trial-cardless")));
check("words: free / grant / offline", /pick a plan/.test(w("free")) && /complimentary/.test(w("grant")) && /write to us/i.test(w("offline")));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
