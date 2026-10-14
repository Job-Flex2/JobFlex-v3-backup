// An estimate from the blueprint estimator, handed to Smart Proposal's ledger to be
// edited there ("Edit in Smart Proposal") — the one thing the two tools share.
//
// Browser module state: it survives a client-side navigation and is gone on a reload —
// a hand-off, not storage. Taken once.
import type { PlanEstimate } from "./merge";

export type PlanEstimateDone = PlanEstimate & {
  /** The market it was priced in ("City, ST"). */
  location: string;
  /** The job address from the plans' title block, when they carry one. */
  address: string | null;
  wholeHouse: boolean;
};

let estimate: PlanEstimateDone | null = null;

export function handPlanEstimate(next: PlanEstimateDone): void {
  estimate = next;
}

export function takePlanEstimate(): PlanEstimateDone | null {
  const e = estimate;
  estimate = null;
  return e;
}
