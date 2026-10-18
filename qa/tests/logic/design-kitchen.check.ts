// Home Design Studio, the kitchen kit (milestone 3, 2026-10-17): standard cabinet widths, a kitchen laid out in an
// empty room the way a designer would, the same kitchen read from what an architect drew, an item snapped to a wall.
//   npx tsx qa/tests/logic/design-kitchen.check.ts
import { autoKitchen, cornersOf, fillWidths, frameOf, kitchenFromPlan, overlaps, roomSpans, snapToWall } from "../../../src/lib/design/kitchen";
import { roomsOf, pointInPoly, dot, sub } from "../../../src/lib/design/geometry";
import { itemCode, lib, LIBRARY } from "../../../src/lib/design/library";
import { normalizeDesign } from "../../../src/lib/design/normalize";
import type { DesignDoc, DesignItem, P, PlanMark, Wall } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = (id: string, ax: number, ay: number, bx: number, by: number, thick = 4.5): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick, height: 96 });
const box = (w: number, d: number) => ({ w, d });
void box;

console.log("── standard widths");
const fw = (n: number) => fillWidths(n);
check("66 in → two 33s", JSON.stringify(fw(66).widths) === "[33,33]", JSON.stringify(fw(66)));
check("100 in → three 33s and a 1 in filler", JSON.stringify(fw(100).widths) === "[33,33,33]" && fw(100).filler === 1);
check("45 in → 24 + 21 (the widest smallest box)", JSON.stringify(fw(45).widths) === "[24,21]", JSON.stringify(fw(45)));
check("36 in → one 36", JSON.stringify(fw(36).widths) === "[36]");
check("8 in → nothing, all filler", fw(8).widths.length === 0 && fw(8).filler === 8);
check("every width a library size", [12, 48, 77, 131, 209].every((n) => fw(n).widths.every((w) => w % 3 === 0 && w >= 9 && w <= 36)));
check("the codes a shop writes", itemCode({ lib: "B", w: 24, h: 34.5 }) === "B24" && itemCode({ lib: "W", w: 30, h: 36 }) === "W3036" && itemCode({ lib: "P", w: 24, h: 84 }) === "P2484" && itemCode({ lib: "SB", w: 36, h: 34.5 }) === "SB36");
check("every library entry has a default width it allows", LIBRARY.every((e) => e.widths.includes(e.w)));

// A kitchen to lay out.
const floorCats = new Set(["base", "tall", "island", "appliance"]);
const floorItems = (items: DesignItem[]) => items.filter((i) => floorCats.has(lib(i.lib)?.cat ?? "") && i.z < 40 && i.lib !== "CT");
const noOverlaps = (items: DesignItem[]) => {
  const f = floorItems(items);
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (overlaps(f[i], f[j])) return `${itemCode(f[i])} × ${itemCode(f[j])}`;
  return "";
};
const tOn = (doc: DesignDoc, it: DesignItem, wallId: string) => {
  const room = roomsOf(doc)[0];
  const s = roomSpans(doc, room).find((x) => x.wallId === wallId)!;
  return dot(sub({ x: it.x, y: it.y }, s.a), s.dir);
};

console.log("── an empty 14 × 12 ft kitchen: a window on the long wall, a door opposite");
const k1: DesignDoc = {
  v: 1,
  title: "k1",
  walls: [W("top", 0, 0, 168, 0), W("right", 168, 0, 168, 144), W("bottom", 168, 144, 0, 144), W("left", 0, 144, 0, 0)],
  openings: [
    { id: "win", wallId: "top", kind: "window", at: 84, width: 36, height: 48, sill: 40 },
    { id: "door", wallId: "bottom", kind: "door", at: 120, width: 32, height: 80, sill: 0 },
  ],
  labels: [{ id: "k", name: "Kitchen", at: { x: 84, y: 72 } }],
  marks: [],
};
const room1 = roomsOf(k1)[0];
const r1 = autoKitchen(k1, room1, "k");
const it1 = r1.items;
const find = (items: DesignItem[], id: string) => items.filter((i) => i.lib === id);
const sb = find(it1, "SB")[0];
check("a sink base", !!sb);
check("…on the window wall, centered under the window (within 1½ in)", !!sb && sb.wallId === "top" && Math.abs(tOn(k1, sb, "top") - (84 - 2.25)) <= 1.5 + 0.01, sb ? String(tOn(k1, sb, "top")) : "");
const dw = find(it1, "DW")[0];
check("the dishwasher right beside the sink", !!dw && !!sb && Math.abs(Math.abs(tOn(k1, dw, "top") - tOn(k1, sb, "top")) - 30) < 0.6);
const rng = find(it1, "RNG")[0];
check("a range", !!rng);
const runOf = (it: DesignItem) => it1.filter((x) => x.wallId === it.wallId && (lib(x.lib)?.cat === "base" || x.lib === "DW") && x.z < 1);
if (rng) {
  const t = tOn(k1, rng, rng.wallId!);
  const neighbours = runOf(rng).map((x) => tOn(k1, x, rng.wallId!));
  check("…with counter on both sides", neighbours.some((n) => n < t) && neighbours.some((n) => n > t));
  const hd = find(it1, "HD")[0];
  check("a hood right over the range", !!hd && hd.wallId === rng.wallId && Math.abs(tOn(k1, hd, hd.wallId!) - t) < 0.6 && hd.z >= 60);
}
check("a 36 in fridge, with a cabinet over it", find(it1, "REF")[0]?.w === 36 && find(it1, "WR").length === 1);
check("a blind corner cabinet where the two runs meet", find(it1, "BC").length === 1);
check("no two things on the floor overlap", noOverlaps(it1) === "", noOverlaps(it1));
const doorAt = 120;
const inDoor = floorItems(it1).filter((i) => i.wallId === "bottom" && Math.abs(tOn(k1, i, "bottom") - (168 - doorAt - 2.25)) < (i.w + 32) / 2);
check("nothing stands in the doorway", inDoor.length === 0, inDoor.map(itemCode).join(" "));
check("everything inside the room", it1.every((i) => cornersOf(i).every((p) => pointInPoly(p, room1.poly))));
const overWindow = it1.filter((i) => i.lib === "W" && i.wallId === "top" && Math.abs(tOn(k1, i, "top") - (84 - 2.25)) < (i.w + 36) / 2);
check("no wall cabinet over the window", overWindow.length === 0, overWindow.map(itemCode).join(" "));
check("wall cabinets 18 in over the counter", find(it1, "W").length > 0 && find(it1, "W").every((w) => w.z === 54 && w.d === 12));
check("every piece's front faces into the room", it1.filter((i) => i.wallId).every((i) => {
  const { f } = frameOf(i);
  return pointInPoly({ x: i.x + f.x * (i.d / 2 + 6), y: i.y + f.y * (i.d / 2 + 6) }, room1.poly);
}));
check("too small for an island — and it says why", find(it1, "ISL").length === 0 && r1.notes.some((n) => /island/i.test(n)));
check("recessed lights over it", find(it1, "CAN").length >= 2);

console.log("── a 20 × 16 ft kitchen: room for an island");
const k2: DesignDoc = { ...k1, walls: [W("top", 0, 0, 240, 0), W("right", 240, 0, 240, 192), W("bottom", 240, 192, 0, 192), W("left", 0, 192, 0, 0)], openings: [{ id: "win", wallId: "top", kind: "window", at: 120, width: 48, height: 48, sill: 40 }], labels: [{ id: "k", name: "Kitchen", at: { x: 120, y: 96 } }] };
const room2 = roomsOf(k2)[0];
const r2 = autoKitchen(k2, room2, "k");
const isl = find(r2.items, "ISL")[0];
check("an island", !!isl, r2.notes.join(" | "));
if (isl) {
  const grown = { ...isl, w: isl.w + 84, d: isl.d + 84 };
  check("…42 in clear all round it", !floorItems(r2.items).some((i) => i !== isl && overlaps(grown, i)) && cornersOf(grown).every((p) => pointInPoly(p, room2.poly)));
  check("…with stools on its seating side", find(r2.items, "STL").length >= 2);
  check("…and pendants over it", find(r2.items, "PEN").length >= 2);
}
check("no two things on the floor overlap", noOverlaps(r2.items) === "", noOverlaps(r2.items));

console.log("── what an architect drew → the kitchen");
// An L counter (front edges 24 in off the top and left walls), a sink and a range in it, a fridge, an island.
const mk = (id: string, role: PlanMark["role"], lines: Array<[P, P]>): PlanMark => {
  const xs = lines.flatMap((l) => [l[0].x, l[1].x]);
  const ys = lines.flatMap((l) => [l[0].y, l[1].y]);
  return { id, role, lines, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
};
const rect = (x0: number, y0: number, x1: number, y1: number): Array<[P, P]> => [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]];
const circle = (cx: number, cy: number, r: number): Array<[P, P]> => Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  const b = ((i + 1) / 16) * Math.PI * 2;
  return [{ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }, { x: cx + r * Math.cos(b), y: cy + r * Math.sin(b) }] as [P, P];
});
const inner = 2.25; // the walls' inner face
const k3: DesignDoc = {
  ...k2,
  marks: [
    // Front edges: along the top wall from the corner's face to x 180, down the left wall to y 110.
    mk("ctrTop", "cabinet", [[{ x: inner + 24, y: inner + 24 }, { x: 180, y: inner + 24 }], [{ x: 180, y: inner }, { x: 180, y: inner + 24 }]]),
    mk("ctrLeft", "cabinet", [[{ x: inner + 24, y: inner + 24 }, { x: inner + 24, y: 110 }], [{ x: inner, y: 110 }, { x: inner + 24, y: 110 }]]),
    // A double sink in the top run, 32 × 18 (busy curves).
    mk("sink", "plumbing", [...rect(104, 5, 136, 23), ...circle(112, 14, 6), ...circle(128, 14, 6)]),
    // A range in the left run: 30 × 25 with four burners.
    mk("range", "appliance", rect(4, 60, 29, 90)),
    mk("b1", "appliance", circle(11, 67, 2.5)),
    mk("b2", "appliance", circle(22, 67, 2.5)),
    mk("b3", "appliance", circle(11, 83, 2.5)),
    mk("b4", "appliance", circle(22, 83, 2.5)),
    // A fridge after the top run's end: 36 × 30.
    mk("ref", "appliance", rect(184, 3, 220, 33)),
    // An island block standing free, with stools drawn on its far side (52 in deep in all).
    mk("isl", "cabinet", rect(90, 100, 162, 152)),
  ],
};
const room3 = roomsOf(k3)[0];
const r3 = kitchenFromPlan(k3, room3, "k");
const it3 = r3.items;
check("it says what it found", /From the plan: .*counter.*island.*range.*sink.*fridge/i.test(r3.notes.join(" ")), r3.notes.join(" | "));
const sb3 = find(it3, "SB")[0];
check("a sink base under the drawn sink", !!sb3 && sb3.wallId === "top" && Math.abs(sb3.x - 120) <= 3, sb3 ? `${sb3.x}` : "none");
check("…a double sink", sb3?.opts?.sink === "double");
check("the dishwasher beside it", find(it3, "DW").length === 1 && find(it3, "DW")[0].wallId === "top");
const rng3 = find(it3, "RNG")[0];
check("the range where it's drawn, in the left run", !!rng3 && rng3.wallId === "left" && Math.abs(rng3.y - 75) <= 3, rng3 ? `${rng3.y}` : "none");
check("a hood over it", find(it3, "HD").length === 1);
check("the fridge where it's drawn", find(it3, "REF").length === 1 && Math.abs(find(it3, "REF")[0].x - 202) <= 3, find(it3, "REF")[0] ? `${find(it3, "REF")[0].x}` : "");
check("the corner where the L meets", find(it3, "BC").length === 1);
const isl3 = find(it3, "ISL")[0];
check("the island, with seats (the stools drawn behind it)", !!isl3 && !!isl3.opts?.seats && isl3.w === 72 && isl3.d === 36, isl3 ? `${isl3.w}×${isl3.d}` : "none");
check("no two things on the floor overlap", noOverlaps(it3) === "", noOverlaps(it3));
check("nothing drawn → the room says so", kitchenFromPlan({ ...k3, marks: [] }, room3, "k").notes.some((n) => /draws nothing/.test(n)));

console.log("── dragging a cabinet near a wall");
const b24 = { id: "x", lib: "B", x: 60, y: 40, rot: 0, w: 24, d: 24, h: 34.5, z: 0 };
const sn = snapToWall(k1, room1, b24, { x: 60, y: 20 });
check("its back goes flush to the wall face", Math.abs(sn.y - (2.25 + 12)) < 0.01 && sn.wallId === "top", JSON.stringify(sn));
check("…and it turns to face the room", Math.abs(sn.rot - 90) < 0.01);
check("a pendant doesn't snap to walls", snapToWall(k1, room1, { ...b24, lib: "PEN" }, { x: 60, y: 20 }).wallId === null);

console.log("── saved designs keep only what's real");
const n = normalizeDesign({ ...k1, items: [{ id: "a", lib: "B", x: 1, y: 2, rot: 90, w: 24, d: 24, h: 34.5, z: 0, wallId: "top", room: "k" }, { id: "b", lib: "NOPE" }, { id: "c", lib: "W", x: 1, y: 1, rot: 0, w: 9999, d: 12, h: 36, z: 54, wallId: "gone" }], finishes: { k: { wall: { color: "red", name: "x" }, cabinets: { style: "fancy", color: "#112233" } }, nope: {} } });
check("an unknown library item dropped", (n.items ?? []).length === 2);
check("sizes clamped, a missing wall forgotten", n.items?.[1].w === 240 && n.items?.[1].wallId === null);
check("finishes: a bad colour falls back, a bad style too, an unknown room dropped", n.finishes?.k.wall.color === "#f3efe6" && n.finishes?.k.cabinets.style === "shaker" && n.finishes?.k.cabinets.color === "#112233" && !n.finishes?.nope);

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
