"use client";

// Settings blueprint — Billing pane.
//
// A pointer, not a duplicate: the subscription page (/dashboard/subscription)
// owns plans, payment method and invoices. This pane shows the plan summary
// with one button into it, plus the billing contact — the one billing value
// that is a plain org column.
//
// REAL DATA: Your plan — Subscription + PricingPlan catalog; seats from the
// plan's teamSeats limit. Billing contact — Organization.billingEmail.
// The button is owner-only (billing is fail-closed to OWNER); managers see
// "Ask your owner". At the foot, the owner's "Cancel subscription" link
// (components/billing/FreeSwitch, owner 2026-10-13): two windows, then the
// plan switches to Free at the end of the cycle.

import { updateBusiness } from "@/actions/accountSettings";
import {
  BILLING_CONTACT_CARD,
  BILLING_CONTACT_LABELS,
  PLAN_ASK_OWNER,
  PLAN_CARD,
  PLAN_CARD_NOTE,
  PLAN_CARD_SUB_FREE,
  PLAN_CARD_SUB_SWITCHING,
  PLAN_META_PREFIX,
  PLAN_PRIMARY_ACTION,
} from "../settings-data";
import type { Badge, CardHead, IconName, PaneProps } from "../settings-data";
import { Field, SaveBar } from "../ui";
import { useState } from "react";
import { CancelPlanLink, FreeSwitchNotice } from "@/components/billing/FreeSwitch";

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ic">
      <use href={`#${name}`} />
    </svg>
  );
}

function Badge2({ badge }: { badge: Badge }) {
  return (
    <span className={`badge2 ${badge.tone}`}>
      <i />
      {badge.label}
    </span>
  );
}

function CardHeader({ head, badge }: { head: CardHead; badge?: Badge | null }) {
  const shown = badge ?? head.badge;
  return (
    <div className="sc-h">
      <div>
        <div className="sc-t">{head.title}</div>
        <div className="sc-s">{head.sub}</div>
      </div>
      {shown ? <Badge2 badge={shown} /> : null}
    </div>
  );
}

export function BillingPane({ data }: PaneProps) {
  const b = data.billing;
  const [billingEmail, setBillingEmail] = useState(b.billingEmail);

  return (
    <>
      {/* ── Your plan ─────────────────────────────────────────────── */}
      <section className="sc">
        <CardHeader
          head={b.onFree ? { ...PLAN_CARD, sub: PLAN_CARD_SUB_FREE } : b.freeSwitch ? { ...PLAN_CARD, sub: PLAN_CARD_SUB_SWITCHING } : PLAN_CARD}
          badge={b.planBadge}
        />
        <div className="sc-b">
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: "20px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div className="plan-big">{b.planName}</div>
              <div className="plan-meta">
                {b.nextBill ? `${PLAN_META_PREFIX.nextBill}${b.nextBill}` : null}
                <span>{`${PLAN_META_PREFIX.seats}${b.seats}`}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              {b.isOwner ? (
                <a className="btn btn-primary" href={b.subscriptionHref}>
                  {PLAN_PRIMARY_ACTION.icon ? <Icon name={PLAN_PRIMARY_ACTION.icon} /> : null}
                  {PLAN_PRIMARY_ACTION.label}
                </a>
              ) : (
                <button className="btn btn-ghost" type="button" disabled title={PLAN_ASK_OWNER.desc}>
                  {PLAN_ASK_OWNER.label}
                </button>
              )}
            </div>
          </div>
          <div className="prow-d" style={{ marginTop: 12 }}>
            {b.isOwner ? PLAN_CARD_NOTE : PLAN_ASK_OWNER.desc}
          </div>
        </div>
      </section>

      {/* ── Billing contact ───────────────────────────────────────── */}
      <section className="sc">
        <CardHeader head={BILLING_CONTACT_CARD} />
        <div className="sc-b">
          <div className="fgrid">
            <Field
              label={BILLING_CONTACT_LABELS.billingEmail}
              value={billingEmail}
              onChange={setBillingEmail}
              disabled={!b.canEditBilling}
            />
          </div>
        </div>
        <SaveBar disabled={!b.canEditBilling} watch={billingEmail} onSave={() => updateBusiness({ billingEmail })} />
      </section>

      {/* ── The way out, and back (lib/freePlan) ──────────────────────
          The owner's plain "Cancel subscription" link at the pane's foot;
          once booked, the date it switches to Free and "Keep <plan>". */}
      {b.freeSwitch ? (
        <FreeSwitchNotice planName={b.freeSwitch.planName} at={b.freeSwitch.at} canKeep={b.isOwner} />
      ) : b.cancel ? (
        <CancelPlanLink offer={b.cancel} />
      ) : null}
    </>
  );
}
