// THE DECK STUDIO'S OFFER (2026-10-04 as "coming soon"; 2026-10-11 the
// edition, lib/editions) — what an account WITHOUT the Deck Studio sees at
// /dashboard/deck-estimator (lib/deck/access): what it is, and where to add
// it. No data, no client code.
import Link from "next/link";
import type { Route } from "next";
import s from "./deck-studio.module.css";

export function DeckComingSoon() {
  return (
    <div className={s.studio}>
      <div className={s.pageHead}>
        <div>
          <div className={s.kicker}>Automation · Estimating</div>
          <h1 className={s.pageTitle}>Deck estimator</h1>
        </div>
      </div>
      <section className={`${s.card} ${s.soonCard}`} aria-label="Part of Deck Studio">
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>Part of Deck Studio</div>
            <div className={s.cardSub}>It comes with the Deck Studio plan, or as an add-on to yours.</div>
          </div>
          <span className={`${s.stamp} ${s.stampWarn}`}>Deck Studio</span>
        </div>
        <div className={s.soonBody}>
          <p>Size a deck, choose what it is built from, and the estimator frames it from the building code&apos;s deck tables, stands it up in 3D and prices the material package and the labor.</p>
          <ul className={s.soonList}>
            <li>Joists, beams, posts, footings and the ledger sized for the load, with the table each one comes from.</li>
            <li>Watch it build in 3D, layer by layer, or read the framing plan from above.</li>
            <li>A material list in the lengths the yard sells: lumber, hangers, ties, flashing, concrete.</li>
            <li>One tap to a proposal, and your client sees the deck in 3D on their page.</li>
          </ul>
          <div className={s.soonActs}>
            <Link className={`${s.btn} ${s.btnPrimary}`} href={"/dashboard/upgrade?edition=deck" as Route} data-deck-offer="plans">
              Add Deck Studio to your plan
            </Link>
            <Link className={s.btn} href={"/dashboard/advanced-ai" as Route}>
              Price a deck with Smart Proposal
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
