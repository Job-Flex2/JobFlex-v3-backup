"use client";
// WHAT TO BUILD, SHOWN (2026-10-11, owner: "the selection of what to do is
// very cheap looking — make it interactive samples of what kind of a deck
// project you do"). The first step's four words are now four pictures the
// engine built (lib/deck/samples → lib/deck/iso): a deck with its rails and
// stairs, a covered deck under its gable, an octagon gazebo, a pergola on
// the house. Touching a card stands its picture up layer by layer — the
// footings, the posts, the frame, the boards, the rails, the roof — and
// choosing one is choosing the kind. Under the chosen kind sit samples to
// start from; one tap lays the sample over the contractor's own address,
// site, house and lumber, and the 3D on the right follows.
//
// Made real (2026-10-13, owner: "more realistic, detailed, modern, a little
// glassy — and interactive"): the pictures are lit and drawn in their
// materials (lib/deck/iso), and they turn — a mouse drags one round, a
// hovered card turns slowly on its own once it has stood up, the ↻ beside
// it turns it a third of the way for a thumb or a keyboard, and every
// picture eases back to its own angle when it is left. While a picture is
// moving it is drawn quicker (fewer parts, no grain) and settles into full
// detail when it stops.
//
// No WebGL here: each picture is a few thousand SVG faces, computed once
// per page for its resting angle and on the fly while it turns.

import * as React from "react";
import { KINDS, KIND_WORDS, kindSample, sampleDesign, samplesFor, type DeckSample } from "@/lib/deck/samples";
import { isoDrawing, isoMarkup, type IsoMaterials } from "@/lib/deck/iso";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, type DeckScene } from "@/lib/deck/scene";
import { deckingProduct } from "@/lib/deck/catalog";
import type { DeckDesign, Structure } from "@/lib/deck/design";
import p from "./deck-kind-picker.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** The angle every picture rests at. */
const REST_YAW = 34;
const DETAIL = { card: { full: 2400, quick: 1100 }, thumb: { full: 900, quick: 500 } } as const;

/** The scene a sample makes, built once per page. */
const scenes = new Map<string, { scene: DeckScene; materials: IsoMaterials }>();
function sceneFor(sample: DeckSample): { scene: DeckScene; materials: IsoMaterials } {
  let s = scenes.get(sample.id);
  if (!s) {
    const design: DeckDesign = sampleDesign(sample);
    const family = deckingProduct(design.decking.product).family;
    const decking: IsoMaterials["decking"] = family === "treated" || family === "softwood" ? "wood" : family === "hardwood" || family === "modified" ? "hardwood" : family;
    s = { scene: deckScene(buildStructure(design)), materials: { decking, roofing: design.roof.roofing, rail: design.rail.type } };
    scenes.set(sample.id, s);
  }
  return s;
}

/** The resting picture, drawn once per sample and size: its markup with the build-up's groups, and with still ones. */
interface Resting { viewBox: string; markup: string; still: string; faces: number; steps: number }
const resting = new Map<string, Resting>();
function restingFor(sample: DeckSample, detail: "card" | "thumb"): Resting {
  const key = `${sample.id}:${detail}`;
  let r = resting.get(key);
  if (!r) {
    const { scene, materials } = sceneFor(sample);
    const d = isoDrawing(scene, { maxSolids: DETAIL[detail].full, materials, yawDeg: REST_YAW });
    const prefix = `iso-${sample.id}-${detail}`;
    r = { viewBox: d.viewBox, markup: isoMarkup(d, { prefix, layerClass: p.layer }), still: isoMarkup(d, { prefix, layerClass: p.still }), faces: d.faces.length, steps: d.ranks.length };
    resting.set(key, r);
  }
  return r;
}

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export type Turn = { turn: () => void };

/**
 * One picture. `play` > 0 stands it up layer by layer; a new value plays it
 * again. It turns: a mouse drag on it, `turnRef` (the ↻ beside it), and a
 * slow turn of its own while `spin` (the mouse resting on its card) — then
 * it eases back to its angle.
 */
export function IsoFigure({ sample, detail, play = 0, spin = false, label, className, turnRef }: { sample: DeckSample; detail: "card" | "thumb"; play?: number; spin?: boolean; label: string; className?: string; turnRef?: React.MutableRefObject<Turn | null> }) {
  const rest = restingFor(sample, detail);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const yaw = React.useRef(REST_YAW);
  const anim = React.useRef<number>(0);
  const settle = React.useRef<number>(0);
  const drag = React.useRef<{ x: number; yaw: number; moved: boolean } | null>(null);

  /**
   * The picture at `yawDeg`, drawn straight into the SVG (no React in the loop — a frame is thousands of paths). Its
   * groups are STILL ones: the build-up's groups animate in from nothing, and a frame that replaced them every tick
   * would never be seen.
   */
  const draw = React.useCallback(
    (yawDeg: number, quality: "full" | "quick") => {
      const svg = svgRef.current;
      if (!svg) return;
      if (Math.abs(yawDeg - REST_YAW) < 0.01 && quality === "full") {
        svg.setAttribute("viewBox", rest.viewBox);
        svg.innerHTML = rest.still;
        return;
      }
      const { scene, materials } = sceneFor(sample);
      const d = isoDrawing(scene, { maxSolids: DETAIL[detail][quality], materials, yawDeg, detail: quality });
      svg.setAttribute("viewBox", d.viewBox);
      svg.innerHTML = isoMarkup(d, { prefix: `iso-${sample.id}-${detail}`, layerClass: p.still });
    },
    [sample, detail, rest],
  );
  const stopAll = React.useCallback(() => {
    cancelAnimationFrame(anim.current);
    cancelAnimationFrame(settle.current);
  }, []);
  /** The picture turned to `to` over `ms`, then drawn in full. */
  const turnTo = React.useCallback(
    (to: number, ms: number) => {
      stopAll();
      const from = yaw.current;
      if (reducedMotion() || ms <= 0) {
        yaw.current = to;
        draw(to, "full");
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        yaw.current = from + (to - from) * easeInOut(t);
        if (t < 1) {
          draw(yaw.current, "quick");
          settle.current = requestAnimationFrame(step);
        } else {
          yaw.current = to;
          draw(to, "full");
        }
      };
      settle.current = requestAnimationFrame(step);
    },
    [draw, stopAll],
  );
  // The resting picture — again whenever it is replayed (the play key remounts the svg).
  React.useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setAttribute("viewBox", rest.viewBox);
    svg.innerHTML = rest.markup;
    yaw.current = REST_YAW;
    return stopAll;
  }, [rest, play, stopAll]);
  // The ↻: a third of a turn.
  React.useEffect(() => {
    if (!turnRef) return;
    turnRef.current = { turn: () => turnTo(yaw.current + 120, 650) };
    return () => {
      turnRef.current = null;
    };
  }, [turnRef, turnTo]);
  // The mouse rests on the card: once the picture has stood up it turns slowly; off the card it eases back.
  React.useEffect(() => {
    if (!spin || reducedMotion()) return;
    stopAll();
    // Only once the build-up has stood every step up (70 ms a step, and the last step's rise).
    const start = performance.now() + (play > 0 ? rest.steps * 70 + 600 : 350);
    let last = start;
    const step = (now: number) => {
      if (now >= start && !drag.current) {
        yaw.current += ((now - Math.max(last, start)) / 1000) * 9;
        draw(yaw.current, "quick");
      }
      last = now;
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(anim.current);
      if (Math.abs(yaw.current - REST_YAW) > 0.01) turnTo(REST_YAW, 600);
    };
  }, [spin, play, rest.steps, draw, turnTo, stopAll]);

  /* ── a mouse drag turns it by hand (a touch scrolls the page, as it should) ── */
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    stopAll();
    drag.current = { x: e.clientX, yaw: yaw.current, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    yaw.current = drag.current.yaw + dx * 0.6;
    draw(yaw.current, "quick");
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    draw(yaw.current, "full");
    // A drag is not a click on the card.
    if (d.moved) {
      const el = e.currentTarget;
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
    }
  };
  return (
    <svg
      key={play}
      ref={svgRef}
      className={cx(p.svg, play > 0 && p.play, className)}
      viewBox={rest.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      data-iso-faces={rest.faces}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}

/** The ↻ beside a picture: a third of a turn, for a thumb or a keyboard. Outside the card's button, so it is its own. */
function TurnButton({ turnRef, small, what }: { turnRef: React.MutableRefObject<Turn | null>; small?: boolean; what: string }) {
  return (
    <button type="button" className={cx(p.turn, small && p.turnSmall)} aria-label={`Turn the picture of ${what}`} title="Turn it" onClick={(e) => { e.stopPropagation(); turnRef.current?.turn(); }} data-iso-turn>
      ↻
    </button>
  );
}

function KindCard({ structure: st, label, on, onPick }: { structure: Structure; label: string; on: boolean; onPick: () => void }) {
  const hero = kindSample(st);
  const turn = React.useRef<Turn | null>(null);
  const [play, setPlay] = React.useState(0);
  const [spin, setSpin] = React.useState(false);
  return (
    <div className={p.kindWrap} onPointerEnter={(e) => { if (e.pointerType === "mouse") { setPlay((n) => n + 1); setSpin(true); } }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" role="radio" aria-checked={on} className={cx(p.kind, on && p.kindOn)} onClick={() => { onPick(); setPlay((n) => n + 1); }} data-structure={st}>
        <span className={p.fig}>
          <IsoFigure sample={hero} detail="card" play={play} spin={spin} label={`${label}: ${hero.name}`} turnRef={turn} />
          {on ? <span className={p.tick} aria-hidden="true">✓</span> : null}
        </span>
        <span className={p.kindName}>{label}</span>
        <span className={p.kindBlurb}>{KIND_WORDS[st].blurb}</span>
        <span className={p.kindInc}>{KIND_WORDS[st].includes}</span>
      </button>
      <TurnButton turnRef={turn} what={label} />
    </div>
  );
}

function SampleCard({ sample, inUse, onPick }: { sample: DeckSample; inUse: boolean; onPick: () => void }) {
  const turn = React.useRef<Turn | null>(null);
  const [spin, setSpin] = React.useState(false);
  return (
    <div className={p.sampleWrap} onPointerEnter={(e) => { if (e.pointerType === "mouse") setSpin(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" className={cx(p.sample, inUse && p.sampleOn)} aria-pressed={inUse} onClick={onPick} data-deck-sample={sample.id}>
        <span className={cx(p.fig, p.figSmall)}>
          <IsoFigure sample={sample} detail="thumb" spin={spin} label={sample.name} turnRef={turn} />
        </span>
        <span className={p.sampleName}>{sample.name}</span>
        <span className={p.sampleFacts}>{sample.facts}</span>
        <span className={p.sampleTag}>{inUse ? "In use ✓" : "Start from this →"}</span>
      </button>
      <TurnButton turnRef={turn} small what={sample.name} />
    </div>
  );
}

export function DeckKindPicker({ structure, onPickKind, onPickSample, appliedSampleId, hint }: { structure: Structure; onPickKind: (s: Structure) => void; onPickSample: (s: DeckSample) => void; appliedSampleId: string | null; /** The line beside "Start from a sample" (the client's page says it its own way). */ hint?: string }) {
  const samples = samplesFor(structure);
  return (
    <div className={p.picker} data-deck-kinds>
      <div className={p.kinds} role="radiogroup" aria-label="What to build">
        {KINDS.map(({ structure: st, label }) => (
          <KindCard key={st} structure={st} label={label} on={st === structure} onPick={() => onPickKind(st)} />
        ))}
      </div>
      <div className={p.samples} data-deck-samples={structure}>
        <div className={p.samplesHead}>
          <span className={p.samplesLbl}>Start from a sample</span>
          <span className={p.samplesHint}>{hint ?? "Your address, state, house and lumber stay as set — the sample brings the shape, height, rails, stairs and roof."}</span>
        </div>
        <div className={p.sampleRow}>
          {samples.map((sm) => (
            <SampleCard key={sm.id} sample={sm} inUse={sm.id === appliedSampleId} onPick={() => onPickSample(sm)} />
          ))}
        </div>
      </div>
    </div>
  );
}
