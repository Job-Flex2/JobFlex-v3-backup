"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast-store";
import { setOrgPlan } from "@/actions/billing";

/** Minimal plan shape the checkout flow needs (a subset of PlanDTO). */
export interface CheckoutPlan {
  slug: string;
  name: string;
}

/**
 * Shared "buy this plan" flow, used by both the change-plan dialog and the
 * per-plan buttons on the subscription spectrum.
 *
 * - Real Stripe Checkout Session; we redirect to Stripe's hosted page (where
 *   the price + any trial are shown before a card is entered).
 * - Stripe not configured (503) → demo direct-set so local dev still works.
 *
 * `pendingSlug` is the slug currently in flight, so callers can show a spinner
 * on just the button that was clicked.
 */
export function usePlanCheckout() {
  const router = useRouter();
  const [pendingSlug, setPendingSlug] = React.useState<string | null>(null);

  async function start(plan: CheckoutPlan, interval: "MONTH" | "YEAR" = "MONTH") {
    setPendingSlug(plan.slug);
    try {
      const res = await fetch("/api/checkout/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: plan.slug, interval }),
      });

      if (res.ok) {
        const { url } = await res.json();
        if (url) {
          window.location.href = url; // Stripe hosted checkout
          return;
        }
      }

      if (res.status === 503) {
        // Stripe not configured — fall back to the demo direct-set so dev works.
        await setOrgPlan(plan.slug);
        toast.success(`Switched to ${plan.name}`, "Demo mode — Stripe isn't configured.");
        router.refresh();
        return;
      }

      const { error } = await res.json().catch(() => ({ error: "Checkout failed." }));
      toast.error(
        "Couldn't start checkout",
        error ?? "This plan isn't checkout-ready yet — sync it to Stripe in Admin → Plans.",
      );
    } catch (err: unknown) {
      toast.error("Couldn't start checkout", err instanceof Error ? err.message : undefined);
    } finally {
      setPendingSlug(null);
    }
  }

  return { start, pendingSlug };
}
