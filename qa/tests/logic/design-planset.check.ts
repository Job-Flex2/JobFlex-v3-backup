// Home Design Studio (2026-10-18): the plan set read for its spaces — which sheets are floor plans (by their drawing
// titles, never a framing, electrical or foundation plan, a sheet index or a page of notes), each floor's level and
// rooms (stacked labels joined, sizes kept, spec tables and notes left out), and a room found by what people call it.
//   npx tsx qa/tests/logic/design-planset.check.ts
import { classifySheet, findFloorPlans, findSpaces, isMultiFloor, levelOf, matchScore, roomName, sameRoom } from "../../../src/lib/design/planSet";
import type { SheetText } from "../../../src/lib/design/planRead";
import { wallPen } from "../../../src/lib/design/planRead";
import { floorFromVision } from "../../../src/lib/design/planSet";
import { closeRoom } from "../../../src/lib/design/openPlan";
import { roomsOf, pointInPoly } from "../../../src/lib/design/geometry";
import { roomSpans } from "../../../src/lib/design/kitchen";
import { houseChanges } from "../../../src/lib/design/structure";
import type { DesignDoc, Wall } from "../../../src/lib/design/model";
import type { VectorSheet } from "../../../src/lib/design/pdfVector";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = 2592;
const H = 1728;
const T = (str: string, x: number, y: number, h = 11): SheetText => ({ str, x, y, h });
const titleBlock = (no: string, name: string): SheetText[] => [T("MAPLE RIDGE RESIDENCE", 2350, 1400, 16), T(name, 2350, 1560, 14), T(no, 2350, 1620, 28)];
const main: SheetText[] = [
  ...titleBlock("A2.1", "MAIN FLOOR PLAN"),
  T("KITCHEN", 420, 380),
  T(`15'-6" X 13'-6"`, 420, 398, 8),
  T("GREAT ROOM", 780, 420),
  T(`23'-6" X 17'-6"`, 780, 438, 8),
  T("DINING", 420, 650),
  T("POWDER", 820, 690),
  T("ENTRY", 700, 690),
  T("MAIN FLOOR PLAN", 640, 880, 20),
  T(`SCALE: 1/4" = 1'-0"`, 640, 910, 10),
];
const upper: SheetText[] = [
  ...titleBlock("A2.2", "UPPER FLOOR PLAN"),
  T("MASTER", 470, 380),
  T("BEDROOM", 470, 394),
  T(`19'-6" X 15'-6"`, 470, 412, 8),
  T("MSTR. BATH", 390, 650),
  T("W.I.C.", 560, 650),
  T("BEDROOM", 760, 380),
  T("#2", 760, 394),
  T("LOFT", 900, 650),
  T("UPPER FLOOR PLAN", 640, 880, 20),
];
const electrical: SheetText[] = [...titleBlock("E2.1", "MAIN FLOOR ELECTRICAL PLAN"), T("KITCHEN", 420, 380), T("GREAT ROOM", 780, 420), T("MAIN FLOOR ELECTRICAL PLAN", 640, 880, 20)];
const notes: SheetText[] = [...titleBlock("G0.1", "GENERAL NOTES"), ...Array.from({ length: 40 }, (_, i) => T(`${i + 1}. CONTRACTOR SHALL VERIFY ALL DIMENSIONS ON THE FLOOR PLAN AND REPORT DISCREPANCIES BEFORE PROCEEDING.`, 120, 120 + i * 22, 9))];
const index: SheetText[] = [...titleBlock("G0.0", "COVER SHEET"), T("A1.0-s SPANISH STYLE FLOOR PLAN, ELEVATIONS, SCHEDULES", 200, 300, 10), T("BEDROOM(S): 1", 200, 340, 10), T("BATHROOM(S): 1", 200, 360, 10)];

console.log("── which sheets are floor plans");
const cMain = classifySheet(main, W, H);
const cNotes = classifySheet(notes, W, H);
const cElec = classifySheet(electrical, W, H);
const cIdx = classifySheet(index, W, H);
check("the main floor plan, by its drawing title", cMain.plans.length === 1 && cMain.plans[0].level === "main");
check("a notes page that says 'floor plan' in a sentence scores below it", cNotes.score < cMain.score - 5 && cNotes.plans.length === 0, `${cNotes.score} vs ${cMain.score}`);
check("an electrical plan is not a floor plan, though it labels the rooms", cElec.plans.length === 0 && cElec.score < cMain.score);
check("a sheet index line is not a plan; a spec table's 'BEDROOM(S): 1' is not a room", cIdx.plans.length === 0 && cIdx.rooms.length === 0);

console.log("── the rooms on a plan");
const cUp = classifySheet(upper, W, H);
const names = cUp.rooms.map((r) => r.name);
check("stacked words are one room: Master bedroom", names.includes("Master bedroom") && !names.includes("Master"), names.join(", "));
check("…and 'BEDROOM' over '#2'", names.includes("Bedroom #2"), names.join(", "));
check("abbreviations spelled out: Master bath, Walk-in closet", names.includes("Master bath") && names.includes("Walk-in closet"));
check("the size printed under the name", cUp.rooms.find((r) => r.name === "Master bedroom")?.size === `19'-6" × 15'-6"`);
check("roomName cleans what plans print", roomName("MSTR. BATH") === "Master bath" && roomName("BDRM. 3") === "Bedroom 3" && roomName("(N) BEDROOM 1") === "Bedroom 1" && roomName("ENTRY / LIVING ROOM / KITCHEN / DINING") === "Entry / living room / kitchen / dining" && roomName("PATIO COVER (OPTIONAL)") === "Patio cover");

console.log("── the set");
const sheets = [
  { key: "a#1", fileName: "maple.pdf", page: 1, width: W, height: H, texts: notes },
  { key: "a#2", fileName: "maple.pdf", page: 2, width: W, height: H, texts: upper },
  { key: "a#3", fileName: "maple.pdf", page: 3, width: W, height: H, texts: main },
  { key: "a#4", fileName: "maple.pdf", page: 4, width: W, height: H, texts: electrical },
];
const floors = findFloorPlans(sheets);
check("two floors, the main floor first", floors.map((f) => f.name).join(",") === "Main floor,Upper floor", floors.map((f) => f.name).join(","));
check("…levels of one house", isMultiFloor(floors));
check("each floor's rooms", floors[0].rooms.length === 5 && floors[1].rooms.length === 5, `${floors[0].rooms.length} + ${floors[1].rooms.length}`);
const rg = floors[0].region;
check("the box each floor's rooms make reaches past them to the outside walls", !!rg && rg.x <= 300 && rg.x + rg.w >= 950 && rg.y <= 230, JSON.stringify(rg));
const alt = findFloorPlans([
  { key: "b#11", fileName: "adu.pdf", page: 11, width: W, height: H, texts: [T("FLOOR PLAN", 244, 70, 26), T("SPANISH STYLE FLOOR PLAN |", 2289, 1555, 14), T("(N) BEDROOM 1", 1229, 350)] },
  { key: "b#12", fileName: "adu.pdf", page: 12, width: W, height: H, texts: [T("FLOOR PLAN", 244, 70, 26), T("CRAFTSMAN STYLE FLOOR PLAN |", 2289, 1555, 14), T("(N) BEDROOM 1", 1229, 350)] },
]);
check("a plain 'FLOOR PLAN' takes the title block's name", alt.map((f) => f.name).join(",") === "Spanish Style Floor Plan,Craftsman Style Floor Plan", alt.map((f) => f.name).join(","));
check("style plans are alternatives, not floors — no whole house", !isMultiFloor(alt) && alt.every((f) => f.level === null));
const two = findFloorPlans([{ key: "c#1", fileName: "duo.pdf", page: 1, width: W, height: H, texts: [T("KITCHEN", 400, 400), T("DINING", 500, 500), T("MAIN FLOOR PLAN", 450, 800, 20), T("MASTER BEDROOM", 1500, 400), T("BATH", 1600, 500), T("UPPER FLOOR PLAN", 1550, 800, 20)] }]);
check("two plans on one sheet: each its own rooms", two.length === 2 && two[0].rooms.map((r) => r.name).join(",") === "Kitchen,Dining" && two[1].rooms.map((r) => r.name).join(",") === "Master bedroom,Bath", two.map((f) => `${f.name}: ${f.rooms.map((r) => r.name).join("/")}`).join(" | "));
check("levels in the house's order", levelOf("SECOND FLOOR PLAN").order > levelOf("FIRST FLOOR PLAN").order && levelOf("BASEMENT PLAN").name === "Basement" && levelOf("LOWER LEVEL FLOOR PLAN").name === "Lower level");

console.log("── a room by what people call it");
const top = (q: string) => findSpaces(q, floors)[0]?.room.name ?? "(none)";
check("'primary bath' → Master bath", top("primary bath") === "Master bath", top("primary bath"));
check("'owner's suite bedroom' → Master bedroom", top("owner's bedroom") === "Master bedroom", top("owner's bedroom"));
check("'half bath' → Powder", top("half bath") === "Powder", top("half bath"));
check("'living' → Great room", top("living") === "Great room", top("living"));
check("'closet' → Walk-in closet", top("closet") === "Walk-in closet", top("closet"));
check("'kitch' → Kitchen (as it's typed)", top("kitch") === "Kitchen", top("kitch"));
check("nothing for a room the house hasn't", findSpaces("wine cellar", floors).length === 0);
check("the same room under two names", sameRoom("Primary Bedroom", "Master bedroom") && sameRoom("Bedroom #2", "Bedroom 2") && !sameRoom("Bedroom 2", "Bedroom 3"));
check("a better match ranks first", matchScore("bedroom 2", "Bedroom #2") > matchScore("bedroom 2", "Master bedroom"));

console.log("── a set that draws its words as lines (read from its pictures)");
const seg = (x1: number, y1: number, x2: number, y2: number, w: number) => ({ x1, y1, x2, y2, w, layer: "", path: 0 });
const lettering = Array.from({ length: 3000 }, (_, i) => seg(100 + (i % 60) * 20, 100 + Math.floor(i / 60) * 20, 125 + (i % 60) * 20, 100 + Math.floor(i / 60) * 20, 0.72));
const heavy = Array.from({ length: 140 }, (_, i) => seg(200, 100 + i * 8, 600, 100 + i * 8, 1.44));
const vsheet = { width: 2592, height: 1728, segs: [...lettering, ...heavy], arcs: [], layers: {} } as unknown as VectorSheet;
check("the walls' pen is the heavy one, the lettering left out", wallPen(vsheet, null) === 1.44);
check("one pen throughout: read every line, as before", wallPen({ ...vsheet, segs: heavy.map((s) => ({ ...s, w: 1 })) } as unknown as VectorSheet, null) === 0);
const vf = floorFromVision({ key: "e#7", fileName: "set.pdf", page: 7, width: 2592, height: 1728 }, { title: "MAIN FLOOR PLAN", level: "main" }, { rooms: [{ name: "Kitchen", x: 0.5, y: 0.4, size: null, box: [0.45, 0.3, 0.55, 0.5] }, { name: "WIC", x: 0.6, y: 0.4, size: null }, { name: "WIC", x: 0.7, y: 0.4, size: null }], box: [0.2, 0.1, 0.8, 0.9], scale: `1/4" = 1'-0"` });
check("a floor seen in its picture: named by its title, its rooms placed on the sheet", vf.name === "Main floor" && vf.level === "main" && vf.seen === true && Math.round(vf.rooms[0].at.x) === 1296 && Math.round(vf.rooms[0].box!.x1) === 1426);
check("two labels of one name told apart", vf.rooms.map((r) => r.name).join(",") === "Kitchen,Walk-in closet,Walk-in closet 2", vf.rooms.map((r) => r.name).join(","));
check("the drawing's box and its scale kept for the read", !!vf.region && vf.region.x < 0.2 * 2592 && vf.scale === `1/4" = 1'-0"`);

console.log("── an open plan's room, closed by room boundaries");
const Wl = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick: 6, height: 96, exterior: true });
// A 40 × 20 ft great room + kitchen with no wall between them; a short wall stub at the kitchen's back corner.
const open: DesignDoc = { v: 1, title: "open", walls: [Wl("n", 0, 0, 480, 0), Wl("e", 480, 0, 480, 240), Wl("s", 480, 240, 0, 240), Wl("w", 0, 240, 0, 0)], openings: [], labels: [{ id: "k", name: "Kitchen", at: { x: 400, y: 120 } }, { id: "g", name: "Great room", at: { x: 150, y: 120 } }], marks: [] };
check("one space before: the kitchen isn't a room of its own", roomsOf(open).length === 1);
const closed = closeRoom(open, { x: 400, y: 120 }, { x0: 318, y0: 14, x1: 470, y1: 226 });
const kroom = closed ? roomsOf(closed).find((r) => pointInPoly({ x: 400, y: 120 }, r.poly)) : null;
check("the kitchen closes: its sides snapped to the outside walls, one boundary across the open side", !!closed && closed.walls.filter((w) => w.boundary).length === 1 && !!kroom && Math.abs(kroom.sqft - (160 * 240) / 144) < 25, kroom ? `${Math.round(kroom.sqft)} sq ft` : "no room");
check("…the boundary is a line on the floor: no face for cabinets or paint", !!kroom && roomSpans(closed!, kroom).every((s) => !closed!.walls.find((w) => w.id === s.wallId)?.boundary));
check("…and never a change to the house", houseChanges({ ...closed!, existing: { walls: open.walls, openings: [], at: "x" } }).length === 0);
check("an extent the label isn't in: not closed", closeRoom(open, { x: 100, y: 120 }, { x0: 318, y0: 14, x1: 470, y1: 226 }) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
