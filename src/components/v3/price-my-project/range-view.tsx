"use client";
// YOUR RANGE (2026-10-27): the number first, then what's included and what moves it. Priced in the browser by the
// pure engine (lib/publicEstimate/roof) from the Solar read the server gave once; a chip re-prices without a call.
// When the sky couldn't see the roof, the home's size stands in. Never a line item, never a rate — the whole
// estimate under the number rides with the lead, hidden, for the contractor who buys it.
import * as React from "react";
import {
  MATERIALS,
  budgetWords,
  materialWords,
  moneyRange,
  roofFactsFromSize,
  roofFactsFromSolar,
  roofRange,
  type MaterialId,
  type RoofAnswers,
  type RoofRange,
} from "@/lib/publicEstimate/roof";
import type { RoofRead } from "./roof-flow";
import type { Site } from "./place-field";
import s from "./price.module.css";

export const DISCLAIMER = "An estimate range from aerial data and local prices, not a quote. A local pro confirms on site.";

export type Priced = { range: RoofRange; answers: RoofAnswers; budgetCents: number | null; homeSqft: number | null };

export function priceRange(read: RoofRead, answers: RoofAnswers, site: Site, homeSqft: number | null): RoofRange | null {
  const city = read.cityWords ? { factor: read.cityFactor, words: read.cityWords } : null;
  if (read.solar) return roofRange(roofFactsFromSolar(read.solar, answers, site.state), answers, city, "solar");
  if (homeSqft && homeSqft >= 200) return roofRange(roofFactsFromSize(homeSqft, answers, site.state), answers, city, "size");
  return null;
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function Chip({ on, onClick, children, name }: { on: boolean; onClick: () => void; children: React.ReactNode; name: string }) {
  return (
    <button type="button" className={`${s.chip}${on ? ` ${s.chipOn}` : ""}`} aria-pressed={on} onClick={onClick} data-price-chip={name}>
      {children}
    </button>
  );
}

export function RangeView({
  site,
  read,
  answers,
  onAnswers,
  onBack,
  onQuotes,
  onEmail,
}: {
  site: Site;
  read: RoofRead;
  answers: RoofAnswers;
  onAnswers: (a: RoofAnswers) => void;
  onBack: () => void;
  onQuotes: (p: Priced) => void;
  onEmail: (p: Priced) => void;
}) {
  const [homeSqft, setHomeSqft] = React.useState<number | null>(null);
  const [budgetText, setBudgetText] = React.useState("");
  const [compareWith, setCompareWith] = React.useState<MaterialId | null>(null);
  const range = React.useMemo(() => priceRange(read, answers, site, homeSqft), [read, answers, site, homeSqft]);
  // Every other material on this roof — for the budget sentence and the compare card.
  const alternatives = React.useMemo(
    () => MATERIALS.filter((m) => m.id !== answers.material).map((m) => ({ material: m.id, range: priceRange(read, { ...answers, material: m.id }, site, homeSqft) })).filter((a): a is { material: MaterialId; range: RoofRange } => !!a.range),
    [read, answers, site, homeSqft],
  );
  const budgetCents = budgetText.trim() === "" ? null : Math.round(Number(budgetText.replace(/[^0-9.]/g, "")) * 100) || null;
  const set = <K extends keyof RoofAnswers>(k: K, v: RoofAnswers[K]) => onAnswers({ ...answers, [k]: v });
  const priced = (): Priced | null => (range ? { range, answers, budgetCents, homeSqft } : null);
  const other = compareWith ? alternatives.find((a) => a.material === compareWith) ?? null : null;
  const showTypical = answers.material === "architectural" && read.guide;

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
          <div>
            <p className={s.rangeNum} data-price-number>{moneyRange(range)}</p>
            <p className={s.rangeBasis} data-price-basis>
              {materialWords(answers.material)} · about {Math.round(range.squares * 100).toLocaleString("en-US")} sq ft of roof
              {range.basis === "solar" ? ` · ${range.pitchLabel} pitch · read from aerial data` : " · from your home’s size"}
            </p>
          </div>
          {showTypical && read.guide ? (
            <p className={s.typical} data-price-typical>
              <b>Typical in {read.guide.cityWords}:</b> {usd(read.guide.low)}–{usd(read.guide.high)} for this kind of roof
            </p>
          ) : null}

          <div>
            <p className={s.chipT}>What’s included</p>
            <ul className={s.incl} data-price-incl>
              {range.scope.slice(0, 7).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          <div className={s.chips} data-price-chips>
            <div className={s.chipRow}>
              <p className={s.chipT}>Material</p>
              <div className={s.chipSet}>
                {MATERIALS.map((m) => (
                  <Chip key={m.id} name={`material-${m.id}`} on={answers.material === m.id} onClick={() => set("material", m.id)}>
                    {m.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div className={s.chipRow}>
              <p className={s.chipT}>Tear-off</p>
              <div className={s.chipSet}>
                {([0, 1, 2] as const).map((n) => (
                  <Chip key={n} name={`tear-${n}`} on={answers.tearOffLayers === n} onClick={() => set("tearOffLayers", n)}>
                    {n === 0 ? "None — lay over" : n === 1 ? "1 layer" : "2 layers"}
                  </Chip>
                ))}
              </div>
            </div>
            <div className={s.chipRow}>
              <p className={s.chipT}>Floors</p>
              <div className={s.chipSet}>
                {([1, 2, 3] as const).map((n) => (
                  <Chip key={n} name={`floors-${n}`} on={answers.storeys === n} onClick={() => set("storeys", n)}>
                    {n === 3 ? "3 or more" : String(n)}
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          <div className={s.budget}>
            <p className={s.chipT}>Is it in my budget?</p>
            <div className={s.budgetRow}>
              <span>I have about</span>
              <input className={`${s.input} ${s.budgetIn}`} inputMode="numeric" placeholder="$18,000" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} aria-label="Your budget, dollars" data-price-budget />
            </div>
            {budgetCents ? <p className={s.budgetSay} data-price-budget-say>{budgetWords(budgetCents, range, alternatives)}</p> : null}
          </div>

          <div>
            <p className={s.chipT}>Compare with</p>
            <div className={s.chipSet} data-price-compare>
              {alternatives.map((a) => (
                <Chip key={a.material} name={`compare-${a.material}`} on={compareWith === a.material} onClick={() => setCompareWith(compareWith === a.material ? null : a.material)}>
                  {MATERIALS.find((m) => m.id === a.material)?.label}
                </Chip>
              ))}
            </div>
            {other ? (
              <div className={s.compare} style={{ marginTop: 10 }} data-price-compare-cards>
                <div className={s.cmp}>
                  <p className={s.cmpT}>{MATERIALS.find((m) => m.id === answers.material)?.label}</p>
                  <p className={s.cmpN}>{moneyRange(range)}</p>
                </div>
                <div className={s.cmp}>
                  <p className={s.cmpT}>{MATERIALS.find((m) => m.id === other.material)?.label}</p>
                  <p className={s.cmpN}>{moneyRange(other.range)}</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className={s.acts}>
            <button type="button" className={s.btn} onClick={() => { const p = priced(); if (p) onQuotes(p); }} data-price-quotes>
              Get quotes from local pros
            </button>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => { const p = priced(); if (p) onEmail(p); }} data-price-email>
              Email me this range
            </button>
          </div>
          <p className={s.disclaim}>{DISCLAIMER}</p>
        </div>
      ) : null}

      <div className={s.acts}>
        <button type="button" className={`${s.btn} ${s.btnQuiet}`} onClick={onBack} data-price-back>
          ← Change my answers
        </button>
      </div>
    </div>
  );
}
