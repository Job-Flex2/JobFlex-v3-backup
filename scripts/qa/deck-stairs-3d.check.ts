// THE STAIRS READ AS STAIRS (owner, 2026-10-12, with a screenshot of a wide flight: "the stairs in 3D look like they don't
// have treads and risers — fix it") — pure, no browser.
//
// A cut stringer is drawn as a box whose top line runs under the treads' backs. It ran one riser higher (along the treads'
// fronts), so every stringer stood up through every tread — 6 in. at its back — and a wide flight read as a ramp ribbed
// by its stringers; and each tread's 1-in. nosing was laid at its back, so no tread overhung the riser below it. Every
// flight here, narrow to the widest, one flight or two with a landing: no stringer rises above any tread it runs under,
// and every tread's front stands past the face of the riser below it.
//
// Run: npx tsx --tsconfig tsconfig.json scripts/qa/deck-stairs-3d.check.ts
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { defaultDeckDesign } from "../../src/lib/deck/design";
import { buildStructure } from "../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
const stair = (widthFt: number, atFt: number) => [{ id: "s1", side: "front" as const, atFt, widthFt, level: "upper" as const, wrap: false, wrapSides: 1 as const, landing: "pad" as const, handrail: "auto" as const }];

for (const [name, heightIn, widthFt] of [["a 4-ft flight, 36 in. up", 36, 4], ["a 12-ft flight (as wide as it goes), 42 in. up", 42, 12], ["a 6-ft flight, 30 in. up", 30, 6], ["a tall 5-ft flight with a landing, 110 in. up", 110, 5]] as const) {
  const design = applyDeckPatch(base, { heightIn, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, stairs: stair(widthFt, 8) as never });
  const s = buildStructure(design);
  const st = s.stairs[0];
  if (!st || st.kind !== "flight") {
    check(`${name}: built as a flight`, false, st ? st.kind : "no stair");
    continue;
  }
  // The flight runs out from the deck's front: +y. Group by height: treads, risers and stringers.
  const treads = st.members.filter((m) => m.role === "tread");
  const risers = st.members.filter((m) => m.role === "riser");
  const stringers = st.members.filter((m) => m.role === "stringer");
  let poke = 0;
  let worst = 0;
  for (const sg of stringers) {
    // The stringer's top face, for a flight running out along +y and down at θ (tilt = −θ): z = cz + (depth/2)/cos θ − tan θ·(y − cy).
    const th = -sg.tilt;
    const topZ = (y: number) => sg.cz + sg.sz / 2 / Math.cos(th) - Math.tan(th) * (y - sg.cy);
    const yMid = sg.cy + (sg.sz / 2) * Math.sin(th);
    const y0 = yMid - (sg.sx / 2) * Math.cos(th);
    const y1 = yMid + (sg.sx / 2) * Math.cos(th);
    for (const tr of treads) {
      if (Math.abs(tr.cx - sg.cx) > tr.sx / 2) continue;
      const ya = Math.max(y0, tr.cy - tr.sy / 2);
      const yb = Math.min(y1, tr.cy + tr.sy / 2);
      if (!(yb > ya)) continue;
      const bottom = tr.cz - tr.sz / 2;
      for (const y of [ya, yb]) {
        const over = topZ(y) - bottom;
        worst = Math.max(worst, over);
        if (over > 0.05) poke++;
      }
    }
  }
  check(`${name}: no stringer stands up through a tread`, poke === 0, `${stringers.length} stringers, ${treads.length} tread boards; highest a stringer reaches over a tread's underside ${worst.toFixed(2)} in.`);
  // Every riser below a tread: the tread's front edge stands past the riser's outer face by the nosing.
  let flush = 0;
  let nosing = Infinity;
  for (const rs of risers) {
    const face = rs.cy + rs.sy / 2;
    const above = treads.filter((tr) => Math.abs(tr.cz - tr.sz / 2 - (rs.cz + rs.sz / 2)) < 0.6);
    if (!above.length) continue;
    const front = Math.max(...above.map((tr) => tr.cy + tr.sy / 2));
    // Boards come in widths: two 5½-in. boards and a gap over a 10½-in. run leave a ⅝-in. nosing — half an inch reads.
    if (front - face < 0.5) flush++;
    nosing = Math.min(nosing, front - face);
  }
  check(`${name}: every tread's nosing stands out past the riser below it`, flush === 0, `${risers.length} risers, ${flush} flush, the least nosing ${Number.isFinite(nosing) ? nosing.toFixed(2) : "-"} in.`);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
