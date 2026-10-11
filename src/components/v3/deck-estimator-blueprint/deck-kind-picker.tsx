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
// No WebGL here: each picture is a few hundred SVG faces, computed once per
// page and kept.

import * as React from "react";
import { KINDS, KIND_WORDS, kindSample, sampleDesign, samplesFor, type DeckSample } from "@/lib/deck/samples";
import { isoDrawing, type IsoDrawing, type IsoFace } from "@/lib/deck/iso";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene } from "@/lib/deck/scene";
import type { Structure } from "@/lib/deck/design";
import p from "./deck-kind-picker.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** The pictures, drawn once per page: the card's at full detail, a sample's thumbnail without the thin members. */
const drawings = new Map<string, IsoDrawing>();
function drawingFor(sample: DeckSample, detail: "card" | "thumb"): IsoDrawing {
  const key = `${sample.id}:${detail}`;
  let d = drawings.get(key);
  if (!d) {
    d = isoDrawing(deckScene(buildStructure(sampleDesign(sample))), { maxSolids: detail === "card" ? 2400 : 320 });
    drawings.set(key, d);
  }
  return d;
}

/** The faces grouped by build step, each group in its far-to-near order. */
function groupsOf(drawing: IsoDrawing): Array<[number, IsoFace[]]> {
  const m = new Map<number, IsoFace[]>();
  for (const f of drawing.faces) {
    const g = m.get(f.rank);
    if (g) g.push(f);
    else m.set(f.rank, [f]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

/** One picture. `play` > 0 stands it up layer by layer; a new value plays it again. */
export function IsoFigure({ drawing, play = 0, label, className }: { drawing: IsoDrawing; play?: number; label: string; className?: string }) {
  const groups = React.useMemo(() => groupsOf(drawing), [drawing]);
  return (
    <svg key={play} className={cx(p.svg, play > 0 && p.play, className)} viewBox={drawing.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} data-iso-faces={drawing.faces.length}>
      {groups.map(([rank, faces], i) => (
        <g key={rank} className={p.layer} style={{ "--i": i } as React.CSSProperties} data-rank={rank}>
          {faces.map((f, j) => (
            <path key={j} d={f.d} fill={f.fill} fillOpacity={f.opacity} />
          ))}
        </g>
      ))}
    </svg>
  );
}

export function DeckKindPicker({ structure, onPickKind, onPickSample, appliedSampleId }: { structure: Structure; onPickKind: (s: Structure) => void; onPickSample: (s: DeckSample) => void; appliedSampleId: string | null }) {
  const [plays, setPlays] = React.useState<Partial<Record<Structure, number>>>({});
  const bump = (st: Structure) => setPlays((m) => ({ ...m, [st]: (m[st] ?? 0) + 1 }));
  const samples = samplesFor(structure);
  return (
    <div className={p.picker} data-deck-kinds>
      <div className={p.kinds} role="radiogroup" aria-label="What to build">
        {KINDS.map(({ structure: st, label }) => {
          const on = st === structure;
          const hero = kindSample(st);
          return (
            <button
              key={st}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx(p.kind, on && p.kindOn)}
              onClick={() => { onPickKind(st); bump(st); }}
              onPointerEnter={(e) => { if (e.pointerType === "mouse") bump(st); }}
              data-structure={st}
            >
              <span className={p.fig}>
                <IsoFigure drawing={drawingFor(hero, "card")} play={plays[st] ?? 0} label={`${label}: ${hero.name}`} />
                {on ? <span className={p.tick} aria-hidden="true">✓</span> : null}
              </span>
              <span className={p.kindName}>{label}</span>
              <span className={p.kindBlurb}>{KIND_WORDS[st].blurb}</span>
              <span className={p.kindInc}>{KIND_WORDS[st].includes}</span>
            </button>
          );
        })}
      </div>
      <div className={p.samples} data-deck-samples={structure}>
        <div className={p.samplesHead}>
          <span className={p.samplesLbl}>Start from a sample</span>
          <span className={p.samplesHint}>Your address, state, house and lumber stay as set — the sample brings the shape, height, rails, stairs and roof.</span>
        </div>
        <div className={p.sampleRow}>
          {samples.map((sm) => {
            const inUse = sm.id === appliedSampleId;
            return (
              <button key={sm.id} type="button" className={cx(p.sample, inUse && p.sampleOn)} aria-pressed={inUse} onClick={() => { onPickSample(sm); bump(sm.structure); }} data-deck-sample={sm.id}>
                <span className={cx(p.fig, p.figSmall)}>
                  <IsoFigure drawing={drawingFor(sm, "thumb")} label={sm.name} />
                </span>
                <span className={p.sampleName}>{sm.name}</span>
                <span className={p.sampleFacts}>{sm.facts}</span>
                <span className={p.sampleTag}>{inUse ? "In use ✓" : "Start from this →"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
