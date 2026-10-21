"use client";
// THE SITE PLAN, DRAWN (2026-10-20) — lib/deck/sitePlan's layout at a true
// engineering scale (1" = 10', 20', 30' …), so a reviewer can put a scale on
// the paper: the street, the property lines with their lengths, the house,
// the new deck, its stairs and roof, the distance to every lot line, north,
// the graphic scale. Feet in the SVG's own units, Y flipped.
import * as React from "react";
import type { SiteLayout, SitePlan, XY } from "@/lib/deck/sitePlan";
import { ftIn } from "@/lib/deck/codeTables";
import s from "./deck-permit.module.css";

const ft = (n: number) => ftIn(Math.round(n * 12));
const pts = (ring: readonly XY[]) => ring.map(([x, y]) => `${x},${-y}`).join(" ");

export function SitePlanSvg({ layout, plan, scaleFtPerIn, storeys, label }: { layout: SiteLayout; plan: SitePlan; scaleFtPerIn: number; storeys: 1 | 2; label: string }) {
  const b = layout.bounds;
  const pad = scaleFtPerIn * 0.35;
  // Type a reviewer can read at any scale: ~7.5 pt on paper.
  const F = scaleFtPerIn * 0.105;
  // Room below the front line for the street and the graphic scale, and beside the lot for north.
  const x0 = b.x0 - pad;
  const y0 = Math.min(b.y0, -F * 9.6) - pad;
  const w = b.x1 + F * 5 - b.x0 + pad * 2;
  const h = b.y1 - y0 + pad;
  const lw = scaleFtPerIn * 0.012;
  const lotBox = { x0: Math.min(...layout.lot.map((p) => p[0])), x1: Math.max(...layout.lot.map((p) => p[0])) };
  const centre = (ring: readonly XY[]): XY => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
  const deckC = centre(layout.deck.flat());
  const houseC = centre(layout.house);
  const north: XY = [b.x1 + F * 2.6, b.y1 - F * 2.2];
  const unit = scaleFtPerIn;
  return (
    <svg className={s.siteSvg} width={`${w / scaleFtPerIn}in`} height={`${h / scaleFtPerIn}in`} viewBox={`${x0} ${-(y0 + h)} ${w} ${h}`} role="img" aria-label={label}>
      <defs>
        <pattern id="siteHatch" width={F * 0.9} height={F * 0.9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={F * 0.9} stroke="#9a9690" strokeWidth={lw * 0.8} />
        </pattern>
      </defs>
      {/* The street */}
      <rect x={lotBox.x0 - F * 3} y={F * 1.2} width={lotBox.x1 - lotBox.x0 + F * 6} height={F * 3.2} className={s.siteStreet} />
      <text x={(lotBox.x0 + lotBox.x1) / 2} y={F * 3.2} fontSize={F * 1.05} textAnchor="middle" className={s.siteStreetText}>{(plan.street || "STREET").toUpperCase()}</text>
      {/* The lot */}
      <polygon points={pts(layout.lot)} className={s.siteLot} strokeWidth={lw * 2.2} strokeDasharray={`${F * 1.6} ${F * 0.4} ${F * 0.25} ${F * 0.4}`} />
      {layout.lotEdges.map((e, i) => {
        const mx = (e.a[0] + e.b[0]) / 2;
        const my = (e.a[1] + e.b[1]) / 2;
        // Outward of a counter-clockwise ring is to the right of the edge.
        const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
        const nx = (e.b[1] - e.a[1]) / len;
        const ny = -(e.b[0] - e.a[0]) / len;
        let ang = (Math.atan2(-(e.b[1] - e.a[1]), e.b[0] - e.a[0]) * 180) / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        const tx = mx + nx * F * (e.side === "front" ? 0.6 : 0.9);
        const ty = my + ny * F * (e.side === "front" ? 0.6 : 0.9);
        return (
          <text key={i} x={tx} y={-ty} fontSize={F * 0.85} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${tx} ${-ty})`} className={s.siteEdge}>
            {`${ft(e.ft)} P.L.`}
          </text>
        );
      })}
      {/* The house */}
      <polygon points={pts(layout.house)} fill="url(#siteHatch)" className={s.siteHouse} strokeWidth={lw * 1.6} />
      <text x={houseC[0]} y={-houseC[1] + F * 0.2} fontSize={F * 1.05} textAnchor="middle" className={s.siteLabel}>EXISTING HOUSE</text>
      <text x={houseC[0]} y={-houseC[1] + F * 1.45} fontSize={F * 0.8} textAnchor="middle" className={s.siteNote}>{storeys === 2 ? "two stories" : "one story"}</text>
      {/* The roof over the deck */}
      {layout.roof ? <polygon points={pts(layout.roof)} className={s.siteRoof} strokeWidth={lw * 1.2} strokeDasharray={`${F * 0.6} ${F * 0.35}`} /> : null}
      {/* The deck and its stairs */}
      {layout.deck.map((r, i) => (
        <polygon key={`d${i}`} points={pts(r)} className={s.siteDeck} strokeWidth={lw * 2} />
      ))}
      {layout.stairs.map((r, i) => (
        <polygon key={`s${i}`} points={pts(r)} className={s.siteStair} strokeWidth={lw * 1.2} />
      ))}
      <text x={deckC[0]} y={-deckC[1] + F * 0.1} fontSize={F * 1.05} textAnchor="middle" className={s.siteLabel}>NEW DECK</text>
      <text x={deckC[0]} y={-deckC[1] + F * 1.3} fontSize={F * 0.8} textAnchor="middle" className={s.siteNote}>{layout.deckWords}{layout.roof ? " · roof over" : ""}</text>
      {/* The distances to the lot lines */}
      {layout.distances.map((dd, i) => {
        const mx = (dd.from[0] + dd.to[0]) / 2;
        const my = (dd.from[1] + dd.to[1]) / 2;
        const vertical = Math.abs(dd.to[1] - dd.from[1]) > Math.abs(dd.to[0] - dd.from[0]);
        return (
          <g key={`dist${i}`} className={s.siteDim}>
            <line x1={dd.from[0]} y1={-dd.from[1]} x2={dd.to[0]} y2={-dd.to[1]} strokeWidth={lw} />
            <circle cx={dd.from[0]} cy={-dd.from[1]} r={F * 0.18} />
            <circle cx={dd.to[0]} cy={-dd.to[1]} r={F * 0.18} />
            <text x={mx + (vertical ? F * 0.5 : 0)} y={-my - (vertical ? 0 : F * 0.45)} fontSize={F * 0.85} textAnchor={vertical ? "start" : "middle"} className={s.siteDimText}>{ft(dd.ft)}</text>
          </g>
        );
      })}
      {/* The house to the front line (not for a deck in front: the deck's own distance says it) */}
      <g className={s.siteDim} display={plan.deckSide === "front" ? "none" : undefined}>
        <line x1={houseC[0]} y1={-layout.houseBox.y0} x2={houseC[0]} y2={0} strokeWidth={lw} strokeDasharray={`${F * 0.4} ${F * 0.25}`} />
        <text x={houseC[0] + F * 0.5} y={-layout.houseBox.y0 / 2} fontSize={F * 0.85} className={s.siteDimText}>{`${ft(layout.houseFrontFt)} TO FRONT P.L.`}</text>
      </g>
      {/* North */}
      <g transform={`translate(${north[0]} ${-north[1]}) rotate(${plan.northDeg})`} className={s.siteNorth}>
        <circle r={F * 1.3} fill="none" strokeWidth={lw * 1.2} />
        <polygon points={`0,${-F * 1.25} ${F * 0.5},${F * 0.6} 0,${F * 0.25} ${-F * 0.5},${F * 0.6}`} />
        <text y={-F * 1.55} fontSize={F * 1.05} textAnchor="middle">N</text>
      </g>
      {/* The graphic scale */}
      <g className={s.siteScale} transform={`translate(${lotBox.x0} ${F * 6.8})`}>
        <rect x={0} y={0} width={unit} height={F * 0.35} fill="#0a0a0a" />
        <rect x={unit} y={0} width={unit} height={F * 0.35} fill="#fff" stroke="#0a0a0a" strokeWidth={lw} />
        <text x={0} y={F * 1.3} fontSize={F * 0.75} textAnchor="middle">0</text>
        <text x={unit} y={F * 1.3} fontSize={F * 0.75} textAnchor="middle">{unit}&apos;</text>
        <text x={unit * 2} y={F * 1.3} fontSize={F * 0.75} textAnchor="middle">{unit * 2}&apos;</text>
      </g>
    </svg>
  );
}
