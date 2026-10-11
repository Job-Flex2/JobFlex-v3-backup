"use client";
// THE BACK WALL, SEEN FROM ABOVE — AND SHAPED BY HAND (2026-10-11; owner:
// "shape the house in any direction, inside, outside, wider or narrower, easy
// to use — whatever is attached to the wall follows; move the deck's size at
// the same time, slide it anywhere, and type the inches in the boxes"): the
// house's body, the wall line with its steps, the deck's outline shaded under
// it with its two ends named. Every step drags sideways; every part of the
// wall drags in or out by its grip, except the part the deck stands on; the
// house's two ends drag wider or narrower; a + on the wall adds a step there.
// The deck's own ends and front edge drag its size, its grip slides it along
// the wall. The keyboard does the same on a focused handle. Feet in, feet
// out; the studio keeps the design and re-shapes the deck to the wall.
import * as React from "react";
import { DECK_LIMITS, shapeOutline, type DeckShape } from "@/lib/deck/design";
import { HOUSE_LIMITS, addStepAt, moveJogTo, moveWallPart, referencePartIndex, resizeDeckLeft, slideDeck, wallParts, type HouseDesign } from "@/lib/deck/house";
import s from "./deck-studio.module.css";

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ft = (n: number) => `${Math.round(n * 2) / 2} ft`;

export interface WallChange {
  house?: HouseDesign;
  shape?: DeckShape;
}

interface Drag {
  kind: "jog" | "left" | "right" | "part" | "deck-right" | "deck-left" | "deck-front" | "deck-slide";
  id?: string;
  part?: number;
  parts: number;
  rect: DOMRect;
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  /** For a part or the deck's slide: where the drag last left it, ft. */
  last: number;
}

export function HouseWallPlan({ shape, house, onChange }: { shape: DeckShape; house: HouseDesign; onChange: (next: WallChange) => void }) {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const parts = wallParts(house, shape);
  const refIdx = referencePartIndex(parts, shape);
  const xMin = -house.leftFt;
  const xMax = W + house.rightFt;
  const depths = parts.map((p) => p.depthFt);
  const yTop = Math.min(0, ...depths) - 7;
  const yBottom = Math.max(0, ...depths) + D + 3.5;
  const pad = 2.5;
  const vbX = xMin - pad;
  const vbY = yTop;
  const vbW = xMax - xMin + 2 * pad;
  const vbH = yBottom - yTop;
  const pts: string[] = [];
  parts.forEach((p, i) => {
    if (i === 0) pts.push(`${p.x0},${p.depthFt}`);
    pts.push(`${p.x1},${p.depthFt}`);
    if (i + 1 < parts.length) pts.push(`${p.x1},${parts[i + 1].depthFt}`);
  });
  const body = `${xMin},${yTop} ${pts.join(" ")} ${xMax},${yTop}`;
  const outline = shapeOutline(shape).map((p) => ({ x: p.x / 12, y: p.y / 12 }));
  const deck = outline.map((p) => `${p.x},${p.y}`).join(" ");
  const depthAt = (x: number) => parts.find((p) => x >= p.x0 && x <= p.x1)?.depthFt ?? 0;
  const span = Math.max(vbW, vbH * 1.3);
  const font = Math.max(0.9, span / 42);
  const handleR = Math.max(0.8, span / 46);
  const leftX = 0 - house.leftFt;
  const rightX = W + house.rightFt;
  const deckMidY = D / 2;

  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<Drag | null>(null);
  const toFeet = (d: Drag, clientX: number, clientY: number) => ({
    x: d.vbX + ((clientX - d.rect.left) / Math.max(1, d.rect.width)) * d.vbW,
    y: d.vbY + ((clientY - d.rect.top) / Math.max(1, d.rect.height)) * d.vbH,
  });
  const start = (e: React.PointerEvent<SVGElement>, kind: Drag["kind"], extra: { id?: string; part?: number; last?: number } = {}) => {
    const svg = svgRef.current;
    if (!svg) return;
    drag.current = { kind, id: extra.id, part: extra.part, last: extra.last ?? 0, parts: parts.length, rect: svg.getBoundingClientRect(), vbX, vbY, vbW, vbH };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toFeet(d, e.clientX, e.clientY);
    if (d.kind === "jog" && d.id) {
      const next = moveJogTo(house, shape, d.id, p.x);
      if (next !== house) onChange({ house: next });
    } else if (d.kind === "left") {
      const leftFt = clamp(half(-p.x), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
      if (leftFt !== house.leftFt) onChange({ house: { ...house, leftFt } });
    } else if (d.kind === "right") {
      const rightFt = clamp(half(p.x - W), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
      if (rightFt !== house.rightFt) onChange({ house: { ...house, rightFt } });
    } else if (d.kind === "part" && d.part !== undefined) {
      // A step dropped to nothing merges two parts and the indexes shift: that ends the drag.
      if (parts.length !== d.parts) {
        drag.current = null;
        return;
      }
      const target = half(p.y);
      const delta = target - d.last;
      if (Math.abs(delta) >= 0.5) {
        const next = moveWallPart(house, shape, d.part, delta);
        if (next && next !== house) {
          onChange({ house: next });
          d.last = target;
        }
      }
    } else if (d.kind === "deck-right") {
      const widthFt = clamp(half(p.x), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
      if (widthFt !== W) onChange({ shape: { ...shape, widthFt } });
    } else if (d.kind === "deck-front") {
      const depthFt = clamp(half(p.y), DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max);
      if (depthFt !== D) onChange({ shape: { ...shape, depthFt } });
    } else if (d.kind === "deck-left") {
      const next = resizeDeckLeft(house, shape, W - half(p.x), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
      if (next.shape !== shape) onChange(next);
    } else if (d.kind === "deck-slide") {
      const target = half(p.x);
      const delta = target - d.last;
      if (Math.abs(delta) >= 0.5) {
        const next = slideDeck(house, delta);
        if (next !== house) {
          onChange({ house: next });
          d.last = target;
        }
      }
    }
  };
  const up = () => {
    drag.current = null;
  };
  const key = (e: React.KeyboardEvent<SVGElement>, kind: Drag["kind"], extra: { id?: string; part?: number } = {}) => {
    const stepFt = e.shiftKey ? 2 : 0.5;
    const left = e.key === "ArrowLeft";
    const right = e.key === "ArrowRight";
    const upK = e.key === "ArrowUp";
    const down = e.key === "ArrowDown";
    let handled = true;
    if (kind === "jog" && extra.id) {
      const j = house.jogs.find((k) => k.id === extra.id);
      if (!j) return;
      if (left || right) onChange({ house: moveJogTo(house, shape, extra.id, j.atFt + (right ? stepFt : -stepFt)) });
      else if (e.key === "Delete" || e.key === "Backspace") onChange({ house: { ...house, jogs: house.jogs.filter((k) => k.id !== extra.id) } });
      else handled = false;
    } else if (kind === "left") {
      if (left || right) onChange({ house: { ...house, leftFt: clamp(house.leftFt + (left ? stepFt : -stepFt), 0, HOUSE_LIMITS.extendFt.max) } });
      else handled = false;
    } else if (kind === "right") {
      if (left || right) onChange({ house: { ...house, rightFt: clamp(house.rightFt + (right ? stepFt : -stepFt), 0, HOUSE_LIMITS.extendFt.max) } });
      else handled = false;
    } else if (kind === "part" && extra.part !== undefined) {
      const next = down ? moveWallPart(house, shape, extra.part, stepFt) : upK ? moveWallPart(house, shape, extra.part, -stepFt) : null;
      if (next) onChange({ house: next });
      else handled = false;
    } else if (kind === "deck-right") {
      if (left || right) onChange({ shape: { ...shape, widthFt: clamp(W + (right ? stepFt : -stepFt), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max) } });
      else handled = false;
    } else if (kind === "deck-left") {
      if (left || right) onChange(resizeDeckLeft(house, shape, W + (left ? stepFt : -stepFt), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max));
      else handled = false;
    } else if (kind === "deck-front") {
      if (upK || down) onChange({ shape: { ...shape, depthFt: clamp(D + (down ? stepFt : -stepFt), DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max) } });
      else handled = false;
    } else if (kind === "deck-slide") {
      if (left || right) onChange({ house: slideDeck(house, right ? stepFt : -stepFt) });
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  };
  // Where a + goes: each part's middle (when the part is wide enough), and the deck's two ends when nothing is there.
  const plusAt: number[] = [];
  for (const p of parts) if (p.x1 - p.x0 >= 4) plusAt.push(half((p.x0 + p.x1) / 2));
  for (const x of [0, W]) if (x > xMin + 1 && x < xMax - 1) plusAt.push(x);
  const plusses = [...new Set(plusAt)].filter((x) => !house.jogs.some((j) => Math.abs(j.atFt - x) < 1.2));
  const canAdd = house.jogs.length < HOUSE_LIMITS.jogs;
  const sq = handleR * 0.95;

  return (
    <div className={s.wallPlan} data-deck-wall-plan data-deck-wall-parts={parts.length}>
      <svg ref={svgRef} viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className={s.wallPlanSvg} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="img" aria-label="The back wall seen from above, with the deck under it">
        <polygon points={body} className={s.wallBody} />
        <polygon points={deck} className={s.wallDeck} />
        <polyline points={pts.join(" ")} className={s.wallLine} />
        <text x={(xMin + xMax) / 2} y={yTop + font * 1.4} fontSize={font} textAnchor="middle" className={s.wallLabel}>
          the house
        </text>
        <text x={W / 2} y={deckMidY - font * 0.3} fontSize={font} textAnchor="middle" className={s.wallLabel}>
          the deck
        </text>
        <text x={W / 2} y={deckMidY + font * 1.1} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
          {ft(W)} × {ft(D)}
        </text>
        <line x1={0} y1={depthAt(0)} x2={0} y2={yBottom - font * 1.6} className={s.wallEnd} />
        <line x1={W} y1={depthAt(W)} x2={W} y2={yBottom - font * 1.6} className={s.wallEnd} />
        <text x={0} y={yBottom - font * 0.4} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
          left end · 0
        </text>
        <text x={W} y={yBottom - font * 0.4} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
          right end · {ft(W)}
        </text>
        {/* The wall's parts: each in or out by its grip — the part the deck stands on is the house line and stays. */}
        {parts.map((p, i) => {
          const w = clamp((p.x1 - p.x0) * 0.45, 1, 2.6);
          const cx = (p.x0 + p.x1) / 2;
          const locked = i === refIdx;
          return (
            <rect key={`g${i}`} x={cx - w / 2} y={p.depthFt - handleR * 0.55} width={w} height={handleR * 1.1} rx={handleR * 0.5} className={locked ? s.wallGripLocked : s.wallGrip} onPointerDown={locked ? undefined : (e) => start(e, "part", { part: i, last: p.depthFt })} onKeyDown={locked ? undefined : (e) => key(e, "part", { part: i })} tabIndex={locked ? -1 : 0} role={locked ? undefined : "slider"} aria-label={locked ? "The part of the wall the deck stands on" : `The wall between ${ft(p.x0)} and ${ft(p.x1)} — drag it out or in`} aria-valuenow={p.depthFt} data-deck-wall-handle={locked ? "part-locked" : "part"} data-deck-wall-part={i}>
              <title>{locked ? "The deck stands on this part of the wall — move the others" : "Drag out toward the yard, or in"}</title>
            </rect>
          );
        })}
        {/* The steps: each drags sideways. */}
        {house.jogs.map((j) => {
          const y = Math.max(depthAt(j.atFt - 0.01), depthAt(j.atFt + 0.01));
          return (
            <g key={j.id}>
              <circle cx={j.atFt} cy={y} r={handleR} className={s.wallHandle} onPointerDown={(e) => start(e, "jog", { id: j.id })} onKeyDown={(e) => key(e, "jog", { id: j.id })} data-deck-wall-handle="jog" data-deck-wall-jog={j.id} tabIndex={0} role="slider" aria-label={`A step in the wall at ${ft(j.atFt)} — drag it along the wall; Delete removes it`} aria-valuenow={j.atFt}>
                <title>Drag along the wall · Delete removes the step</title>
              </circle>
              <text x={j.atFt} y={y - handleR - font * 1.9} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>
                {ft(j.atFt)} · {j.dir === "toward" ? "out" : "back"} {ft(j.depthFt)}
              </text>
            </g>
          );
        })}
        {/* The house's two ends: wider or narrower. */}
        <polygon points={`${leftX},${depthAt(leftX + 0.01) - handleR} ${leftX - handleR * 1.6},${depthAt(leftX + 0.01)} ${leftX},${depthAt(leftX + 0.01) + handleR}`} className={s.wallHandle} onPointerDown={(e) => start(e, "left")} onKeyDown={(e) => key(e, "left")} data-deck-wall-handle="left" tabIndex={0} role="slider" aria-label="The house's left end — drag it wider or narrower" aria-valuenow={leftX}>
          <title>The house&apos;s left end</title>
        </polygon>
        <polygon points={`${rightX},${depthAt(rightX - 0.01) - handleR} ${rightX + handleR * 1.6},${depthAt(rightX - 0.01)} ${rightX},${depthAt(rightX - 0.01) + handleR}`} className={s.wallHandle} onPointerDown={(e) => start(e, "right")} onKeyDown={(e) => key(e, "right")} data-deck-wall-handle="right" tabIndex={0} role="slider" aria-label="The house's right end — drag it wider or narrower" aria-valuenow={rightX}>
          <title>The house&apos;s right end</title>
        </polygon>
        {/* The deck: its ends and its front edge drag its size; its grip slides it along the wall. */}
        <rect x={W - sq} y={deckMidY - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={s.wallDeckHandle} onPointerDown={(e) => start(e, "deck-right")} onKeyDown={(e) => key(e, "deck-right")} data-deck-wall-handle="deck-right" tabIndex={0} role="slider" aria-label="The deck's right end — drag it wider or narrower" aria-valuenow={W}>
          <title>The deck&apos;s right end: wider or narrower</title>
        </rect>
        <rect x={-sq} y={deckMidY - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={s.wallDeckHandle} onPointerDown={(e) => start(e, "deck-left")} onKeyDown={(e) => key(e, "deck-left")} data-deck-wall-handle="deck-left" tabIndex={0} role="slider" aria-label="The deck's left end — drag it; the house stays where it is" aria-valuenow={0}>
          <title>The deck&apos;s left end: the house stays put</title>
        </rect>
        <rect x={W / 2 - sq} y={D - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={s.wallDeckHandle} onPointerDown={(e) => start(e, "deck-front")} onKeyDown={(e) => key(e, "deck-front")} data-deck-wall-handle="deck-front" tabIndex={0} role="slider" aria-label="The deck's front edge — drag it deeper or shallower" aria-valuenow={D}>
          <title>The deck&apos;s front edge: deeper or shallower</title>
        </rect>
        <rect x={W / 2 - handleR * 1.6} y={deckMidY + font * 1.7} width={handleR * 3.2} height={handleR * 1.1} rx={handleR * 0.5} className={s.wallGrip} onPointerDown={(e) => start(e, "deck-slide", { last: W / 2 })} onKeyDown={(e) => key(e, "deck-slide")} data-deck-wall-handle="deck-slide" tabIndex={0} role="slider" aria-label="The deck — slide it along the wall" aria-valuenow={house.leftFt}>
          <title>Slide the deck along the wall</title>
        </rect>
        {/* A + on the wall adds a step there. */}
        {canAdd
          ? plusses.map((x) => (
              <g key={`p${x}`} className={s.wallPlus} onClick={() => onChange({ house: addStepAt(house, shape, x) })} data-deck-wall-plus={x} role="button" tabIndex={0} aria-label={`Add a step in the wall at ${ft(x)}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange({ house: addStepAt(house, shape, x) }); } }}>
                <circle cx={x} cy={depthAt(x) - handleR * 2.2} r={handleR * 0.8} />
                <text x={x} y={depthAt(x) - handleR * 2.2 + font * 0.38} fontSize={font * 1.1} textAnchor="middle">+</text>
              </g>
            ))
          : null}
      </svg>
    </div>
  );
}
