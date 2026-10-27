// The public roof read's cache (lib/publicEstimate/store, 2026-10-27): one Solar call per address per 30 days,
// whoever asks. Pure parts only — the SyncState reads and writes are walked on the stand.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/public-estimate-store.check.ts
import { PUBROOF_TTL_MS, cacheFresh, cacheable, pubRoofKey } from "../../../src/lib/publicEstimate/store";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const now = new Date("2026-10-27T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86400_000).toISOString();

check("the cache key is the EagleView address key under pubroof:", pubRoofKey({ address: " 418 Linden Ave ", city: "buffalo", state: "NY", zip: "14216" }) === "pubroof:418 LINDEN AVE|BUFFALO|NY|14216", pubRoofKey({ address: " 418 Linden Ave ", city: "buffalo", state: "NY", zip: "14216" }));
check("a row is fresh for 30 days, stale after; no row is not fresh", cacheFresh({ v: 1, at: d(-29), solar: null, error: "x" }, now) && !cacheFresh({ v: 1, at: d(-31), solar: null, error: "x" }, now) && !cacheFresh(null, now) && PUBROOF_TTL_MS === 30 * 86400_000);
check("a read is cached; a no-coverage answer is cached (asking again changes nothing); a timeout is not", cacheable("ok") && cacheable("no-coverage") && cacheable("error") && !cacheable("timeout") && !cacheable("config"));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
