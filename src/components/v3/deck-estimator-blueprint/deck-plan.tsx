"use client";
// THE FRAMING PLAN (2026-10-04; the roof 2026-10-10; levels, stairs, rails and
// fixtures M3 2026-10-10) — the structure seen from above, drawn the way a
// framer sketches it: the outline in heavy ink (a bow or clipped corners as
// drawn), the house wall hatched, the ledger along it, every joist, the beams
// (dashed where they sit under the joists, solid where they are flush), posts
// on their footings, the blocking, the dimensions a crew lays out by; the
// lower level the same a step down; the stairs with their treads; the rail
// with its posts; the fixtures as amber marks. With a roof: its posts, the
// headers between them, the rafters, hips and ridge in blueprint blue, and
// the eave line dashed outside the posts.
//
// Owner: "stairs placed by pointing." In placing mode a click near an open
// edge tells the studio which edge, how far along, and which level.
import * as React from "react";
import type { DeckFrame } from "@/lib/deck/frame";
import type { DeckStructure } from "@/lib/deck/structure";
import { structureLevels } from "@/lib/deck/structure";
import { ftIn } from "@/lib/deck/codeTables";
import { shapeOutline, type StairSide } from "@/lib/deck/design";
import s from "./deck-studio.module.css";

export interface PlanEdgeHit {
  level: "upper" | "lower";
  side: StairSide;
  atFt: number;
}

const FIXTURE_MARK: Record<string, string> = { "led-strip": "L", "post-cap": "c", "step-light": "s", "string-light": "S", sconce: "W", "ceiling-light": "L", chandelier: "C", fan: "F", outlet: "O", heater: "H", flood: "F" };

export function DeckPlan({ structure, placing = null, onPlaceStair }: { structure: DeckStructure; placing?: "stair" | null; onPlaceStair?: (hit: PlanEdgeHit) => void }) {
  const { frame, roof } = structure;
  const levels = structureLevels(structure);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const eave = roof?.eaveRing ?? [];
  const xs = [...levels.flatMap((l) => l.frame.zones.flatMap((z) => [z.zone.x0 + l.offsetXIn, z.zone.x1 + l.offsetXIn])), ...eave.map((p) => p.x), ...(roof ? [0] : []), ...structure.stairs.flatMap((st) => st.footprint.map((p) => p.x))];
  const ys = [...levels.flatMap((l) => l.frame.zones.flatMap((z) => [z.zone.y0 + l.offsetYIn, z.zone.y1 + l.offsetYIn])), ...eave.map((p) => p.y), ...(roof ? [0] : []), ...structure.stairs.flatMap((st) => st.footprint.map((p) => p.y))];
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 48);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 48);
  const size = Math.max(maxX - minX, maxY - minY);
  const font = Math.max(9, size / 34);
  const pad = font * 5.5;
  const onHouse = frame ? frame.design.placement !== "detached" : roof?.attach === "wall";
  const houseBand = font * 2.2;
  const lw = Math.max(0.8, size / 260);
  const dimY = maxY + font * 2.6;
  const dimX = maxX + font * 2.6;
  const joistNote = frame ? `${frame.joistSize} joists @ ${frame.spacingIn}" o.c.` : "";
  const roofNote = roof ? `${roof.rafters.size} rafters @ ${roof.rafters.spacingIn}" o.c.` : "";
  const vb = `${minX - pad} ${minY - pad - (onHouse ? houseBand : 0)} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2 + (onHouse ? houseBand : 0)}`;
  const roofMembers = (roles: string[]) => (roof ? roof.members.filter((m) => roles.includes(m.role)) : []);

  /** A click in placing mode: the nearest open edge of a level, and where along it. */
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!placing || !onPlaceStair || !svgRef.current) return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best: { d: number; hit: PlanEdgeHit } | null = null;
    for (const l of levels) {
      const W = Math.max(...l.frame.zones.map((z) => z.zone.x1));
      const D = Math.max(...l.frame.zones.map((z) => z.zone.y1));
      const ox = l.offsetXIn;
      const oy = l.offsetYIn;
      const edges: Array<{ side: StairSide; d: number; at: number; open: boolean }> = [
        { side: "front", d: Math.abs(pt.y - (oy + D)), at: pt.x - ox, open: pt.x >= ox && pt.x <= ox + W },
        { side: "left", d: Math.abs(pt.x - ox), at: pt.y - oy, open: pt.y >= oy && pt.y <= oy + D && l.frame.edges.some((ed) => ed.side === "left" && !ed.house) },
        { side: "right", d: Math.abs(pt.x - (ox + W)), at: pt.y - oy, open: pt.y >= oy && pt.y <= oy + D && l.frame.edges.some((ed) => ed.side === "right" && !ed.house) },
      ];
      for (const ed of edges) {
        if (!ed.open || ed.d > 36) continue;
        if (!best || ed.d < best.d) best = { d: ed.d, hit: { level: l.id, side: ed.side, atFt: Math.round((ed.at / 12) * 2) / 2 } };
      }
    }
    if (best) onPlaceStair(best.hit);
  };

  const levelDrawing = (f: DeckFrame, ox: number, oy: number, lower: boolean) => {
    const zones = f.zones.map((z) => z.zone);
    const W = Math.max(...zones.map((z) => z.x1));
    const D = Math.max(...zones.map((z) => z.y1));
    const outline = shapeOutline(f.design.shape).map((p) => `${p.x + ox},${p.y + oy}`).join(" ");
    const sticks = (role: string) => f.sticks.filter((st) => st.role === role);
    const rect = (st: (typeof f.sticks)[number], key: string, fill: string, stroke?: string, sw = lw * 0.6) =>
      st.yaw ? (
        <rect key={key} x={st.cx + ox - st.sx / 2} y={st.cy + oy - st.sy / 2} width={st.sx} height={st.sy} fill={fill} stroke={stroke} strokeWidth={sw} transform={`rotate(${(st.yaw * 180) / Math.PI} ${st.cx + ox} ${st.cy + oy})`} />
      ) : (
        <rect key={key} x={st.cx + ox - st.sx / 2} y={st.cy + oy - st.sy / 2} width={st.sx} height={st.sy} fill={fill} stroke={stroke} strokeWidth={sw} />
      );
    return (
      <g key={lower ? "lower" : "upper"} opacity={lower ? 0.92 : 1}>
        {f.posts.map((p) => (
          <circle key={`f${p.id}`} cx={p.x + ox} cy={p.y + oy} r={p.footing.padIn / 2} fill="none" stroke="var(--muted)" strokeWidth={lw} strokeDasharray={`${lw * 3} ${lw * 2}`} />
        ))}
        {f.beams.map((b) => (
          <rect key={b.id} x={b.x0 + ox} y={b.y + oy - b.spec.thickIn / 2} width={b.x1 - b.x0} height={b.spec.thickIn} fill={b.style === "flush" ? "var(--paper-deep)" : "none"} stroke="var(--blueprint)" strokeWidth={lw * 1.6} strokeDasharray={b.style === "dropped" ? `${lw * 6} ${lw * 3}` : undefined} />
        ))}
        {sticks("joist").map((j, i) => rect(j, `j${i}`, "var(--paper-deep)", "var(--ink-soft)"))}
        {sticks("rim").map((r, i) => rect(r, `r${i}`, r.curved ? "var(--blueprint)" : "var(--paper-deep)", "var(--ink-soft)"))}
        {sticks("blocking").map((b, i) => rect(b, `k${i}`, "var(--muted-light)"))}
        {sticks("ledger").map((l, i) => rect(l, `l${i}`, "var(--ink)"))}
        {f.posts.filter((p) => !p.roof).map((p) => {
          const w = p.size === "8x8" ? 7.5 : p.size === "6x6" ? 5.5 : 3.5;
          const d = p.size === "4x6" ? 5.5 : w;
          return <rect key={p.id} x={p.x + ox - w / 2} y={p.y + oy - d / 2} width={w} height={d} fill="var(--ink)" />;
        })}
        <polygon points={outline} fill="none" stroke="var(--ink)" strokeWidth={lw * 2.2} />
        {f.beams.map((b) => (
          <text key={`bt${b.id}`} x={b.x0 + ox + font * 0.6} y={b.y + oy - b.spec.thickIn / 2 - font * 0.45} fontSize={font * 0.9} className={s.planNote}>
            {`${b.spec.size} ${b.style === "flush" ? "flush " : ""}beam · posts ${ftIn(b.spanIn)} o.c.`}
          </text>
        ))}
        {!roof || lower ? (
          <text x={W / 2 + ox} y={(f.zones[0].zone.y0 + (f.beams[0]?.y ?? D)) / 2 + oy} fontSize={font * 0.95} textAnchor="middle" className={s.planNote}>
            {lower ? `lower level · ${f.joistSize} @ ${f.spacingIn}" · ${ftIn(f.surfaceIn)} high` : joistNote}
          </text>
        ) : null}
      </g>
    );
  };

  return (
    <svg ref={svgRef} className={`${s.planSvg}${placing ? ` ${s.planPlacing}` : ""}`} viewBox={vb} role="img" aria-label={`Framing plan: ${ftIn(maxX - minX)} by ${ftIn(maxY - minY)}${joistNote ? `, ${joistNote}` : ""}${roofNote ? `, ${roofNote}` : ""}`} onClick={onClick} data-deck-plan={placing ? "placing" : "plan"}>
      <defs>
        <pattern id="deckHatch" width={font} height={font} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={font} stroke="var(--muted-light)" strokeWidth={lw} />
        </pattern>
      </defs>
      {/* The house, where the deck meets it. */}
      {frame
        ? frame.edges.filter((e) => e.house).map((e, i) => {
            const horizontal = e.y0 === e.y1;
            const x = Math.min(e.x0, e.x1);
            const y = Math.min(e.y0, e.y1);
            return horizontal ? (
              <rect key={`h${i}`} x={x} y={y - houseBand} width={Math.abs(e.x1 - e.x0)} height={houseBand} fill="url(#deckHatch)" stroke="var(--ink)" strokeWidth={lw} />
            ) : (
              <rect key={`h${i}`} x={x - (e.side === "left" ? 0 : houseBand)} y={y} width={houseBand} height={Math.abs(e.y1 - e.y0)} fill="url(#deckHatch)" stroke="var(--ink)" strokeWidth={lw} />
            );
          })
        : onHouse
          ? <rect x={minX} y={-houseBand} width={maxX - minX} height={houseBand} fill="url(#deckHatch)" stroke="var(--ink)" strokeWidth={lw} />
          : null}
      {onHouse ? (
        <text x={(minX + maxX) / 2} y={-houseBand / 2 + font * 0.35} fontSize={font} textAnchor="middle" className={s.planLabel}>
          HOUSE
        </text>
      ) : null}
      {/* The deck's levels. */}
      {levels.map((l) => levelDrawing(l.frame, l.offsetXIn, l.offsetYIn, l.id === "lower"))}
      {/* The stairs: the footprint and every tread line. */}
      {structure.stairs.map((st) => {
        const pts = st.footprint.map((p) => `${p.x},${p.y}`).join(" ");
        const treads = st.members.filter((m) => m.role === "tread" || m.role === "box-tread" || m.role === "landing-tread");
        return (
          <g key={`st${st.design.id}`} className={s.planStair}>
            <polygon points={pts} fill="var(--paper)" stroke="var(--ink)" strokeWidth={lw * 1.4} />
            {treads.map((m, i) => (
              <rect key={i} x={m.cx - m.sx / 2} y={m.cy - m.sy / 2} width={m.sx} height={m.sy} fill="none" stroke="var(--ink-soft)" strokeWidth={lw * 0.6} transform={m.yaw ? `rotate(${(m.yaw * 180) / Math.PI} ${m.cx} ${m.cy})` : undefined} />
            ))}
            {st.kind === "flight" && st.footprint[0] && st.footprint[3] ? (
              <line x1={(st.footprint[0].x + st.footprint[1].x) / 2} y1={(st.footprint[0].y + st.footprint[1].y) / 2} x2={(st.footprint[2].x + st.footprint[3].x) / 2} y2={(st.footprint[2].y + st.footprint[3].y) / 2} stroke="var(--blueprint)" strokeWidth={lw} markerEnd="url(#arrow)" />
            ) : null}
            <text x={st.footprint.reduce((a, p) => a + p.x, 0) / st.footprint.length} y={st.footprint.reduce((a, p) => a + p.y, 0) / st.footprint.length + font * 0.35} fontSize={font * 0.8} textAnchor="middle" className={s.planNote}>
              {st.kind === "box" ? `box steps · ${st.risers} risers` : `${st.widthIn / 12} ft stair · ${st.risers} risers`}
            </text>
          </g>
        );
      })}
      {/* The rail: a line just inside the edge, a square at every post. */}
      {structure.rails.on ? (
        <g className={s.planRail}>
          {structure.rails.segments.map((sg, i) => (
            <line key={i} x1={sg.x0} y1={sg.y0} x2={sg.x1} y2={sg.y1} stroke="var(--ink)" strokeWidth={lw * 2.6} strokeLinecap="butt" opacity={0.75} />
          ))}
          {structure.rails.members.filter((m) => m.role === "rail-post").map((m, i) => (
            <rect key={i} x={m.cx - 2} y={m.cy - 2} width={4} height={4} fill="#fff" stroke="var(--ink)" strokeWidth={lw} />
          ))}
        </g>
      ) : null}
      {/* The roof: eave line dashed, rafters, hips and ridge in blue, headers heavy, posts solid. */}
      {roof ? (
        <g className={s.planRoof}>
          {roof.slab ? <rect x={Math.min(...roof.ring.map((p) => p.x)) - 12} y={Math.min(...roof.ring.map((p) => p.y)) - 12} width={Math.max(...roof.ring.map((p) => p.x)) - Math.min(...roof.ring.map((p) => p.x)) + 24} height={Math.max(...roof.ring.map((p) => p.y)) - Math.min(...roof.ring.map((p) => p.y)) + 24} fill="var(--paper)" stroke="var(--muted)" strokeWidth={lw} /> : null}
          <polygon points={roof.eaveRing.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--blueprint)" strokeWidth={lw * 1.2} strokeDasharray={`${lw * 5} ${lw * 3}`} />
          {roofMembers(["rafter", "jack", "fly", "purlin", "slat", "tie"]).map((m, i) => (
            <line key={`rf${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} stroke="var(--blueprint)" strokeWidth={m.role === "slat" ? lw * 0.4 : lw * 0.7} opacity={m.role === "slat" || m.role === "purlin" ? 0.5 : 0.85} />
          ))}
          {roofMembers(["hip", "ridge", "ring"]).map((m, i) => (
            <line key={`hr${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} stroke="var(--blueprint-dark)" strokeWidth={lw * 1.8} />
          ))}
          {roof.headers.map((h) => (
            <line key={h.id} x1={h.x0} y1={h.y0} x2={h.x1} y2={h.y1} stroke="var(--ink)" strokeWidth={lw * 2.4} />
          ))}
          {roof.walls?.segments.map((w, i) => (
            <line key={`w${i}`} x1={w.x0} y1={w.y0} x2={w.x1} y2={w.y1} stroke="var(--blueprint-dark)" strokeWidth={lw * 3.5} opacity={0.5} />
          ))}
          {roof.ledger ? <rect x={Math.min(...roof.members.filter((m) => m.role === "roof-ledger").map((m) => m.x0))} y={0} width={roof.ledger.lengthIn} height={1.5} fill="var(--ink)" /> : null}
          {roof.posts.map((p) => {
            const w = p.size === "8x8" ? 7.5 : p.size === "6x6" ? 5.5 : 3.5;
            return <rect key={p.id} x={p.x - w / 2} y={p.y - w / 2} width={w} height={w} fill="var(--blueprint-dark)" stroke="#fff" strokeWidth={lw * 0.6} />;
          })}
          {roof.posts.filter((p) => p.footing).map((p) => (
            <circle key={`rf${p.id}`} cx={p.x} cy={p.y} r={(p.footing?.padIn ?? 12) / 2} fill="none" stroke="var(--muted)" strokeWidth={lw} strokeDasharray={`${lw * 3} ${lw * 2}`} />
          ))}
          <text x={roof.centreX} y={roof.centreY + font * 0.35} fontSize={font * 0.95} textAnchor="middle" className={s.planNote}>
            {roofNote}
          </text>
          {roof.headers[0] ? (
            <text x={roof.headers[0].x0 + font * 0.6} y={roof.headers[0].y0 - font * 0.6} fontSize={font * 0.85} className={s.planNote}>
              {`${[...new Set(roof.headers.map((h) => h.spec.size))].join("/")} headers · ${roof.posts.length} posts`}
            </text>
          ) : null}
        </g>
      ) : null}
      {/* Fixtures: amber marks with a letter. */}
      {structure.electrical.on ? (
        <g className={s.planFixtures}>
          {structure.electrical.fixtures.map((fx) =>
            fx.kind === "led-strip" || fx.kind === "string-light" ? (
              <line key={fx.id} x1={fx.x - (Math.cos(fx.yaw) * fx.sx) / 2} y1={fx.y - (Math.sin(fx.yaw) * fx.sx) / 2} x2={fx.x + (Math.cos(fx.yaw) * fx.sx) / 2} y2={fx.y + (Math.sin(fx.yaw) * fx.sx) / 2} stroke="#d9a21b" strokeWidth={lw * 1.6} strokeDasharray={fx.kind === "string-light" ? `${lw * 2} ${lw * 2}` : undefined} />
            ) : (
              <g key={fx.id}>
                <circle cx={fx.x} cy={fx.y} r={font * 0.55} fill={fx.supply === "client" ? "#fff" : "#f1c45a"} stroke="#9a6d0a" strokeWidth={lw} strokeDasharray={fx.supply === "client" ? `${lw * 2} ${lw * 1.5}` : undefined} />
                <text x={fx.x} y={fx.y + font * 0.3} fontSize={font * 0.7} textAnchor="middle" fill="#5b4000" fontWeight={700}>
                  {FIXTURE_MARK[fx.kind] ?? "•"}
                </text>
              </g>
            ),
          )}
        </g>
      ) : null}
      {/* Dimensions. */}
      <g className={s.planDim}>
        <line x1={minX} y1={dimY} x2={maxX} y2={dimY} strokeWidth={lw} />
        <line x1={minX} y1={dimY - font * 0.6} x2={minX} y2={dimY + font * 0.6} strokeWidth={lw} />
        <line x1={maxX} y1={dimY - font * 0.6} x2={maxX} y2={dimY + font * 0.6} strokeWidth={lw} />
        <text x={(minX + maxX) / 2} y={dimY + font * 1.5} fontSize={font} textAnchor="middle">{ftIn(maxX - minX)}</text>
        <line x1={dimX} y1={minY} x2={dimX} y2={maxY} strokeWidth={lw} />
        <line x1={dimX - font * 0.6} y1={minY} x2={dimX + font * 0.6} y2={minY} strokeWidth={lw} />
        <line x1={dimX - font * 0.6} y1={maxY} x2={dimX + font * 0.6} y2={maxY} strokeWidth={lw} />
        <text x={dimX + font * 0.9} y={(minY + maxY) / 2} fontSize={font} transform={`rotate(90 ${dimX + font * 0.9} ${(minY + maxY) / 2})`} textAnchor="middle">{ftIn(maxY - minY)}</text>
      </g>
      {placing ? (
        <text x={(minX + maxX) / 2} y={minY - pad * 0.45 - (onHouse ? houseBand : 0)} fontSize={font * 1.1} textAnchor="middle" className={s.planNote}>
          Click an open edge to put the stairs there
        </text>
      ) : null}
    </svg>
  );
}
