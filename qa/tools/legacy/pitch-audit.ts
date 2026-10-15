// Measured-pitch harness: the six ledger addresses from the clone's cached
// DSM grids, zero purchases, no network. Prints measured vs Instant.
//   npx tsx qa/tools/legacy/pitch-audit.ts
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import type { InstantRoofData } from "../../../src/lib/eagleview";
import type { Raster } from "../../../src/lib/solar";
import { latLngRingToFrame } from "../../../src/lib/roofRecon/surveyDsm";
import { registerContourToRaster } from "../../../src/lib/roofRecon/register";
import { measureCoverage } from "../../../src/lib/roofRecon/coverage";
import { measurePitch } from "../../../src/lib/roofRecon/measuredPitch";
import type { FootprintPoint } from "../../../src/lib/roofRecon/footprint";

const CLONE = "c:/Projects/JobFlex-roofcore/scripts/qa/roof";
const JOBS = [
  { key: "12629", dir: `${CLONE}/fixtures/kirkland-12629-ne-100th-pl` },
  { key: "12621", dir: `${CLONE}/field/12621-ne-100th-pl-kirkland-wa` },
  { key: "12618", dir: `${CLONE}/field/12618-ne-100th-st-kirkland-wa` },
  { key: "9903", dir: `${CLONE}/field/9903-117th-pl-ne-kirkland-wa` },
  { key: "419", dir: `${CLONE}/fixtures/prairie-419-prairie-ridge-ln` },
  { key: "12117", dir: `${CLONE}/field/12117-202nd-st-se-snohomish-wa` },
];

interface Meta {
  origin: { lat: number; lng: number };
  raster: { width: number; height: number; pixelSizeM: number };
  diagnostics: { groundElevFt: number };
}

function grid(dir: string, meta: Meta, f: string): Raster {
  const buf = gunzipSync(readFileSync(resolve(dir, f)));
  const data = new Float32Array(meta.raster.width * meta.raster.height);
  Buffer.from(data.buffer).set(buf);
  return { width: meta.raster.width, height: meta.raster.height, pixelSizeM: meta.raster.pixelSizeM, data } as Raster;
}

for (const job of JOBS) {
  const meta = JSON.parse(readFileSync(resolve(job.dir, "meta.json"), "utf8")) as Meta;
  const instant = JSON.parse(readFileSync(resolve(job.dir, "instant.json"), "utf8")) as InstantRoofData;
  const dsm = grid(job.dir, meta, "dsm.f32.gz");
  const mask = grid(job.dir, meta, "mask.f32.gz");

  const rings: FootprintPoint[][] = instant.structures
    .map((st) => (st.outline && st.outline.length >= 3 ? (latLngRingToFrame(meta.origin, st.outline).ring as FootprintPoint[]) : null))
    .filter((r): r is FootprintPoint[] => r !== null);

  const reg = registerContourToRaster({ contour: rings[0], mask, dsm, groundElevFt: meta.diagnostics.groundElevFt });
  const cov = measureCoverage({ mask: mask as never, dsm: dsm as never, groundElevFt: meta.diagnostics.groundElevFt, rings });

  const pitchLabel = instant.totals.pitchLabel ?? null;
  const instantPitch12 = pitchLabel ? Number(pitchLabel.split("/")[0]) : null;
  const solarPanels = instant.structures.some((st) => st.solarPanels === true);

  const rep = measurePitch({
    dsm,
    contours: rings,
    transform: reg.applied ? reg.transform : null,
    instantPitch12,
    solarPanels,
    coverageShare: cov?.share ?? null,
  });

  console.log(
    JSON.stringify({
      key: job.key,
      instant: pitchLabel,
      source: rep.source,
      families: rep.families.map((f) => `${f.pitch12.toFixed(1)}/12 (${Math.round(f.planSqft)}sf)`),
      trustedShare: Number(rep.trustedShare.toFixed(2)),
      iqr: rep.spreadIqr12 != null ? Number(rep.spreadIqr12.toFixed(2)) : null,
      reason: rep.reason.slice(0, 110),
    }),
  );
}
