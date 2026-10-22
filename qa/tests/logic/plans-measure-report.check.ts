// Sizes & measurements from the plans (2026-10-21, owner: "extract the sizes of anything in the plan — room sizes by
// name, sq ft — downloadable in PDF"). On the real 18-sheet set (plans-eagle.fixture): every room by floor with its
// size or a marked estimate, the floors, walls, roof and its edges, foundation, site, the window and door schedules
// with the glass, the work quantities — each with its sheet and where it came from; the find box; the spreadsheet.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/plans-measure-report.check.ts
import { cleanSheetRead } from "../../../src/lib/plans/sheet";
import { computeTakeoff, roofArea } from "../../../src/lib/plans/takeoff";
import { filterReport, ftIn, measureReport, reportCsv, withFirst } from "../../../src/lib/plans/measureReport";
import type { FoundRow } from "../../../src/lib/plans/ask";
import { EAGLE_READS } from "./plans-eagle.fixture";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("── feet and inches");
check("12.5 → 12'-6\", 12 → 12'-0\", 9.99 → 10'-0\"", ftIn(12.5) === `12'-6"` && ftIn(12) === `12'-0"` && ftIn(9.99) === `10'-0"`);

const sheets = EAGLE_READS.map(([page, raw]) => cleanSheetRead(page, raw));
const t = computeTakeoff(sheets);
const h = t.house;
const r = measureReport(t, sheets);
const sec = (k: string) => r.sections.find((s) => s.key === k);

console.log("── the rooms");
const roomCount = h.levels.reduce((a, l) => a + l.rooms.length, 0);
check("every room the plans name, floor by floor", r.rooms.length === roomCount && roomCount > 10, `${r.rooms.length} rooms on ${h.levels.map((l) => l.name).join(", ")}`);
check("each with its floor and its sheet", r.rooms.every((x) => x.level && x.pages.length));
check("a room with no size on the plans is marked est., never passed off as read", r.rooms.some((x) => x.estimated) && r.rooms.filter((x) => x.estimated).every((x) => x.size === null));
check("…and the report says to measure those on site", r.checks.some((c) => /no size on the plans/.test(c)));
const garage = r.rooms.find((x) => /garage/i.test(x.name));
check("the garage room carries the garage's stated area", !!garage && garage.areaSqFt === Math.round(h.garage!.areaSqFt), `${garage?.name} ${garage?.areaSqFt}`);

console.log("── the house");
check("the living area as the takeoff has it", sec("areas")?.rows[0].value === `${h.livingSqFt.toLocaleString("en-US")} sq ft`, sec("areas")?.rows[0].value);
check("each floor's area with where it came from", h.levels.every((l) => sec("areas")!.rows.some((x) => x.label === `${l.name} floor` && !!x.note)));
check("walls: each floor's exterior run and wall height, and the gross wall area", h.levels.every((l) => sec("walls")!.rows.some((x) => x.label.startsWith(`${l.name} floor · exterior walls`))) && sec("walls")!.rows.some((x) => /gross/.test(x.label)));
const surf = sec("roof")!.rows.find((x) => /on the slope/.test(x.label))!;
check("roof on the slope = the takeoff's roof area, with squares", surf.value.startsWith(`${Math.round(roofArea(h)).toLocaleString("en-US")} sq ft`) && /squares/.test(surf.value), surf.value);
check("the roof's edges: eaves and ridge", ["Eaves", "Ridge"].every((w) => sec("roof")!.rows.some((x) => x.label.startsWith(w))));
check("pitch written as rise/12", /^\d+(\.\d)?\/12$/.test(sec("roof")!.rows[0].value), sec("roof")!.rows[0].value);
check("foundation type and footing", sec("foundation")!.rows[0].value === h.foundation.type && sec("foundation")!.rows.some((x) => /wide × .* deep/.test(x.value)));
check("the site plan's paving", !!sec("site") && sec("site")!.rows.some((x) => /Driveway/.test(x.label)));

console.log("── windows and doors");
const wins = h.windows.reduce((a, w) => a + w.count, 0);
const glass = Math.round(h.windows.reduce((a, w) => a + ((w.widthIn ?? 0) * (w.heightIn ?? 0) * w.count) / 144, 0));
const wTotal = sec("windows")!.rows[0];
check("windows in all, with the glass", wTotal.value.startsWith(String(wins)) && wTotal.value.includes(`${glass.toLocaleString("en-US")} sq ft of glass`), wTotal.value);
check("each schedule line as W × H in feet and inches", sec("windows")!.rows.slice(1).some((x) => /^\d+'-\d+" × \d+'-\d+"/.test(x.value)), sec("windows")!.rows[1]?.value);
check("doors, the exterior ones counted", /exterior/.test(sec("doors")!.rows[0].value), sec("doors")!.rows[0].value);

console.log("── the work quantities");
const work = sec("work")!.rows;
check("the build list's work, not its purchase units", work.length > 20 && !work.some((x) => /bundles|boxes|gallons|rolls/.test(x.value)), `${work.length} lines`);
check("each says where its number came from", work.every((x) => !!x.source));

console.log("── what was asked");
const found: FoundRow[] = [
  { label: "Master closet floor", qty: 64, unit: "sq ft", pages: [5], asWritten: "8'-0\" × 8'-0\" (p. 5)", status: "measured", replaces: null, confidence: "high" },
  { label: "Wine room", qty: null, unit: "sq ft", pages: [], asWritten: "not drawn on the sheets read", status: "missing", replaces: null, confidence: null },
];
const ra = measureReport(t, sheets, { request: "master closet and the wine room", rows: found });
check("measured on the sheets, with the page", ra.asked?.rows[0].value === "64 sq ft" && ra.asked?.rows[0].source === "measured" && ra.asked.rows[0].pages[0] === 5);
check("…and what is not on the sheets said so", ra.asked?.rows[1].value === "not found on the sheets");

console.log("── find and order");
const kitchen = filterReport(r, "kitchen");
check("'kitchen' finds the kitchen and the work in it", kitchen.rooms.length >= 1 && kitchen.rooms.every((x) => /kitchen/i.test(x.name)), kitchen.rooms.map((x) => x.name).join(", "));
const roof = filterReport(r, "roof");
check("a section's own name keeps the whole section", roof.sections.find((s) => s.key === "roof")?.rows.length === sec("roof")!.rows.length);
check("nothing typed: everything", filterReport(r, "  ").sections.length === r.sections.length);
check("the Windows chip opens on the windows", withFirst(r, "windows").sections[0].key === "windows");

console.log("── the spreadsheet");
const csv = reportCsv(ra);
const lines = csv.split("\r\n");
check("a row a measurement, rooms and asked included", lines.length === 1 + ra.asked!.rows.length + ra.rooms.length + ra.sections.reduce((a, s) => a + s.rows.length, 0) && csv.startsWith("﻿") && /You asked,Master closet floor,64 sq ft/.test(csv));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
