"use client";
// DECK ESTIMATOR — VARIANT 5: THE GALLERY ("start from the deck people ask for", 2026-10-18).
//
// Most jobs are one of a handful of decks. The first view is those decks as pictures — the engine's own drawings of
// every sample it knows (lib/deck/samples, drawn by deck-kind-picker's IsoFigure), grouped by kind — each with its
// usual size and what it comes to on THIS shop's rate book at this address. One click lays the sample over the job
// (the address, site, house and lumber stay) and opens the editor. The job address sits on top because it moves the
// prices: the lumber, the frost line, the snow and the market's rates all follow it.

import * as React from "react";
import { IsoFigure, type Turn } from "@/components/v3/deck-estimator-blueprint/deck-kind-picker";
import { KINDS, type DeckSample } from "@/lib/deck/samples";
import type { Structure } from "@/lib/deck/design";
import { cx, money } from "./deck-v5-controls";

export interface PricedSample {
  sample: DeckSample;
  price: number;
  size: string;
  detail: string;
}

function Card({ p, inUse, onPick }: { p: PricedSample; inUse: boolean; onPick: () => void }) {
  const turn = React.useRef<Turn | null>(null);
  const [spin, setSpin] = React.useState(false);
  return (
    <li className="v5-card-wrap" onPointerEnter={(e) => { if (e.pointerType === "mouse") setSpin(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" className={cx("v5-card", inUse && "is-on")} onClick={onPick} data-deck-sample={p.sample.id} aria-label={`${p.sample.name}, ${p.size}, from ${money(p.price)}`}>
        <span className="v5-card-fig">
          <IsoFigure sample={p.sample} detail="thumb" spin={spin} label={p.sample.name} turnRef={turn} />
        </span>
        <span className="v5-card-body">
          <span className="v5-card-name">{p.sample.name}</span>
          <span className="v5-card-size">{p.size}</span>
          {p.detail ? <span className="v5-card-detail">{p.detail}</span> : null}
          <span className="v5-card-price">
            <span className="v5-card-from">from</span> {money(p.price)}
          </span>
        </span>
        {inUse ? <span className="v5-stamp v5-stamp--info v5-card-stamp">On your deck</span> : null}
      </button>
    </li>
  );
}

export function DeckGallery({ priced, appliedId, onPick, onBlank, blankPrice, addressField, priceNote, onBack }: { priced: PricedSample[]; appliedId: string | null; onPick: (s: DeckSample) => void; onBlank: () => void; blankPrice: number; addressField: React.ReactNode; priceNote: React.ReactNode; onBack: (() => void) | null }) {
  const byKind = new Map<Structure, PricedSample[]>();
  for (const p of priced) byKind.set(p.sample.structure, [...(byKind.get(p.sample.structure) ?? []), p]);
  return (
    <div className="v5-gallery" data-deck-kinds>
      <section className="v5-job" aria-label="Job">
        {addressField}
      </section>
      <div className="v5-gallery-head">
        <h2 className="v5-h2">Pick the deck to start from</h2>
        <div className="v5-gallery-note">{priceNote}</div>
        {onBack ? (
          <button type="button" className="v5-btn" onClick={onBack} data-v5-back-to-editor>
            Back to your deck
          </button>
        ) : null}
      </div>
      {KINDS.map(({ structure, label }) => {
        const list = byKind.get(structure) ?? [];
        if (!list.length) return null;
        return (
          <section key={structure} className="v5-kind" aria-label={label} data-deck-samples={structure}>
            <h3 className="v5-kind-name">{label}</h3>
            <ul className="v5-cards">
              {list.map((p) => (
                <Card key={p.sample.id} p={p} inUse={p.sample.id === appliedId} onPick={() => onPick(p.sample)} />
              ))}
              {structure === "deck" ? (
                <li className="v5-card-wrap">
                  <button type="button" className="v5-card v5-card--blank" onClick={onBlank} data-deck-sample="blank">
                    <span className="v5-card-fig v5-card-fig--blank" aria-hidden="true">
                      <svg viewBox="0 0 120 80"><rect x="22" y="18" width="76" height="44" /><path d="M22 70h76M22 66v8M98 66v8M10 18v44M6 18h8M6 62h8" /></svg>
                    </span>
                    <span className="v5-card-body">
                      <span className="v5-card-name">Your own size</span>
                      <span className="v5-card-size">A plain deck to size yourself</span>
                      <span className="v5-card-price">
                        <span className="v5-card-from">from</span> {money(blankPrice)}
                      </span>
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
