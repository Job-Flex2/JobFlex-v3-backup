// A real plan set — no network, no model.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/plans-eagle.check.ts
// A real 18-sheet permit set (site, architectural, structural) for a two-story house in
// Washington, sent by the owner 2026-10-12 — the client, the address and the architect
// are left out of this public repo. Its architectural sheets carry NO text layer (the CAD
// export drew every letter as lines), only the A2 energy/schedule sheet does.
//
// Below is each sheet read the way the model is told to read it (lib/plans/readPrompt):
// what the sheet writes, copied as written — superscript sizes ("8⁰8⁰ O.H."), decimal
// feet in the glazing table ("3.00 x 6.00"), rooms with no size (this set dimensions
// the walls, not the rooms), "OPEN TO BELOW" over the two-story great room.
//
// The takeoff is then held to the numbers the architect wrote elsewhere on the set:
// the energy sheet's crawlspace, floor, attic and wall areas and its heat load, the
// site plan's footprint, roof and paving areas, the glazing schedule's total.
import { cleanSheetRead } from "../../../src/lib/plans/sheet";
import { computeTakeoff, roofArea } from "../../../src/lib/plans/takeoff";
import { EAGLE_READS } from "./plans-eagle.fixture";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const within = (a: number | undefined, b: number, tol: number) => a != null && Math.abs(a - b) <= Math.abs(b) * tol;

const sheets = EAGLE_READS.map(([page, raw]) => cleanSheetRead(page, raw));

const t = computeTakeoff(sheets);
const h = t.house;
const q = (id: string) => t.items.find((i) => i.id === id)?.qty;
const sum = (pred: (id: string) => boolean) => t.items.filter((i) => pred(i.id)).reduce((a, i) => a + i.qty, 0);
console.log(`items ${t.items.length} · checks: ${t.checks.map((c) => `[${c.level}] ${c.text}`).join(" | ")}\n`);

// ── the readings themselves
ok("superscript sizes: 8⁰8⁰ and 16⁰8⁰ overhead doors", h.doors.filter((d) => /o\.h/i.test(d.type ?? "")).map((d) => `${d.widthIn}x${d.heightIn}`).join(",") === "96x96,192x96", h.doors.map((d) => `${d.type}:${d.widthIn}x${d.heightIn}`).join(" "));
ok("decimal feet in the glazing table: 3.00 x 6.00 is 36\" x 72\"", h.windows[0].widthIn === 36 && h.windows[0].heightIn === 72, `${h.windows[0].widthIn}x${h.windows[0].heightIn}`);
ok("…as bare numbers too (3, 5 → 36\" x 60\")", h.windows.some((w) => w.type === "MEDIA picture" && w.widthIn === 36 && w.heightIn === 60));

// ── the house, against the area summary and the site plan
ok("living 5,192 sq ft (area summary)", h.livingSqFt === 5192);
ok("main 2,251 / upper 2,941", h.levels.map((l) => `${l.name} ${l.areaSqFt}`).join(", ") === "Main 2251, Upper 2941", h.levels.map((l) => `${l.name} ${l.areaSqFt}`).join(", "));
ok("plates 10'-1 1/8\" main, 9'-1 1/8\" upper", within(h.levels[0].plateFt, 10.09, 0.01) && within(h.levels[1].plateFt, 9.09, 0.01));
ok("garage 674, covered porches 438", h.garage?.areaSqFt === 674 && h.porchSqFt === 438);
ok("the garage is inside the 64' x 51' outline", h.garageInOutline === true);
ok("OPEN TO BELOW is not a room", !h.levels.some((l) => l.rooms.some((r) => /below/i.test(r.name))));
ok("footprint ≈ site plan's 2,908 building + 438 porches", within(h.footprintSqFt, 3346, 0.03), String(h.footprintSqFt));
ok("media room over the garage: 674 sq ft of floor over the garage", h.overGarageSqFt === 674, String(h.overGarageSqFt));

// ── the energy sheet's areas
const floorIns = (q("insulation.floor") ?? 0) + (q("insulation.floor-garage") ?? 0);
ok("insulated floors ≈ the energy sheet's 2,920 sq ft (crawl + over the garage)", within(floorIns, 2920, 0.01), String(floorIns));
ok("attic ≈ 2,448 flat + 500 vaulted = 2,948", within(q("insulation.attic"), 2948, 0.01), String(q("insulation.attic")));
ok("crawl vapor barrier ≈ the 2,254 sq ft crawlspace", within(q("foundation.vapor"), 2254, 0.01), String(q("foundation.vapor")));
ok("exterior wall insulation within 20% of the energy sheet's 4,340 sq ft", within(q("insulation.walls"), 4340, 0.2), String(q("insulation.walls")));
const glazed = h.windows.reduce((a, w) => a + ((w.widthIn ?? 0) * (w.heightIn ?? 0) * w.count) / 144, 0);
ok("glazing 839 + 16 skylight = 855 sq ft, 44 units", Math.round(glazed) === 855 && h.windows.reduce((a, w) => a + w.count, 0) === 44, `${Math.round(glazed)} sq ft`);
ok("HVAC from the heat load: 51,624 Btu/h → 4.5 ton", /4\.5 ton/.test(t.items.find((i) => i.id === "hvac.system")?.label ?? "") && t.items.find((i) => i.id === "hvac.system")?.source === "plan", t.items.find((i) => i.id === "hvac.system")?.label);

// ── the roof, against the site plan's roof & gutters area
ok("roof plan area = the site plan's 4,013 sq ft", q("framing.roof") === 4013);
ok("roof covering = 4,013 × 1.118 (6:12)", within(roofArea(h), 4013 * 1.118, 0.01), String(roofArea(h)));

// ── doors: the schedule's exterior doors + the plans' overhead and interior doors
ok("exterior doors: 2 foyer + 1 garage swing + 2 overhead = 5", sum((id) => id.startsWith("windows-doors.door-")) === 5, String(sum((id) => id.startsWith("windows-doors.door-"))));
ok("interior doors from the plans: 26", q("interior-trim.doors") === 26, String(q("interior-trim.doors")));

// ── rooms with no size: estimated, flagged, still priced
const hw = t.items.find((i) => i.id === "flooring.floor-hardwood");
const cp = t.items.find((i) => i.id === "flooring.floor-carpet");
ok("hardwood and carpet quantities exist, marked as estimates", !!hw && !!cp && hw.source === "rule" && cp.source === "rule", `${hw?.qty} / ${cp?.qty}`);
ok("tile floors (mud, MBA2, master bath, BA 3, BA 4, laundry)", (q("tile.floor") ?? 0) > 250 && t.items.find((i) => i.id === "tile.floor")?.source === "rule", String(q("tile.floor")));
ok("the estimate is called out on the takeoff", t.checks.some((c) => c.level === "warn" && /no size on the plans/.test(c.text)));
ok("flooring stays inside the floor area (finished floor ≤ 88% of 5,192)", (hw?.qty ?? 0) + (cp?.qty ?? 0) + (q("tile.floor") ?? 0) <= 5192 * 0.88 + 1);
ok("baseboard measured from the estimated rooms", (q("interior-trim.base") ?? 0) > 800, String(q("interior-trim.base")));

// ── MEP and site
ok("fixtures: 5 toilets, 8 lavatories, 2 tubs, 3 showers, 1 tub/shower", h.fixtures.toilet === 5 && h.fixtures.lavatory === 8 && h.fixtures.tub === 2 && h.fixtures.shower === 3 && h.fixtures.tubShower === 1);
ok("gas: the cooktop and the fireplace", q("plumbing.gas") === 2, String(q("plumbing.gas")));
ok("rough-in counts drained fixtures only (24)", q("plumbing.rough") === 24, String(q("plumbing.rough")));
ok("driveway + walks + patio from the site plan: 1,671 + 68 + 78", q("foundation.flatwork") === 1817 && t.items.find((i) => i.id === "foundation.flatwork")?.source === "plan");
ok("smoke alarms ≥ 5 bedrooms + 2 floors", (q("electrical.smoke") ?? 0) >= 7, String(q("electrical.smoke")));
ok("Type X under the media room: shared wall + 674 sq ft of garage ceiling", (q("drywall.garage") ?? 0) > 674);

// ── the build list: everything it takes, down to the stub-outs
ok("water stub-outs: toilets 1 each, sinks/tubs/showers/washer 2, dishwasher and ice maker 1 = 41", q("plumbing.water-stubs") === 41, String(q("plumbing.water-stubs")));
ok("drain stub-outs at the 22 drained fixtures", q("plumbing.drain-stubs") === 22, String(q("plumbing.drain-stubs")));
ok("a faucet for every lavatory (8), the kitchen sink and the laundry sink", q("plumbing.lav-faucet") === 8 && q("plumbing.kitchen-faucet") === 1 && q("plumbing.laundry-faucet") === 1);
ok("angle stops: toilets 5 + 2 × 10 sinks + dishwasher 1 = 26", q("plumbing.stops") === 26 && q("plumbing.supplies") === 26, String(q("plumbing.stops")));
ok("valves and trim: 2 tub fillers, 1 tub/shower valve, 3 shower trims, 3 tub drains", q("plumbing.tub-filler") === 2 && q("plumbing.tubshower-valve") === 1 && q("plumbing.shower-trim") === 3 && q("plumbing.tub-drain") === 3);
ok("the ice-maker box is not on the plans: assumed, marked rule", t.items.find((i) => i.id === "plumbing.fix-iceMaker")?.source === "rule");
ok("gas: CSST and a valve per outlet (cooktop, fireplace)", (q("plumbing.csst") ?? 0) > 0 && q("plumbing.gas-valves") === 2);
ok("two heat pumps: 4.5 ton as 2.5 + 2, two thermostats, two disconnects", /2 systems: 2\.5 \+ 2 ton/.test(t.items.find((i) => i.id === "hvac.system")?.label ?? "") && q("hvac.system") === 2 && q("hvac.thermostat") === 2 && q("electrical.disconnects") === 2);
ok("light fixtures by kind add up to the fixture labor", ["lt-recessed", "lt-fans", "lt-flush", "lt-vanity", "lt-pendants", "lt-exterior", "lt-garage", "lt-undercab"].reduce((a, k) => a + (q(`electrical.${k}`) ?? 0), 0) === q("electrical.lights"));
ok("a fan in every bedroom (5)", (q("electrical.lt-fans") ?? 0) >= 5);
ok("devices: receptacles = standard + GFCI + exterior", (q("electrical.recept-std") ?? 0) + (q("electrical.gfci") ?? 0) + (q("electrical.ext-recept") ?? 0) === q("electrical.receptacles"));
ok("Type X sheets cover the garage fire separation", (q("drywall.typex") ?? 0) * 48 >= (q("drywall.garage") ?? 0));
ok("crawlspace: 10 vents (corners + every 24'), 2 poly rolls, an access", q("foundation.vents") === 10 && q("foundation.poly") === 2 && q("foundation.crawl-access") === 1, `${q("foundation.vents")} vents`);
ok("every line says labor / material / both and its phase", t.items.every((i) => i.role && i.phase), t.items.filter((i) => !i.role || !i.phase).map((i) => i.id).join(", "));
ok("labor lines carry no purchase unit (bundles, boxes, rolls…)", t.items.filter((i) => i.role === "labor").every((i) => ["sq ft", "linear ft", "each", "cu yards", "lot"].includes(i.unit)));

if (process.env.PRINT) for (const i of t.items) console.log(`  ${i.trade.padEnd(14)} ${i.label.slice(0, 64).padEnd(64)} ${String(i.qty).padStart(8)} ${i.unit.padEnd(9)} ${i.source}`);
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
