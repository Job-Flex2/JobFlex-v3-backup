"use client";
// THE BACK WALL, SEEN FROM ABOVE (2026-10-11; owner: "hard to understand what's
// edge and what's not, where the jogs go — make it smarter, more automated,
// draggable"): the house's wall as a line with its steps, the house's body
// behind it, the deck's outline under it with its two ends named, and
// handles to drag — each step along the wall, and the house's two corners.
// Feet in, feet out; the studio keeps the design.
import * as React from "react";
import { shapeOutline, type DeckShape } from "@/lib/deck/design";
import { HOUSE_LIMITS, wallParts, type HouseDesign } from "@/lib/deck/house";
import s from "./deck-studio.module.css";

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ft = (n: number) => `${Math.round(n * 2) / 2} ft`;

export function HouseWallPlan({ shape, house, onChange }: { shape: DeckShape; house: HouseDesign; onChange: (next: HouseDesign) => void }) {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const parts = wallParts(house, shape);
  const xMin = -house.leftFt;
  const xMax = W + house.rightFt;
  const depths = parts.map((p) => p.depthFt);
  const yTop = Math.min(0, ...depths) - 7;
  const yBottom = Math.max(0, ...depths) + Math.min(D, 9) + 3;
  const pad = 2.5;
  const vbW = xMax - xMin + 2 * pad;
  const vb = `${xMin - pad} ${yTop} ${vbW} ${yBottom - yTop}`;
  // The wall line through the parts, a riser at every step.
  const pts: string[] = [];
  parts.forEach((p, i) => {
    if (i === 0) pts.push(`${p.x0},${p.depthFt}`);
    pts.push(`${p.x1},${p.depthFt}`);
    if (i + 1 < parts.length) pts.push(`${p.x1},${parts[i + 1].depthFt}`);
  });
  const body = `${xMin},${yTop} ${pts.join(" ")} ${xMax},${yTop}`;
  const deck = shapeOutline(shape)
    .map((p) => `${p.x / 12},${p.y / 12}`)
    .join(" ");
  const depthAt = (x: number) => parts.find((p) => x >= p.x0 && x <= p.x1)?.depthFt ?? 0;

  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ kind: "jog" | "left" | "right"; id?: string } | null>(null);
  const xAt = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const r = svg.getBoundingClientRect();
    return xMin - pad + ((clientX - r.left) / Math.max(1, r.width)) * vbW;
  };
  const down = (kind: "jog" | "left" | "right", id?: string) => (e: React.PointerEvent<SVGElement>) => {
    drag.current = { kind, id };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = half(xAt(e.clientX));
    if (d.kind === "jog") {
      const atFt = clamp(x, xMin + 1, xMax - 1);
      const j = house.jogs.find((k) => k.id === d.id);
      if (j && j.atFt !== atFt) onChange({ ...house, jogs: house.jogs.map((k) => (k.id === d.id ? { ...k, atFt } : k)) });
    } else if (d.kind === "left") {
      const leftFt = clamp(-x, HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
      if (leftFt !== house.leftFt) onChange({ ...house, leftFt });
    } else {
      const rightFt = clamp(x - W, HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
      if (rightFt !== house.rightFt) onChange({ ...house, rightFt });
    }
  };
  const up = () => {
    drag.current = null;
  };
  const leftX = 0 - house.leftFt;
  const rightX = W + house.rightFt;
  const font = Math.max(0.9, vbW / 42);
  const handleR = Math.max(0.8, vbW / 46);
  return (
    <div className={s.wallPlan} data-deck-wall-plan>
      <svg ref={svgRef} viewBox={vb} className={s.wallPlanSvg} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="img" aria-label="The back wall seen from above, with the deck under it">
        <polygon points={body} className={s.wallBody} />
        <polygon points={deck} className={s.wallDeck} />
        <polyline points={pts.join(" ")} className={s.wallLine} />
        <text x={(xMin + xMax) / 2} y={yTop + font * 1.4} fontSize={font} textAnchor="middle" className={s.wallLabel}>
          the house
        </text>
        <text x={W / 2} y={Math.min(D, 9) * 0.55 + font * 0.4} fontSize={font} textAnchor="middle" className={s.wallLabel}>
          the deck
        </text>
        <line x1={0} y1={depthAt(0)} x2={0} y2={yBottom - font * 1.6} className={s.wallEnd} />
        <line x1={W} y1={depthAt(W)} x2={W} y2={yBottom - font * 1.6} className={s.wallEnd} />
        <text x={0} y={yBottom - font * 0.4} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
          left end · 0
        </text>
        <text x={W} y={yBottom - font * 0.4} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
          right end · {ft(W)}
        </text>
        {house.jogs.map((j) => {
          const y = Math.max(depthAt(j.atFt - 0.01), depthAt(j.atFt + 0.01));
          return (
            <g key={j.id}>
              <circle cx={j.atFt} cy={y} r={handleR} className={s.wallHandle} onPointerDown={down("jog", j.id)} data-deck-wall-handle="jog" data-deck-wall-jog={j.id} tabIndex={0} role="slider" aria-label={`A step in the wall at ${ft(j.atFt)}`} aria-valuenow={j.atFt} />
              <text x={j.atFt} y={y - handleR - font * 0.5} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
                {ft(j.atFt)} · {j.dir === "toward" ? "out" : "back"} {ft(j.depthFt)}
              </text>
            </g>
          );
        })}
        <polygon points={`${xMin},${depthAt(xMin + 0.01) - handleR} ${xMin - handleR * 1.6},${depthAt(xMin + 0.01)} ${xMin},${depthAt(xMin + 0.01) + handleR}`} className={s.wallHandle} onPointerDown={down("left")} data-deck-wall-handle="left" tabIndex={0} role="slider" aria-label="The house's left corner" aria-valuenow={leftX} />
        <polygon points={`${xMax},${depthAt(xMax - 0.01) - handleR} ${xMax + handleR * 1.6},${depthAt(xMax - 0.01)} ${xMax},${depthAt(xMax - 0.01) + handleR}`} className={s.wallHandle} onPointerDown={down("right")} data-deck-wall-handle="right" tabIndex={0} role="slider" aria-label="The house's right corner" aria-valuenow={rightX} />
      </svg>
    </div>
  );
}
