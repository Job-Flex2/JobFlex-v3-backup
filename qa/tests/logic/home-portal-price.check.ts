// ONE HOMEOWNER PORTAL (lib/home/portalPrice, 2026-10-28): the box points the homeowner's words at the estimator that
// prices them, only the estimators that are on; the old pricing addresses forward into the portal.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/home-portal-price.check.ts
import { PRICE_NUDGE, PORTAL_TRADES, isPortalTrade, movedPricePath, portalHeroSub, portalPriceHref, priceTradeFor } from "../../../src/lib/home/portalPrice";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const on = (t: string) => priceTradeFor(t, true);
const off = (t: string) => priceTradeFor(t, false);

check("a roof, in a homeowner's words", on("My roof is 15 years old and leaking around the chimney after storms") === "roof" && on("need new shingles") === "roof" && on("Re-roofing a ranch house") === "roof");
check("the roof is priced even with the house estimators off", off("My roof is leaking") === "roof");
check("a deck, a pergola, a gazebo → Deck Studio", on("Build a 12x16 composite deck off the back door") === "deck" && on("a pergola over the patio") === "deck" && on("gazebo in the yard") === "deck");
check("a fence", on("Replace 150 ft of cedar fencing with vinyl") === "fence" && on("new fence and a gate") === "fence");
check("heating and cooling", on("Our furnace is 20 years old") === "hvac" && on("add a heat pump") === "hvac" && on("AC unit stopped working") === "hvac" && on("central air for a 2,000 sq ft house") === "hvac" && on("ductless mini-split in the garage") === "hvac");
check("kitchens, baths, remodels → any project", on("I want to remodel my 12x14 kitchen with shaker cabinets") === "smart" && on("Redo the main bathroom shower") === "smart" && on("Paint the living room and hallway") === "smart" && on("finish the basement") === "smart");
check("off, only the roof: the others are words for the intake", off("Build a deck") === null && off("new fence") === null && off("our furnace") === null && off("remodel the kitchen") === null);
check("too short or nothing to price", on("") === null && on("hi") === null && on("fix the leak under the sink") === null && on("a gate latch") === null);
check("heating and cooling first: a heat pump on the roof is heating", on("put the heat pump on the roof") === "hvac");
check("every trade has its words and a portal address", PORTAL_TRADES.every((t) => isPortalTrade(t) && !!PRICE_NUDGE[t].say && !!PRICE_NUDGE[t].go && portalPriceHref(t) === `/homeowner/price/${t}`));
check("not a trade", !isPortalTrade("plumbing") && !isPortalTrade(undefined) && !isPortalTrade("any"));

check("/price → the portal", movedPricePath("/price") === "/homeowner" && movedPricePath("/price/") === "/homeowner");
check("/price/roof → the portal's roof", movedPricePath("/price/roof") === "/homeowner/price/roof");
check(
  "the house pages → the portal's estimators",
  movedPricePath("/estimate/jobflex/deck") === "/homeowner/price/deck" && movedPricePath("/estimate/jobflex/fence") === "/homeowner/price/fence" &&
    movedPricePath("/estimate/jobflex/hvac") === "/homeowner/price/hvac" && movedPricePath("/estimate/jobflex/smart") === "/homeowner/price/smart" && movedPricePath("/estimate/jobflex/roof") === "/homeowner/price/roof",
);
check("a contractor's own website estimator never moves", movedPricePath("/estimate/fancescan/deck") === null && movedPricePath("/estimate/jobflex-roofing/deck") === null && movedPricePath("/estimate/jobflex/plumbing") === null);
check("other pages never move", movedPricePath("/pricing") === null && movedPricePath("/price-book") === null && movedPricePath("/homeowner") === null && movedPricePath("/homeowner/price/roof") === null && movedPricePath("/") === null);

check("the promise names only what is on", /decks, fences, heating & cooling and remodels/.test(portalHeroSub(true)) && !/deck|fence|heating/i.test(portalHeroSub(false)) && /Roofs are priced/.test(portalHeroSub(false)));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
