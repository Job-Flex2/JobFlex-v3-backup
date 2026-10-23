// THE SYMBOLS LEGEND (2026-10-23) — pure: every mark the plans use, drawn by
// the same renderer at full size (scale 1: model inches are paper inches), so
// the legend can never drift from the drawings.
import { Sketch, type View } from "./draft";

export function legendView(): View {
  const k = new Sketch(1);
  const row = 0.42;
  const colW = 2.05;
  const items: Array<(x: number, y: number) => string> = [
    (x, y) => (k.bubble(x + 0.2, y, "grid", "A"), "GRID LINE"),
    (x, y) => (k.bubble(x + 0.2, y, "detail", "1", "S-501"), "DETAIL: NUMBER / SHEET"),
    (x, y) => (k.bubble(x + 0.2, y, "section", "1", "S-301", 0), "SECTION CUT, LOOKING →"),
    (x, y) => (k.bubble(x + 0.2, y, "tag", "J1"), "MEMBER TAG — SCHEDULE"),
    (x, y) => (k.bubble(x + 0.2, y, "foot", "F1"), "FOOTING TAG — SCHEDULE"),
    (x, y) => (k.datum(x + 0.1, y, "T.O. DECK", "+5'-1\""), ""),
    (x, y) => (k.line(x, y, x + 0.42, y, "hidden"), "BELOW / HIDDEN"),
    (x, y) => (k.line(x, y, x + 0.42, y, "phantom"), "ABOVE / OUTLINE OVER"),
    (x, y) => (k.line(x, y, x + 0.42, y, "center"), "CENTRE OR GRID LINE"),
    (x, y) => (k.rect(x, y - 0.08, 0.42, 0.16, "light", "concrete"), "CONCRETE"),
    (x, y) => (k.rect(x, y - 0.08, 0.42, 0.16, "light", "earth"), "EARTH, CUT"),
    (x, y) => (k.rect(x, y - 0.08, 0.42, 0.16, "medium", "woodCut"), "WOOD, CUT ACROSS"),
    (x, y) => (k.rect(x, y - 0.08, 0.42, 0.16, "medium", "poche"), "EXISTING HOUSE"),
    (x, y) => (k.north(x + 0.2, y + 0.04, 0), "NORTH"),
  ];
  items.forEach((draw, i) => {
    const col = i % 3;
    const r = Math.floor(i / 3);
    const x = col * colW;
    const y = r * row + 0.2;
    const label = draw(x, y);
    if (label) k.text(x + 0.55, y, label, "sm", { base: "middle", bold: true });
  });
  return k.view("legend", "Symbols", "None", 0.04);
}
