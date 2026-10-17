"use client";

import s from "./blueprint-estimator.module.css";

const STEPS = ["Reading your plans", "Working out the job", "Measuring it on the sheets", "Pricing"];

export function BlueprintLoadingCard({ request, step, readDone, readTotal, hint, onCancel }: {
  request: string;
  step: number;
  readDone: number;
  readTotal: number;
  hint: string;
  onCancel: () => void;
}) {
  const progress = Math.min(99, Math.round(((step + (step === 0 && readTotal ? readDone / readTotal : 0.5)) / STEPS.length) * 100));
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
            <span className={s.stepMark} aria-hidden="true" />
            <span>{label}</span>
            <span className={s.stepState}>{i < step ? "Done" : i === step ? "In progress" : ""}</span>
          </li>
        ))}
      </ol>
      <p className={s.workHint}>{hint}</p>
      <button type="button" className={s.btnGhost} onClick={onCancel}>Cancel</button>
    </section>
  );
}
