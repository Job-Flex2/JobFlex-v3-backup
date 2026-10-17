"use client";
// THE CLIENT'S HOUSE (2026-10-12; owner: "give the client more options —
// draw and move the deck and the house's jogs, so they can go outside,
// measure the wall's jogs and shape it on the design; make it smart").
//
// Three ways to the same wall, each following the others:
//   · a one-tap start (straight, a bump-out at either end, a nook);
//   · the measuring sheet — the wall walked from its left corner with a
//     tape, stretch by stretch: how long, and whether it sticks out or sits
//     back against the wall the deck goes on; then where the deck starts
//     (lib/deck/wallMeasure turns that into the house model);
//   · the studio's own drawing (house-wall-plan): drag a wall in or out, a
//     corner sideways, the house's ends, the deck's ends and its grip; tap +
//     for a new corner; full screen on a phone.
// When the deck cannot frame around the wall as measured, the step says why
// and offers the one-tap fixes the studio offers (lib/deck/house wallFixes).
// Under it, the house's look: storeys, roof, siding and roof colours.

import * as React from "react";
import { DECK_LIMITS, type DeckShape } from "@/lib/deck/design";
import {
  HOUSE_LIMITS,
  HOUSE_ROOFS,
  HOUSE_ROOF_LABEL,
  QUICK_WALLS,
  ROOF_COLOURS,
  SIDINGS,
  deckShapeForHouse,
  quickWall,
  quickWallOf,
  wallFixes,
  wallWords,
  type HouseDesign,
  type HouseRoof,
  type QuickWall,
  type RoofColourId,
  type SidingId,
} from "@/lib/deck/house";
import { STRETCH_MAX, centreOn, houseFromSheet, sheetWords, wallSheet, type WallStretch } from "@/lib/deck/wallMeasure";
import { HouseWallPlan } from "@/components/v3/deck-estimator-blueprint/house-wall-plan";
import { Chips, Stepper, cx, ftWords } from "./parts";
import s from "./deck-client-designer.module.css";

const QUICK_NAMES: Record<QuickWall, { name: string; words: string }> = {
  straight: { name: "Straight wall", words: "No corners behind the deck" },
  "bump-right": { name: "Bump-out on the right", words: "Part of the house sticks out at the deck's right end" },
  "bump-left": { name: "Bump-out on the left", words: "Part of the house sticks out at the deck's left end" },
  nook: { name: "Deck in a nook", words: "The house wraps around both ends of the deck" },
};

type Lean = "out" | "flush" | "back";
const leanOf = (offset: number): Lean => (offset > 0 ? "out" : offset < 0 ? "back" : "flush");

/** The picture in the measuring guide: the house from above, its back wall walked left to right. */
function MeasureFigure() {
  return (
    <svg viewBox="0 0 360 200" className={s.guideFig} role="img" aria-label="The back of a house seen from above: wall 1 where the deck goes, wall 2 sticking out, wall 3 back in line, and where the deck starts">
      <defs>
        <marker id="cdArrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L8 4L0 8z" className={s.guideInk} />
        </marker>
      </defs>
      {/* the house: wall 1, a part sticking out (wall 2), wall 3 back in line */}
      <path d="M20 12H340V60H250V84H190V60H20Z" className={s.guideHouse} />
      <text x="105" y="34" className={s.guideHouseText}>YOUR HOUSE</text>
      {/* the deck on wall 1 */}
      <rect x="60" y="60" width="130" height="64" className={s.guideDeck} />
      <text x="125" y="97" className={s.guideDeckText}>DECK</text>
      {/* wall 1 and wall 3, measured along the wall */}
      <line x1="20" y1="52" x2="190" y2="52" className={s.guideDim} markerStart="url(#cdArrow)" markerEnd="url(#cdArrow)" />
      <circle cx="105" cy="52" r="8" className={s.guideBadge} />
      <text x="105" y="55.5" className={s.guideBadgeText}>1</text>
      <line x1="250" y1="52" x2="340" y2="52" className={s.guideDim} markerStart="url(#cdArrow)" markerEnd="url(#cdArrow)" />
      <circle cx="295" cy="52" r="8" className={s.guideBadge} />
      <text x="295" y="55.5" className={s.guideBadgeText}>3</text>
      {/* wall 2: its length, and how far it sticks out */}
      <line x1="190" y1="96" x2="250" y2="96" className={s.guideDim} markerStart="url(#cdArrow)" markerEnd="url(#cdArrow)" />
      <circle cx="220" cy="96" r="8" className={s.guideBadge} />
      <text x="220" y="99.5" className={s.guideBadgeText}>2</text>
      <line x1="258" y1="62" x2="258" y2="84" className={s.guideDim} markerStart="url(#cdArrow)" markerEnd="url(#cdArrow)" />
      <text x="265" y="77" className={s.guideNote}>sticks out</text>
      {/* where the deck starts */}
      <line x1="20" y1="138" x2="60" y2="138" className={s.guideDim} markerStart="url(#cdArrow)" markerEnd="url(#cdArrow)" />
      <line x1="20" y1="62" x2="20" y2="146" className={s.guideTick} />
      <line x1="60" y1="126" x2="60" y2="146" className={s.guideTick} />
      <text x="40" y="158" className={s.guideNoteMid}>deck starts</text>
      {/* you, in the yard */}
      <circle cx="290" cy="138" r="6" className={s.guideYou} />
      <path d="M290 144v14M283 150h14" className={s.guideYouLine} />
      <text x="290" y="174" className={s.guideNoteMid}>you, facing the house</text>
      <text x="20" y="192" className={s.guideNote}>← start at the LEFT corner</text>
    </svg>
  );
}

export function ClientHouse({ shape, house, shopName, onChange }: { shape: DeckShape; house: HouseDesign; shopName: string; onChange: (next: { house?: HouseDesign; shape?: DeckShape }) => void }) {
  const sheet = wallSheet(house, shape);
  const [sheetNote, setSheetNote] = React.useState<string | null>(null);
  const W = shape.widthFt;

  /** The sheet changed: the house rebuilt from it (its look kept), and anything bent to fit said once. */
  const fromSheet = (stretches: WallStretch[], deckStartFt = sheet.deckStartFt) => {
    const r = houseFromSheet(house, shape, { stretches, deckStartFt });
    setSheetNote(r.note);
    onChange({ house: r.house });
  };
  const setStretch = (i: number, p: Partial<WallStretch>) => fromSheet(sheet.stretches.map((st, k) => (k === i ? { ...st, ...p } : st)));
  const setLean = (i: number, lean: Lean) => {
    const st = sheet.stretches[i];
    const by = Math.abs(st.offsetFt) || 2;
    setStretch(i, { offsetFt: lean === "flush" ? 0 : lean === "out" ? by : -by });
  };
  const addStretch = () => {
    const last = sheet.stretches[sheet.stretches.length - 1];
    fromSheet([...sheet.stretches, { lengthFt: 6, offsetFt: last.offsetFt === 0 ? 2 : 0 }]);
  };
  const removeStretch = (i: number) => fromSheet(sheet.stretches.filter((_, k) => k !== i));

  const fit = deckShapeForHouse(shape, house);
  const fixes = fit.note ? wallFixes(shape, house, { minWidthFt: DECK_LIMITS.widthFt.min, maxWidthFt: DECK_LIMITS.widthFt.max }) : [];
  const quick = quickWallOf(shape, house);
  const [exactOpen, setExactOpen] = React.useState(() => quick === null || !!fit.note);

  return (
    <div className={s.house} data-client-house>
      <div className={s.lbl}>Start from</div>
      <Chips label="The wall's shape" value={quick} options={QUICK_WALLS.map((k) => ({ value: k, name: QUICK_NAMES[k].name, words: QUICK_NAMES[k].words }))} onChange={(k) => { setSheetNote(null); onChange({ house: quickWall(k, shape, house) }); }} />

      <p className={fit.note ? s.warn : s.hint} data-client-wall-words>{wallWords(shape, house)}</p>
      {fixes.length ? (
        <div className={s.fixes} data-client-wall-fixes>
          {fixes.slice(0, 4).map((f) => (
            <button key={f.id} type="button" className={s.tipBtn} onClick={() => { setSheetNote(null); onChange({ house: f.house, shape: f.shape }); }}>{f.label}</button>
          ))}
        </div>
      ) : null}

      <div className={s.lbl}>Your house</div>
      <div className={s.lookGrid}>
        <Chips small label="Storeys" value={house.storeys} options={[{ value: 1 as const, name: "One storey" }, { value: 2 as const, name: "Two storeys" }]} onChange={(v) => onChange({ house: { ...house, storeys: v } })} />
        <Chips small label="House roof" value={house.roof} options={HOUSE_ROOFS.map((r) => ({ value: r, name: `${HOUSE_ROOF_LABEL[r]} roof` }))} onChange={(v: HouseRoof) => onChange({ house: { ...house, roof: v } })} />
      </div>
      <Chips small label="Siding colour" value={house.siding} options={SIDINGS.map((c) => ({ value: c.id, name: c.label, swatch: c.hex }))} onChange={(v: SidingId) => onChange({ house: { ...house, siding: v } })} />
      <Chips small label="Roof colour" value={house.roofColour} options={ROOF_COLOURS.map((c) => ({ value: c.id, name: c.label, swatch: c.hex }))} onChange={(v: RoofColourId) => onChange({ house: { ...house, roofColour: v } })} />

      {/* MEASURE IT EXACTLY — OPTIONAL (2026-10-17 audit: the wall step ran over two phone screens of tape
          measures before the client had sized the deck). The quick shapes and the house's look stay out; the
          measuring guide, the wall parts and the drawing fold in here. It opens itself when the wall is already
          custom, or the deck does not fit it — and every part of it still works as before. */}
      <details className={s.exact} open={exactOpen} onToggle={(e) => setExactOpen(e.currentTarget.open)} data-client-exact>
        <summary className={s.exactSum}>
          <b>Measure it exactly</b>
          <span>Optional — {shopName} measures on site before building</span>
        </summary>
        <div className={s.exactBody}>
          <details className={s.guide} data-client-measure-guide>
            <summary className={s.guideSum}>How to measure your wall — 2 minutes with a tape</summary>
            <div className={s.guideBody}>
              <MeasureFigure />
              <ol className={s.guideSteps}>
                <li>Stand in the yard facing the back of the house. Start at the <b>left corner</b>.</li>
                <li>Measure along the bottom of the wall to the first corner where the wall turns — that is <b>wall 1</b>.</li>
                <li>At that corner, measure how far the next part <b>sticks out</b> or <b>sits back</b>, face to face. Then measure its length — <b>wall 2</b>. Keep going to the right corner.</li>
                <li>Last, measure from the left corner to where you want the deck to <b>start</b>.</li>
              </ol>
              <p className={s.hint}>Measure the siding, not the trim. Half a foot is close enough — type 12.5 for 12 ft 6 in. {shopName} checks it on site before building.</p>
            </div>
          </details>
          <div className={s.lbl}>Your measurements — left corner to right corner</div>
          <ol className={s.stretches} data-client-stretches>
            {sheet.stretches.map((st, i) => {
              const main = i === sheet.mainIndex;
              const lean = leanOf(st.offsetFt);
              return (
                <li key={i} className={cx(s.stretch, main && s.stretchMain)} data-client-stretch={i}>
                  <div className={s.stretchHead}>
                    <b>Wall {i + 1}</b>
                    {main ? <span className={s.tag}>The deck is on this wall</span> : null}
                    <span className={s.stretchSpacer} />
                    {!main && sheet.stretches.length > 1 ? (
                      <button type="button" className={s.removeBtn} onClick={() => removeStretch(i)} aria-label={`Remove wall ${i + 1}`}>Remove</button>
                    ) : null}
                  </div>
                  <div className={s.stretchGrid}>
                    <Stepper label={`Wall ${i + 1} length, ft`} data={`stretch-${i}-length`} feet value={st.lengthFt} min={1} max={80} step={0.5} words={ftWords} onChange={(v) => setStretch(i, { lengthFt: v })} />
                    {main ? (
                      <p className={s.hint}>The wall the deck attaches to — the others are measured against it.</p>
                    ) : (
                      <div className={s.leanBox}>
                        <Chips small label={`Wall ${i + 1} against the deck's wall`} value={lean} options={[{ value: "out" as Lean, name: "Sticks out" }, { value: "flush" as Lean, name: "In line" }, { value: "back" as Lean, name: "Sits back" }]} onChange={(v) => setLean(i, v)} />
                        {lean !== "flush" ? (
                          <Stepper compact label={`Wall ${i + 1} ${lean === "out" ? "sticks out" : "sits back"} by, ft`} data={`stretch-${i}-offset`} feet value={Math.abs(st.offsetFt)} min={0.5} max={HOUSE_LIMITS.depthFt.max} step={0.5} words={(v) => `${lean === "out" ? "sticks out" : "sits back"} ${ftWords(v)}`} onChange={(v) => setStretch(i, { offsetFt: lean === "out" ? v : -v })} />
                        ) : null}
                      </div>
                    )}
                  </div>
                  {!main ? (
                    <button type="button" className={s.linkBtn} onClick={() => fromSheet(sheet.stretches, centreOn(sheet, i, W))} data-client-deck-on={i}>Put the deck on this wall</button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {sheet.stretches.length < STRETCH_MAX ? (
            <button type="button" className={s.ghostBtn} onClick={addStretch} data-client-add-stretch>+ The wall turns — add the next part</button>
          ) : (
            <p className={s.hint}>That is the most corners the drawing takes ({STRETCH_MAX} wall parts) — the far ones can be left out.</p>
          )}

          <div className={s.grid2}>
            <Stepper label="Deck starts from the left corner, ft" data="deck-start" feet value={sheet.deckStartFt} min={0} max={Math.max(0, sheet.totalFt - 1)} step={0.5} words={ftWords} onChange={(v) => fromSheet(sheet.stretches, v)} />
            <div className={s.centreBox}>
              <button type="button" className={s.ghostBtn} onClick={() => fromSheet(sheet.stretches, centreOn(sheet, sheet.mainIndex, W))} data-client-centre>Centre the deck on its wall</button>
            </div>
          </div>
          <p className={s.hint} data-client-sheet-words>Corner to corner: <b>{ftWords(sheet.totalFt)}</b> — {sheetWords(sheet)}.</p>
          {sheetNote ? <p className={s.warn} role="status">{sheetNote}</p> : null}
          <div className={s.lbl}>Or draw it — drag the walls, the corners and the deck</div>
          <div className={s.drawing} data-client-wall-drawing>
            <HouseWallPlan shape={shape} house={house} onChange={(n2) => { setSheetNote(null); onChange(n2); }} />
          </div>
        </div>
      </details>
    </div>
  );
}
