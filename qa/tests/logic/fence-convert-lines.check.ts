// The package engine's lines must pass the convert action's schema — every
// control layout, every terrain, every option. No browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/fence-convert-lines.check.ts
// Added 2026-09-22 after "fence does not convert": a line with NaN, a negative
// quantity or an empty name would be refused by zod on the server, and the
// page had no way to say which one.
import { priceFencePackage } from "../../../src/lib/fence/pricing";
import { fenceConvertSchema, firstIssue } from "../../../src/lib/fence/convertSchema";
import type { FenceLayoutInput } from "../../../src/lib/fence/takeoff";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const base: FenceLayoutInput = {
  type: "cedar-privacy",
  heightFt: 6,
  runs: [{ lengthFt: 96, corners: 1 }, { lengthFt: 63, corners: 0 }],
  openings: [],
  terrain: "flat",
  wastePct: 10,
} as unknown as FenceLayoutInput;

const cases: Array<[string, Partial<FenceLayoutInput>]> = [
  ["flat control (the harness lot: 96 + 63 lf)", {}],
  ["sloped, 7 stepped sections", { terrain: "sloped", steppedSections: 7 } as Partial<FenceLayoutInput>],
  ["steep grade", { terrain: "steep" } as Partial<FenceLayoutInput>],
  ["rocky ground", { terrain: "rocky" } as Partial<FenceLayoutInput>],
  ["gates and a door", { openings: [{ kind: "gate", widthFt: 4 }, { kind: "gate", widthFt: 10 }, { kind: "door", widthFt: 3 }] } as Partial<FenceLayoutInput>],
  ["a gate with an empty label", { openings: [{ kind: "gate", widthFt: 4, label: "" }] } as Partial<FenceLayoutInput>],
  ["demolition 159 lf", { removalLf: 159 } as Partial<FenceLayoutInput>],
  ["stain + 6x6 posts", { stain: true, postUpgrade: "6x6" } as Partial<FenceLayoutInput>],
  ["steel posts, 8' spacing", { postUpgrade: "steel", postSpacingFt: 8 } as Partial<FenceLayoutInput>],
  ["tiny job under the minimum", { runs: [{ lengthFt: 6, corners: 0 }] } as Partial<FenceLayoutInput>],
  ["zero-length run (nothing traced)", { runs: [{ lengthFt: 0, corners: 0 }] } as Partial<FenceLayoutInput>],
  ["waste over the cap", { wastePct: 90 } as Partial<FenceLayoutInput>],
  ["NaN waste from a blank field", { wastePct: Number.NaN } as Partial<FenceLayoutInput>],
  ["chain link, 4 ft", { type: "chain-link", heightFt: 4 } as Partial<FenceLayoutInput>],
  ["vinyl privacy, 8 ft asked", { type: "vinyl-privacy", heightFt: 8 } as Partial<FenceLayoutInput>],
  ["negative removal (bad field)", { removalLf: -20 } as Partial<FenceLayoutInput>],
];

for (const [name, patch] of cases) {
  let pkg;
  try {
    pkg = priceFencePackage({ ...base, ...patch } as FenceLayoutInput, {});
  } catch (err) {
    ok(name, false, "engine threw: " + (err instanceof Error ? err.message : String(err)));
    continue;
  }
  const lines = pkg.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost }));
  const parsed = fenceConvertSchema.safeParse({ title: "check", materials: [], labor: [], assumptions: [], lines });
  const bad = lines.filter((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.materialCost) || !Number.isFinite(l.laborCost) || l.quantity < 0 || !l.name);
  ok(name, parsed.success && bad.length === 0, parsed.success ? `${lines.length} lines` : firstIssue(parsed.error));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
