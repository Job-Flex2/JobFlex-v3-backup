"use client";

// PAYING FOR A LEAD — the one client flow every Accept on a priced offer runs
// (the pop-up, the desk Incoming tab, the handheld Incoming tab).
//
//   buyLead(offerId) ──startLeadPurchase──▶ card on file → this sheet:
//                                            "Charge $45 to Visa •4242?"
//                                          · no card     → Stripe Checkout
//   Charge ──chargeLeadOffer──▶ succeeded → the lead opens here
//                               3-D Secure / declined → Stripe Checkout
//
// Back from Checkout (`?lead_paid=…&session_id=…`) the host reads the session
// from Stripe (finishLeadCheckout) and says what happened.
//
// ONE HOST. The host is mounted beside the pop-up and inside both Leads
// editions, because a handheld sales rep has no pop-up; the first mounted one
// claims the job and the rest render nothing. Surfaces that keep their own
// lists listen for PURCHASED_EVENT and re-read.
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { chargeLeadOffer, finishLeadCheckout, startLeadPurchase } from "@/actions/leadPurchase";
import { acceptLeadOffer } from "@/actions/leadOffers";
import "./lead-popup.css";

export type PurchaseOutcome = "unlocked" | "redirect" | "cancelled" | "failed";

const REQUEST_EVENT = "jf:lead-purchase";
/** Fired on window after a lead opened, so lists that hold their own state re-read. */
export const PURCHASED_EVENT = "jf:lead-purchased";

type Request = { offerId: string; resolve: (o: PurchaseOutcome) => void };

/** "$45" / "$45.50". */
export function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Start paying for an offer. Resolves when the lead is open, the browser is on
 * its way to Stripe, or the person backed out — the caller keeps its own busy
 * state until then.
 */
export function buyLead(offerId: string): Promise<PurchaseOutcome> {
  return new Promise((resolve) => {
    const ev = new CustomEvent<Request>(REQUEST_EVENT, { detail: { offerId, resolve }, cancelable: true });
    // The host cancels the event to say "mine"; nobody did → nothing mounted.
    if (window.dispatchEvent(ev)) {
      toast.error("Couldn't start the payment", "Reload the page and try again.");
      resolve("failed");
    }
  });
}

// Which mounted host handles requests: the first to mount, then the next in
// line when it unmounts. A tiny store, read with useSyncExternalStore.
const hosts = { active: null as string | null, line: [] as string[], listeners: new Set<() => void>() };
function emitHosts() {
  hosts.listeners.forEach((l) => l());
}
function claimHost(id: string) {
  hosts.line.push(id);
  if (!hosts.active) {
    hosts.active = id;
    emitHosts();
  }
}
function releaseHost(id: string) {
  hosts.line = hosts.line.filter((x) => x !== id);
  if (hosts.active === id) {
    hosts.active = hosts.line[0] ?? null;
    emitHosts();
  }
}
function subscribeHosts(l: () => void) {
  hosts.listeners.add(l);
  return () => {
    hosts.listeners.delete(l);
  };
}

type Confirm = { offerId: string; amountCents: number; brand: string; last4: string; resolve: (o: PurchaseOutcome) => void };

export function LeadPurchaseHost() {
  const router = useRouter();
  const id = React.useId();
  const mine = React.useSyncExternalStore(subscribeHosts, () => hosts.active === id, () => false);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [charging, setCharging] = React.useState(false);
  const chargeRef = React.useRef<HTMLButtonElement>(null);

  // Claim the host role (first mount wins; released on unmount).
  React.useEffect(() => {
    claimHost(id);
    return () => releaseHost(id);
  }, [id]);

  const opened = React.useCallback(
    (leadId?: string) => {
      toast.success("Lead unlocked", "The homeowner's contact details are on the lead now.");
      window.dispatchEvent(new CustomEvent(PURCHASED_EVENT, { detail: { leadId } }));
      router.refresh();
    },
    [router],
  );

  const toStripe = React.useCallback((url: string, reason?: string) => {
    if (reason) toast.info("Continuing on Stripe", reason);
    window.location.assign(url);
  }, []);

  // Requests from the cards.
  React.useEffect(() => {
    if (!mine) return;
    const onRequest = async (e: Event) => {
      const { offerId, resolve } = (e as CustomEvent<Request>).detail;
      e.preventDefault();
      try {
        const step = await startLeadPurchase(offerId);
        if (step.kind === "free") {
          await acceptLeadOffer(offerId);
          opened();
          resolve("unlocked");
        } else if (step.kind === "unlocked") {
          opened(step.leadId);
          resolve("unlocked");
        } else if (step.kind === "checkout") {
          toStripe(step.url, step.reason);
          resolve("redirect");
        } else {
          setConfirm({ offerId, amountCents: step.amountCents, brand: step.brand, last4: step.last4, resolve });
        }
      } catch (err) {
        toast.error("Couldn't unlock the lead", err instanceof Error ? err.message : "Please try again.");
        resolve("failed");
      }
    };
    window.addEventListener(REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_EVENT, onRequest);
  }, [mine, opened, toStripe]);

  // Back from Stripe Checkout.
  React.useEffect(() => {
    if (!mine) return;
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");
    const paid = url.searchParams.get("lead_paid");
    const cancelled = url.searchParams.get("lead_checkout") === "cancelled";
    if (!paid && !cancelled) return;
    const clean = () => {
      url.searchParams.delete("lead_paid");
      url.searchParams.delete("session_id");
      url.searchParams.delete("lead_checkout");
      router.replace((url.pathname + (url.search || "")) as never, { scroll: false });
    };
    if (cancelled) {
      toast.info("Payment cancelled", "Nothing was charged. The offer stays open until its time runs out.");
      clean();
      return;
    }
    if (!sessionId) return clean();
    void (async () => {
      try {
        const res = await finishLeadCheckout(sessionId);
        if (res.status === "unlocked") opened(res.leadId);
        else if (res.status === "pending") toast.info("Payment processing", "The lead opens as soon as Stripe confirms the payment.");
        else if (res.status === "refunded") toast.error("Lead no longer available", "It went to another shop first — your payment is being refunded.");
      } catch (err) {
        toast.error("Couldn't confirm the payment", err instanceof Error ? err.message : "Refresh in a moment.");
      } finally {
        clean();
      }
    })();
  }, [mine, opened, router]);

  React.useEffect(() => {
    if (confirm) chargeRef.current?.focus();
  }, [confirm]);

  const close = React.useCallback(() => {
    if (!confirm || charging) return;
    confirm.resolve("cancelled");
    setConfirm(null);
  }, [confirm, charging]);

  React.useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, close]);

  async function charge() {
    if (!confirm || charging) return;
    setCharging(true);
    try {
      const step = await chargeLeadOffer(confirm.offerId);
      if (step.kind === "unlocked" || step.kind === "free") {
        opened(step.kind === "unlocked" ? step.leadId : undefined);
        confirm.resolve("unlocked");
        setConfirm(null);
      } else if (step.kind === "checkout") {
        toStripe(step.url, step.reason);
        confirm.resolve("redirect");
      } else {
        // A card appeared between the two calls — nothing was charged; ask again.
        setConfirm({ ...confirm, amountCents: step.amountCents, brand: step.brand, last4: step.last4 });
      }
    } catch (err) {
      toast.error("Couldn't charge the card", err instanceof Error ? err.message : "Please try again.");
      confirm.resolve("failed");
      setConfirm(null);
    } finally {
      setCharging(false);
    }
  }

  if (!mine || !confirm) return null;
  const amount = priceLabel(confirm.amountCents);
  return (
    <div className="jflpay" data-nest="" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="jflpay-card" role="dialog" aria-modal="true" aria-labelledby="jflpay-title">
        <div className="jflp-head">
          <span className="jflp-kick">Unlock lead</span>
        </div>
        <div className="jflp-body">
          <h2 id="jflpay-title" className="jflpay-title">
            Charge {amount} to {confirm.brand} •{confirm.last4}?
          </h2>
          <p className="jflpay-note">
            The homeowner&apos;s name, phone, email and address open as soon as the payment clears. Stripe emails
            the receipt. Lead purchases are not refundable.
          </p>
          <div className="jflp-act">
            <button
              ref={chargeRef}
              type="button"
              className="jflp-btn jflp-primary"
              disabled={charging}
              aria-busy={charging}
              onClick={() => void charge()}
            >
              {charging ? "Charging…" : `Charge ${amount}`}
            </button>
            <button type="button" className="jflp-btn jflp-ghost" disabled={charging} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
