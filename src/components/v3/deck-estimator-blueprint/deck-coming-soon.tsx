// THE DECK STUDIO'S OFFER (2026-10-04 as "coming soon"; 2026-10-11 the
// edition, lib/editions) — what an account WITHOUT the whole Deck Studio sees
// where the studio's pages would be (lib/deck/access). Since 2026-10-19 the
// studio itself opens as a PREVIEW to every account (2026-10-20: the Free plan
// too), so this is the deck inventory's page for a preview (a plan opens it —
// owner, 2026-10-21: the Deck estimator comes with every plan), and the
// studio's page while the edition is coming soon.
import Link from "next/link";
import type { Route } from "next";
import { isEditionOpen } from "@/lib/editions";
import s from "./deck-studio.module.css";

export function DeckComingSoon() {
  // Coming soon (lib/editions EDITION_OPEN, owner 2026-10-11): said plainly, nothing to buy yet.
  const open = isEditionOpen("deck");
  return (
    <div className={s.studio}>
      <div className={s.pageHead}>
        <div>
          <div className={s.kicker}>Automation · Estimating</div>
          <h1 className={s.pageTitle}>Deck estimator</h1>
        </div>
      </div>
      <section className={`${s.card} ${s.soonCard}`} aria-label={open ? "Part of Deck Studio" : "Deck Studio — coming soon"}>
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>{open ? "Part of Deck Studio" : "Deck Studio — coming soon"}</div>
            <div className={s.cardSub}>{open ? "The Deck estimator's preview is open to you. A plan opens the rest — every plan has it; on a Custom plan, add the Deck estimator page." : "It isn't open yet. Until it is, Smart Proposal prices a deck from a description."}</div>
          </div>
          <span className={`${s.stamp} ${s.stampWarn}`}>{open ? "Deck Studio" : "Coming soon"}</span>
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
            {open ? (
              <>
                <Link className={`${s.btn} ${s.btnPrimary}`} href={"/dashboard/subscription" as Route}>
                  Choose a plan
                </Link>
                <Link className={s.btn} href={"/dashboard/deck-estimator" as Route}>
                  Design a deck in the preview
                </Link>
              </>
            ) : (
              <Link className={`${s.btn} ${s.btnPrimary}`} href={"/dashboard/advanced-ai" as Route}>
                Price a deck with Smart Proposal
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
