/* WHAT CONTRACTORS SAY ABOUT JOBFLEX (2026-10-19) — the reviews block
   under the hero's numbers (hero-proof.tsx), on every landing.

   OWNER FILLS: real reviews only, each with the person's consent — the
   sign-in page once carried a quote from a customer who does not exist
   (auth/login), and no page may do that again. Three show; while the list
   below is empty the block renders nothing, heading and all. */

export type LandingReview = {
  /** Their words, as they wrote them. */
  quote: string;
  /** The person's name as they agreed to show it ("Mike R."). */
  name: string;
  /** Their company. */
  company: string;
  /** Their trade or city, one short line ("Roofing · Tacoma, WA"). */
  detail?: string;
};

// owner fills — up to three; empty = no reviews block.
export const LANDING_REVIEWS: LandingReview[] = [];

export function LandingReviews({ reviews = LANDING_REVIEWS }: { reviews?: LandingReview[] }) {
  if (!reviews.length) return null;
  return (
    <div className="lp-proof-block">
      <h2 className="lp-proof-h">What contractors say</h2>
      <ul className="lp-reviews">
        {reviews.slice(0, 3).map((r) => (
          <li key={`${r.name}-${r.company}`} className="lp-review">
            <blockquote className="lp-review-quote">“{r.quote}”</blockquote>
            <p className="lp-review-who">
              <span className="lp-review-name">{r.name}</span>
              <span className="lp-review-co">
                {r.company}
                {r.detail ? ` · ${r.detail}` : ""}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
