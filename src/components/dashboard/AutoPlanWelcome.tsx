"use client";

// THE WELCOME AFTER THE SHORT SIGN-UP (owner, 2026-10-15): "once they appear in JobFlex with the Professional plan,
// tell them if they need a different package and tools they can adjust the plan at any time". Drawn from what the
// subscription really is (lib/autoPlanWelcome), for the owner, until "Got it" or ten days. Desktop above the page,
// phone on the overview.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { MapPin, Sparkles, X } from "lucide-react";
import { dismissAutoPlanWelcome } from "@/actions/autoPlanWelcome";
import { formatPlanPrice } from "@/lib/planCatalog";
import type { AutoPlanWelcomeView } from "@/lib/autoPlanWelcome";
import s from "./AutoPlanWelcome.module.css";
// While this card is up it carries the "set up your specialties" ask, so the Lead Center banner below waits.
import "./auto-plan-welcome.css";

/** "roofing, siding and gutters" — the trades in words. */
const listWords = (trades: readonly string[]) => {
  const t = trades.map((x) => x.toLowerCase());
  return t.length < 2 ? (t[0] ?? "your trades") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
};

// One zone on both renders (server and browser), so the date never flips on hydration.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

export function AutoPlanWelcome({ view }: { view: AutoPlanWelcomeView }) {
  const [gone, setGone] = React.useState(false);
  if (gone) return null;
  const close = () => {
    setGone(true);
    void dismissAutoPlanWelcome();
  };
  const price = view.priceCents ? `${formatPlanPrice(view.priceCents)}/${view.interval === "YEAR" ? "year" : "month"}` : null;
  return (
    <section className={s.card} aria-label="Welcome to JobFlex" data-auto-plan-welcome>
      <Sparkles className={s.icon} size={20} aria-hidden />
      <div className={s.copy}>
        <p className={s.kicker}>Welcome to JobFlex</p>
        <p className={s.head}>
          You&apos;re on <b>{view.planName}</b>
          {view.trial && view.trialEndsAt ? <> — free until {day(view.trialEndsAt)}.</> : "."}
        </p>
        <p className={s.body}>
          {view.trial && view.trialEndsAt && price ? <>Nothing is charged before then; after that it&apos;s {price}, and you can cancel any time. </> : null}
          Need different tools, or a smaller or bigger package? <b>You can change your plan any time</b> — in Subscription.
          {view.billingEmail ? <span className={s.mail}> Receipts go to {view.billingEmail}.</span> : null}
        </p>
        {/* HOMEOWNER LEADS (owner, 2026-10-15): the portal opens in their area soon — specialties set now means the
            requests reach them the day it does. Says their town when the address names one. */}
        <div className={s.leads} data-auto-plan-leads={view.leads.ready ? "ready" : "setup"}>
          <MapPin className={s.leadsPin} size={18} aria-hidden />
          <p className={s.leadsTxt}>
            <b>Homeowner leads:</b> the JobFlex homeowner portal opens in {view.leads.area ?? "your area"} soon.{" "}
            {view.leads.ready ? (
              <>
                You&apos;re set for {listWords(view.leads.trades)} — requests near you come straight to you when it opens.
              </>
            ) : (
              <>Set up your specialties and service area now, so requests near you reach you the day it opens.</>
            )}
          </p>
          <Link href={"/dashboard/company#trades" as Route} className={s.leadsLink} data-auto-plan-specialties>
            {view.leads.ready ? "Edit specialties" : "Set up specialties"}
          </Link>
        </div>
        <div className={s.actions}>
          <Link href={"/dashboard/upgrade" as Route} className={s.primary} data-auto-plan-compare>
            Compare plans
          </Link>
          <Link href={"/dashboard/subscription" as Route} className={s.ghost}>
            Subscription
          </Link>
          <button type="button" className={s.ghost} onClick={close} data-auto-plan-dismiss>
            Got it
          </button>
        </div>
      </div>
      <button type="button" className={s.x} onClick={close} aria-label="Dismiss">
        <X size={18} aria-hidden />
      </button>
    </section>
  );
}
