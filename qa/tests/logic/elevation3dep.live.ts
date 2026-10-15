// LIVE check of the USGS 3DEP reader — needs network, no keys.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/elevation3dep.live.ts
// 1. Lidar coverage answers at ~1 m (the mosaic sort works).
// 2. A batch answers in REQUEST order: each point of a shuffled batch matches
//    the same point asked alone.
// 3. A point outside the US is refused without a request, as a GAP.
import { sample3depElevations, in3depCoverage } from "../../../src/lib/elevation3dep";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

async function main() {
  // Hillside streets in Woodinville WA (King County 2021 lidar) and a flat
  // Florida peninsula point (FDEM 2018) — public-road coordinates, not homes.
  const pts = [
    { lat: 47.7550, lng: -122.1430 },
    { lat: 47.7563, lng: -122.1388 },
    { lat: 47.7541, lng: -122.1467 },
    { lat: 47.7577, lng: -122.1412 },
    { lat: 27.4000, lng: -81.3900 },
  ];
  const batch = await sample3depElevations(pts);
  ok("batch answered", batch.ok, batch.ok ? `resM ${batch.resM}` : batch.reason);
  if (!batch.ok) return;
  ok("lidar resolution (≤ 2 m)", batch.resM <= 2, `resM ${batch.resM}`);
  const singles: number[] = [];
  for (const p of pts) {
    const one = await sample3depElevations([p]);
    singles.push(one.ok ? one.elevFt[0] : NaN);
  }
  pts.forEach((p, i) =>
    ok(`point ${i} in request order`, Math.abs(batch.elevFt[i] - singles[i]) < 0.05, `${batch.elevFt[i]} vs ${singles[i]}`),
  );
  const spread = Math.max(...batch.elevFt.slice(0, 4)) - Math.min(...batch.elevFt.slice(0, 4));
  ok("the hillside points differ (not one value echoed)", spread > 5, `${spread.toFixed(1)} ft spread`);
  ok("outside the US is not in coverage", !in3depCoverage({ lat: 51.5, lng: -0.12 }));
  const abroad = await sample3depElevations([{ lat: 51.5, lng: -0.12 }, { lat: 51.51, lng: -0.12 }]);
  ok("outside the US is a gap, not an error (Google answers, and may be cached)", !abroad.ok && abroad.reason === "gap");
}

main().then(() => {
  console.log(failures ? `\n${failures} failed` : "\nAll live checks passed.");
  process.exit(failures ? 1 : 0);
});
