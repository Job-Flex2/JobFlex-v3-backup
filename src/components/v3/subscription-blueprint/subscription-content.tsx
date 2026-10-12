"use client";

// SUBSCRIPTION — BLUEPRINT · the page.
// Route: /dashboard/subscription (promoted 2026-08-12; ported at
// /dashboard/subscription-blueprint, which no longer exists).
//
// A port of the approved mockup jobflex-subscription-blueprint (8).html, with
// one owner-directed revision (2026-08-17): the Free tier is removed from the
// product, so the plan-limit banner is gone and the fixture org reads as a
// Professional subscriber (see ./subscription-data.ts). Everything else is the
// source's string, unchanged.
//
// THE CHROME IS NOT PORTED. The mockup ships the whole app shell — a 24-link
// `aside.sb` with its sliding indicator and account footer, a `header.topbar`
// with search / burger / New Estimate / bell, and the `div.layout` >
// `div.main` frame around them. All of it is discarded: blueprint-shell
// already renders that furniture from src/app/dashboard/layout.tsx and
// re-porting it would fork the navigation. What ships is the children of
// `div.content` and nothing else, which is why this component returns a
// FRAGMENT: the six blocks are direct children of the shell's `.content`,
// so its `display: flex; flex-direction: column; gap: 22px` spaces them
// exactly as `.content` does in the source (the two rules are byte-identical).
//
// THE SIX BLOCKS, in source order (the source's second block, the `.banner`
// free-plan-limit upsell, left with the Free tier):
//   .page-head · .sub-hero · #plans (tier spectrum) ·
//   .row-ub (usage + billing) · Refer & earn · Compare all plans
//
// NO innerHTML. The source builds `.spec-cell`, `.us-row`, `.inv-row` and the
// whole comparison table by concatenating HTML strings and assigning
// `innerHTML`. Those are real JSX here, mapped over the fixtures in
// ./subscription-data.ts — same markup, same classes, same order, no
// dangerouslySetInnerHTML anywhere.
//
// STATE. Exactly one piece: the Copy button's label. Everything else that
// moves is imperative and lives in ./subscription-behavior.ts, mounted through
// the shell's `useBlueprintContent` layout-effect contract so the first paint
// is already primed.
//
// LIVE DATA since 2026-08-31: the page hands this component the SAME loader
// result the handheld half has run on all along (loadSubscriptionData — plan
// catalog, current plan, limits-engine usage, Stripe invoices, referral), so
// the two halves finally agree on every number. The fixtures in
// ./subscription-data.ts are no longer imported here; they remain only as the
// donor record. The plan CTAs lead to /dashboard/upgrade, the real checkout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { UpgradeContent, type UpgradePlan } from "@/components/v3/upgrade-blueprint/upgrade-content";
import { longDate } from "@/lib/format";
import { customPlanAddable, customPlanIncludes, customPriceCents } from "@/lib/customPlan";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initSubscriptionContent } from "./subscription-behavior";
import { SubscriptionSprite } from "./subscription-sprite";
// Type-only: erased at compile, so the loader's server imports never reach
// this client bundle.
import { BillingRecovery } from "../payment-ribbon/billing-recovery";
import type { SubscriptionViewProps } from "@/app/(dashboard)/dashboard/subscription/subscription-load";
import { CancelSubscription } from "@/components/billing/CancelSubscription";
import { nextChargeLines, usd } from "@/app/(dashboard)/dashboard/subscription/next-charge-lines";
import { expandPlanFeatures } from "@/lib/planCatalog";
import styles from "./subscription.module.css";

const UPGRADE = "/dashboard/upgrade" as Route;

/** Epoch seconds → the fixture's date voice ("Jul 1, 2026"). */
function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Class list by the SOURCE's literal names, so the JSX below reads as the
 * mockup's markup does and the stylesheet stays diffable against it.
 *
 * The fallback matters: four class names in the source's markup — `sub-hero-l`,
 * `us-list`, `inv-list`, `ref-l` — have no rule anywhere in its stylesheet, so
 * the module exports nothing for them. They are emitted literally rather than
 * dropped, to keep the markup faithful; each was checked against the shell's
 * always-on modules first and none is claimed there, so they style nothing and
 * can collide with nothing.
 */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => styles[n as string] ?? (n as string))
    .join(" ");
}

/** `rv` stays LITERAL: the entrance cascade is published once, globally, by the
 *  always-on dashboard module (`.bp :global(.rv)`), with the same values the
 *  source declares. Porting a second hashed copy would be two definitions of
 *  one thing. */
const RV = "rv";

export function SubscriptionContent(props: SubscriptionViewProps) {
  const [copyLabel, setCopyLabel] = useState("Copy");
  const copyTimer = useRef(0);

  useBlueprintContent(initSubscriptionContent);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  /* The catalog, in the fixture's column shape: paid plans in display order
     plus the "Build your plan" custom column the mockup ends on. The custom
     column is CURRENT when the org's Subscription.plan says so. */
  const plansStrip = useMemo(() => {
    const paid = props.plans.filter((p) => !p.isFree);
    /* Up or down is decided by PRICE against the current plan; a custom
       plan (or one that left the catalog) sits below every catalog tier. */
    const curCents = paid.find((p) => p.slug === props.currentSlug)?.priceCents ?? -1;
    return [
      ...paid.map((p) => ({
        slug: p.slug,
        name: p.name,
        mo: Math.round(p.priceCents / 100) as number | null,
        cur: p.slug === props.currentSlug,
        dir: (p.priceCents > curCents ? "up" : "down") as "up" | "down",
        features: p.features,
      })),
      // Off sale (lib/customPlanFlag): no "Build your plan" column for a shop
      // not already on it.
      ...(props.currentSlug !== "custom" && !props.customOffered ? [] : [{
        slug: "custom",
        name: props.currentSlug === "custom" ? "Custom" : "Build your plan",
        // Priced when it is THIS org's plan: base plus the pages it owns.
        mo:
          props.currentSlug === "custom"
            ? (Math.round(customPriceCents(props.customPages ?? []) / 100) as number | null)
            : (null as number | null),
        cur: props.currentSlug === "custom",
        dir: "down" as "up" | "down",
        features: [] as string[],
      }]),
    ];
  }, [props.plans, props.currentSlug, props.customPages, props.customOffered]);

  /* THE CUSTOM COLUMN TICKS (owner, 2026-09-02). On the custom plan the column
     shows what the org actually has — base rows plus the pages it bought —
     instead of a dashed "pick your own" placeholder on every row. Off the
     plan, base rows tick and page rows show the pick mark. */
  const customHas = useMemo(() => customPlanIncludes(props.customPages ?? []), [props.customPages]);
  const customCould = useMemo(() => customPlanAddable(), []);
  const onCustomPlan = props.currentSlug === "custom";

  /* THE PLAN BUTTONS DO THE THING (owner, 2026-09-02). A shop with a Stripe
     subscription is switched in place — up charges the difference, down is
     free — and one without is sent through checkout. */
  /* THE CARDS are the upgrade page's own (owner, 2026-09-04: one set of
     plan cards everywhere): same labels, same confirm dialogs, same custom
     picker, embedded here without its page head. */
  const upgradePlans = useMemo<UpgradePlan[]>(
    () =>
      props.plans
        .filter((p) => !p.isFree)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          description: p.description,
          priceCents: p.priceCents,
          yearlyPriceCents: p.yearlyPriceCents,
          trialDays: p.trialDays,
          features: p.features,
          highlight: p.highlight,
        })),
    [props.plans],
  );

  /* The comparison rows, "Everything in <plan>" expanded — the same rule the
     signup step and /dashboard/upgrade apply (lib/planCatalog). */
  const { rows: featureRows, included } = useMemo(
    () => expandPlanFeatures(props.plans.filter((p) => !p.isFree)),
    [props.plans],
  );

  const comp = props.complimentary;
  const ended = props.cancellation;
  const statusLabel = comp
    ? "Complimentary"
    : ended
      ? "Canceled"
      : props.status
        ? props.status.charAt(0).toUpperCase() + props.status.slice(1).toLowerCase().replace(/_/g, " ")
        : "—";
  const isTrial = props.status === "TRIALING" && !comp;
  const nextCharge = props.nextCharge;
  const nextChargeItems = useMemo(() => (nextCharge ? nextChargeLines(nextCharge) : []), [nextCharge]);

  const copyCode = useCallback(() => {
    const code = props.referral.code;
    const done = () => {
      setCopyLabel("Copied");
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopyLabel("Copy"), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, done);
    } else {
      done();
    }
  }, [props.referral.code]);

  /** The price cell shared by the tier spectrum and the comparison table.
   *
   *  `{"$" + mo}` rather than `${mo}`: adjacent JSX expressions become SEPARATE
   *  text nodes, and the browser shapes each one independently — measured, a
   *  split "$79" and a split "4 / 5" come out 1px wider than the single text
   *  node the source's innerHTML produces. One string, one text node, identical
   *  metrics. */
  const price = (mo: number | null) =>
    mo === null ? (
      <b>Custom</b>
    ) : (
      <>
        <b>{"$" + mo}</b>
        <i>/ mo</i>
      </>
    );

  return (
    <>
      {/* PAGE HEAD */}
      <div className={cx("page-head", RV)}>
        <div>
          <div className={cx("kicker")}>Account</div>
          <h1 className={cx("page-title")}>Subscription</h1>
        </div>
        <div className={cx("page-actions")}>
          <Link className={cx("btn", "btn-primary")} href={UPGRADE}>
            <svg className={cx("ic")}>
              <use href="#i-arrow" />
            </svg>
            Upgrade plan
          </Link>
        </div>
      </div>

      <BillingRecovery isOwner status={props.status} blocked={props.accessBlocked} />

      {/* CURRENT PLAN HERO */}
      <section className={cx("sub-hero", RV)}>
        <div className={cx("sub-hero-l")}>
          <div className={cx("sub-hero-meta")}>Your plan</div>
          <div className={cx("sub-hero-name")}>{props.planName}</div>
          <div className={cx("sub-hero-row")}>
            <span className={cx("sub-hero-price")}>
              {comp ? (
                <>
                  {"$0"}
                  <i>/ mo · free of charge</i>
                </>
              ) : props.priceCents === null ? (
                "—"
              ) : (
                <>
                  {"$" + Math.round(props.priceCents / 100)}
                  <i>/ mo</i>
                </>
              )}
            </span>
          </div>
        </div>
        <div className={cx("sub-hero-r")}>
          <div className={cx("sub-stamp-zone")}>
            <span className={cx("sub-stamp")}>{statusLabel}</span>
          </div>
          {/* The stamp already says the status; the facts are the two dates,
              as dates — "Sep 16, 2026", not an ISO timestamp (owner). A trial
              shows its end; an active plan shows its next bill. */}
          <div className={cx("sub-hero-facts")}>
            {comp ? (
              /* A grant: when it ends and what follows — never a "next bill",
                 because nothing is billed (owner, 2026-09-22). */
              <>
                <div>
                  <span>Complimentary until</span>
                  <b>{comp.endsAt ? longDate(comp.endsAt) : "No end date"}</b>
                </div>
                <div>
                  <span>Then</span>
                  <b>{comp.after === "free" ? "Free plan" : "Choose a plan"}</b>
                </div>
              </>
            ) : ended ? (
              /* Cancelled (owner, 2026-10-07): when access ends, never a
                 next bill — nothing more is charged. */
              <div>
                <span>{ended.ended ? "Access ended" : "Access until"}</span>
                <b>{ended.accessUntil ? longDate(ended.accessUntil) : "—"}</b>
              </div>
            ) : (
              <>
                {isTrial && props.trialEndsAt ? (
                  <div>
                    <span>Trial ends</span>
                    <b>{longDate(props.trialEndsAt)}</b>
                  </div>
                ) : null}
                <div>
                  <span>{isTrial ? "First bill" : "Next bill"}</span>
                  <b>{longDate(props.nextBill ?? props.trialEndsAt)}</b>
                </div>
              </>
            )}
            {/* A card-less trial's card (lib/trialCardLine, 2026-10-09): the
                place the welcome email points to. Nobody else gets the line. */}
            {props.trialCard ? (
              <div data-trial-card>
                <span>Card</span>
                <b>{props.trialCard.value}</b>
                {props.trialCard.addHref ? (
                  <Link className={cx("sub-hero-link")} href={props.trialCard.addHref as Route}>
                    Add a card
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* PLANS — the upgrade page's cards, embedded */}
      <section className={cx("plans-embed", RV)} id="plans">
        <UpgradeContent
          embedded
          plans={upgradePlans}
          currentPlan={props.currentSlug}
          currentInterval={props.interval ?? null}
          scheduledSwitch={props.scheduledSwitch ?? null}
          customPages={props.customPages ?? []}
          isOwner
          checkoutReady={props.checkoutReady}
          customOffered={props.customOffered}
          sandbox={props.sandbox}
          upgradedTo={null}
          cancelled={false}
        />
      </section>

      {/* USAGE + BILLING */}
      <div className={cx("row-ub", RV)}>
        <div className={cx("card")} id="usageCard">
          <div className={cx("card-head")}>
            <h2>Usage</h2>
            <a className={cx("btn", "btn-ghost")} href="#plans">
              Change plan
            </a>
          </div>
          <div className={cx("us-list")} id="usList">
            {props.usageExempt ? (
              <div className={cx("us-note")}>Unlimited · platform admin</div>
            ) : props.usage.length === 0 && (props.usageUnlimited ?? []).length === 0 ? (
              <div className={cx("us-note")}>Nothing used yet this cycle.</div>
            ) : null}
            {props.usage.map((u) => {
              const pct = u.limit > 0 ? Math.min(100, (u.used / u.limit) * 100) : 0;
              const cls = pct >= 90 ? "hot" : pct >= 60 ? "warn" : "";
              return (
                <div key={u.label} className={cx("us-row")}>
                  <div className={cx("us-top")}>
                    <span className={cx("us-lbl")}>{u.label}</span>
                    <span className={cx("us-num")}>{u.used + " / " + u.limit}</span>
                  </div>
                  <div className={cx("us-bar")}>
                    {/* width is written by the behavior module from data-w,
                        never by React — see its "USAGE BARS" note. */}
                    <span className={cx("us-fill", cls)} data-w={pct.toFixed(1)}></span>
                  </div>
                </div>
              );
            })}
            {(props.usageUnlimited ?? []).map((u) => (
              <div key={u.label} className={cx("us-row")}>
                <div className={cx("us-top")}>
                  <span className={cx("us-lbl")}>{u.label}</span>
                  <span className={cx("us-num")}>{u.used + " · no cap"}</span>
                </div>
              </div>
            ))}
          </div>
          <div className={cx("us-note")}>
            {props.usageExempt
              ? "The plan's caps do not apply to a platform admin in their own organization"
              : props.usage.length > 0
                ? "Limits reset each billing cycle · hitting one never blocks existing work"
                : "This plan has no caps · counts reset each billing cycle"}
          </div>
        </div>
        <div className={cx("card", "bill-card")} id="billCard">
          <div className={cx("card-head")}>
            <h2>Billing history</h2>
            <span className={cx("bill-count")}>
              {props.invoices.invoices.length === 0
                ? "No invoices yet"
                : `${props.invoices.invoices.length} invoice${props.invoices.invoices.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {/* THE NEXT BILL, as Stripe will charge it — one framed block, the
              amount first, every coupon and referral credit itemised under
              it (owner, 2026-09-02; redrawn 2026-09-04 after the critique:
              the old row crammed three lines into a ledger cell). */}
          {nextCharge ? (
            <div className={cx("bill-next")}>
              <div className={cx("bill-next-l")}>
                <span className={cx("bill-next-k")}>{nextCharge.estimated ? "Next bill · estimate" : "Next bill"}</span>
                <span className={cx("bill-next-d")}>
                  {nextCharge.dueAt ? longDate(nextCharge.dueAt) : "Date pending"}
                </span>
              </div>
              <div className={cx("bill-next-r")}>
                {nextCharge.amountDueCents < nextCharge.subtotalCents ? (
                  <s className={cx("bill-next-was")}>{usd(nextCharge.subtotalCents)}</s>
                ) : null}
                <span className={cx("bill-next-amt")}>{usd(nextCharge.amountDueCents)}</span>
              </div>
              {nextChargeItems.length ? (
                <ul className={cx("bill-lines")}>
                  {nextChargeItems.map((l) => (
                    <li key={l.label} className={cx(l.tone === "note" && "bill-line-note")}>
                      <span>{l.label}</span>
                      {l.amount ? <b className={cx("bill-line-amt")}>{l.amount}</b> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {props.invoices.available && props.invoices.invoices.length > 0 ? (
            <>
              <div className={cx("inv-head")}>
                <span>Invoice</span>
                <span>Date</span>
                <span>Status</span>
                <span className={cx("ta-r")}>Amount</span>
              </div>
              <div className={cx("inv-list")} id="invList">
                {props.invoices.invoices.map((v) => (
                  <div key={v.id} className={cx("inv-row")}>
                    <span className={cx("inv-no")}>
                      {v.hostedInvoiceUrl ? (
                        <a href={v.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                          {v.number ?? v.id.slice(0, 12)}
                        </a>
                      ) : (
                        (v.number ?? v.id.slice(0, 12))
                      )}
                    </span>
                    <span className={cx("inv-date")}>{fmtDate(v.created)}</span>
                    <span>
                      <span className={cx("st-badge", v.status === "paid" ? "" : "warn")}>
                        {v.status ?? "—"}
                      </span>
                    </span>
                    <span className={cx("inv-amt")}>{"$" + (v.amountPaidCents / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className={cx("bill-foot")}>Receipts open on Stripe · amounts in USD</div>
            </>
          ) : (
            <div className={cx("bill-empty")}>
              {!props.invoices.available
                ? "Invoices appear here once Stripe billing is active for your account."
                : "Your first invoice lands here after it is issued."}
            </div>
          )}
        </div>
      </div>

      {/* REFER & EARN */}
      <section className={cx("card", RV)}>
        <div className={cx("card-head")}>
          <h2>Refer &amp; earn</h2>
          <svg className={cx("ic", "card-head-ic")}>
            <use href="#i-gift" />
          </svg>
        </div>
        <div className={cx("ref-grid")}>
          <div className={cx("ref-l")}>
            <div className={cx("ref-code-row")}>
              <span className={cx("ref-code")} id="refCode">
                {props.referral.code}
              </span>
              <button
                className={cx("btn", "btn-ghost")}
                type="button"
                id="refCopy"
                onClick={copyCode}
              >
                <svg className={cx("ic")}>
                  <use href="#i-copy" />
                </svg>
                <span id="refCopyLbl">{copyLabel}</span>
              </button>
            </div>
            <div className={cx("ref-reward")}>{props.referral.rewardSummary}</div>
          </div>
          <div className={cx("kpi-grid", "kpi-grid--3")}>
            <div className={cx("kpi")}>
              <div className={cx("kpi-lbl")}>Code uses</div>
              <div className={cx("kpi-val")}>{props.referral.uses}</div>
            </div>
            <div className={cx("kpi")}>
              <div className={cx("kpi-lbl")}>Converted</div>
              <div className={cx("kpi-val")}>{props.referral.converted}</div>
            </div>
            <div className={cx("kpi")}>
              <div className={cx("kpi-lbl")}>Pending</div>
              <div className={cx("kpi-val")}>{props.referral.pending}</div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARE ALL PLANS */}
      <section className={cx("card", "card--flush", RV)} id="compare">
        <div className={cx("mx-wrap")}>
          <table className={cx("mx")} id="mxTable">
            <thead>
              <tr>
                <th></th>
                {plansStrip.map((p) => (
                  <th key={p.slug} className={p.cur ? cx("col-cur") : ""}>
                    <div className={cx("mx-plan")}>{p.name}</div>
                    <div className={cx("mx-price")}>{price(p.mo)}</div>
                    {p.cur ? <div className={cx("mx-cur")}>Current</div> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureRows.map((f) => (
                <tr key={f}>
                  <th className={cx("mx-feature")}>{f}</th>
                  {plansStrip.map((p) => (
                    <td key={p.slug} className={p.cur ? cx("col-cur") : ""}>
                      {p.slug === "custom" ? (
                        customHas.has(f.toLowerCase()) ? (
                          <span className={cx("mx-yes")}>✓</span>
                        ) : !onCustomPlan && customCould.has(f.toLowerCase()) ? (
                          <span className={cx("mx-opt")}></span>
                        ) : (
                          <span className={cx("mx-no")}>—</span>
                        )
                      ) : included.get(p.slug)?.has(f.toLowerCase()) ? (
                        <span className={cx("mx-yes")}>✓</span>
                      ) : (
                        <span className={cx("mx-no")}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={cx("mx-foot")}>
          <span className={cx("mx-opt")}></span>
          {onCustomPlan
            ? "Your custom plan — ticks are the pages you own; add more on Plans & upgrade"
            : "Build your plan — base rows included, marked rows are $10/mo each"}
        </div>
      </section>

      {/* CANCEL — the page's last row (owner, 2026-09-20). Shared with the
          handheld build; renders nothing when there is no live subscription. */}
      <div className={cx(RV)}>
        <CancelSubscription
          // A complimentary plan has no subscription to cancel; the row hides.
          status={comp ? "COMPLIMENTARY" : props.status}
          planName={props.planName}
          endsAt={props.nextBill ?? props.trialEndsAt}
          cancelAtPeriodEnd={props.cancelAtPeriodEnd}
        />
      </div>

      {/* Out of flow, so it is not a flex item and adds no gap. Last, so it
          cannot shift the reveal cascade's stagger indices. */}
      <SubscriptionSprite />

      {/* The source's second <style> block, verbatim. Without JS the reveal
          cascade never runs, and the `rv` class the markup carries would leave
          every block parked at opacity 0 — this is the escape hatch that keeps
          the page readable. suppressHydrationWarning because the HTML parser
          hands a scripting-enabled browser the noscript's contents as raw text,
          which never matches the element React expects; the markup React ships
          is correct either way. */}
      <noscript suppressHydrationWarning>
        <style>{`.rv{opacity:1!important;transform:none!important}`}</style>
      </noscript>
    </>
  );
}
