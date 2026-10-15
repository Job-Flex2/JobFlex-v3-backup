// LIVE smoke test of the county assessor layers — needs the network, not run
// by the QA suite. One known house per county (the points the layers were
// verified with); a county that stops answering shows up here first.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-assessors.live.ts
import { assessorRecordAt } from "../../../src/lib/hvac/assessors";

const POINTS: Array<[string, string, number, number, string]> = [
  ["WA", "Skagit", 48.4715, -122.332, "304 E Rio Vista Ave, Burlington"],
  ["WA", "King", 47.618, -122.165, "811 132nd Ave NE, Bellevue"],
  ["WA", "Whatcom", 48.7647, -122.4993, "2210 W North St, Bellingham"],
  ["WA", "Clark", 45.649072, -122.683478, "3715 Lavina St, Vancouver"],
  ["WA", "Thurston", 47.01662, -122.797145, "6418 37th Ln SE, Lacey"],
  ["WA", "Snohomish", 47.99334, -122.1023, "9528 3rd St SE, Lake Stevens (sold 2025)"],
];

(async () => {
  let bad = 0;
  for (const [st, county, lat, lng, label] of POINTS) {
    const t0 = Date.now();
    const r = await assessorRecordAt(st, county, lat, lng);
    const good = !!r && (r.yearBuilt !== undefined || r.livingSqft !== undefined);
    if (!good) bad++;
    console.log(`${good ? "OK  " : "MISS"} ${st}:${county.padEnd(10)} ${String(Date.now() - t0).padStart(5)} ms  ${label} → ${r ? `built ${r.yearBuilt ?? "—"} · ${r.livingSqft ?? "—"} sq ft · ${r.storeys ?? "—"} storeys · ${r.landUse ?? ""}` : "no record"}`);
  }
  console.log(bad ? `\n${bad} county layer(s) did not answer` : "\nall county layers answered");
  process.exit(bad ? 1 : 0);
})();
