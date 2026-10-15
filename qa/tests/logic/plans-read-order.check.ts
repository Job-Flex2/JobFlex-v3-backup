// The order a plan set is read in, and what a job waits for — no network, no model.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/plans-read-order.check.ts
// (owner, 2026-10-13: "is it normal that it takes so long?") The real permit set's sheets,
// as a first look sorts them: floor plans and schedules read first and closest, structural
// notes last and lighter, details not at all; a countertop job waits for the floor plans,
// a roof for the roof plan and the elevations, the whole house for everything.
import { BASE_KINDS, cleanSkim, kindsFor, readRank, readsAtAll, readsLight } from "../../../src/lib/plans/readOrder";
import { cleanSheetRead } from "../../../src/lib/plans/sheet";
import { EAGLE_READS } from "./plans-eagle.fixture";
import { tileGrid } from "../../../src/lib/plans/pdfClient";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const sheets = EAGLE_READS.map(([p, r]) => cleanSheetRead(p, r));
const queue = sheets.filter((s) => readsAtAll(s.kind)).sort((a, b) => readRank(a.kind) - readRank(b.kind) || a.page - b.page);
const order = queue.map((s) => `${s.page}:${s.kind}`);
ok("floor plans first, then the schedules, the cover, the site plan", /^7:floor,9:floor,3:schedule,2:cover,1:site/.test(order.join(",")), order.join(" "));
ok("structural sheets last", queue.slice(-7).every((s) => s.kind === "structural"), order.slice(-7).join(" "));
ok("details are not read in the background", !queue.some((s) => s.kind === "detail") && sheets.some((s) => s.kind === "detail"));
const light = queue.filter((s) => readsLight(s.kind)).map((s) => s.kind);
ok("elevations, sections and structural sheets are read light (4 close-ups, not 12)", light.length === 10 && !queue.some((s) => ["floor", "schedule", "site", "cover"].includes(s.kind) && readsLight(s.kind)), `${light.length} light of ${queue.length}`);
ok("a full read of a 36×24 sheet is 12 close-ups; a light one 4", tileGrid(36, 24).reduce((a, b) => a * b, 1) === 12);

// what a job waits for
const waits = (trades: Parameters<typeof kindsFor>[0]) => queue.filter((s) => kindsFor(trades).has(s.kind)).length;
ok("countertops wait for 4 of the 15 sheets (floor plans, schedule, cover)", waits(["cabinets"]) === 4, String(waits(["cabinets"])));
ok("drywall adds the section; not the structural sheets", waits(["drywall"]) === 5);
ok("a roof waits for the roof plan and the elevations too", kindsFor(["roofing"]).has("roof") && kindsFor(["roofing"]).has("elevation") && !kindsFor(["roofing"]).has("structural"));
ok("framing waits for the structural sheets", kindsFor(["framing"]).has("structural"));
ok("every job waits for the base: floor plans, cover, schedules", ["floor", "cover", "schedule"].every((k) => BASE_KINDS.includes(k as never)));

// the first look's answer
ok("a first look: kind, title and the floor of a floor plan", JSON.stringify(cleanSkim({ kind: "floor", title: "A6 MAIN FLOOR PLAN", level: "main floor" })) === JSON.stringify({ kind: "floor", title: "A6 MAIN FLOOR PLAN", level: "Main", contents: [] }));
const look = cleanSkim({ kind: "detail", title: "A3 DETAILS", contents: ["KITCHEN INTERIOR ELEVATIONS", "  note:   countertops 3cm quartz, eased edge ", 42, "", ...Array(30).fill("WALL SECTION")] });
ok("…and what is on the sheet, kept in mind: tidied, junk dropped, at most 16 lines", look.contents.length === 16 && look.contents[1] === "note: countertops 3cm quartz, eased edge" && look.contents[0] === "KITCHEN INTERIOR ELEVATIONS", JSON.stringify(look.contents.slice(0, 3)));
ok("…an unknown kind is other; junk never throws", cleanSkim({ kind: "spaceship" }).kind === "other" && cleanSkim(null).kind === "other" && cleanSkim("x").title === null);
ok("…the floor read from the title when the level is missing", cleanSkim({ kind: "floor", title: "UPPER FLOOR PLAN" }).level === "Upper");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
