"use client";

import { WorkSquare } from "../estimators-blueprint/work-square";
import s from "./blueprint-estimator.module.css";
import { PRICING_STEP, WORK_STEPS, workProgress } from "./use-blueprint-estimator";

// The steps and the meter live with the estimator's state (use-blueprint-estimator), shared with the phone page.
const STEPS = WORK_STEPS;
const PRICING = PRICING_STEP;

export function BlueprintLoadingCard({ request, step, readDone, readTotal, priced = 0, priceTotal = 0, onCancel }: {
  request: string;
  step: number;
  readDone: number;
  readTotal: number;
  /** Trades priced so far and of how many — the pricing step's real progress (2026-10-17; it read a fixed 88%). */
  priced?: number;
  priceTotal?: number;
  onCancel: () => void;
}) {
  const { progress, pricingWords } = workProgress({ step, readDone, readTotal, priced, priceTotal });
  return (
    <section className={`${s.card} ${s.work}`} aria-label="Blueprint estimate progress">
      <div className={s.workRequest}>{request}</div>
      <div className={s.workHead}>
        <div className={s.workStage} role="status">{STEPS[step]}…</div>
        <div className={s.workPercent}>{progress}%</div>
      </div>
      <div className={s.meter} role="progressbar" aria-label="Estimate progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className={s.steps} aria-label="Estimate steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? s.stepDone : i === step ? s.stepNow : undefined}>
            <WorkSquare state={i < step ? "done" : i === step ? "now" : "wait"} />
            <span>{label}</span>
            <span className={s.stepState}>{i < step ? "Done" : i === step ? (i === PRICING && pricingWords ? pricingWords : "In progress") : ""}</span>
          </li>
        ))}
      </ol>
      {/* Red Cancel, nothing written under the bars (owner, 2026-10-20). */}
      <button type="button" className={`${s.btnGhost} ${s.btnCancel}`} onClick={onCancel}>Cancel</button>
    </section>
  );
}
