// The house shop (lib/webEstimator, 2026-10-28): the website estimators in house mode — JobFlex as the shop behind the
// reserved `jobflex` slug, every trade on but the roof, a range, its own ceilings. Pure parts only; the slug lookup
// and the gates are walked on the stand.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/web-house.check.ts
import { HOUSE_HOURLY, HOUSE_MONTHLY_CAP, HOUSE_NAME, HOUSE_SLUG, SHOP_HOURLY, WEB_TRADES, houseSettings, houseShop, isHouse, shopHourly } from "../../../src/lib/webEstimator";

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

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
