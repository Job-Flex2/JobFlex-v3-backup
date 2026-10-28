"use client";

// HVAC estimator — page CONTENT (the `.content` children; the shell owns the
// chrome). No donor exists for this page; the vocabulary is the roof and
// fence estimators', restated in ./hvac-estimator.module.css under the
// newer hashed-class convention, so nothing is registered in blueprint-shell.

import { HvacEstimatorForm } from "./hvac-estimator-form";
import type { WaitingLead } from "@/lib/leadRules";
import type { WebHvacSeed } from "@/lib/webHandoff";
import s from "./hvac-estimator.module.css";

export function HvacEstimatorContent({ aiEnabled, initialAddress, leads, webHvac = null }: { aiEnabled: boolean; initialAddress?: string; leads?: WaitingLead[]; webHvac?: WebHvacSeed | null }) {
  return (
    <>
      <div className={s["page-head"]}>
        <div>
          <div className={s.kicker}>Automation · Replacement</div>
          <h1 className={s["page-title"]}>HVAC estimator</h1>
        </div>
      </div>
      <HvacEstimatorForm aiEnabled={aiEnabled} initialAddress={initialAddress} leads={leads} webHvac={webHvac} />
    </>
  );
}
