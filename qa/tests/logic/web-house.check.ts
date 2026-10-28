// The house shop (lib/webEstimator, 2026-10-28): the website estimators in house mode — JobFlex as the shop behind the
// reserved `jobflex` slug, every trade on but the roof, a range, its own ceilings. Pure parts only; the slug lookup
// and the gates are walked on the stand.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/web-house.check.ts
import { HANDOFF_WORDS, HOUSE_HOURLY, HOUSE_MONTHLY_CAP, HOUSE_NAME, HOUSE_SLUG, SHOP_HOURLY, WEB_TRADES, houseSettings, houseShop, isHouse, pageWords, shopHourly } from "../../../src/lib/webEstimator";
import { LEAD_CONSENT_TEXT } from "../../../src/lib/leadConsent";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const s = houseSettings();
check("the house slug and name are reserved", HOUSE_SLUG === "jobflex" && HOUSE_NAME === "JobFlex");
check(
  "every trade on but the roof, a range, the default spread, the email asked, no domains, 2,000 a month",
  WEB_TRADES.every((t) => s.trades[t].on === (t !== "roof") && s.trades[t].show === "range" && s.trades[t].spread === 0.12 && s.trades[t].askEmail && s.trades[t].note === "" && s.trades[t].materials.length === 0) &&
    s.domains.length === 0 && s.monthlyCap === HOUSE_MONTHLY_CAP && HOUSE_MONTHLY_CAP === 2000,
  JSON.stringify(s),
);
const h = houseShop("org_house");
check(
  "the house shop is JobFlex on the house org, no logo, no phone, no website, no state, the house settings",
  h.id === "org_house" && h.name === "JobFlex" && h.slug === "jobflex" && h.logoUrl === null && h.primaryColor === null && h.phone === null && h.website === null && h.state === null && JSON.stringify(h.settings) === JSON.stringify(s),
);
check("isHouse by the slug alone", isHouse(h) && !isHouse({ slug: "ridgeline-roofing" }) && !isHouse({ slug: "jobflex-roofing" }));
check(
  "the house's hourly ceilings are its own; a shop keeps today's",
  JSON.stringify(shopHourly(h)) === JSON.stringify(HOUSE_HOURLY) && HOUSE_HOURLY.estimates === 600 && HOUSE_HOURLY.leads === 120 && JSON.stringify(shopHourly({ slug: "x" })) === JSON.stringify(SHOP_HOURLY) && SHOP_HOURLY.estimates === 120 && SHOP_HOURLY.leads === 60,
);

// ── the buyer's hand-off (Task 4): the lead page's words say the estimator opens priced ──
check("the hand-off words say the estimator opens priced", /priced in your book/.test(HANDOFF_WORDS.fence) && /tier they picked/.test(HANDOFF_WORDS.hvac) && /lines they were priced on/.test(HANDOFF_WORDS.smart), JSON.stringify([HANDOFF_WORDS.fence, HANDOFF_WORDS.hvac, HANDOFF_WORDS.smart]));

// ── the page's words (Task 5): a shop's page names the shop; the house's names a local pro and the Lead Center's consent ──
const pw = pageWords({ name: "Ridgeline Roofing" }, "fence"), hw = pageWords({ name: "JobFlex", house: true }, "fence");
check(
  "a shop's page words name the shop",
  pw.sees === "No account, no payment. Ridgeline Roofing sees your request only when you send it." &&
    pw.quote === "The full, line-by-line quote comes from Ridgeline Roofing after they look at it. You pick a time; they confirm the price." &&
    pw.consent === "Ridgeline Roofing may call, text or email me about this fence." &&
    pw.foot === "Estimates by JobFlex for Ridgeline Roofing. No prices are shown to anyone else; the final price follows a visit." &&
    pw.call === "Call Ridgeline Roofing and they will price it in person." && pw.who === "Ridgeline Roofing",
  JSON.stringify(pw),
);
check(
  "the house's page words: a local pro, the Lead Center's consent, no shop",
  hw.sees === "No account, no payment. JobFlex sends your request to a local pro only when you send it." &&
    hw.quote === "The full, line-by-line quote comes from a local pro after they look at it. You pick a time; they confirm the price." &&
    hw.consent === LEAD_CONSENT_TEXT &&
    hw.foot === "Estimates by JobFlex. No prices are shown to anyone else; a local pro confirms on site." &&
    hw.call === "Describe it instead and a local pro prices it." && hw.who === "a local pro",
  JSON.stringify(hw),
);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
