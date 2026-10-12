"use client";

// PLANS & UPGRADE — the client half of /dashboard/upgrade. See the page for
// what this surface is; see upgrade.css for why the styling is a plain,
// self-scoped stylesheet.
//
// 2026-09-02 REWORK (owner's calls):
//   · A plan change is made IN PLACE on the existing Stripe subscription
//     (actions/billing.changePlan): up charges the prorated difference now,
//     down is free — checkout only when there is no subscription yet. The old
//     build opened a fresh Checkout for every click, which minted a SECOND
//     subscription beside the first.
//   · Cards are one row's height (a subgrid since 2026-10-12: prices and
//     first rows on one line); every benefit is listed, nothing scrolls or
//     folds inside a card, and the button sits at the foot of every card,
//     full width, blueprint blue.
//   · MONTHLY | ANNUAL (owner, 2026-10-12): one switch over the row
//     (components/billing/PlanTermSwitch). A plan with no yearly price is
//     shown and bought monthly whatever the switch says (lib/planDeal).
//   · Only the clicked button goes busy. `disabled={Boolean(busy)}` used to
//     dim all three the moment one was pressed.
//   · A downgrade asks first ("Are you sure…?").
//   · After a change the router is refreshed, so the sidebar's locks and
//     quota pills redraw without a manual reload — including on the return
//     leg from Stripe, where the page is reached with ?session_id.
//   · CUSTOM PLAN: an org already on it can ADD PAGES here. The page is
//     charged once now ($10 each), the subscription price steps up, and the
//     next cycle bills the new total — no second charge for the base.

import { PlanConfetti } from "@/components/billing/PlanConfetti";
import { annualDeal, dealDollars, offersYearly, planTerm, sharedDealWords, type BillingTerm } from "@/lib/planDeal";
import { PlanDealSlot, PlanTermSwitch } from "@/components/billing/PlanTermSwitch";
import { DEV_EVENT, type DevUpgradeEvent } from "@/lib/devSimulation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { expandPlanFeatures } from "@/lib/planCatalog";
import { changePlan, updateCustomPages } from "@/actions/billing";
import { CustomChangeNote } from "./custom-change-note";
import { ConfirmPlanChange } from "@/components/billing/ConfirmPlanChange";
import { toast } from "@/components/ui/Toast";
import {
  CUSTOM_BASE_CENTS,
  CUSTOM_PAGES,
  CUSTOM_PAGE_CENTS,
  CUSTOM_PLAN_SLUG,
  customPriceCents,
} from "@/lib/customPlan";
import "./upgrade.css";

export type UpgradePlan = {
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  yearlyPriceCents: number | null;
  trialDays: number;
  features: string[];
  highlight: boolean;
};

/** Whole dollars when round, cents otherwise — a prorated charge rarely is. */
function dollarsOf(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

export function UpgradeContent({
  plans,
  currentPlan,
  customPages,
  isOwner,
  checkoutReady,
  sandbox,
  upgradedTo,
  upgradedDirection = "up",
  cancelled,
  embedded = false,
  devTools,
  customOffered = false,
  focusSlug = null,
  focusWords = null,
}: {
  /** THE PLAN TO POINT AT (2026-10-11, lib/editions): the one that carries the edition an existing customer came to add (?edition=deck), and the line that says so. */
  focusSlug?: string | null;
  focusWords?: string | null;
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag): off, a shop not already on the
   *  custom plan is not offered it. One on it always manages its pages. */
  customOffered?: boolean;
  plans: UpgradePlan[];
  /** Subscription.plan as stored ("PROFESSIONAL", "CUSTOM", …), or null. */
  currentPlan: string | null;
  /** Pages a CUSTOM-plan org owns (ids from lib/customPlan), else []. */
  customPages: string[];
  isOwner: boolean;
  checkoutReady: boolean;
  /** The admin's payments switch is on the sandbox — say so on the page, so a
   *  test charge is never mistaken for a real one. */
  sandbox: boolean;
  /** Slug just purchased on this request's ?session_id return, if any. */
  upgradedTo: string | null;
  /** Which way that return went; a downgrade gets the banner, not the confetti. */
  upgradedDirection?: "up" | "down";
  cancelled: boolean;
  /** Rendered inside another page (the subscription page's plan section):
   *  no page head, no return-leg banners — just the cards and their dialogs. */
  embedded?: boolean;
  /** TEMP (2026-09-19): the DEV ONLY block, handed in by the page behind the
   *  server gate; undefined everywhere else. */
  devTools?: React.ReactNode;
}) {
  const router = useRouter();
  // False on the server render and the hydration pass, true after: the portal
  // below must not exist on the first client render or React reports a
  // hydration mismatch on ?custom=1 (agent's finding, 2026-09-02).
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  /* MONTHLY ONLY for now (owner, 2026-09-04): the yearly tier is unreviewed,
     so the billing switch is gone from every plan surface. The type is kept
     wide so the price math below stays ready for the day it comes back. */
  /* ANNUAL IS BACK (owner, 2026-10-11), as one switch over the row (2026-10-12): "2 months free" in words,
     never a percentage (lib/planDeal). Monthly until it is flipped. */
  const [interval, setInterval] = useState<BillingTerm>("MONTH");
  /** The term a card is billed on: the switch's, or the month for a plan with no yearly price. */
  const termFor = useCallback(
    (slug: string): BillingTerm =>
      slug === CUSTOM_PLAN_SLUG ? interval : planTerm(interval, plans.find((p) => p.slug === slug)?.yearlyPriceCents),
    [interval, plans],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The current plan as the page knows it; moved locally after an in-place
  // switch so the labels flip before the refresh lands.
  // Overrides win until the refreshed props catch up (they then agree).
  const [curOverride, setCur] = useState<string | null>(null);
  const cur = curOverride ?? (currentPlan ?? "").toLowerCase();
  const [ownedOverride, setOwned] = useState<string[] | null>(null);
  const owned = ownedOverride ?? customPages;

  /* THE RETURN FROM STRIPE (and the dev simulator's ?simulated= twin). The
     layout that draws the sidebar rendered BEFORE verifyReturn wrote the new
     plan, so locks and quota pills were stale until a manual reload: refresh
     at once, and drop the query so a reload cannot re-verify. The banner and
     the confetti key off state derived from the prop DURING RENDER, not a
     useState initialiser — the simulator's router.push lands on this same
     mounted component with a new prop, and an initialiser would never see it
     (the old stamp never played for that reason). */
  const [seenReturn, setSeenReturn] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; dir: "up" | "down"; key: number } | null>(null);
  if (upgradedTo !== seenReturn) {
    setSeenReturn(upgradedTo);
    if (upgradedTo) {
      const slug = upgradedTo;
      setDone((prev) => ({ slug, dir: upgradedDirection, key: (prev?.key ?? 0) + 1 }));
    }
  }
  useEffect(() => {
    if (!upgradedTo) return;
    router.replace("/dashboard/upgrade");
    router.refresh();
  }, [upgradedTo, router]);
  const doneName = done
    ? done.slug === CUSTOM_PLAN_SLUG
      ? "Custom plan"
      : (plans.find((p) => p.slug === done.slug)?.name ?? done.slug)
    : null;

  // The feature comparison, with "Everything in <plan>" expanded so a dearer
  // plan never reads as missing the cheaper plan's basics — the same rule the
  // signup step applies (lib/planCatalog.expandPlanFeatures).
  const { rows: featureRows, included } = useMemo(() => expandPlanFeatures(plans), [plans]);


  const curCents = useMemo(() => {
    if (cur === CUSTOM_PLAN_SLUG) return customPriceCents(owned);
    return plans.find((p) => p.slug === cur)?.priceCents ?? -1;
  }, [cur, owned, plans]);
  /* UP OR DOWN — by tier, not by price (owner, 2026-09-04). The catalog's
     own order is the ladder (Starter < Professional < Enterprise, as
     /admin/plans sorts them) and the Custom plan is the rung below Starter
     whatever its page count adds up to. So from Custom every catalog plan is
     an upgrade, and from any catalog plan Custom is a downgrade. No plan at
     all ranks below everything. */
  const rankOf = (slug: string): number =>
    slug === CUSTOM_PLAN_SLUG ? -1 : slug ? plans.findIndex((p) => p.slug === slug) : -2;
  const direction = (p: UpgradePlan): "up" | "down" => (rankOf(p.slug) > rankOf(cur) ? "up" : "down");

  /* What is being asked. "up" and "custom" go to Stripe to be paid for (the
     owner's rule: an upgrade is confirmed, then paid on Stripe's page, and it
     replaces the current subscription on the return); "down" is switched in
     place, free. */
  const [confirm, setConfirm] = useState<
    | { kind: "up"; plan: UpgradePlan; from?: UpgradePlan }
    | { kind: "down"; plan: UpgradePlan; from?: UpgradePlan }
    | { kind: "custom"; pages: string[] }
    | { kind: "pages"; pages: string[]; removing: string[]; adding: string[] }
    | null
  >(null);

  const checkout = useCallback(
    async (slug: string, customPagesToBuy?: string[]) => {
      const res = await fetch("/api/checkout/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: slug, interval: termFor(slug), customPages: customPagesToBuy }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't open checkout.");
      window.location.assign(body.url);
    },
    [termFor],
  );

  /* An upgrade (or a custom plan) is PAID on Stripe: confirm, then checkout.
     The return leg cancels the subscription it replaces. */
  const payFor = useCallback(
    async (slug: string, pages?: string[]) => {
      if (busy) return;
      setErr(null);
      setBusy(slug);
      try {
        await checkout(slug, pages); // navigates away on success
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't open checkout.");
        setBusy(null);
        setConfirm(null);
      }
    },
    [busy, checkout],
  );

  /* A downgrade is switched in place, free. */
  const switchDown = useCallback(
    async (p: UpgradePlan) => {
      if (busy) return;
      setErr(null);
      setBusy(p.slug);
      try {
        const res = await changePlan(p.slug, termFor(p.slug));
        if (!res.ok) throw new Error(res.error);
        if (res.mode === "checkout") {
          await checkout(p.slug);
          return; // navigating away
        }
        setCur(p.slug);
        toast.success(`Moved to ${res.planName}`, "Nothing was charged. The lower price starts now.");
        // The layout re-renders with the new plan's locks and quota pills.
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't change the plan.");
      } finally {
        setBusy(null);
        setConfirm(null);
      }
    },
     
    [busy, checkout, termFor, router],
  );

  function onPick(p: UpgradePlan) {
    setConfirm({ kind: direction(p) === "down" && cur ? "down" : "up", plan: p });
  }

  /* ── CUSTOM PLAN ─────────────────────────────────────────────────────
     On it already: add pages (paid once now, price steps up). Not on it:
     build one — pick pages, confirm, pay on Stripe like any other plan. */
  const onCustom = cur === CUSTOM_PLAN_SLUG;
  const searchParams = useSearchParams();
  // /dashboard/upgrade?custom=1 (the subscription page's "Build it") lands
  // straight in the page picker.
  const [pickerOpen, setPickerOpen] = useState(
    () => searchParams?.get("custom") === "1" && (onCustom || customOffered),
  );
  // The same two-flag entrance as the signup step's picker: mounted first,
  // `is-on` a frame later so the box has a start state to leave from.
  const [pickerOn, setPickerOn] = useState(false);
  useEffect(() => {
    if (!pickerOpen) return;
    const id = requestAnimationFrame(() => setPickerOn(true));
    return () => cancelAnimationFrame(id);
  }, [pickerOpen]);
  const closePicker = useCallback(() => {
    setPickerOn(false);
    window.setTimeout(() => setPickerOpen(false), 220);
  }, []);
  /* The picker is the whole selection (owner, 2026-09-04: "add or remove").
     On the plan it opens with the owned pages ticked; what is ticked when
     the user is done is the plan they want. Ticking a new page is PAID —
     the new selection replaces the subscription on Stripe's page, like any
     upgrade. Un-ticking only is free: the pages close now and the price
     steps down from the next bill (actions/billing.removeCustomPages). */
  const [picked, setPicked] = useState<string[]>([]);
  const openPicker = useCallback(() => {
    setPicked(onCustom ? owned : []);
    setPickerOpen(true);
  }, [onCustom, owned]);
  const adds = picked.filter((id) => !owned.includes(id));
  const removes = onCustom ? owned.filter((id) => !picked.includes(id)) : [];
  const nextMonthlyCents = customPriceCents(picked);
  /* What a new Custom plan costs on the switch's term (an existing one is
     managed page by page, monthly, below). */
  const pickedTermCents = customPriceCents(picked, interval);
  const termPer = interval === "YEAR" ? "/yr" : "/mo";
  /* The switch: drawn when a card has a year to show; its "N months free"
     tag only when every yearly card gives the same whole months. */
  const showTerms = offersYearly(plans) || onCustom || customOffered;
  const termTag = sharedDealWords([
    ...plans.filter((p) => p.yearlyPriceCents).map((p) => annualDeal(p.priceCents, p.yearlyPriceCents)),
    ...(onCustom || customOffered ? [annualDeal(customPriceCents(onCustom ? owned : picked), customPriceCents(onCustom ? owned : picked, "YEAR"))] : []),
  ]);
  /* A change to the pages of a Custom plan — added, removed or both — is made
     on the subscription the shop already has (actions/billing.updateCustomPages,
     lib/customBilling): added pages are charged now, prorated (nothing in a
     trial); removed pages close now and the price drops from the next bill. */
  async function changePages(pages: string[]) {
    if (busy) return;
    setErr(null);
    setBusy("custom-remove");
    try {
      const res = await updateCustomPages(pages);
      if (!res.ok) throw new Error(res.error);
      setOwned(res.pages);
      setConfirm(null);
      const what = [
        res.added.length ? `${res.added.length} page${res.added.length === 1 ? "" : "s"} added` : "",
        res.removed.length ? `${res.removed.length} removed` : "",
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(
        what || "Plan updated",
        res.chargedCents > 0
          ? `${dollarsOf(res.chargedCents)} charged today. Your plan is ${dollarsOf(res.monthlyCents)}/mo from the next bill.`
          : `Your plan is ${dollarsOf(res.monthlyCents)}/mo from the next bill.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't change the pages.");
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  }

  const cannot = !isOwner
    ? "Only the account owner can change the plan"
    : !checkoutReady
      ? "Checkout is not configured"
      : null;

  /* TEMP (2026-09-19): the DEV ONLY block's "Preview dialog" — one rung up
     or down from here, without changing anything; at the top (or bottom) of
     the ladder the pair is taken from one rung below (above) so the dialog
     never shows a $0 move. Heard only when the page handed us devTools. */
  useEffect(() => {
    if (!devTools) return;
    const onDev = (e: Event) => {
      const d = (e as CustomEvent<DevUpgradeEvent>).detail;
      if (d?.type !== "preview-dialog") return;
      const at = plans.findIndex((p) => p.slug === cur);
      if (d.direction === "up") {
        const to = plans[at + 1] ?? plans[plans.length - 1];
        const from = plans[at + 1] ? undefined : plans[plans.length - 2];
        if (to) setConfirm({ kind: "up", plan: to, from });
      } else {
        const to = at > 0 ? plans[at - 1] : plans[0];
        const from = at > 0 ? undefined : plans[1];
        if (to) setConfirm({ kind: "down", plan: to, from });
      }
    };
    window.addEventListener(DEV_EVENT, onDev);
    return () => window.removeEventListener(DEV_EVENT, onDev);
  }, [devTools, plans, cur]);

  return (
    <div className={"jf-upgrade" + (embedded ? " jf-up-embed" : "")}>
      <div className={"jf-up-head" + (embedded ? " jf-up-head--embed" : "")}>
        {embedded ? (
          <div className="jf-up-embed-lbl">Plans</div>
        ) : (
        <div>
          <div className="jf-up-kick">Billing · plans</div>
          <h1 className="jf-up-h1">Plans &amp; upgrade.</h1>
          {cur ? (
            <p className="jf-up-cur">
              You&apos;re on{" "}
              <b>
                {onCustom
                  ? `the Custom plan · $${(curCents / 100).toFixed(0)}/mo`
                  : (plans.find((p) => p.slug === cur)?.name ?? currentPlan)}
              </b>
              {onCustom
                ? " — add a page below, or switch to a full plan to open everything."
                : "."}
            </p>
          ) : null}
        </div>
        )}
      </div>

      {devTools && !embedded ? devTools : null}
      {sandbox ? (
        <div className="jf-up-sand" role="status">
          Sandbox mode — payments here are Stripe TEST charges. Card 4242 4242 4242 4242 works.
        </div>
      ) : null}
      {done && !embedded ? (
        <div className="jf-up-ok" role="status">
          <span className="jf-up-ok-k">{done.dir === "down" ? "Plan changed" : "Plan activated"}</span>
          <b>{doneName}</b>
        </div>
      ) : null}
      {/* The one moment the plan actually turns on: confetti from both side
          edges, blocking nothing. A downgrade gets the banner only. */}
      {!embedded ? (
        <PlanConfetti
          active={done?.dir === "up"}
          token={done?.key ?? 0}
          once={!devTools}
          devReplay={Boolean(devTools)}
        />
      ) : null}
      {cancelled && !embedded ? (
        <div className="jf-up-err" role="alert">
          Checkout was cancelled — nothing changed.
        </div>
      ) : null}
      {err ? (
        <div className="jf-up-err" role="alert">
          {err}
        </div>
      ) : null}

      {focusWords ? <p className="jf-up-focus" data-upgrade-focus-words>{focusWords}</p> : null}
      {showTerms ? (
        <PlanTermSwitch className="jf-up-termsw" value={interval} onChange={setInterval} tag={termTag} />
      ) : null}
      <div className="jf-up-plans has-custom">
        {plans.map((p) => {
          const term = planTerm(interval, p.yearlyPriceCents);
          const cents = term === "YEAR" ? (p.yearlyPriceCents ?? 0) : p.priceCents;
          const isCur = cur === p.slug;
          const dir = direction(p);
          return (
            <div
              key={p.slug}
              className={"jf-up-plan" + (p.highlight ? " hero" : "") + (isCur ? " cur" : "") + (focusSlug === p.slug ? " focus" : "")}
              data-upgrade-focus={focusSlug === p.slug ? "" : undefined}
              data-plan-card={p.slug}
              data-monthly-cents={p.priceCents}
              data-yearly-cents={p.yearlyPriceCents ?? undefined}
            >
              {focusSlug === p.slug ? <span className="jf-up-tag">Includes Deck Studio</span> : p.highlight ? <span className="jf-up-tag">Most picked</span> : null}
              <span className="jf-up-n">{p.name}</span>
              <span className="jf-up-price" data-plan-price>
                {dealDollars(cents)}
                <i>{term === "YEAR" ? "/yr" : "/mo"}</i>
              </span>
              <PlanDealSlot term={interval} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} />
              <span className="jf-up-feats" data-plan-feats>
                {featureRows.map((f) => {
                  const has = included.get(p.slug)?.has(f.toLowerCase()) ?? false;
                  return (
                    <span key={f} className={"jf-up-f" + (has ? "" : " no")}>
                      <svg viewBox="0 0 24 24" className="jf-up-fic" aria-hidden="true">
                        {has ? <path d="M20 6 9 17l-5-5" /> : <path d="M5 12h14" />}
                      </svg>
                      {f}
                    </span>
                  );
                })}
              </span>
              {isCur ? (
                <span className="jf-up-curlbl">Current plan</span>
              ) : (
                <button
                  className={"jf-up-go" + (dir === "down" ? " down" : "")}
                  type="button"
                  disabled={Boolean(cannot) || busy === p.slug}
                  aria-busy={busy === p.slug}
                  title={cannot ?? undefined}
                  onClick={() => onPick(p)}
                >
                  {busy === p.slug ? "Switching…" : dir === "down" && cur ? "Downgrade" : "Upgrade"}
                </button>
              )}
            </div>
          );
        })}

        {onCustom || customOffered ? (
          <div
            className={"jf-up-plan custom" + (onCustom ? " cur" : "")}
            data-plan-card={CUSTOM_PLAN_SLUG}
            data-monthly-cents={onCustom ? curCents : customPriceCents(picked)}
            data-yearly-cents={customPriceCents(onCustom ? owned : picked, "YEAR")}
          >
            <span className="jf-up-n">{onCustom ? "Custom" : "Build your plan"}</span>
            <span className="jf-up-price" data-plan-price>
              {dealDollars(customPriceCents(onCustom ? owned : picked, interval))}
              <i>{termPer}</i>
            </span>
            <PlanDealSlot
              term={interval}
              monthlyCents={customPriceCents(onCustom ? owned : picked)}
              yearlyCents={customPriceCents(onCustom ? owned : picked, "YEAR")}
            />
            {/* ON THE PLAN: only the pages it holds — nothing when it holds
                none (owner, 2026-09-04). OFF it: every page, ticked as picked.
                The base and the page price head the list. */}
            <span className="jf-up-feats" data-plan-feats>
              <span className="jf-up-f jf-up-f--base">
                ${(CUSTOM_BASE_CENTS / 100).toFixed(0)} base · ${(CUSTOM_PAGE_CENTS / 100).toFixed(0)} per page a month
              </span>
              {onCustom
                ? CUSTOM_PAGES.filter((pg) => owned.includes(pg.id)).map((pg) => (
                    <span key={pg.id} className="jf-up-f">
                      <svg viewBox="0 0 24 24" className="jf-up-fic" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {pg.label}
                    </span>
                  ))
                : CUSTOM_PAGES.map((pg) => {
                    const has = picked.includes(pg.id);
                    return (
                      <span key={pg.id} className={"jf-up-f" + (has ? "" : " no")}>
                        <svg viewBox="0 0 24 24" className="jf-up-fic" aria-hidden="true">
                          {has ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}
                        </svg>
                        {pg.label}
                      </span>
                    );
                  })}
              {onCustom && owned.length === 0 ? (
                <span className="jf-up-f no jf-up-f--none">No add-on pages yet</span>
              ) : null}
            </span>
            <button
              className="jf-up-go"
              type="button"
              disabled={Boolean(cannot) || busy !== null}
              title={cannot ?? undefined}
              onClick={openPicker}
            >
              {onCustom
                ? "Add or remove pages"
                : busy === CUSTOM_PLAN_SLUG
                  ? "Opening Stripe…"
                  : "Choose pages"}
            </button>
          </div>
        ) : null}
      </div>

      {!isOwner ? (
        <p className="jf-up-note">Plan changes are owner-only — ask the account owner.</p>
      ) : null}
      {!onCustom && customOffered ? (
        <p className="jf-up-note">
          Build your plan: ${(CUSTOM_BASE_CENTS / 100).toFixed(0)} base covers proposals, clients,
          projects, jobs, invoices and financials; each extra page is $
          {(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo.
        </p>
      ) : null}

      <ConfirmPlanChange
        open={confirm !== null}
        compare={
          confirm && (confirm.kind === "up" || confirm.kind === "down")
            ? {
                plans,
                from:
                  confirm.from ??
                  plans.find((p) => p.slug === cur) ??
                  (onCustom ? { slug: cur, name: "Custom plan", priceCents: customPriceCents(owned), features: [] } : null),
                to:
                  termFor(confirm.plan.slug) === "YEAR"
                    ? { ...confirm.plan, priceCents: confirm.plan.yearlyPriceCents ?? confirm.plan.priceCents }
                    : confirm.plan,
                toPer: termFor(confirm.plan.slug) === "YEAR" ? "/yr" : "/mo",
                direction: confirm.kind,
                how: confirm.kind === "up" ? "checkout" : "switch",
              }
            : undefined
        }
        kicker={
          confirm?.kind === "down"
            ? "Downgrade"
            : confirm?.kind === "pages"
              ? "Custom plan"
              : "Upgrade"
        }
        title={
          confirm?.kind === "down"
            ? `Downgrade to ${confirm.plan.name}?`
            : confirm?.kind === "up"
              ? `Upgrade to ${confirm.plan.name}?`
              : confirm?.kind === "pages"
                ? confirm.adding.length && confirm.removing.length
                  ? "Change your pages?"
                  : confirm.adding.length
                    ? `Add ${confirm.adding.length} page${confirm.adding.length === 1 ? "" : "s"}?`
                    : `Remove ${confirm.removing.length} page${confirm.removing.length === 1 ? "" : "s"}?`
                : onCustom
                  ? "Change your Custom plan?"
                  : "Switch to a Custom plan?"
        }
        body={
          confirm?.kind === "down" ? (
            <>
              You&rsquo;ll move to <b>{confirm.plan.name}</b> at{" "}
              <b>
                {termFor(confirm.plan.slug) === "YEAR"
                  ? `${dealDollars(confirm.plan.yearlyPriceCents ?? 0)}/yr`
                  : `${dealDollars(confirm.plan.priceCents)}/mo`}
              </b>{" "}
              right away. Nothing is
              charged today; pages and limits that plan does not include close as soon as you
              confirm.
            </>
          ) : confirm?.kind === "up" ? (
            <>
              You&rsquo;ll be taken to Stripe to pay{" "}
              <b>
                $
                {termFor(confirm.plan.slug) === "YEAR"
                  ? `${dealDollars(confirm.plan.yearlyPriceCents ?? 0)}/yr`
                  : `${dealDollars(confirm.plan.priceCents)}/mo`}
              </b>{" "}
              for <b>{confirm.plan.name}</b>. Your current plan is replaced the moment the payment
              goes through.
            </>
          ) : confirm?.kind === "custom" ? (
            <>
              You&rsquo;ll be taken to Stripe to pay{" "}
              <b>
                ${(customPriceCents(confirm.pages, interval) / 100).toFixed(0)}
                {interval === "YEAR" ? "/yr" : "/mo"}
              </b>{" "}
              for the base plus {confirm.pages.length} page{confirm.pages.length === 1 ? "" : "s"}.
              {cur ? " Your current plan is replaced the moment the payment goes through." : ""}
            </>
          ) : confirm?.kind === "pages" ? (
            <CustomChangeNote pages={confirm.pages} adding={confirm.adding} removing={confirm.removing} />
          ) : null
        }
        confirmLabel={
          confirm?.kind === "down"
            ? `Downgrade to ${confirm.plan.name}`
            : confirm?.kind === "pages"
              ? confirm.adding.length
                ? confirm.removing.length
                  ? "Confirm change"
                  : `Add ${confirm.adding.length} page${confirm.adding.length === 1 ? "" : "s"}`
                : "Remove pages"
              : "Continue to payment"
        }
        busy={busy !== null}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "down") void switchDown(confirm.plan);
          else if (confirm.kind === "up") void payFor(confirm.plan.slug);
          else if (confirm.kind === "pages") void changePages(confirm.pages);
          else void payFor(CUSTOM_PLAN_SLUG, confirm.pages);
        }}
        onCancel={() => setConfirm(null)}
      />

      {/* THE PAGE PICKER for a custom plan — the signup step's dialog, re-cut
          for "add", with the two numbers that matter: what is charged now and
          what the plan costs from the next bill. */}
      {pickerOpen && isClient ? createPortal(
        /* The scope class sits on a WRAPPER: `.jf-upgrade .jf-up-pick` needs
           an ancestor, and a root that carried both classes matched only the
           page-level flex rule — the picker laid out inline at the foot of
           <body>, invisible, and "Choose pages" read as dead (owner). */
        <div className="jf-upgrade jf-up-portal">
        <div className={"jf-up-pick" + (pickerOn ? " is-on" : "")} role="dialog" aria-modal="true" aria-label="Add pages to your plan">
          <div className="jf-up-pick-scrim" onClick={() => busy !== "custom-remove" && closePicker()} />
          <div className="jf-up-pick-box">
            <div className="jf-up-pick-head">
              <div>
                <div className="jf-up-kick">Custom plan</div>
                <h2 className="jf-up-pick-h">{onCustom ? "Your pages." : "Pick your pages."}</h2>
              </div>
              <button
                type="button"
                className="jf-up-pick-x"
                aria-label="Close"
                onClick={() => closePicker()}
              >
                ×
              </button>
            </div>
            <p className="jf-up-pick-lede">
              {onCustom
                ? `Tick what you want in the plan — $${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo each. Adding a page is paid on Stripe and replaces your plan; removing one is free and the lower price starts on the next bill.`
                : `$${(CUSTOM_BASE_CENTS / 100).toFixed(0)}/mo covers the everyday workspace — proposals, clients, projects, jobs, invoices. Everything below is $${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo each.`}
            </p>
            <div className="jf-up-pick-list">
              {CUSTOM_PAGES.map((pg) => {
                const on = picked.includes(pg.id);
                const had = owned.includes(pg.id);
                return (
                  <button
                    key={pg.id}
                    type="button"
                    className={
                      "jf-up-pick-row" +
                      (on ? " on" : "") +
                      (onCustom && had && !on ? " drop" : "") +
                      (onCustom && !had && on ? " add" : "")
                    }
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((cur) =>
                        cur.includes(pg.id) ? cur.filter((x) => x !== pg.id) : [...cur, pg.id],
                      )
                    }
                  >
                    <span className="jf-up-pick-box-t" aria-hidden="true">
                      {on ? (
                        <svg viewBox="0 0 24 24">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="jf-up-pick-txt">
                      <span className="jf-up-pick-n">{pg.label}</span>
                      <span className="jf-up-pick-note">{pg.note}</span>
                    </span>
                    <span className="jf-up-pick-p">
                      {onCustom && had ? (on ? "Yours" : "Removing") : `+$${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="jf-up-pick-foot">
              <span className="jf-up-pick-total">
                <b>{dealDollars(onCustom ? nextMonthlyCents : pickedTermCents)}</b>
                <i>
                  {onCustom
                    ? adds.length > 0
                      ? "per month · added pages prorated today"
                      : removes.length > 0
                        ? "per month from the next bill"
                        : "per month · your plan today"
                    : interval === "YEAR"
                      ? "per year · paid on Stripe"
                      : "per month · paid on Stripe"}
                </i>
              </span>
              {onCustom ? (
                <button
                  type="button"
                  className={"jf-up-go" + (adds.length === 0 && removes.length > 0 ? " down" : "")}
                  disabled={(adds.length === 0 && removes.length === 0) || busy !== null}
                  onClick={() => {
                    closePicker();
                    setConfirm({ kind: "pages", pages: picked, removing: removes, adding: adds });
                  }}
                >
                  {adds.length > 0
                    ? `Review · $${(nextMonthlyCents / 100).toFixed(0)}/mo`
                    : removes.length > 0
                      ? `Remove ${removes.length} page${removes.length === 1 ? "" : "s"}`
                      : "No changes"}
                </button>
              ) : (
                <button
                  type="button"
                  className="jf-up-go"
                  disabled={busy !== null}
                  onClick={() => {
                    closePicker();
                    setConfirm({ kind: "custom", pages: picked });
                  }}
                >
                  {`Switch to Custom · ${dealDollars(pickedTermCents)}${termPer}`}
                </button>
              )}
            </div>
          </div>
        </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
