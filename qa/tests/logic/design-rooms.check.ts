// Home Design Studio, every room (2026-10-18): what kind of room a name is, a first layout for each kind ("Furnish
// it") inside its walls and clear of its doors, every library piece built in 3D within its footprint, the checks a
// bath is held to by the code (IRC R307.1, P2708.1) and the walkways for the other rooms, and each room priced by its
// own trade's steps — a bath by the bathroom-remodel book, a bedroom as the finish work it is, furniture never.
//   npx tsx qa/tests/logic/design-rooms.check.ts
import * as THREE from "three";
import { autoFurnish, kindOfRoom, KIT, roomKind } from "../../../src/lib/design/rooms";
import { roomChecks, designChecks } from "../../../src/lib/design/checks";
import { cornersOf, overlaps } from "../../../src/lib/design/kitchen";
import { roomsOf, pointInPoly } from "../../../src/lib/design/geometry";
import { DEFAULT_FINISHES, LIBRARY, lib, newItemFrom } from "../../../src/lib/design/library";
import { normalizeDesign } from "../../../src/lib/design/normalize";
import { benchmarkFor, DEFAULT_OPTIONS, priceDesign, scopeText, takeoff } from "../../../src/lib/design/estimate";
import { roomFinishes } from "../../../src/lib/design/roomKinds";
import { buildItem, type Mats } from "../../../src/components/v3/design-studio/items-3d";
import type { DesignDoc, DesignItem, RoomKind, Wall } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = (id: string, ax: number, ay: number, bx: number, by: number, thick = 4.5): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick, height: 96 });
/** A w × h in room, a 32 in door near the right end of the bottom wall, a window in the top wall when asked. */
const roomDoc = (name: string, w: number, h: number, opts: { window?: boolean; door?: number } = {}): DesignDoc => ({
  v: 1,
  title: name,
  walls: [W("top", 0, 0, w, 0), W("right", w, 0, w, h), W("bottom", w, h, 0, h), W("left", 0, h, 0, 0)],
  openings: [{ id: "door", wallId: "bottom", kind: "door", at: opts.door ?? 26, width: 32, height: 80, sill: 0 }, ...(opts.window ? [{ id: "win", wallId: "top", kind: "window" as const, at: w / 2, width: 48, height: 48, sill: 30 }] : [])],
  labels: [{ id: "r", name, at: { x: w / 2, y: h / 2 } }],
  marks: [],
});
const furnish = (doc: DesignDoc, kind?: RoomKind) => {
  const room = roomsOf(doc)[0];
  const r = autoFurnish(doc, room, "r", kind);
  return { room, r, doc: { ...doc, items: r.items } as DesignDoc };
};
const ids = (items: DesignItem[]) => items.map((i) => i.lib).sort().join(" ");
const has = (items: DesignItem[], id: string) => items.filter((i) => i.lib === id).length;
const TUCK = new Set(["CHR", "STL", "OCH"]);
const UNDER = new Set(["TBL", "DSK", "ISL", "CTB"]);
/** Nothing on the floor in another floor piece's spot (chairs tuck under a table; a rug lies under everything). */
const clash = (items: DesignItem[]) => {
  const f = items.filter((i) => i.z < 30 && lib(i.lib)?.cat !== "light" && i.lib !== "RUG");
  for (let i = 0; i < f.length; i++)
    for (let j = i + 1; j < f.length; j++) {
      const a = f[i];
      const b = f[j];
      if ((TUCK.has(a.lib) && UNDER.has(b.lib)) || (TUCK.has(b.lib) && UNDER.has(a.lib))) continue;
      if (overlaps(a, b, 1)) return `${a.lib} × ${b.lib}`;
    }
  return "";
};
const inside = (room: { poly: Array<{ x: number; y: number }> }, items: DesignItem[]) => items.filter((i) => !cornersOf({ ...i, w: i.w - 2, d: i.d - 2 }).every((p) => pointInPoly(p, room.poly))).map((i) => i.lib);
const check3 = (cs: ReturnType<typeof roomChecks>, id: string) => cs.find((c) => c.id === id || c.id.startsWith(`${id}:`));

console.log("── what kind of room a name is");
const names: Array<[string, RoomKind]> = [
  ["Kitchen", "kitchen"], ["Master bath 2", "bath"], ["Powder", "bath"], ["Master bedroom 2", "bedroom"], ["Bedroom 3", "bedroom"], ["Walk-in closet", "closet"],
  ["Great room", "living"], ["Family room", "living"], ["Nook", "dining"], ["Dining", "dining"], ["Den", "office"], ["Foyer", "entry"], ["Mud room", "entry"],
  ["Hall", "entry"], ["3-car garage", "garage"], ["Rear covered patio", "outdoor"], ["Butler's pantry", "pantry"], ["Laundry", "laundry"], ["Bonus", "living"], ["Storage", "other"],
];
const wrong = names.filter(([n, k]) => roomKind(n) !== k).map(([n, k]) => `${n}: ${roomKind(n)} (want ${k})`);
check(`${names.length} names read as their kind`, !wrong.length, wrong.join("; "));
const bonus = roomDoc("Bonus", 144, 144);
bonus.labels[0].use = "office";
check("the designer's word outranks the name (Bonus → office)", kindOfRoom(bonus, roomsOf(bonus)[0]) === "office");
const kept = normalizeDesign({ ...bonus, labels: [{ ...bonus.labels[0], use: "office" }, { id: "x", name: "X", at: { x: 1, y: 1 }, use: "spaceship" }] });
check("a saved design keeps a room's kind, drops one that isn't", kept.labels[0].use === "office" && kept.labels[1].use === undefined);
check("every kind's kit is real library pieces", Object.values(KIT).every((list) => list.every((id) => !!lib(id))));

console.log("── every piece in 3D, within its footprint");
const fakeMats = (): Mats => {
  const m = new Map<string, THREE.Material>();
  return { get: (k, make) => m.get(k) ?? (m.set(k, make()), m.get(k)!), tex: () => new THREE.Texture(), dispose: () => undefined };
};
const ctx = { mats: fakeMats(), f: DEFAULT_FINISHES, ceiling: 96, splashTop: 54 };
const off3d: string[] = [];
for (const e of LIBRARY) {
  const it = newItemFrom(e.id, { x: 0, y: 0, rot: 0 }, `t${e.id}`)!;
  let g: THREE.Group;
  try {
    g = buildItem(it, ctx);
  } catch (err) {
    off3d.push(`${e.id} threw ${(err as Error).message}`);
    continue;
  }
  let meshes = 0;
  const bb = new THREE.Box3();
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      bb.expandByObject(o);
    }
  });
  const inch = (v: number) => v * 12;
  const finite = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].every(Number.isFinite);
  const reach = 14;
  const ok = meshes > 0 && finite && inch(bb.max.x) <= it.w / 2 + reach && inch(bb.min.x) >= -it.w / 2 - reach && inch(bb.max.z) <= it.d / 2 + reach && inch(bb.min.z) >= -it.d / 2 - reach && inch(bb.min.y) >= -40 && inch(bb.max.y) <= it.h + 60;
  if (!ok) off3d.push(`${e.id}: ${meshes} meshes, x ${inch(bb.min.x).toFixed(0)}..${inch(bb.max.x).toFixed(0)} z ${inch(bb.min.z).toFixed(0)}..${inch(bb.max.z).toFixed(0)} y ${inch(bb.min.y).toFixed(0)}..${inch(bb.max.y).toFixed(0)}`);
}
check(`all ${LIBRARY.length} library pieces build`, !off3d.length, off3d.join("; "));

console.log("── a full bath, 8 × 10 ft");
{
  const { room, r, doc } = furnish(roomDoc("Master bath", 96, 120, { window: true }));
  check("tub, vanity with a mirror, toilet", has(r.items, "TUB") === 1 && has(r.items, "VAN") === 1 && has(r.items, "MIR") === 1 && has(r.items, "WC") === 1, ids(r.items));
  check("inside the walls", !inside(room, r.items).length, inside(room, r.items).join(" "));
  check("nothing in the same spot", !clash(r.items), clash(r.items));
  const cs = roomChecks(doc, "r");
  const fails = cs.filter((c) => !c.ok).map((c) => `${c.title}: ${c.detail}`);
  check("its own layout passes every check", !fails.length, fails.join(" | "));
  check("held to the code: the toilet's 15 in and 21 in, the vanity's 21 in", !!check3(cs, "wc-side") && !!check3(cs, "wc-front") && !!check3(cs, "lav-front") && check3(cs, "wc-side")!.source === "IRC R307.1");
  check("designChecks picks the bath's checks", designChecks(doc, "r").some((c) => c.id.startsWith("wc-side")));
  // A toilet shoved 10 in from the side wall, a shower too small inside.
  const wc = doc.items!.find((i) => i.lib === "WC")!;
  const tight: DesignDoc = { ...doc, items: [...doc.items!.filter((i) => i.lib !== "WC"), { ...wc, x: 2.25 + 10 + 0, y: wc.y, rot: 0, wallId: "left" }] };
  tight.items![tight.items!.length - 1] = { ...tight.items![tight.items!.length - 1], x: 2.25 + wc.d / 2, y: 2.25 + 10 + 30, rot: 0 };
  const cs2 = roomChecks(tight, "r");
  const side = cs2.find((c) => c.id.startsWith("wc-side"));
  check("a toilet 10 in from the wall fails the code", !!side && !side.ok, side ? side.title : "no check");
  const shw = newItemFrom("SHW", { x: 60, y: 40, rot: 90, wallId: null, room: "r" }, "shw", 30)!;
  shw.d = 30;
  const cs3 = roomChecks({ ...doc, items: [...doc.items!, shw] }, "r");
  const small = cs3.find((c) => c.id === "shw-size:shw");
  check("a 30 × 30 shower (28 × 28 inside) is too small", !!small && !small.ok && small.source === "IRC P2708.1", small?.detail);

  const t = takeoff(doc, "r")!;
  const lines = priceDesign(t, DEFAULT_FINISHES, DEFAULT_OPTIONS, 1);
  const key = (k: string) => lines.find((l) => l.key === k);
  check("priced as a bath", t.kind === "bath" && !!key("bath-rough-plumb") && !!key("bath-vanity") && !!key("bath-fixtures") && !!key("bath-fan"), lines.map((l) => l.key).join(" "));
  const basins = doc.items!.filter((i) => i.lib === "VAN").reduce((n, v) => n + (v.w >= 60 ? 2 : 1), 0);
  check(`rough plumbing for the toilet, ${basins === 2 ? "both basins" : "the basin"} and the tub`, key("bath-rough-plumb")?.qty === 2 + basins, `${key("bath-rough-plumb")?.qty} for ${basins} basins`);
  check("the tub's surround tiled, no shower pan", (key("bath-wall-tile")?.qty ?? 0) > 0 && !key("bath-pan"));
  const words = `${lines.map((l) => `${l.name} ${l.desc}`).join(" ")} ${scopeText(t, DEFAULT_FINISHES, DEFAULT_OPTIONS)}`;
  check("never called a kitchen", !/kitchen/i.test(words), words.match(/.{30}kitchen.{30}/i)?.[0]);
  const b = benchmarkFor(t, 1);
  check("held against a full bath's benchmark", !!b && /bathroom/i.test(b.words) && b.low > 10000, b?.words);
}

console.log("── each kind starts from its own finishes");
{
  const bath = roomDoc("Master bath", 96, 120);
  const bed = roomDoc("Bedroom 2", 144, 144);
  check("a bath starts on tile, in satin", roomFinishes(bath, "r").floor.id.startsWith("tile") && roomFinishes(bath, "r").wall.sheen === "satin");
  check("a bedroom keeps the wood floor", roomFinishes(bed, "r").floor.id === DEFAULT_FINISHES.floor.id);
  const chosen: DesignDoc = { ...bath, finishes: { r: { ...DEFAULT_FINISHES, floor: { id: "walnut", pattern: "straight", angle: 0 } } } };
  check("what the designer chose outranks the kind's start", roomFinishes(chosen, "r").floor.id === "walnut");
  const t = takeoff(furnish(bath).doc, "r")!;
  const lines = priceDesign(t, roomFinishes(bath, "r"), DEFAULT_OPTIONS, 1);
  check("the bath's tile floor priced by the bath book", lines.some((l) => l.key === "bath-floor") && !lines.some((l) => l.key === "underlay"), lines.map((l) => l.key).join(" "));
}

console.log("── a powder room, 5 × 6 ft, the door in the middle of the short wall");
{
  const { room, r, doc } = furnish(roomDoc("Powder", 60, 72, { door: 30 }));
  const slim = r.items.find((i) => i.lib === "VAN");
  check("a slim vanity beside the door's swing", !!slim && slim.d <= 18, slim ? `${slim.w} × ${slim.d} in` : "none");
  check("a vanity and a toilet, no tub", has(r.items, "VAN") === 1 && has(r.items, "WC") === 1 && !has(r.items, "TUB") && !has(r.items, "SHW"), ids(r.items));
  check("inside the walls, nothing overlapping", !inside(room, r.items).length && !clash(r.items), inside(room, r.items).join(" ") + clash(r.items));
  check("no full-bath benchmark for a powder room", benchmarkFor(takeoff(doc, "r")!, 1) === null);
}

console.log("── a bedroom, 12 × 13 ft");
{
  const { room, r, doc } = furnish(roomDoc("Bedroom 2", 156, 144, { window: true, door: 130 }));
  const bed = r.items.find((i) => i.lib === "BED");
  check("a queen bed, two nightstands, a dresser", bed?.w === 60 && has(r.items, "NS") === 2 && has(r.items, "DRS") === 1, ids(r.items));
  check("the headboard against a wall without the window", !!bed?.wallId && bed.wallId !== "top", bed?.wallId ?? "");
  check("inside the walls, nothing overlapping", !inside(room, r.items).length && !clash(r.items), inside(room, r.items).join(" ") + clash(r.items));
  const cs = roomChecks(doc, "r");
  const fails = cs.filter((c) => !c.ok).map((c) => `${c.title}: ${c.detail}`);
  check("its own layout passes every check", !fails.length, fails.join(" | "));
  const t = takeoff(doc, "r")!;
  const lines = priceDesign(t, DEFAULT_FINISHES, DEFAULT_OPTIONS, 1);
  check("priced as the finish work: floor, paint, trim — no cabinets, no plumbing", lines.some((l) => l.key === "floor") && lines.some((l) => l.key === "room-paint-walls") && lines.some((l) => l.key === "room-trim") && !lines.some((l) => /cab|plumb|counter/.test(l.key)), lines.map((l) => l.key).join(" "));
  check("the furniture is not priced, and the scope says so", t.furnishings >= 4 && /not part of this price/.test(scopeText(t, DEFAULT_FINISHES, DEFAULT_OPTIONS)));
  check("no book benchmark for a bedroom", benchmarkFor(t, 1) === null);
}

console.log("── a living room, 16 × 14 ft");
{
  const { room, r, doc } = furnish(roomDoc("Living room", 192, 168, { window: true, door: 160 }));
  check("sofa, coffee table, two armchairs, a rug, the TV", has(r.items, "SOFA") === 1 && has(r.items, "CTB") === 1 && has(r.items, "ARM") === 2 && has(r.items, "RUG") === 1 && has(r.items, "TVC") === 1, ids(r.items));
  check("inside the walls, nothing overlapping", !inside(room, r.items).length && !clash(r.items), inside(room, r.items).join(" ") + clash(r.items));
  const fails = roomChecks(doc, "r").filter((c) => !c.ok).map((c) => `${c.title}: ${c.detail}`);
  check("its own layout passes every check", !fails.length, fails.join(" | "));
}

console.log("── a dining room, 14 × 12 ft");
{
  const { room, r, doc } = furnish(roomDoc("Dining", 168, 144, { window: true, door: 140 }));
  check("a table and a chair every 24 in", has(r.items, "TBL") === 1 && has(r.items, "CHR") >= 6, ids(r.items));
  check("inside the walls, chairs tucked, nothing else overlapping", !inside(room, r.items).length && !clash(r.items), inside(room, r.items).join(" ") + clash(r.items));
  const fails = roomChecks(doc, "r").filter((c) => !c.ok).map((c) => `${c.title}: ${c.detail}`);
  check("36 in round the table to pull a chair out", !fails.length, fails.join(" | "));
}

console.log("── a laundry, 8 × 7 ft");
{
  const { room, r, doc } = furnish(roomDoc("Laundry", 96, 84, { door: 70 }));
  check("washer and dryer side by side", has(r.items, "WSH") === 1 && has(r.items, "DRY") === 1, ids(r.items));
  check("inside the walls, nothing overlapping", !inside(room, r.items).length && !clash(r.items), inside(room, r.items).join(" ") + clash(r.items));
  const fails = roomChecks(doc, "r").filter((c) => !c.ok).map((c) => `${c.title}: ${c.detail}`);
  check("36 in in front of the machines", !fails.length, fails.join(" | "));
  const t = takeoff(doc, "r")!;
  const lines = priceDesign(t, DEFAULT_FINISHES, DEFAULT_OPTIONS, 1);
  check("priced by the laundry book: plumbing, the 240 V circuit, the vent, the set", ["laundry-plumb", "laundry-elec", "laundry-vent", "laundry-set"].every((k) => lines.some((l) => l.key === k)), lines.map((l) => l.key).join(" "));
}

console.log("── an office, a walk-in closet, a garage, a patio");
for (const [name, w, h, want] of [["Den", 120, 120, ["DSK", "OCH", "SHF"]], ["Walk-in closet", 72, 96, ["CLS"]], ["3-car garage", 360, 264, ["WBN"]], ["Rear covered patio", 216, 168, ["TBL", "LNG", "GRL"]]] as Array<[string, number, number, string[]]>) {
  const { room, r, doc } = furnish(roomDoc(name, w, h, { door: 30 }));
  check(`${name}: ${want.join(", ")}`, want.every((id) => has(r.items, id)), ids(r.items));
  check(`${name}: inside the walls, nothing overlapping`, !inside(room, r.items).length && !clash(r.items), inside(room, r.items).join(" ") + clash(r.items));
  const fails = roomChecks(doc, "r").filter((c) => !c.ok).map((c) => `${c.title}: ${c.detail}`);
  check(`${name}: its own layout passes every check`, !fails.length, fails.join(" | "));
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
