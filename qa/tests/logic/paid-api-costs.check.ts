// The paid-API cost table (lib/paidApiCosts): what each outside call costs us, per unit. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/paid-api-costs.check.ts
import { UNIT_CENTS, unitCents } from "../../../src/lib/paidApiCosts";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// EagleView (owner, 2026-10-26): $2.40 a whole roof measured, whatever packs it takes — not the old placeholder
// of $5 a pack. The full report is a separate, separately priced product.
check("EagleView is priced per whole roof at the contract price; the full report is its own product", UNIT_CENTS.eagleview.roof === 240 && !("pack" in UNIT_CENTS.eagleview) && UNIT_CENTS.eagleview.report > 0, JSON.stringify(UNIT_CENTS.eagleview));
check("…and unitCents reads it", unitCents("eagleview", "roof") === 240 && unitCents("eagleview", "roof", 3) === 720);
check("an op nobody bills costs nothing", unitCents("eagleview", "pack") === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
