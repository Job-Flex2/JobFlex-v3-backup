"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { usePlanLimitStore } from "@/stores/usePlanLimitStore";
import { LIMIT_DEFS, SMS_ALLOWANCE_MESSAGE } from "@/lib/planLimits";
import { TRIAL_CAPS, TRIAL_CAP_NOUN, TRIAL_CAP_TITLE, trialCapAllowance, trialCapHref } from "@/lib/trialCaps";
import { ConfirmPlanChange } from "./ConfirmPlanChange";

/**
 * Globally-mounted "you've hit your plan limit" dialog. Opened via
 * reportPlanLimit() from create flows.
 *
 * Since 2026-09-19 it is the plan dialog (ConfirmPlanChange) with the limit
 * as its body: one box, one pair of buttons, one stylesheet for the upgrade,
 * the downgrade and this gate, so they cannot drift apart again. The primary
 * button leads to the plans page, where the real comparison is made.
 */
export function PlanLimitDialog() {
  const router = useRouter();
  const open = usePlanLimitStore((s) => s.open);
  const resource = usePlanLimitStore((s) => s.resource);
  const trial = usePlanLimitStore((s) => s.trial);
  const sms = usePlanLimitStore((s) => s.sms);
  const close = usePlanLimitStore((s) => s.close);

  /* THE CARD-LESS TRIAL'S OWN CEILING (lib/trialCaps): the same box, but the
     way on is a card, not a bigger plan — the button opens the trial page,
     which names the ceiling and adds the card. */
  if (trial) {
    const [, many] = TRIAL_CAP_NOUN[trial.key];
    const cap = TRIAL_CAPS[trial.key];
    return (
      <ConfirmPlanChange
        open={open}
        kicker="Free trial"
        title={trial.ended ? "Your free trial has ended" : TRIAL_CAP_TITLE}
        confirmLabel="Add a card"
        cancelLabel="Not now"
        onCancel={close}
        onConfirm={() => {
          close();
          router.push((trial.ended ? "/dashboard/trial" : trialCapHref(trial.key)) as Route);
        }}
        body={
          <>
            <p>
              {trial.ended ? (
                <>Add a card to keep working — everything you made is still here.</>
              ) : (
                <>
                  The free trial without a card includes <b>{trialCapAllowance(trial.key)}</b>
                  {cap > 0 ? ", and they are used" : ""}. Add a card and your plan&rsquo;s full limits apply at once — nothing is
                  charged until the trial ends.
                </>
              )}
            </p>
            {trial.ended ? null : (
              <div className="jf-confirm-meter">
                <span>{many.charAt(0).toUpperCase() + many.slice(1)}</span>
                <span>{cap > 0 ? `${cap} of ${cap} used` : "Needs a card"}</span>
              </div>
            )}
          </>
        }
      />
    );
  }

  /* THE MONTH'S TEXTS (owner, 2026-10-26): a soft stop — nothing is billed past the allowance, texting waits for
     the next month or a bigger plan. */
  if (sms) {
    return (
      <ConfirmPlanChange
        open={open}
        kicker="Plan limit"
        title="SMS allowance used"
        confirmLabel="See plans"
        onCancel={close}
        onConfirm={() => {
          close();
          router.push("/dashboard/upgrade");
        }}
        body={
          <>
            <p>{SMS_ALLOWANCE_MESSAGE}. Texts start again on the 1st of next month; nothing past the allowance is billed.</p>
            <div className="jf-confirm-meter">
              <span>Text messages</span>
              <span>0 left this month</span>
            </div>
          </>
        }
      />
    );
  }

  const def = resource ? LIMIT_DEFS.find((d) => d.key === resource) : null;
  const label = def?.label.toLowerCase() ?? null;
  const absolute = def?.scope === "absolute";

  return (
    <ConfirmPlanChange
      open={open}
      kicker="Plan limit"
      title={label ? `No ${label} left` : "Plan limit reached"}
      confirmLabel="See plans"
      onCancel={close}
      onConfirm={() => {
        close();
        router.push("/dashboard/upgrade");
      }}
      body={
        <>
          <p>
            {label ? (
              <>
                You&rsquo;ve used all the <b>{label}</b> included in your plan.{" "}
              </>
            ) : (
              <>You&rsquo;ve hit a limit on your current plan. </>
            )}
            {absolute ? "Upgrade to add more." : "Upgrade to keep going now, or wait until the limit resets next cycle."}
          </p>
          {def ? (
            <div className="jf-confirm-meter">
              <span>{def.label}</span>
              <span>{absolute ? "Seats full" : "0 left this cycle"}</span>
            </div>
          ) : null}
        </>
      }
    />
  );
}
