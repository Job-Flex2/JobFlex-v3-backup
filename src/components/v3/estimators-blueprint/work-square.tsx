// THE STEP SQUARE of an estimator's working card (owner, 2026-10-17: "the loading squares like the Smart
// estimator's"). The same 20×20 mark Smart Proposal's generation overlay draws (advanced-ai-content GenOverlay):
// waiting — a dashed outline; now — a quarter-perimeter line walking round a faint blue square; done — filled
// blue with a white tick. Both rects are always drawn, so a state change is a repaint, never a remount that would
// restart the walk.
import s from "./work-square.module.css";

export type WorkSquareState = "wait" | "now" | "done";

export function WorkSquare({ state }: { state: WorkSquareState }) {
  return (
    <span className={s.mark} data-state={state} aria-hidden="true">
      <svg className={s.ring} viewBox="0 0 20 20">
        <rect className={s.track} x="1" y="1" width="18" height="18" />
        <rect className={s.run} x="1" y="1" width="18" height="18" />
      </svg>
      <svg className={s.tick} viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}
