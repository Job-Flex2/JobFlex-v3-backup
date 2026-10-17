"use client";

// THE BRAND AND LINE ON THIS ROOF (owner, 2026-10-16: "show the brands most popular per state … the contractor clicks
// the brand and knows it's popular in the state"). Under the system in Card D's "Roof system": the lines that ARE this
// system, ranked for the job's state by lib/roofPackage/brands, each saying why in a few words. The first one is on
// unless the contractor picks another (their pick is remembered per system — Prefs.brands), or "Any brand".

import * as React from "react";
import { brandHeadline, STATE_NAME, topPicks, type BrandHint, type BrandPrice, type RankedProduct } from "@/lib/roofPackage/brands";

const TOP = 4;

export function RoofBrandPicker({
  ranked,
  selectedId,
  auto,
  usualId,
  state,
  systemLabel,
  onPick,
  priceOf,
  hint,
  onHint,
  disabled,
}: {
  ranked: readonly RankedProduct[];
  /** The line in use (null: any brand). */
  selectedId: string | null;
  /** The line in use is the state's pick, not the contractor's. */
  auto: boolean;
  /** The contractor's usual line for this system, when they have one. */
  usualId?: string | null;
  state: string | null;
  systemLabel: string;
  onPick: (productId: string | null) => void;
  /** The line's price on this estimate (the contractor's own, else their system rate moved by retail). */
  priceOf?: (productId: string) => BrandPrice;
  /** What the state asks of this roof (Class 4 credit, Title 24, the HVHZ) — and the system to switch to. */
  hint?: BrandHint | null;
  onHint?: (systemId: string) => void;
  disabled?: boolean;
}) {
  const [more, setMore] = React.useState(false);
  if (!ranked.length) return null;
  // Four different brands up front (each at its best line here); their other lines wait under "More brands".
  const top = topPicks(ranked, TOP);
  // The one in use always shows, even when it sits below the top four.
  const chosen = ranked.find((r) => r.product.id === selectedId);
  const shown = chosen && !top.includes(chosen) ? [...top.slice(0, TOP - 1), chosen] : top;
  const rest = ranked.filter((r) => !shown.includes(r));
  const st = state && STATE_NAME[state] ? state : null;
  return (
    <div className="rbd-brands" data-roof-brands={st ?? "none"}>
      <div className="rbd-brands-h">
        <span className="rbd-lbl">Brand</span>
        <span className="rbd-brands-t" data-roof-brands-headline>
          {brandHeadline(systemLabel, st)}
        </span>
      </div>
      <p className="rbd-note rbd-brands-why">
        {st
          ? `Ranked for ${STATE_NAME[st]} by state approvals, the weather and what the yards nearby stock — the first is on until you pick.`
          : "Add the roof's address to rank these for its state."}
      </p>
      {hint ? (
        <p className="rbd-note rbd-brands-hint" data-roof-brands-hint>
          {hint.text}
          {hint.switchTo && onHint ? (
            <>
              {" "}
              <button type="button" className="rbd-text-btn" onClick={() => onHint(hint.switchTo!)} disabled={disabled} data-roof-brands-switch={hint.switchTo}>
                {hint.switchLabel ?? "Switch"}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="rbd-brand-grid" role="radiogroup" aria-label="Brand and line">
        {shown.map((r) => (
          <BrandTile key={r.product.id} r={r} price={priceOf?.(r.product.id)} on={r.product.id === selectedId} auto={auto && r.product.id === selectedId} usual={r.product.id === usualId} onPick={onPick} disabled={disabled} />
        ))}
      </div>
      <div className="rbd-brands-foot">
        <button type="button" className={"rbd-chip" + (selectedId === null ? " is-on" : "")} aria-pressed={selectedId === null} onClick={() => onPick(null)} disabled={disabled} data-roof-brand="any">
          Any brand
        </button>
        {rest.length ? (
          <button type="button" className="rbd-text-btn" onClick={() => setMore((m) => !m)} aria-expanded={more} data-roof-brands-more>
            {more ? "Fewer brands" : `More brands (${rest.length})`}
          </button>
        ) : null}
      </div>
      {more && rest.length ? (
        <div className="rbd-brand-grid rbd-brand-grid--more" role="radiogroup" aria-label="More brands">
          {rest.map((r) => (
            <BrandTile key={r.product.id} r={r} price={priceOf?.(r.product.id)} on={r.product.id === selectedId} auto={false} usual={r.product.id === usualId} onPick={onPick} disabled={disabled} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function BrandTile({ r, price, on, auto, usual, onPick, disabled }: { r: RankedProduct; price?: BrandPrice; on: boolean; auto: boolean; usual: boolean; onPick: (id: string) => void; disabled?: boolean }) {
  const reasons = r.held ? [r.held] : r.reasons.slice(0, 2);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={"rbd-brand" + (on ? " is-on" : "") + (r.held ? " is-held" : "")}
      onClick={() => onPick(r.product.id)}
      disabled={disabled}
      data-roof-brand={r.product.id}
    >
      <span className="rbd-brand-name">
        <b>{r.brand.name}</b> {r.product.line}
      </span>
      {(usual || auto || r.product.class4) && (
        <span className="rbd-brand-tags">
          {usual ? <span className="rbd-brand-tag">Your usual</span> : auto ? <span className="rbd-brand-tag is-auto">Top pick</span> : null}
          {r.product.class4 ? <span className="rbd-brand-tag">Class 4</span> : null}
        </span>
      )}
      {price ? (
        <span className="rbd-brand-price" data-roof-brand-price={price.basis}>
          <b>{money(price.matPerSq)}</b> material + {money(price.laborPerSq)} labor /sq
          {price.basis === "own" ? <span className="rbd-brand-price-k">your price</span> : price.factor != null && Math.round((price.factor - 1) * 100) !== 0 ? <span className="rbd-brand-price-k">{`${price.factor > 1 ? "+" : "−"}${Math.abs(Math.round((price.factor - 1) * 100))}% retail`}</span> : null}
        </span>
      ) : null}
      <span className="rbd-brand-why">{reasons.join(" · ")}</span>
      <span className="rbd-tile-mark" aria-hidden="true">
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </button>
  );
}
