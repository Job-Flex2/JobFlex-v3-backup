// The homeowner's roof read (actions/publicEstimate, 2026-10-28): many US homes have only Google's MEDIUM imagery, and
// a HIGH-only read left them on "We couldn't read your roof from the sky." The homeowner's rough range takes MEDIUM;
// the contractor's measurement still requires HIGH. A cached read from before (v 1, HIGH-only) is read again.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/public-roof-read.check.ts
import fs from "node:fs";
import path from "node:path";
import { parseBuildingInsights } from "../../../src/lib/solar";
import { estimateSolarRoof } from "../../../src/lib/roofSolarEstimate";
import { cacheFresh } from "../../../src/lib/publicEstimate/store";
import { DEFAULT_ANSWERS, homeSqftFromSize, roofFactsFromSize, roofRange } from "../../../src/lib/publicEstimate/roof";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../_lib/fixtures/solar-insights.json"), "utf8"));
const pin = { lat: 42.948, lng: -78.853 };
const now = new Date("2026-10-28T12:00:00Z");
const high = parseBuildingInsights(raw);
const medium = parseBuildingInsights({ ...raw, imageryQuality: "MEDIUM" });
const base = parseBuildingInsights({ ...raw, imageryQuality: "BASE" });

check("HIGH imagery estimates, as before", estimateSolarRoof(high, pin, now).ok);
const strict = estimateSolarRoof(medium, pin, now);
check("MEDIUM imagery is still refused by default — the contractor's measurement stays HIGH-only", !strict.ok && /High-quality/.test(strict.ok ? "" : strict.error));
const loose = estimateSolarRoof(medium, pin, now, { minQuality: "MEDIUM" });
check("…and taken for the homeowner's rough range", loose.ok && loose.estimate.imageryQuality === "MEDIUM" && loose.estimate.areaSqft > 0, loose.ok ? String(loose.estimate.areaSqft) : loose.error);
check("the same roof reads the same area at either quality", loose.ok && (estimateSolarRoof(high, pin, now) as { ok: true; estimate: { areaSqft: number } }).estimate.areaSqft === loose.estimate.areaSqft);
check("BASE imagery is refused even for the rough range", !estimateSolarRoof(base, pin, now, { minQuality: "MEDIUM" }).ok);

const at = new Date(now.getTime() - 86400_000).toISOString();
check("a cached read from before (v 1, HIGH-only) is read again; a v 2 row is fresh", !cacheFresh({ v: 1, at, solar: null, error: "x" } as never, now) && cacheFresh({ v: 2, at, solar: null, error: "x" }, now));

// ── No aerial roof at all: the home's size worked out, never asked (owner, 2026-10-28: "homeowners don't know how many
// square feet — calculate it for them"). The building's outline on the map × the floors they tapped; else the
// county's living area; else nothing (and only then is the homeowner asked).
const outline = { footprintSqft: 1800, livingSqft: null, storeys: null, source: "building outline" };
check("the outline × the floors they tapped", homeSqftFromSize(outline, 2) === 3600 && homeSqftFromSize(outline, 1) === 1800);
check("…so the roof is the outline's, whatever the floors", roofFactsFromSize(homeSqftFromSize(outline, 2)!, { ...DEFAULT_ANSWERS, storeys: 2 }, "NY").footprintSqft === 1800 && roofFactsFromSize(homeSqftFromSize(outline, 3)!, { ...DEFAULT_ANSWERS, storeys: 3 }, "NY").footprintSqft === 1800);
check("no outline: the county's living area", homeSqftFromSize({ footprintSqft: null, livingSqft: 2400, storeys: 2, source: "county record" }, 2) === 2400);
check("an outline that is not a house (a shed, a mall) gives way to the living area, or to nothing", homeSqftFromSize({ footprintSqft: 120, livingSqft: 2400, storeys: null, source: "x" }, 1) === 2400 && homeSqftFromSize({ footprintSqft: 60_000, livingSqft: null, storeys: null, source: "x" }, 1) === null);
check("nothing known: nothing (the homeowner is asked)", homeSqftFromSize(null, 1) === null && homeSqftFromSize({ footprintSqft: null, livingSqft: null, storeys: null, source: "" }, 2) === null);
const fromOutline = roofRange(roofFactsFromSize(homeSqftFromSize(outline, 1)!, DEFAULT_ANSWERS, "NY"), DEFAULT_ANSWERS, null, "size");
check("a range from the outline, from the home's size", fromOutline.basis === "size" && fromOutline.low > 0 && fromOutline.high > fromOutline.low, `${fromOutline.low}–${fromOutline.high}`);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
