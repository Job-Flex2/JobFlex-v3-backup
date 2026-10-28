"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/ui/Toast";
import "./lead-popup.css";
import {
  pendingLeadOffers,
  pendingRoutedLeads,
  acceptLeadOffer,
  declineLeadOffer,
  declineRoutedLead,
} from "@/actions/leadOffers";
import { claimLead } from "@/actions/leads";
import { buyLead, LeadPurchaseHost, priceLabel, PURCHASED_EVENT } from "./LeadPurchase";

/**
 * A platform lead can reach a contractor two ways, and both have to announce
 * themselves here:
 *
 *   "offer"  — the cascade picked this shop and is waiting 24h for an answer.
 *              Accepting materialises the lead; passing sends it onward.
 *   "routed" — an admin routed it by hand. The Lead row already exists in the
 *              Incoming tab with status ROUTED; accepting claims it into the
 *              pipeline, passing marks it lost. Nothing is on a clock.
 */
interface Offer {
  kind: "offer" | "routed";
  id: string;
  name: string;
  projectType: string | null;
  detectedTrade: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  description: string | null;
  attempt: number;
  /** Offers only — a routed lead has no deadline. */
  expiresAt: string | null;
  /** A priced offer opens by payment (LeadPurchase); null = free. */
  priceCents: number | null;
  /** The range the homeowner priced on /price (2026-10-27), in one line; null when they described instead. */
  estimateShort: string | null;
  /** "Exclusive — nobody else gets this lead". */
  exclusive: boolean;
}

const POLL_MS = 45_000;

/**
 * App-wide "elite lead routed to you" pop-up. Polls for live platform-lead
 * offers and slides one in wherever the contractor is working — accept or
 * decline right from the card (an email also fires from the cascade). Mounted
 * in the dashboard layout, gated to roles that can act on leads.
 */
export function LeadOfferPopup() {
  const router = useRouter();
  const [offers, setOffers] = React.useState<Offer[]>([]);
  const [resolving, setResolving] = React.useState<"accept" | "decline" | null>(null);
  // Offers dismissed this session shouldn't re-pop while polling; a genuinely
  // new offer (different id) still surfaces.
  const dismissed = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    try {
      // Both feeds, one queue. Live offers come first — they expire.
      const [live, routed] = await Promise.all([
        pendingLeadOffers().catch(() => []),
        pendingRoutedLeads().catch(() => []),
      ]);
      const list: Offer[] = [
        ...live.map((o) => ({ ...o, kind: "offer" as const })),
        ...routed.map((l) => ({
          kind: "routed" as const,
          id: l.id,
          name: l.name,
          projectType: l.projectType,
          detectedTrade: l.detectedTrade,
          city: l.city,
          state: l.state,
          zip: l.zip,
          description: l.description,
          attempt: 0,
          expiresAt: null,
          priceCents: null,
          estimateShort: null,
          exclusive: false,
        })),
      ];
      setOffers(list.filter((o) => !dismissed.current.has(o.id)));
    } catch {
      // Role not allowed / signed out mid-poll — stay silent.
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    // A lead paid for anywhere (this card, the Leads page, back from Stripe)
    // leaves the queue at once, not at the next poll.
    window.addEventListener(PURCHASED_EVENT, onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PURCHASED_EVENT, onFocus);
    };
  }, [load]);

  // Newest un-dismissed offer is the one on screen.
  const current = offers[0] ?? null;

  function dismiss(id: string) {
    dismissed.current.add(id);
    setOffers((os) => os.filter((o) => o.id !== id));
  }

  async function accept(offer: Offer) {
    if (resolving) return;
    setResolving("accept");
    try {
      // A priced offer is a purchase: the card on file or Stripe Checkout.
      if (offer.kind === "offer" && offer.priceCents) {
        const out = await buyLead(offer.id);
        if (out === "unlocked") setOffers((os) => os.filter((o) => o.id !== offer.id));
        return;
      }
      // A routed lead is already a Lead row: accepting it is a claim, not an
      // offer response.
      if (offer.kind === "routed") await claimLead(offer.id);
      else await acceptLeadOffer(offer.id);
      toast.success("Lead accepted", `${offer.name} is now in your pipeline.`);
      setOffers((os) => os.filter((o) => o.id !== offer.id));
      router.refresh();
    } catch (err: unknown) {
      toast.error("Couldn't accept", err instanceof Error ? err.message : "Please try again.");
      dismiss(offer.id); // likely already taken/expired — clear it
    } finally {
      setResolving(null);
    }
  }

  async function decline(offer: Offer) {
    if (resolving) return;
    setResolving("decline");
    try {
      if (offer.kind === "routed") {
        // Passing un-matches the lead and sends it to the next-best shop —
        // marking the row LOST on its own left the Lead Center reading
        // "accepted" for a shop that had just refused it.
        const res = await declineRoutedLead(offer.id);
        toast.info(
          "Lead passed",
          res.rerouted ? "It is on its way to the next shop." : "It is back with the platform team.",
        );
      } else {
        await declineLeadOffer(offer.id);
        toast.info("Lead passed", "It's on its way to the next shop.");
      }
      setOffers((os) => os.filter((o) => o.id !== offer.id));
      router.refresh();
    } catch (err: unknown) {
      toast.error("Couldn't pass", err instanceof Error ? err.message : "Please try again.");
      dismiss(offer.id);
    } finally {
      setResolving(null);
    }
  }

  return (
    <>
      {/* Pays for priced offers wherever this pop-up is mounted (LeadPurchase). */}
      <LeadPurchaseHost />
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            className="jflp"
            data-nest=""
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12, transition: { duration: 0.14 } }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            role="status"
          >
            <div className="jflp-card">
              <div className="jflp-head">
                {/* The label says what arrived; the name below says who. The old
                    card put both in a coloured banner and the homeowner's name
                    came third, under a pill. */}
                <span className="jflp-kick">
                  {current.kind === "routed" ? "New lead · sent to you" : "New lead · reserved for you"}
                </span>
                {current.expiresAt ? (
                  <span className="jflp-clock">
                    <Countdown expiresAt={current.expiresAt} /> left
                  </span>
                ) : null}
                <button
                  type="button"
                  className="jflp-x"
                  aria-label="Dismiss"
                  onClick={() => dismiss(current.id)}
                >
                  <X />
                </button>
              </div>

              <div className="jflp-body">
                <div className="jflp-name">{current.name}</div>
                <div className="jflp-meta">
                  <b>{current.detectedTrade ?? current.projectType ?? "Project"}</b>
                  {locationOf(current) ? ` · ${locationOf(current)}` : ""}
                </div>
                {current.estimateShort ? (
                  <div className="jflp-meta" data-offer-range>
                    <b>Priced by the homeowner:</b> {current.estimateShort}
                  </div>
                ) : null}
                {current.exclusive ? (
                  <div className="jflp-meta" data-offer-exclusive>
                    <b>Exclusive — nobody else gets this lead</b>
                  </div>
                ) : null}
                {current.description ? <p className="jflp-desc">{current.description}</p> : null}
                {current.priceCents ? (
                  <div className="jflp-price">{priceLabel(current.priceCents)} to unlock contact</div>
                ) : null}

                <div className="jflp-act">
                  <button
                    type="button"
                    className="jflp-btn jflp-primary"
                    disabled={resolving !== null}
                    onClick={() => accept(current)}
                  >
                    <Check />
                    {resolving === "accept"
                      ? current.priceCents ? "Opening…" : "Accepting…"
                      : current.priceCents ? `Accept · ${priceLabel(current.priceCents)}` : "Accept"}
                  </button>
                  <button
                    type="button"
                    className="jflp-btn jflp-ghost"
                    disabled={resolving !== null}
                    onClick={() => decline(current)}
                  >
                    {resolving === "decline" ? "Passing…" : "Pass"}
                  </button>
                  <Link href={"/dashboard/leads" as never} className="jflp-btn jflp-ghost" onClick={() => dismiss(current.id)}>
                    Open
                  </Link>
                </div>

                {offers.length > 1 ? (
                  <div className="jflp-more">
                    +{offers.length - 1} more waiting
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function locationOf(o: Offer): string {
  return [o.city, o.state].filter(Boolean).join(", ") || o.zip || "";
}

// "22h 14m" live countdown; warms toward urgency inside the last hours.
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const msLeft = new Date(expiresAt).getTime() - now;
  if (msLeft <= 0) return <>expiring</>;
  const totalMin = Math.floor(msLeft / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return <>{h > 0 ? `${h}h ${m}m` : `${m}m`}</>;
}
