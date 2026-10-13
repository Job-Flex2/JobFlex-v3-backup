// Blueprint takeoff — no network, no model.
//   npx tsx --tsconfig tsconfig.json scripts/qa/plans-takeoff.check.ts
// The Carter house (a five-sheet test set: cover, main, upper, elevations, schedules)
// as the vision model reads it, through cleanSheetRead → computeTakeoff. Checks the
// dimension reader, the merge (rooms per level, schedules over plan tags, stated areas
// over sums), and the quantities against hand arithmetic on the plans.
import { areaOf, feetOf, inchesOf, pitchOf, sizeOf } from "../../src/lib/plans/dims";
import { cleanSheetRead } from "../../src/lib/plans/sheet";
import { computeTakeoff, roofArea } from "../../src/lib/plans/takeoff";
import { pageWorthReading } from "../../src/lib/plans/readPrompt";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const near = (a: number | undefined, b: number, tol = 0.02) => a != null && Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * tol);

// ── the dimension reader
ok("feet-inch 12'-6\"", feetOf("12'-6\"") === 12.5);
ok("feet only 40'", feetOf("40'") === 40);
ok("with a note 9'-0\" CLG", feetOf("9'-0\" CLG") === 9);
ok("fraction 12' 6 1/2\"", near(feetOf("12' 6 1/2\"") ?? 0, 12.5417, 0.001), String(feetOf("12' 6 1/2\"")));
ok("inches only 18\" → 1.5 ft", feetOf("18\"") === 1.5);
ok("bare number is feet", feetOf("30") === 30);
ok("inchesOf 3'-0\" = 36", inchesOf("3'-0\"") === 36);
ok("size 3'-0\" x 5'-0\"", JSON.stringify(sizeOf("3'-0\" x 5'-0\"")) === JSON.stringify({ w: 36, h: 60 }));
ok("shorthand 3068", JSON.stringify(sizeOf("3068")) === JSON.stringify({ w: 36, h: 80 }));
ok("area 12'-0\" x 14'-0\" = 168", areaOf("12'-0\" x 14'-0\"") === 168);
ok("area stated 1,200 SF", areaOf("1,200 SF") === 1200);
ok("pitch 6:12 factor 1.118", near(pitchOf("6:12")?.factor, 1.118, 0.001));
ok("pitch 8/12", pitchOf("8/12")?.rise === 8);
ok("pitch rejects 30:12", pitchOf("30:12") === null);

// ── the Carter house, as the model answers sheet by sheet
const raw: Array<[number, unknown]> = [
  [1, { kind: "cover", title: "A0 Cover Sheet", project: { name: "Carter Residence", address: "8217 NE 140th St, Kirkland, WA 98034" },
        stated: { livingSqFt: "2,280 SF", mainSqFt: 1200, upperSqFt: 1080, garageSqFt: 576, porchSqFt: 96 }, stories: 2,
        plateHeights: [{ level: "Main", height: "9'-0\"" }, { level: "Upper", height: "8'-0\"" }],
        roof: { pitch: "6:12", style: "gable", material: "30 yr architectural comp shingle", overhang: "18\"" },
        foundation: { type: "crawlspace", footingWidth: "16\"", footingDepth: "8\"" }, confidence: "high" }],
  [2, { kind: "floor", title: "A1 Main Floor Plan", level: "Main Floor", scale: "1/4\" = 1'-0\"", overall: { width: "40'-0\"", depth: "30'-0\"" },
        rooms: [
          { name: "Great Room", size: "16'-0\" x 14'-0\"", ceiling: "9'-0\"" }, { name: "Kitchen", width: "12'-0\"", length: "14'-0\"" },
          { name: "Dining", size: "12'-0\" x 14'-0\"" }, { name: "Office", size: "12'-0\" x 12'-0\"" }, { name: "Powder", size: "6'-0\" x 8'-0\"" },
          { name: "Mudroom / Laundry", size: "12'-0\" x 10'-0\"" }, { name: "Stair / Entry", size: "10'-0\" x 16'-0\"" },
          { name: "Garage", size: "24'-0\" x 24'-0\"" },
        ],
        windows: [{ tag: "W1", count: 2 }, { tag: "W2", count: 2 }, { tag: "W3", count: 1 }], doors: [{ tag: "D1", count: 1 }],
        walls: { exteriorFraming: "2x6 @ 16\" o.c.", interiorFraming: "2x4 @ 16\" o.c." }, confidence: "high" }],
  [3, { kind: "floor", title: "A2 Upper Floor Plan", level: "Upper", overall: { width: 40, depth: 27 },
        rooms: [
          { name: "Primary Suite", size: "16'-0\" x 14'-0\"", ceiling: "8'-0\"", floor: "carpet" }, { name: "Primary Bath", size: "10'-0\" x 14'-0\"", floor: "tile" },
          { name: "Bedroom 2", size: "14'-0\" x 14'-0\"", floor: "carpet" }, { name: "Bedroom 3", size: "12'-0\" x 13'-0\"", floor: "carpet" },
          { name: "Bath 2", size: "8'-0\" x 9'-0\"", floor: "tile" }, { name: "Hall / Linen", size: "10'-0\" x 13'-0\"" }, { name: "Stair", size: "10'-0\" x 13'-0\"" },
        ], confidence: "high" }],
  [4, { kind: "elevation", title: "A3 Exterior Elevations", roof: { pitch: "6:12" },
        exterior: { siding: "fiber cement lap 7\" exposure", trim: "5/4 trim", gutters: "5\" K-style aluminum" }, confidence: "medium" }],
  [5, { kind: "schedule", title: "A4 Window & Door Schedules",
        windows: [{ tag: "W1", size: "3'-0\" x 5'-0\"", type: "vinyl single hung", count: 10 }, { tag: "W2", size: "5'-0\" x 5'-0\"", type: "vinyl slider", count: 4 }, { tag: "W3", size: "2'-0\" x 3'-0\"", type: "vinyl awning (obsc)", count: 3 }],
        doors: [
          { tag: "D1", size: "3'-0\" x 6'-8\"", type: "ext fiberglass entry", count: 1 }, { tag: "D2", size: "2'-8\" x 6'-8\"", type: "ext half-lite (garage)", count: 1 },
          { tag: "D3", size: "2'-8\" x 6'-8\"", type: "int 2-panel hollow core", count: 11 }, { tag: "D4", size: "6'-0\" x 6'-8\"", type: "sliding patio", count: 1 },
          { tag: "OH", size: "16'-0\" x 7'-0\"", type: "overhead garage", count: 1 },
        ], confidence: "high" }],
];
const sheets = raw.map(([p, r]) => cleanSheetRead(p, r));
ok("cleaner: level 'Main Floor' → Main", sheets[1].level === "Main");
ok("cleaner: room size string read (kitchen 168 sq ft)", sheets[1].rooms.find((r) => r.name === "Kitchen")?.areaSqFt === 168);
ok("cleaner: stated '2,280 SF' read", sheets[0].stated.livingSqFt === 2280);
ok("cleaner: door D3 is interior, D4 sliding patio exterior", sheets[4].doors.find((d) => d.tag === "D3")?.exterior === false && sheets[4].doors.find((d) => d.tag === "D4")?.exterior === true);
ok("cleaner: overhang 18\"", sheets[0].roof.overhangIn === 18);

const t = computeTakeoff(sheets);
const q = (id: string) => t.items.find((i) => i.id === id)?.qty;
const h = t.house;
console.log("\nitems:", t.items.length, "· checks:", t.checks.map((c) => `[${c.level}] ${c.text}`).join(" | ") || "none");

ok("two levels, main then upper", h.levels.map((l) => l.name).join(",") === "Main,Upper", h.levels.map((l) => l.name).join(","));
ok("main 1,200 sq ft stated, perimeter 140 LF", h.levels[0].areaSqFt === 1200 && h.levels[0].perimeterLf === 140);
ok("upper 1,080 sq ft, perimeter 134 LF", h.levels[1].areaSqFt === 1080 && h.levels[1].perimeterLf === 134);
ok("plates 9' main, 8' upper, from the plans", h.levels[0].plateFt === 9 && h.levels[1].plateFt === 8 && h.levels.every((l) => l.plateFrom === "plan"));
ok("living 2,280 stated, no mismatch warning", h.livingSqFt === 2280 && !t.checks.some((c) => /Living area/.test(c.text)));
ok("garage 576, kept out of living", h.garage?.areaSqFt === 576);
ok("footprint = 1,200 + 576 + 96 = 1,872", h.footprintSqFt === 1872, String(h.footprintSqFt));
ok("roof 6:12 from the plan, 18\" overhang", h.roof.rise === 6 && h.roof.pitchFrom === "plan" && h.roof.overhangIn === 18);
ok("schedule wins over plan tags: 17 windows", h.windows.reduce((a, w) => a + w.count, 0) === 17);
ok("doors: 4 exterior marks, 1 interior mark", h.doors.filter((d) => d.exterior).length === 4 && h.doors.filter((d) => !d.exterior).length === 1);

// foundation: outline 140 + garage three walls (24 + 2×24 = 72) = 212 LF
ok("footing 212 LF", q("foundation.footing") === 212, String(q("foundation.footing")));
ok("footing concrete 212 × 16\" × 8\" = 7.0 CY", near(q("foundation.footing-cy"), 7.0, 0.03), String(q("foundation.footing-cy")));
ok("stem wall 212 × 8\" × 2.5' = 13.1 CY", near(q("foundation.wall-cy"), 13.1, 0.03), String(q("foundation.wall-cy")));
ok("slab: garage + porch 672 sq ft", q("foundation.slab") === 672, String(q("foundation.slab")));
ok("crawlspace vapor barrier 1,200", q("foundation.vapor") === 1200);

// framing
ok("exterior wall framing 140 + 134 + 72 = 346 LF", q("framing.ext-walls") === 346, String(q("framing.ext-walls")));
ok("interior walls ~98 + ~103 LF", near(q("framing.int-walls"), 201, 0.05), String(q("framing.int-walls")));
ok("framed floors 2,280 (crawlspace main + upper)", q("framing.floor") === 2280);

// roof: (1,872 + overhang band) × 1.118
const ra = roofArea(h);
ok("roof area between 2,300 and 2,600 sq ft", ra > 2300 && ra < 2600, String(ra));
ok("underlayment = the roof area (no separate squares item to double-count)", q("roofing.underlayment") === q("roofing.area") && q("roofing.squares") === undefined);

// openings & envelope
ok("windows listed per schedule mark (W1 10, W2 4, W3 3)", q("windows-doors.win-w1") === 10 && q("windows-doors.win-w2") === 4 && q("windows-doors.win-w3") === 3);
ok("garage overhead door from the schedule, no rule item", q("windows-doors.door-oh") === 1 && q("windows-doors.garage-door") === undefined);
const siding = q("siding.net") ?? 0;
ok("siding net between 2,800 and 3,600 sq ft", siding > 2800 && siding < 3600, String(siding));

// interior
ok("interior doors 11 from the schedule", q("interior-trim.doors") === 11);
ok("drywall walls + ceilings present, ceilings = 2,280", (q("drywall.walls") ?? 0) > 4000 && q("drywall.ceilings") === 2280, `${q("drywall.walls")} / ${q("drywall.ceilings")}`);
ok("tile floors = primary bath 140 + bath 2 72 + powder 48 (assumed, marked rule)", q("tile.floor") === 260 && t.items.find((i) => i.id === "tile.floor")?.source === "rule", String(q("tile.floor")));
ok("carpet 224 + 196 + 156 = 576 sq ft", q("flooring.floor-carpet") === 576, String(q("flooring.floor-carpet")));
ok("kitchen cabinets estimated, marked as a rule", t.items.find((i) => i.id.startsWith("cabinets.base"))?.source === "rule");

// MEP from the room names (no plumbing / electrical sheets)
ok("toilets 3 (powder, primary, bath 2)", h.fixtures.toilet === 3, JSON.stringify(h.fixtures));
ok("fixtures marked 'rule' (no plumbing plan)", h.fixturesFrom === "rule");
ok("smoke alarms ≥ bedrooms + floors", (q("electrical.smoke") ?? 0) >= 5, String(q("electrical.smoke")));
ok("HVAC 3 ton by rule on 2,280 sq ft (~800 sq ft a ton, a new house)", t.items.find((i) => i.id === "hvac.system")?.label.includes("3 ton") === true, t.items.find((i) => i.id === "hvac.system")?.label);

// general conditions, stairs, and the items a new house always has
ok("general conditions: permit, survey, temp facilities, supervision, laterals, final clean", ["permit", "survey", "temp", "supervision", "laterals", "clean"].every((k) => (q(`general.${k}`) ?? 0) > 0));
ok("build months by rule: 2,280 sq ft → 6 months", q("general.temp") === 6 && q("general.supervision") === 6, String(q("general.temp")));
ok("one stair flight for two floors, framed, railed and treaded", q("framing.stairs") === 1 && q("interior-trim.stair-rail") === 14 && q("flooring.stair-treads") === 14);
ok("driveway + walk by rule (24' × 25' + 120)", q("foundation.flatwork") === 720 && t.items.find((i) => i.id === "foundation.flatwork")?.source === "rule", String(q("foundation.flatwork")));
ok("house wrap ≥ net siding", (q("siding.wrap") ?? 0) > (q("siding.net") ?? 0));
ok("air sealing + blower door, one per house", q("insulation.air-seal") === 1);
ok("dedicated circuits: kitchen 5 + laundry 2 + electric water heater 1 + garage opener 1", q("electrical.circuits") === 9, String(q("electrical.circuits")));
ok("HVAC power is its own line: one system", q("electrical.hvac-power") === 1);
ok("thermostat 1", q("hvac.thermostat") === 1);
ok("no gas outlets when the plans name no gas", q("plumbing.gas") === undefined);

// the build list (lib/plans/assemblies): every line labor, material or both, in a phase
ok("every line says labor / material / both and its phase", t.items.every((i) => i.role && i.phase), t.items.filter((i) => !i.role || !i.phase).map((i) => i.id).join(", "));
ok("fixtures from room names: 3 toilets, 4 lavatories → 4 lav faucets, 3 wax ring sets", q("plumbing.fix-toilet") === 3 && q("plumbing.lav-faucet") === h.fixtures.lavatory && q("plumbing.wax") === 3);
ok("assumed and flagged: the refrigerator ice-maker box", t.items.find((i) => i.id === "plumbing.fix-iceMaker")?.source === "rule" && t.checks.some((c) => /assumed because every house has them: .*ice-maker/.test(c.text)));
ok("a disposal at the kitchen sink and a faucet for it", q("plumbing.disposal") === 1 && q("plumbing.kitchen-faucet") === 1);
ok("drywall bought in 4×12 sheets with waste over the hung area", (q("drywall.regular") ?? 0) * 48 >= ((q("drywall.walls") ?? 0) + (q("drywall.ceilings") ?? 0)) * 0.95);
ok("shingles: 3 bundles a square + waste", q("roofing.shingles") === Math.ceil((roofArea(h) / 100) * 1.1 * 3), String(q("roofing.shingles")));
ok("no gas outlets → no CSST", q("plumbing.csst") === undefined);

// every item says where it came from
ok("every item has a basis and a source", t.items.every((i) => i.basis && ["plan", "derived", "rule"].includes(i.source)));
ok("no NaN or zero quantities", t.items.every((i) => Number.isFinite(i.qty) && i.qty > 0));

// ── the contractor's corrections flow through every quantity that rests on them
const t2 = computeTakeoff(sheets, { roofRise: 8, levels: { Upper: { plateFt: 9 } }, foundation: "slab", garageSqFt: 0 });
const q2 = (id: string) => t2.items.find((i) => i.id === id)?.qty;
const steeper = computeTakeoff(sheets, { roofRise: 8 });
ok("edit: 8:12 pitch makes a bigger roof", (steeper.items.find((i) => i.id === "roofing.area")?.qty ?? 0) > ra && steeper.house.roof.pitchFrom === "entered", String(steeper.items.find((i) => i.id === "roofing.area")?.qty));
ok("edit: a 9' upper plate makes more wall to hang", (q2("drywall.walls") ?? 0) > (q("drywall.walls") ?? 0));
ok("edit: slab-on-grade → the main floor is a slab, no stem wall", q2("foundation.wall") === undefined && (q2("foundation.slab") ?? 0) >= 1200 && t2.house.foundation.from === "entered");
ok("edit: no garage → no garage door, no fire separation", t2.house.garage === null && q2("drywall.garage") === undefined && q2("windows-doors.door-oh") === 1);
ok("edit: the pitch warning is gone once the pitch is entered", !computeTakeoff(sheets.filter((s) => s.kind !== "elevation"), { roofRise: 5 }).checks.some((c) => /pitch/.test(c.text)));

// ── which pages get read, and what the picker calls them
const coverWords = "CARTER RESIDENCE — NEW SINGLE FAMILY AREA SUMMARY MAIN FLOOR 1,200 SF UPPER FLOOR 1,080 SF GARAGE 576 SF";
ok("a cover whose area summary says MAIN FLOOR is still a cover (title block)", pageWorthReading(coverWords, "CARTER RESIDENCE COVER SHEET SCALE: NTS A0").guess === "cover");
ok("an elevations sheet is elevations by its title", pageWorthReading("FRONT ELEVATION 6:12 SEE MAIN FLOOR PLAN FOR WINDOWS", "A3 EXTERIOR ELEVATIONS").guess === "elevation");
ok("plural titles: WINDOW & DOOR SCHEDULES", pageWorthReading("W1 3'-0\" x 5'-0\"", "WINDOW & DOOR SCHEDULES").guess === "schedule");
ok("a details sheet is left out", pageWorthReading("TYPICAL WALL SECTION DETAILS", "A6 DETAILS").read === false);
ok("a scan (no text) is read, the model sorts it", pageWorthReading("").read && pageWorthReading("").guess === "scan");
ok("no title block: the page's words decide", pageWorthReading("MAIN FLOOR PLAN 1/4\" = 1'-0\"").guess === "floor");

// ── an empty / junk answer never throws
const junk = computeTakeoff([cleanSheetRead(1, null), cleanSheetRead(2, { rooms: "nope", windows: [{ count: -3 }] })]);
ok("junk answers: no items, a warning to read a floor plan", junk.items.length === 0 && junk.checks.some((c) => /floor plan/.test(c.text)));

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
