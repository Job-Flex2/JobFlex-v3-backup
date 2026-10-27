"use client";
// YOUR RANGE (2026-10-27): the number first, then what's included and what moves it. Priced in the browser by the
// pure engine (lib/publicEstimate/roof) from the Solar read the server gave once; a chip re-prices without a call.
// When the sky couldn't see the roof, the home's size stands in. Never a line item, never a rate.
import * as React from "react";
import { moneyRange, roofFactsFromSize, roofFactsFromSolar, roofRange, type RoofAnswers, type RoofRange } from "@/lib/publicEstimate/roof";
import type { RoofRead } from "./roof-flow";
import type { Site } from "./place-field";
import s from "./price.module.css";

export const DISCLAIMER = "An estimate range from aerial data and local prices, not a quote. A local pro confirms on site.";

export function priceRange(read: RoofRead, answers: RoofAnswers, site: Site, homeSqft: number | null): RoofRange | null {
  const city = read.cityWords ? { factor: read.cityFactor, words: read.cityWords } : null;
  if (read.solar) return roofRange(roofFactsFromSolar(read.solar, answers, site.state), answers, city, "solar");
  if (homeSqft && homeSqft >= 200) return roofRange(roofFactsFromSize(homeSqft, answers, site.state), answers, city, "size");
  return null;
}

export function RangeView({ site, read, answers, onAnswers, onBack }: { site: Site; read: RoofRead; answers: RoofAnswers; onAnswers: (a: RoofAnswers) => void; onBack: () => void }) {
  const [homeSqft, setHomeSqft] = React.useState<number | null>(null);
  void onAnswers;
  const range = React.useMemo(() => priceRange(read, answers, site, homeSqft), [read, answers, site, homeSqft]);
  return (
    <div className={s.panel} data-price-step="range">
      {!read.solar ? (
        <div className={s.field} data-price-fallback>
          <p className={s.qT}>{read.noRoofReason ?? "We couldn’t read your roof from the sky."}</p>
          <label className={s.label} htmlFor="price-sqft">About how big is the home, in square feet?</label>
          <input id="price-sqft" className={s.input} inputMode="numeric" placeholder="2,400" onChange={(e) => setHomeSqft(Number(e.target.value.replace(/[^0-9]/g, "")) || null)} data-price-sqft />
        </div>
      ) : null}
      {range ? (
        <div className={s.rangeWrap}>
          <p className={s.rangeNum} data-price-number>{moneyRange(range)}</p>
          <p className={s.rangeBasis} data-price-basis>
            {range.basis === "solar" ? `about ${Math.round(range.squares * 100).toLocaleString("en-US")} sq ft of roof · ${range.pitchLabel} pitch · read from aerial data` : `about ${Math.round(range.squares * 100).toLocaleString("en-US")} sq ft of roof · from your home’s size`}
          </p>
          <p className={s.disclaim}>{DISCLAIMER}</p>
        </div>
      ) : null}
      <div className={s.acts}>
        <button type="button" className={`${s.btn} ${s.btnQuiet}`} onClick={onBack} data-price-back>
          ← Change my answers
        </button>
      </div>
      {/* The chips, the budget, compare and the two buttons follow (the range screen's own task). */}
    </div>
  );
}
