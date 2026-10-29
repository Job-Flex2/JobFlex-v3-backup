// The estimators' cards (components/v3/price-my-project/cards, 2026-10-28; in the homeowner portal since the same day):
// the roof prices itself always; the other four describe themselves until the Lead Center names the house org, then
// they run the house estimators — every one at /homeowner/price/<trade>.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/price-cards.check.ts
import { priceCards } from "../../../src/components/v3/price-my-project/cards";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const off = priceCards(false), on = priceCards(true);
check("five cards, the roof first and live either way", off.length === 5 && on.length === 5 && off[0].key === "roof" && off[0].href === "/homeowner/price/roof" && off[0].live && on[0].href === "/homeowner/price/roof" && on[0].live);
check("no house: the four describe themselves", off.slice(1).every((c) => !c.live && /^\/homeowner/.test(c.href)), JSON.stringify(off.map((c) => c.href)));
check(
  "the house set: deck, fence, heating & cooling and any project run the house estimators",
  on.map((c) => c.href).slice(1).join() === "/homeowner/price/deck,/homeowner/price/fence,/homeowner/price/hvac,/homeowner/price/smart" &&
    on.slice(1).every((c) => c.live) && on[1].go === "Design my deck" && on[2].go === "Price my fence" && on[3].go === "Price my new system" && on[4].go === "Price my project",
  JSON.stringify(on.map((c) => [c.href, c.go])),
);
check("each card names its portal estimator", on.map((c) => c.trade).join() === "roof,deck,fence,hvac,smart" && off.map((c) => c.trade).join() === "roof,deck,fence,hvac,smart");
check("the keys and titles are the same either way", off.map((c) => c.key + ":" + c.title).join() === on.map((c) => c.key + ":" + c.title).join());

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
