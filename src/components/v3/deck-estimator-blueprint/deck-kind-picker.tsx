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
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { KINDS, KIND_WORDS, kindSample, sampleDesign, samplesFor, type DeckSample } from "@/lib/deck/samples";
import { isoDrawing, isoMarkup, type IsoDrawing, type IsoMaterials } from "@/lib/deck/iso";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, type DeckScene } from "@/lib/deck/scene";
import { deckingProduct } from "@/lib/deck/catalog";
import type { DeckDesign, Structure } from "@/lib/deck/design";
import p from "./deck-kind-picker.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** The angle every picture rests at. */
const REST_YAW = 34;
const DETAIL = { card: { full: 2400, quick: 1100 }, thumb: { full: 900, quick: 500 } } as const;

/* A TURNING PICTURE IS PAINTED, NOT REBUILT (2026-10-19, perf). A frame of the turn used to replace the SVG's
   thousands of paths, and the browser's styling and painting of them cost 120–170ms a frame — 2.7s of every 3s of a
   hovered card, whatever the frame rate or the number of parts. The faces are now painted onto a canvas laid over
   the picture (a few milliseconds for the same frame); the resting SVG underneath is never touched, and shows again,
   crisp and with its build-up, as soon as the picture is back at its angle. */
function paintFrame(canvas: HTMLCanvasElement, d: IsoDrawing) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(1, Math.round(box.width * dpr));
  const ch = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const [vx, vy, vw, vh] = d.viewBox.split(/\s+/).map(Number);
  const k = Math.min(cw / vw, ch / vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, (cw - vw * k) / 2 - vx * k, (ch - vh * k) / 2 - vy * k);
  // A gradient or pattern fill is painted as its first colour; a filter is dropped. A gradient that only fades one
  // colour out (the ground's edge, black to nothing) is a mask, not a surface: painted flat it was a dark wedge, so
  // a face filled with one is left out.
  const flat = new Map<string, [string, number] | null>();
  for (const def of d.defs) {
    if (def.kind === "linear" || def.kind === "radial") {
      const fade = def.stops.length > 1 && def.stops.every((s) => s[1] === def.stops[0][1]) && def.stops[def.stops.length - 1][2] === 0;
      flat.set(def.id, fade ? null : [def.stops[0]?.[1] ?? "#888", def.stops[0]?.[2] ?? 1]);
    } else if (def.kind === "grain") flat.set(def.id, [def.lines[0]?.[2] ?? "#888", 0.5]);
  }
  const colour = (fill: string): [string, number] | null => {
    const m = /^url\(#([^)]+)\)/.exec(fill);
    if (!m) return [fill, 1];
    return flat.has(m[1]) ? flat.get(m[1])! : ["#888", 1];
  };
  ctx.lineJoin = "round";
  for (const f of d.faces) {
    const ca = colour(f.fill.split("|")[0]);
    if (!ca) continue;
    const [c, a] = ca;
    const path = new Path2D(f.d);
    ctx.globalAlpha = (f.opacity ?? 1) * a * (f.layer === "shadow" ? 0.34 : 1);
    ctx.fillStyle = c;
    ctx.fill(path);
    if (f.stroke) {
      ctx.globalAlpha = f.strokeOpacity ?? 1;
      ctx.strokeStyle = f.stroke;
      ctx.lineWidth = 0.45 / k;
      ctx.stroke(path);
    }
  }
  ctx.globalAlpha = 1;
}

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

/* A turning picture is redrawn at most this often (2026-10-19, perf): a frame is a few thousand paths computed and
   parsed, and at 60 a second four turning cards took the page under 20fps. 25 a second reads as smooth for a slow
   turn. And not while the page scrolls under the mouse: the picture holds its angle until the scroll settles. */
const DRAW_EVERY_MS = 40;
const SCROLL_QUIET_MS = 200;
let pageScrolledAt = 0;
let scrollWatched = false;
function watchPageScroll() {
  if (scrollWatched || typeof document === "undefined") return;
  scrollWatched = true;
  document.addEventListener("scroll", () => { pageScrolledAt = performance.now(); }, { capture: true, passive: true });
}
if (typeof document !== "undefined") watchPageScroll();
const pageStill = (now: number) => now - pageScrolledAt > SCROLL_QUIET_MS;

export type Turn = { turn: () => void };

/**
 * One picture. `play` > 0 stands it up layer by layer; a new value plays it
 * again. It turns: a mouse drag on it, `turnRef` (the ↻ beside it), and a
 * slow turn of its own while `spin` (the mouse resting on its card) — then
 * it eases back to its angle.
 *
 * WHAT IS IN THE DOM (2026-10-19, perf). A live picture is thousands of SVG nodes, and four of them on the page
 * made every scroll frame re-style and re-layerize them all (2.9s of style, 4s of layerizing over one scroll). So:
 * at rest the picture is an IMAGE of its resting markup (crisp, one node); a turn is PAINTED on the canvas over it
 * (paintFrame); the live SVG is mounted only for the build-up — the second and a half after a card is picked —
 * and gives way to the image again as soon as it has stood up.
 */
export function IsoFigure({ sample, detail, play = 0, spin = false, label, className, turnRef, staticPreview = false }: { sample: DeckSample; detail: "card" | "thumb"; play?: number; spin?: boolean; label: string; className?: string; turnRef?: React.MutableRefObject<Turn | null>; staticPreview?: boolean }) {
  const rest = restingFor(sample, detail);
  const image = React.useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rest.viewBox}">${rest.still}</svg>`)}`, [rest]);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const stillRef = React.useRef<HTMLSpanElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const yaw = React.useRef(REST_YAW);
  const anim = React.useRef<number>(0);
  const settle = React.useRef<number>(0);
  const drag = React.useRef<{ x: number; yaw: number; moved: boolean } | null>(null);
  // The build-up's live SVG is in the DOM only while it plays. A new `play` turns it on during render (the sanctioned
  // way to derive state from a prop); the timer below turns it off once the picture has stood up.
  const [live, setLive] = React.useState(false);
  const [seenPlay, setSeenPlay] = React.useState(play);
  if (play !== seenPlay) {
    setSeenPlay(play);
    if (play && !staticPreview) setLive(true);
  }
  const buildEnds = React.useRef(0);
  const turning = React.useRef(false);

  /** The picture at `yawDeg`: at its angle the resting image (or the live SVG) shows; turned, a painted frame. */
  const draw = React.useCallback(
    (yawDeg: number, quality: "full" | "quick") => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const atRest = Math.abs(yawDeg - REST_YAW) < 0.01 && quality === "full";
      if (atRest) {
        turning.current = false;
        canvas.style.display = "none";
        if (stillRef.current) stillRef.current.style.visibility = "";
        if (svgRef.current) svgRef.current.style.visibility = "";
        return;
      }
      const { scene, materials } = sceneFor(sample);
      const d = isoDrawing(scene, { maxSolids: DETAIL[detail][quality], materials, yawDeg, detail: quality });
      turning.current = true;
      canvas.style.display = "block";
      paintFrame(canvas, d);
      if (stillRef.current) stillRef.current.style.visibility = "hidden";
      if (svgRef.current) svgRef.current.style.visibility = "hidden";
    },
    [sample, detail],
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
      let drawn = 0;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        yaw.current = from + (to - from) * easeInOut(t);
        if (t < 1) {
          if (now - drawn >= DRAW_EVERY_MS) {
            drawn = now;
            draw(yaw.current, "quick");
          }
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
  // The build-up: the live SVG for as long as it plays, then the image again.
  React.useEffect(() => {
    if (!live) return;
    stopAll();
    yaw.current = REST_YAW;
    draw(REST_YAW, "full");
    buildEnds.current = performance.now() + rest.steps * 70 + 700;
    const t = window.setTimeout(() => setLive(false), rest.steps * 70 + 700);
    return () => window.clearTimeout(t);
  }, [live, play, rest.steps, draw, stopAll]);
  React.useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !live) return;
    svg.setAttribute("viewBox", rest.viewBox);
    svg.innerHTML = rest.markup;
  }, [rest, live, play]);
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
    watchPageScroll();
    // Only once the build-up has stood every step up (70 ms a step, and the last step's rise).
    const start = Math.max(performance.now() + 350, buildEnds.current);
    let last = start;
    const step = (now: number) => {
      if (now >= start && !drag.current) {
        if (!pageStill(now)) {
          // Paused for the scroll: the time does not pile up into a jump when it resumes.
          last = now;
        } else if (now - last >= DRAW_EVERY_MS) {
          yaw.current += ((now - Math.max(last, start)) / 1000) * 9;
          last = now;
          draw(yaw.current, "quick");
        }
      } else last = now;
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(anim.current);
      if (Math.abs(yaw.current - REST_YAW) > 0.01) turnTo(REST_YAW, 600);
    };
  }, [spin, play, draw, turnTo, stopAll]);
  React.useEffect(() => stopAll, [stopAll]);

  /* ── a mouse drag turns it by hand (a touch scrolls the page, as it should) ── */
  const dragDrawn = React.useRef(0);
  const onDown = (e: React.PointerEvent<Element>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    stopAll();
    drag.current = { x: e.clientX, yaw: yaw.current, moved: false };
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<Element>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    yaw.current = drag.current.yaw + dx * 0.6;
    // A mouse reports faster than the picture can be drawn: one frame per DRAW_EVERY_MS, the last angle wins on release.
    const now = performance.now();
    if (now - dragDrawn.current < DRAW_EVERY_MS) return;
    dragDrawn.current = now;
    draw(yaw.current, "quick");
  };
  const onUp = (e: React.PointerEvent<Element>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    (e.currentTarget as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(e.pointerId);
    draw(yaw.current, "full");
    // A drag is not a click on the card.
    if (d.moved) {
      const el = e.currentTarget;
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
    }
  };
  const handlers = staticPreview ? {} : { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };
  return (
    <>
      {/* The resting picture: one image. Hidden under a painted turn or the build-up's live SVG. */}
      <span ref={stillRef} className={cx(p.svg, className)} style={live ? { visibility: "hidden" } : undefined} {...handlers}>
        <Image src={image} alt={label} width={480} height={320} unoptimized loading="lazy" className={p.svg} draggable={false} />
      </span>
      {live ? (
        <svg
          key={play}
          ref={svgRef}
          className={cx(p.svg, p.play, p.liveSvg, className)}
          viewBox={rest.viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={label}
          data-iso-faces={rest.faces}
          {...handlers}
        />
      ) : null}
      {/* The turning frames, painted; shown only while the picture is off its angle. */}
      <canvas ref={canvasRef} className={p.turnCanvas} aria-hidden="true" />
    </>
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

function KindCard({ structure: st, label, on, onPick, staticPreview }: { structure: Structure; label: string; on: boolean; onPick: () => void; staticPreview: boolean }) {
  const hero = kindSample(st);
  const turn = React.useRef<Turn | null>(null);
  const [play, setPlay] = React.useState(0);
  const [spin, setSpin] = React.useState(false);
  return (
    <div className={p.kindWrap} onPointerEnter={(e) => { if (!staticPreview && e.pointerType === "mouse" && pageStill(performance.now())) { setPlay((n) => n || 1); setSpin(true); } }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" role="radio" aria-checked={on} className={cx(p.kind, on && p.kindOn)} onClick={() => { onPick(); if (!staticPreview) setPlay((n) => n + 1); }} data-structure={st}>
        <span className={p.fig}>
          <IsoFigure sample={hero} detail="card" play={play} spin={spin} label={`${label}: ${hero.name}`} turnRef={turn} staticPreview={staticPreview} />
          {on ? <span className={p.tick} aria-hidden="true">✓</span> : null}
        </span>
        <span className={p.kindName}>{label}</span>
        <span className={p.kindBlurb}>{KIND_WORDS[st].blurb}</span>
        <span className={p.kindInc}>{KIND_WORDS[st].includes}</span>
      </button>
      {!staticPreview ? <TurnButton turnRef={turn} what={label} /> : null}
    </div>
  );
}

function SampleCard({ sample, inUse, onPick, staticPreview }: { sample: DeckSample; inUse: boolean; onPick: () => void; staticPreview: boolean }) {
  const turn = React.useRef<Turn | null>(null);
  const [spin, setSpin] = React.useState(false);
  return (
    <div className={p.sampleWrap} onPointerEnter={(e) => { if (!staticPreview && e.pointerType === "mouse" && pageStill(performance.now())) setSpin(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" className={cx(p.sample, inUse && p.sampleOn)} aria-pressed={inUse} onClick={onPick} data-deck-sample={sample.id}>
        <span className={cx(p.fig, p.figSmall)}>
          <IsoFigure sample={sample} detail="thumb" spin={spin} label={sample.name} turnRef={turn} staticPreview={staticPreview} />
        </span>
        <span className={p.sampleName}>{sample.name}</span>
        <span className={p.sampleFacts}>{sample.facts}</span>
        <span className={p.sampleTag}>{inUse ? "In use ✓" : "Start from this →"}</span>
      </button>
      {!staticPreview ? <TurnButton turnRef={turn} small what={sample.name} /> : null}
    </div>
  );
}

export function DeckKindPicker({ structure, onPickKind, onPickSample, appliedSampleId, hint, staticPreview = false, foldSamples = false }: { structure: Structure; onPickKind: (s: Structure) => void; onPickSample: (s: DeckSample) => void; appliedSampleId: string | null; /** The line beside "Start from a sample" (the client's page says it its own way). */ hint?: string; staticPreview?: boolean; foldSamples?: boolean }) {
  const samples = samplesFor(structure);
  const [samplesOpen, setSamplesOpen] = React.useState(false);
  const choices = <div className={p.sampleRow}>{samples.map((sm) => <SampleCard key={sm.id} sample={sm} inUse={sm.id === appliedSampleId} onPick={() => onPickSample(sm)} staticPreview={staticPreview} />)}</div>;
  return (
    <div className={p.picker} data-deck-kinds>
      <div className={p.kinds} role="radiogroup" aria-label="What to build">
        {KINDS.map(({ structure: st, label }) => (
          <KindCard key={st} structure={st} label={label} on={st === structure} onPick={() => onPickKind(st)} staticPreview={staticPreview} />
        ))}
      </div>
      {foldSamples ? <details className={p.samples} data-deck-samples={structure} onToggle={(event) => setSamplesOpen(event.currentTarget.open)}><summary className={p.samplesLbl}>Starting layouts<ChevronDown size={16} aria-hidden="true" /></summary>{samplesOpen ? choices : null}</details> : <div className={p.samples} data-deck-samples={structure}>
        <div className={p.samplesHead}>
          <span className={p.samplesLbl}>Start from a sample</span>
          <span className={p.samplesHint}>{hint ?? "Your address, state, house and lumber stay as set — the sample brings the shape, height, rails, stairs and roof."}</span>
        </div>
        {choices}
      </div>}
    </div>
  );
}
