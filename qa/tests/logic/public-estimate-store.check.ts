// The public roof read's cache (lib/publicEstimate/store, 2026-10-27): one Solar call per address per 30 days,
// whoever asks. Pure parts only — the SyncState reads and writes are walked on the stand.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/public-estimate-store.check.ts
import { PUBROOF_TTL_MS, cacheFresh, cacheable, inUs, pubRoofKey } from "../../../src/lib/publicEstimate/store";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const now = new Date("2026-10-27T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86400_000).toISOString();

const at = { address: " 418 Linden Ave ", city: "buffalo", state: "NY", zip: "14216", lat: 42.948, lng: -78.853 };
check("the cache key is the EagleView address key and the pin to 11 m, under pubroof:", pubRoofKey(at) === "pubroof:418 LINDEN AVE|BUFFALO|NY|14216|42.9480,-78.8530", pubRoofKey(at));
check("the same pick again is the same key; a pin dragged 55 m onto the house next door is another read", pubRoofKey({ ...at, lat: 42.94800001 }) === pubRoofKey(at) && pubRoofKey({ ...at, lat: 42.9485 }) !== pubRoofKey(at) && pubRoofKey({ ...at, address: "9 Elm St" }) !== pubRoofKey(at));
check("a pin outside the US is refused before any read", inUs(42.948, -78.853) && inUs(21.3, -157.8) && inUs(61.2, -149.9) && !inUs(51.5, -0.1) && !inUs(19.4, -99.1) && !inUs(0, 0));
check("a row is fresh for 30 days, stale after; no row is not fresh", cacheFresh({ v: 1, at: d(-29), solar: null, error: "x" }, now) && !cacheFresh({ v: 1, at: d(-31), solar: null, error: "x" }, now) && !cacheFresh(null, now) && PUBROOF_TTL_MS === 30 * 86400_000);
check("a read is cached; a no-coverage answer is cached (asking again changes nothing); a timeout is not", cacheable("ok") && cacheable("no-coverage") && cacheable("error") && !cacheable("timeout") && !cacheable("config"));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
