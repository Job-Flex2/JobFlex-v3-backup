// Synthetic check of the fields a fix can ask for (lib/hvac/fieldSpecs) — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-fieldspecs.check.ts
// Every model path a check's plan can name (lib/hvac/fixes) has a control the design
// step can draw inside the row; the numeric selects say so; the area field says so.
import { readFileSync } from "node:fs";
import { FIX_FIELDS, fixFieldSpec } from "../../../src/lib/hvac/fieldSpecs";

let failures = 0, passes = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passes++; else failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

const fixes = readFileSync(new URL("../../../src/lib/hvac/fixes.ts", import.meta.url), "utf8");
const named = Array.from(new Set(Array.from(fixes.matchAll(/field\("([^"]+)"/g)).map((m) => m[1])));
ok("The plans name a handful of fields", named.length >= 12, `${named.length}: ${named.join(", ")}`);
const missing = named.filter((p) => !fixFieldSpec(p));
ok("Every field a plan can name has a control", missing.length === 0, missing.join(", "));
ok("Selects carry their options, numbers and text none", Object.entries(FIX_FIELDS).every(([, s]) => (s.kind === "select" ? !!s.options?.length : !s.options)));
ok("The amperage and pipe selects are numeric", FIX_FIELDS["electrical.mainAmps"].numeric === true && FIX_FIELDS["gas.pipeIn"].numeric === true && !FIX_FIELDS["ducts.condition"].numeric);
ok("The return grille multiplies W×H", FIX_FIELDS["ducts.returnGrilleSqIn"].area === true);
ok("Labels match the intake step's words", FIX_FIELDS["electrical.mainAmps"].label === "Main breaker" && FIX_FIELDS["ducts.supplyTrunk"].label === "Supply trunk (Ø or W×H, in)");
ok("An unknown path has no control (the page falls back to the jump)", fixFieldSpec("nope.nothing") === undefined);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
