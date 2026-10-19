"use client";
// DECK ESTIMATOR — VARIANT 2, THE DRAFTING TABLE (2026-10-18). "The deck is the interface": the plan seen from above
// fills the page, and every part of it is something to press — the house wall, the boards, the joists and beams, the
// rail, each stair, the roof, each light. A press opens that part's settings in the inspector; a hover names it. The
// deck's right and front edges carry blue handles: drag them (or focus one and use the arrow keys) and the deck is
// re-framed and re-priced as it moves. The drawing's geometry is the engine's own (lib/deck/structure) — the same
// members deck-plan.tsx draws, read from the same build; nothing is redrawn by hand.
import * as React from "react";
import type { DeckStructure } from "@/lib/deck/structure";
import { structureLevels } from "@/lib/deck/structure";
import { ftIn } from "@/lib/deck/codeTables";
import { shapeOutline, spaRectIn, type DeckDesign } from "@/lib/deck/design";
import { nearestStairEdge, type PlanEdgeHit } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import type { DeckEdit } from "@/components/estimator/deck/DeckModel3D";
import { cx } from "./deck-v2-controls";

export type Part = "deck" | "site" | "house" | "frame" | "boards" | "rails" | "stairs" | "roof" | "lights";
export interface PartHit {
  part: Part;
  /** The stair or the fixture pressed. */
  id?: string;
  /** What the hover names. */
  name: string;
}

const FIXTURE_MARK: Record<string, string> = { "led-strip": "L", "post-cap": "c", "step-light": "s", "string-light": "S", sconce: "W", "ceiling-light": "L", chandelier: "C", fan: "F", outlet: "O", heater: "H", flood: "F" };

type HandleKind = "width" | "depth" | "corner" | "lower-depth" | "roof-width" | "roof-depth";
interface Drag {
  kind: HandleKind;
  x0: number;
  y0: number;
  /** The design numbers at the start, feet. */
  w0: number;
  d0: number;
  vb: string;
}

export function DeckV2Plan({
  structure,
  design,
  selected,
  selectedId,
  hovered,
  onSelect,
  onHover,
  onEdit,
  placing,
  onPlaceStair,
}: {
  structure: DeckStructure;
  design: DeckDesign;
  selected: Part | null;
  selectedId: string | null;
  hovered: PartHit | null;
  onSelect: (hit: PartHit | null) => void;
  onHover: (hit: PartHit | null) => void;
  onEdit: (e: DeckEdit) => void;
  placing: boolean;
  onPlaceStair: (hit: PlanEdgeHit) => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [drag, setDrag] = React.useState<Drag | null>(null);
  // Pixels per inch of the drawing as it stands on screen: the type is sized in screen pixels, not in inches.
  const [boxW, setBoxW] = React.useState(900);
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { frame, roof } = structure;
  const levels = structureLevels(structure);
  const eave = roof?.eaveRing ?? [];
  const xs = [...levels.flatMap((l) => l.frame.zones.flatMap((z) => [z.zone.x0 + l.offsetXIn, z.zone.x1 + l.offsetXIn])), ...eave.map((p) => p.x), ...structure.stairs.flatMap((st) => st.footprint.map((p) => p.x))];
  const ys = [...levels.flatMap((l) => l.frame.zones.flatMap((z) => [z.zone.y0 + l.offsetYIn, z.zone.y1 + l.offsetYIn])), ...eave.map((p) => p.y), ...structure.stairs.flatMap((st) => st.footprint.map((p) => p.y))];
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 48);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 48);
  const size = Math.max(maxX - minX, maxY - minY);
  const pad = size * 0.2 + 24;
  const onHouse = frame ? frame.design.placement !== "detached" : roof?.attach === "wall";
  const houseBand = size * 0.07 + 6;
  const liveVb = `${minX - pad} ${minY - pad - (onHouse ? houseBand : 0)} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2 + (onHouse ? houseBand : 0)}`;
  // While a handle is held the sheet stays where it was: the deck grows under the pointer instead of the paper moving.
  const vb = drag?.vb ?? liveVb;
  const vbW = Number(vb.split(" ")[2]);
  const ppi = boxW / vbW;
  const px = (n: number) => n / Math.max(ppi, 0.01);
  const lw = px(1);
  const font = px(13);
  const dimFont = px(17);

  const W = frame ? Math.max(...frame.zones.map((z) => z.zone.x1)) : 0;
  const D = frame ? Math.max(...frame.zones.map((z) => z.zone.y1)) : 0;
  const lowerLevel = levels.find((l) => l.id === "lower") ?? null;
  const dimY = maxY + Math.max(px(26), pad * 0.25);
  const dimX = maxX + Math.max(px(26), pad * 0.25);

  const toSvg = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  };

  /* ── the handles ── */
  const startDrag = (kind: HandleKind, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const pt = toSvg(e.clientX, e.clientY);
    if (!pt) return;
    const w0 = kind === "roof-width" ? (design.roof.plan.shape === "hexagon" || design.roof.plan.shape === "octagon" || design.roof.plan.shape === "round" ? design.roof.plan.acrossFt : design.roof.plan.widthFt) : kind === "lower-depth" ? design.lower.depthFt : design.shape.widthFt;
    const d0 = kind === "roof-depth" ? design.roof.plan.depthFt : kind === "lower-depth" ? design.lower.depthFt : design.shape.depthFt;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ kind, x0: pt.x, y0: pt.y, w0, d0, vb: liveVb });
    onSelect({ part: kind.startsWith("roof") ? "roof" : "deck", name: "Size" });
  };
  const moveDrag = (e: React.PointerEvent, done = false) => {
    if (!drag) return;
    const pt = toSvg(e.clientX, e.clientY);
    if (!pt) return;
    const dx = (pt.x - drag.x0) / 12;
    const dy = (pt.y - drag.y0) / 12;
    const send = (kind: DeckEdit["kind"], value: number) => onEdit({ kind, id: kind, value, done });
    if (drag.kind === "width" || drag.kind === "corner") send("width", drag.w0 + dx);
    if (drag.kind === "depth" || drag.kind === "corner") send("depth", drag.d0 + dy);
    if (drag.kind === "lower-depth") send("lower-depth", drag.d0 + dy);
    if (drag.kind === "roof-width") send("roof-width", drag.w0 + dx);
    if (drag.kind === "roof-depth") send("roof-depth", drag.d0 + dy);
    if (done) setDrag(null);
  };
  const keyNudge = (kind: HandleKind, e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 2 : 0.5;
    const grow = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!grow) return;
    e.preventDefault();
    const sideways = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const polygonRoof = design.roof.plan.shape === "hexagon" || design.roof.plan.shape === "octagon" || design.roof.plan.shape === "round";
    const send = (k: DeckEdit["kind"], value: number) => onEdit({ kind: k, id: k, value, done: true });
    if (kind === "width" || (kind === "corner" && sideways)) send("width", design.shape.widthFt + grow * step);
    if (kind === "depth" || (kind === "corner" && !sideways)) send("depth", design.shape.depthFt + grow * step);
    if (kind === "lower-depth") send("lower-depth", design.lower.depthFt + grow * step);
    if (kind === "roof-width") send("roof-width", (polygonRoof ? design.roof.plan.acrossFt : design.roof.plan.widthFt) + grow * step);
    if (kind === "roof-depth") send("roof-depth", design.roof.plan.depthFt + grow * step);
  };
  const handle = (kind: HandleKind, x: number, y: number, label: string, value: number) => {
    const s = px(22);
    const cursor = kind === "width" || kind === "roof-width" ? "ew-resize" : kind === "corner" ? "nwse-resize" : "ns-resize";
    return (
      <g
        key={kind}
        className={cx("v2-handle", drag?.kind === kind && "is-drag")}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuetext={`${feetWords(value)}`}
        style={{ cursor }}
        onPointerDown={(e) => startDrag(kind, e)}
        onPointerMove={(e) => moveDrag(e)}
        onPointerUp={(e) => moveDrag(e, true)}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => keyNudge(kind, e)}
        onClick={(e) => e.stopPropagation()}
        data-v2-handle={kind}
      >
        <rect x={x - s} y={y - s} width={s * 2} height={s * 2} fill="transparent" />
        <rect className="v2-handle-knob" x={x - s / 2} y={y - s / 2} width={s} height={s} strokeWidth={px(2)} />
        {kind === "corner" ? null : kind === "width" || kind === "roof-width" ? (
          <path d={`M${x - s * 0.22} ${y - s * 0.2} L${x - s * 0.36} ${y} L${x - s * 0.22} ${y + s * 0.2} M${x + s * 0.22} ${y - s * 0.2} L${x + s * 0.36} ${y} L${x + s * 0.22} ${y + s * 0.2}`} className="v2-handle-arrow" strokeWidth={px(1.6)} />
        ) : (
          <path d={`M${x - s * 0.2} ${y - s * 0.22} L${x} ${y - s * 0.36} L${x + s * 0.2} ${y - s * 0.22} M${x - s * 0.2} ${y + s * 0.22} L${x} ${y + s * 0.36} L${x + s * 0.2} ${y + s * 0.22}`} className="v2-handle-arrow" strokeWidth={px(1.6)} />
        )}
      </g>
    );
  };

  /* ── pressing a part ── */
  const isSel = (p: Part, id?: string) => selected === p && (!id || !selectedId || selectedId === id);
  const isHov = (p: Part, id?: string) => hovered?.part === p && (!id || hovered.id === id);
  const partProps = (hit: PartHit) => ({
    "data-part": hit.part,
    className: cx("v2-part", isSel(hit.part, hit.id) && "is-sel", isHov(hit.part, hit.id) && "is-hov"),
    onPointerEnter: (e: React.PointerEvent) => {
      if (!e.buttons && !drag) onHover(hit);
    },
    onPointerLeave: () => onHover(null),
    onClick: (e: React.MouseEvent) => {
      if (placing) return;
      e.stopPropagation();
      onSelect(hit);
    },
  });
  const onSheetClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (drag) return;
    if (placing) {
      const pt = toSvg(e.clientX, e.clientY);
      if (!pt) return;
      const hit = nearestStairEdge(structure, pt.x, pt.y);
      if (hit) onPlaceStair(hit);
      return;
    }
    onSelect(null);
  };

  const joistNote = frame ? `${frame.joistSize} joists @ ${frame.spacingIn}" o.c.` : "";
  const roofNote = roof ? (roof.trusses ? `trusses @ ${roof.trusses.spacingIn}" o.c.` : `${roof.rafters.size} rafters @ ${roof.rafters.spacingIn}" o.c.`) : "";
  const boardsName = frame ? `Deck boards · ${frame.decking.label}` : "Deck boards";
  const frameName = frame ? `Frame · ${joistNote}` : "Frame";
  const spa = frame ? spaRectIn(design) : null;
  const selFrame = isSel("frame") || isHov("frame");

  const levelDrawing = (f: NonNullable<typeof frame>, ox: number, oy: number, lower: boolean) => {
    const zones = f.zones.map((z) => z.zone);
    const lW = Math.max(...zones.map((z) => z.x1));
    const lD = Math.max(...zones.map((z) => z.y1));
    const outlinePts = shapeOutline(f.design.shape);
    const outline = outlinePts.map((p) => `${p.x + ox},${p.y + oy}`).join(" ");
    const sticks = (role: string) => f.sticks.filter((st) => st.role === role);
    const rect = (st: (typeof f.sticks)[number], key: string, cls: string) => (
      <rect key={key} className={cls} x={st.cx + ox - st.sx / 2} y={st.cy + oy - st.sy / 2} width={st.sx} height={st.sy} strokeWidth={lw * 0.8} transform={st.yaw ? `rotate(${(st.yaw * 180) / Math.PI} ${st.cx + ox} ${st.cy + oy})` : undefined} />
    );
    // The board lines run along the house (straight), or on the diagonal: drawn faint, clipped to the outline.
    const clipId = `v2clip-${lower ? "l" : "u"}`;
    const boardGap = 5.5 * (lW > 300 ? 2 : 1);
    const boardLines: React.ReactNode[] = [];
    const diagonal = f.design.decking.pattern !== "straight";
    if (diagonal) {
      for (let k = -lD; k < lW + lD; k += boardGap * 1.414) boardLines.push(<line key={k} x1={ox + k} y1={oy} x2={ox + k + lD} y2={oy + lD} />);
    } else {
      for (let y = boardGap; y < lD; y += boardGap) boardLines.push(<line key={y} x1={ox} y1={oy + y} x2={ox + lW} y2={oy + y} />);
    }
    return (
      <g key={lower ? "lower" : "upper"}>
        <defs>
          <clipPath id={clipId}>
            <polygon points={outline} />
          </clipPath>
        </defs>
        {/* The boards: the whole floor is the surface's part. */}
        <g {...partProps({ part: "boards", name: lower ? `Lower level · ${boardsName}` : boardsName })}>
          <polygon points={outline} className="v2-boards" />
          <g clipPath={`url(#${clipId})`} className="v2-board-lines" strokeWidth={lw * 0.7}>
            {boardLines}
          </g>
        </g>
        {/* The frame: joists, rim, blocking, ledger, beams and posts — one part. */}
        <g {...partProps({ part: "frame", name: frameName })}>
          {f.posts.map((p) => (
            <circle key={`f${p.id}`} cx={p.x + ox} cy={p.y + oy} r={p.footing.padIn / 2} className="v2-footing" strokeWidth={lw} strokeDasharray={`${lw * 3} ${lw * 2}`} />
          ))}
          {sticks("joist").map((j, i) => (
            <g key={`j${i}`}>
              {rect(j, `jr${i}`, "v2-joist")}
              <line x1={j.cx + ox} y1={j.cy + oy - j.sy / 2} x2={j.cx + ox} y2={j.cy + oy + j.sy / 2} className="v2-hit" strokeWidth={Math.min(px(8), f.spacingIn * 0.3)} transform={j.yaw ? `rotate(${(j.yaw * 180) / Math.PI} ${j.cx + ox} ${j.cy + oy})` : undefined} />
            </g>
          ))}
          {sticks("rim").map((r, i) => rect(r, `r${i}`, "v2-joist"))}
          {sticks("blocking").map((b, i) => rect(b, `k${i}`, "v2-blocking"))}
          {sticks("ledger").map((l, i) => rect(l, `l${i}`, "v2-ledger"))}
          {f.beams.map((b) => (
            <g key={b.id}>
              <rect x={b.x0 + ox} y={b.y + oy - b.spec.thickIn / 2} width={b.x1 - b.x0} height={b.spec.thickIn} className={cx("v2-beam", b.style === "flush" && "is-flush")} strokeWidth={lw * 2} strokeDasharray={b.style === "dropped" ? `${lw * 7} ${lw * 4}` : undefined} />
              <line x1={b.x0 + ox} y1={b.y + oy} x2={b.x1 + ox} y2={b.y + oy} className="v2-hit" strokeWidth={px(14)} />
            </g>
          ))}
          {f.posts.filter((p) => !p.roof).map((p) => {
            const w = p.size === "8x8" ? 7.5 : p.size === "6x6" ? 5.5 : 3.5;
            const d = p.size === "4x6" ? 5.5 : w;
            return <rect key={p.id} x={p.x + ox - w / 2} y={p.y + oy - d / 2} width={w} height={d} className="v2-post" />;
          })}
          {selFrame || !roof ? (
            f.beams.map((b) => (
              <text key={`bt${b.id}`} x={b.x0 + ox + font * 0.5} y={b.y + oy - b.spec.thickIn / 2 - font * 0.45} fontSize={font} className="v2-note">
                {`${b.spec.size} ${b.style === "flush" ? "flush " : ""}beam · posts ${ftIn(b.spanIn)} o.c.`}
              </text>
            ))
          ) : null}
        </g>
        <polygon points={outline} className="v2-outline" strokeWidth={lw * 2.6} />
        {!roof || lower ? (
          <text x={lW / 2 + ox} y={(f.zones[0].zone.y0 + (f.beams[0]?.y ?? lD)) / 2 + oy} fontSize={font} textAnchor="middle" className="v2-note v2-note-quiet">
            {lower ? `lower level · ${ftIn(f.surfaceIn)} high` : joistNote}
          </text>
        ) : null}
      </g>
    );
  };

  const roofMembers = (roles: string[]) => (roof ? roof.members.filter((m) => roles.includes(m.role)) : []);
  const eaveXs = eave.map((p) => p.x);
  const eaveYs = eave.map((p) => p.y);
  const roofBox = eave.length ? { x0: Math.min(...eaveXs), x1: Math.max(...eaveXs), y0: Math.min(...eaveYs), y1: Math.max(...eaveYs) } : null;
  const polygonRoof = design.roof.plan.shape === "hexagon" || design.roof.plan.shape === "octagon" || design.roof.plan.shape === "round";
  const roofHandles = !!roof && !!roofBox && design.roof.plan.shape !== "follows-deck";

  return (
    <svg
      ref={svgRef}
      className={cx("v2-plan", placing && "is-placing", drag && "is-dragging")}
      viewBox={vb}
      role="group"
      aria-label={`Plan of the ${structure.design.structure === "deck" ? "deck" : structure.design.structure}: ${ftIn(maxX - minX)} by ${ftIn(maxY - minY)}. Press a part to set it up.`}
      onClick={onSheetClick}
      data-v2-plan={placing ? "placing" : "plan"}
    >
      <defs>
        <pattern id="v2-hatch" width={px(9)} height={px(9)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={px(9)} className="v2-hatch-line" strokeWidth={lw} />
        </pattern>
      </defs>

      {/* The house wall where the deck meets it. */}
      {onHouse ? (
        <g {...partProps({ part: "house", name: "House wall" })}>
          {frame ? (
            frame.edges.filter((e) => e.house).map((e, i) => {
              const horizontal = e.y0 === e.y1;
              const x = Math.min(e.x0, e.x1);
              const y = Math.min(e.y0, e.y1);
              return horizontal ? (
                <rect key={`h${i}`} x={x} y={y - houseBand} width={Math.abs(e.x1 - e.x0)} height={houseBand} className="v2-house" strokeWidth={lw * 1.4} />
              ) : (
                <rect key={`h${i}`} x={x - (e.side === "left" ? 0 : houseBand)} y={y} width={houseBand} height={Math.abs(e.y1 - e.y0)} className="v2-house" strokeWidth={lw * 1.4} />
              );
            })
          ) : (
            <rect x={minX} y={-houseBand} width={maxX - minX} height={houseBand} className="v2-house" strokeWidth={lw * 1.4} />
          )}
          <rect x={minX - pad * 0.4} y={-houseBand - px(4)} width={maxX - minX + pad * 0.8} height={houseBand + px(4)} className="v2-hit-area" />
          <text x={(minX + maxX) / 2} y={-houseBand / 2 + font * 0.38} fontSize={font} textAnchor="middle" className="v2-house-label">
            HOUSE WALL
          </text>
        </g>
      ) : null}

      {frame ? levels.map((l) => levelDrawing(l.frame, l.offsetXIn, l.offsetYIn, l.id === "lower")) : null}

      {/* The hot tub: it sizes the frame under it — part of the deck's own settings. */}
      {spa ? (
        <g {...partProps({ part: "deck", name: "Hot-tub spot" })}>
          <rect x={spa.x0} y={spa.y0} width={spa.x1 - spa.x0} height={spa.y1 - spa.y0} className="v2-spa" strokeWidth={lw * 1.6} strokeDasharray={`${lw * 5} ${lw * 3}`} />
          <text x={(spa.x0 + spa.x1) / 2} y={(spa.y0 + spa.y1) / 2 + font * 0.35} fontSize={font} textAnchor="middle" className="v2-note">
            hot tub
          </text>
        </g>
      ) : null}

      {/* The stairs, each its own. */}
      {structure.stairs.map((st) => {
        const pts = st.footprint.map((p) => `${p.x},${p.y}`).join(" ");
        const treads = st.members.filter((m) => m.role === "tread" || m.role === "box-tread" || m.role === "landing-tread");
        const cx0 = st.footprint.reduce((a, p) => a + p.x, 0) / Math.max(1, st.footprint.length);
        const cy0 = st.footprint.reduce((a, p) => a + p.y, 0) / Math.max(1, st.footprint.length);
        return (
          <g key={`st${st.design.id}`} {...partProps({ part: "stairs", id: st.design.id, name: st.kind === "box" ? `Box steps · ${st.risers} risers` : `Stair · ${st.risers} risers, ${st.widthIn / 12} ft wide` })}>
            <polygon points={pts} className="v2-stair" strokeWidth={lw * 1.6} />
            {treads.map((m, i) => (
              <rect key={i} x={m.cx - m.sx / 2} y={m.cy - m.sy / 2} width={m.sx} height={m.sy} className="v2-tread" strokeWidth={lw * 0.7} transform={m.yaw ? `rotate(${(m.yaw * 180) / Math.PI} ${m.cx} ${m.cy})` : undefined} />
            ))}
            <text x={cx0} y={cy0 + font * 0.35} fontSize={font} textAnchor="middle" className="v2-note v2-note-chip">
              {st.kind === "box" ? `box · ${st.risers} R` : `${st.risers} risers`}
            </text>
          </g>
        );
      })}

      {/* The rail: one part, every run of it. */}
      {structure.rails.on ? (
        <g {...partProps({ part: "rails", name: `Railing · ${structure.rails.label}` })}>
          {structure.rails.segments.map((sg, i) => (
            <g key={i}>
              <line x1={sg.x0} y1={sg.y0} x2={sg.x1} y2={sg.y1} className="v2-rail" strokeWidth={px(4)} />
              <line x1={sg.x0} y1={sg.y0} x2={sg.x1} y2={sg.y1} className="v2-hit" strokeWidth={px(16)} />
            </g>
          ))}
          {structure.rails.members.filter((m) => m.role === "rail-post").map((m, i) => (
            <rect key={i} x={m.cx - px(4)} y={m.cy - px(4)} width={px(8)} height={px(8)} className="v2-rail-post" strokeWidth={lw * 1.2} />
          ))}
        </g>
      ) : null}

      {/* The roof: its eave line, its ridge and hips, its posts — pressed on its lines, so the deck under it stays pressable. */}
      {roof ? (
        <g {...partProps({ part: "roof", name: `${structure.design.structure === "pergola" ? "Pergola" : "Roof"} · ${roofNote}` })}>
          {roof.slab ? <rect x={Math.min(...roof.ring.map((p) => p.x)) - 12} y={Math.min(...roof.ring.map((p) => p.y)) - 12} width={Math.max(...roof.ring.map((p) => p.x)) - Math.min(...roof.ring.map((p) => p.x)) + 24} height={Math.max(...roof.ring.map((p) => p.y)) - Math.min(...roof.ring.map((p) => p.y)) + 24} className="v2-slab" strokeWidth={lw} /> : null}
          {!frame ? <polygon points={roof.eaveRing.map((p) => `${p.x},${p.y}`).join(" ")} className="v2-roof-fill" /> : null}
          {roofMembers(["rafter", "jack", "fly", "purlin", "slat", "tie"]).map((m, i) => (
            <line key={`rf${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} className={cx("v2-rafter", (m.role === "slat" || m.role === "purlin") && "is-faint")} strokeWidth={lw * 0.8} />
          ))}
          {roofMembers(["truss"]).filter((m) => m.of === "truss-tc").map((m, i) => (
            <line key={`tr${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} className="v2-rafter" strokeWidth={lw * 0.9} />
          ))}
          <polygon points={roof.eaveRing.map((p) => `${p.x},${p.y}`).join(" ")} className="v2-eave" strokeWidth={lw * 2} strokeDasharray={`${lw * 8} ${lw * 5}`} />
          <polygon points={roof.eaveRing.map((p) => `${p.x},${p.y}`).join(" ")} className="v2-hit" strokeWidth={px(14)} />
          {roofMembers(["hip", "ridge", "ring"]).map((m, i) => (
            <g key={`hr${i}`}>
              <line x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} className="v2-ridge" strokeWidth={lw * 2.4} />
              <line x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} className="v2-hit" strokeWidth={px(14)} />
            </g>
          ))}
          {roof.headers.map((h) => (
            <line key={h.id} x1={h.x0} y1={h.y0} x2={h.x1} y2={h.y1} className="v2-header" strokeWidth={lw * 3} />
          ))}
          {roof.posts.map((p) => {
            const w = p.size === "8x8" ? 7.5 : p.size === "6x6" ? 5.5 : 3.5;
            return <rect key={p.id} x={p.x - w / 2 - px(2)} y={p.y - w / 2 - px(2)} width={w + px(4)} height={w + px(4)} className="v2-roof-post" strokeWidth={lw} />;
          })}
          <text x={roof.centreX} y={roof.centreY + font * 0.35} fontSize={font} textAnchor="middle" className="v2-note v2-note-chip">
            {roofNote}
          </text>
        </g>
      ) : null}

      {/* The lights: each fixture its own. */}
      {structure.electrical.on ? (
        <g>
          {structure.electrical.fixtures.map((fx) => (
            <g key={fx.id} {...partProps({ part: "lights", id: fx.designId, name: `Light · ${fx.label}` })}>
              {fx.kind === "led-strip" || fx.kind === "string-light" ? (
                <>
                  <line x1={fx.x - (Math.cos(fx.yaw) * fx.sx) / 2} y1={fx.y - (Math.sin(fx.yaw) * fx.sx) / 2} x2={fx.x + (Math.cos(fx.yaw) * fx.sx) / 2} y2={fx.y + (Math.sin(fx.yaw) * fx.sx) / 2} className="v2-fixture-line" strokeWidth={px(3)} strokeDasharray={fx.kind === "string-light" ? `${px(4)} ${px(4)}` : undefined} />
                  <line x1={fx.x - (Math.cos(fx.yaw) * fx.sx) / 2} y1={fx.y - (Math.sin(fx.yaw) * fx.sx) / 2} x2={fx.x + (Math.cos(fx.yaw) * fx.sx) / 2} y2={fx.y + (Math.sin(fx.yaw) * fx.sx) / 2} className="v2-hit" strokeWidth={px(14)} />
                </>
              ) : (
                <>
                  <circle cx={fx.x} cy={fx.y} r={px(9)} className={cx("v2-fixture", fx.supply === "client" && "is-client")} strokeWidth={px(1.5)} />
                  <text x={fx.x} y={fx.y + px(4)} fontSize={px(11)} textAnchor="middle" className="v2-fixture-mark">
                    {FIXTURE_MARK[fx.kind] ?? "•"}
                  </text>
                </>
              )}
            </g>
          ))}
        </g>
      ) : null}

      {/* Dimensions: the two numbers that size the deck, large — drawn clear of the stairs and the roof. */}
      <g className="v2-dims">
        {frame ? (
          <>
            <line x1={0} y1={dimY} x2={W} y2={dimY} strokeWidth={lw} />
            <line x1={0} y1={dimY - px(7)} x2={0} y2={dimY + px(7)} strokeWidth={lw} />
            <line x1={W} y1={dimY - px(7)} x2={W} y2={dimY + px(7)} strokeWidth={lw} />
            <text x={W / 2} y={dimY + dimFont * 1.25} fontSize={dimFont} textAnchor="middle" className="v2-dim-text">
              {ftIn(design.shape.widthFt * 12)}
            </text>
            <line x1={dimX} y1={0} x2={dimX} y2={D} strokeWidth={lw} />
            <line x1={dimX - px(7)} y1={0} x2={dimX + px(7)} y2={0} strokeWidth={lw} />
            <line x1={dimX - px(7)} y1={D} x2={dimX + px(7)} y2={D} strokeWidth={lw} />
            <text x={dimX + dimFont * 0.6} y={D / 2 + dimFont * 0.35} fontSize={dimFont} className="v2-dim-text">
              {ftIn(design.shape.depthFt * 12)}
            </text>
          </>
        ) : roofBox ? (
          <text x={(roofBox.x0 + roofBox.x1) / 2} y={dimY + dimFont} fontSize={dimFont} textAnchor="middle" className="v2-dim-text">
            {ftIn(roofBox.x1 - roofBox.x0)} at the eaves
          </text>
        ) : null}
      </g>

      {/* The height: part of the drawing, pressed to set the height and the ground. */}
      {frame ? (
        <g {...partProps({ part: "site", name: "Height and ground" })}>
          <rect x={minX} y={dimY + dimFont * 2} width={px(130)} height={px(30)} className="v2-tag" strokeWidth={lw * 1.5} />
          <text x={minX + px(10)} y={dimY + dimFont * 2 + px(20)} fontSize={px(13)} className="v2-tag-text">
            {`${ftIn(design.heightIn)} high`}
          </text>
        </g>
      ) : null}

      {/* The handles. */}
      {frame && !placing ? (
        <>
          {handle("width", W, D / 2, "Deck width along the house — drag or use the arrow keys", design.shape.widthFt)}
          {handle("depth", W / 4, D, "Deck depth out from the house — drag or use the arrow keys", design.shape.depthFt)}
          {handle("corner", W, D, "Deck width and depth together", design.shape.widthFt)}
          {lowerLevel ? handle("lower-depth", lowerLevel.offsetXIn + Math.max(...lowerLevel.frame.zones.map((z) => z.zone.x1)) / 2, lowerLevel.offsetYIn + Math.max(...lowerLevel.frame.zones.map((z) => z.zone.y1)), "Lower level depth", design.lower.depthFt) : null}
        </>
      ) : null}
      {!frame && roofHandles && roofBox && !placing ? (
        <>
          {handle("roof-width", roofBox.x1, (roofBox.y0 + roofBox.y1) / 2, polygonRoof ? "Across the flats" : "Roof width", polygonRoof ? design.roof.plan.acrossFt : design.roof.plan.widthFt)}
          {design.roof.plan.shape === "rect" ? handle("roof-depth", (roofBox.x0 + roofBox.x1) / 2, roofBox.y1, "Roof depth", design.roof.plan.depthFt) : null}
        </>
      ) : null}
    </svg>
  );
}

function feetWords(ft: number) {
  return ftIn(Math.round(ft * 12));
}
