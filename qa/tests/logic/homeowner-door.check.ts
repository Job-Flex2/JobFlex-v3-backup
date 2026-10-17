// The homeowner's door on a contractor page (2026-10-16, lib/home/homeownerDoor): every trade's landing and sign-up
// sends a homeowner to /homeowner with their project started in their words; a page with no trade has no door.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/homeowner-door.check.ts
import { homeTradeKey, homeownerDoorFor, projectStarter } from "../../../src/lib/home/homeownerDoor";
import { VARIANT_KEYS, VARIANT_TRADE } from "../../../src/components/v3/landing-e/landing-variants";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
check("every landing trade has a door", VARIANT_KEYS.every((k) => !!homeownerDoorFor(k)), VARIANT_KEYS.filter((k) => !homeownerDoorFor(k)).join(", "));
check("…found by the sign-up's trade name too", Object.values(VARIANT_TRADE).every((t) => !!homeownerDoorFor(t)), Object.values(VARIANT_TRADE).filter((t) => !homeownerDoorFor(t)).join(", "));
check("Kitchen & Bath, General Contractor and HVAC normalise", homeTradeKey("Kitchen & Bath") === "kitchen-bath" && homeTradeKey("General Contractor") === "general-contractor" && homeTradeKey("HVAC") === "hvac" && homeTradeKey("fencing") === "fencing");
const fence = homeownerDoorFor("Fencing");
check("the fence door: its words and where it leads", fence?.thing === "a fence" && fence.href === "/homeowner?project=fencing", JSON.stringify(fence));
check("no trade, no door — the default page stays as it was", homownerNull());
check("the homeowner's request starts in their words", projectStarter("fencing") === "I'm looking for a fence. " && projectStarter("kitchen-bath") === "I'm looking for a kitchen or bath remodel. ");
check("an unknown project starts nothing", projectStarter("piano-moving") === "" && projectStarter(null) === "" && projectStarter("<script>") === "");
function homownerNull() {
  return homeownerDoorFor(undefined) === null && homeownerDoorFor("") === null && homeownerDoorFor("default") === null;
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
