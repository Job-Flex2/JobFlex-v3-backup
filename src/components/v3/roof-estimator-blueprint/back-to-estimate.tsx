// "Back to the estimate" on the roof-types page (owner, 2026-10-16: "when I press Manage roof types there is no way
// to come back to the estimate builder"). Shown only when the page was opened from the estimate (?from=estimate);
// the estimator reopens the measurement and the builder from what it kept for this tab (roof-estimator-data-form,
// RETURN_KEY). Floats at the foot of the page so the price book's own layout is untouched, on a desk and a phone.
import Link from "next/link";
import s from "./back-to-estimate.module.css";

export function BackToEstimate() {
  return (
    <Link href="/dashboard/roof-estimator?reopen=1" className={s.back} data-back-to-estimate>
      <span aria-hidden="true">←</span> Back to the estimate
    </Link>
  );
}
