// THE DECK STUDIO'S OFFER (2026-10-04 as "coming soon"; 2026-10-11 the
// edition, lib/editions) — what an account WITHOUT the whole Deck Studio sees
// where the studio's pages would be (lib/deck/access). Since 2026-10-19 the
// studio itself opens as a PREVIEW to every account whose plan runs, so this
// is the deck inventory's page for a preview ("preview": the $49/month add-on),
// and the studio's page for a plan that has ended ("none").
import Link from "next/link";
import type { Route } from "next";
import { isEditionOpen, type EditionLevel } from "@/lib/editions";
import { DeckAddonButton } from "@/components/v3/deck-addon/deck-addon";
import s from "./deck-studio.module.css";

export function DeckComingSoon({ level = "none" }: { level?: EditionLevel }) {
  // Coming soon (lib/editions EDITION_OPEN, owner 2026-10-11): said plainly, nothing to buy yet.
  const open = isEditionOpen("deck");
  // The plan has ended: the way back is a plan.
  if (open && level !== "preview") return <DeckPlanEnded />;
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
            <div className={s.cardSub}>{open ? "Your plan has the Deck estimator's preview. Deck Studio — $49/month on your plan — opens the rest." : "It isn't open yet. Until it is, Smart Proposal prices a deck from a description."}</div>
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
                <DeckAddonButton label="Add Deck Studio — $49/month" className={`${s.btn} ${s.btnPrimary}`} />
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

/** This account's plan has ended, so the way back is a plan (the free trial includes Deck Studio; after it, the
 *  $49/month add-on — lib/deckAddon). */
function DeckPlanEnded() {
  return (
    <div className={s.studio}>
      <div className={s.pageHead}>
        <div>
          <div className={s.kicker}>Automation · Estimating</div>
          <h1 className={s.pageTitle}>Deck estimator</h1>
        </div>
      </div>
      <section className={`${s.card} ${s.soonCard}`} aria-label="Your plan has ended">
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>Your plan has ended</div>
            <div className={s.cardSub}>Pick a plan and the Deck estimator opens again, your drafts where you left them. Every plan previews it; Deck Studio, $49/month on the plan, opens the whole studio.</div>
          </div>
          <span className={`${s.stamp} ${s.stampWarn}`}>Plan ended</span>
        </div>
        <div className={s.soonBody}>
          <p>Size a deck, choose what it is built from, and the estimator frames it from the building code&apos;s deck tables, stands it up in 3D and prices the material package and the labor.</p>
          <div className={s.soonActs}>
            <Link className={`${s.btn} ${s.btnPrimary}`} href={"/dashboard/upgrade" as Route} data-deck-offer="plans">
              See the plans
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
