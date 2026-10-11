"use client";

// THE TRIAL CARD SWITCH (2026-10-07), at the top of Admin → Trials: card
// required at the plan step, or a card-less trial. One press, every
// door follows (lib/trialPolicyServer signupTrialMode). The panel says what a
// signup gets right now and why: the source (this switch or the deployment's
// TRIAL_REQUIRES_CARD), its value, and whether the day's ceiling on card-less
// trials turned it into a card. Reset to default (env) removes the row.
import { useState } from "react";
import { resetTrialCardPolicyAction, setTrialCardPolicyAction } from "@/actions/trialPolicy";
import type { SignupTrialState } from "@/lib/trialPolicyServer";
import t from "./trial-policy.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function TrialPolicyPanel({ initial }: { initial: SignupTrialState }) {
  const [p, setP] = useState(initial);
  const [pending, setPending] = useState<"" | "flip" | "reset">("");
  const [error, setError] = useState("");
  const run = async (kind: "flip" | "reset") => {
    setPending(kind);
    setError("");
    try {
      const res = kind === "flip" ? await setTrialCardPolicyAction({ requiresCard: !p.requiresCard }) : await resetTrialCardPolicyAction();
      if (res.ok) setP(res.policy);
      else setError(res.error);
    } catch {
      setError(kind === "flip" ? "The switch could not be saved. Try again." : "The reset could not be saved. Try again.");
    } finally {
      setPending("");
    }
  };

  const now = p.mode === "card"
    ? p.capReached
      ? "New signups add a card at the plan step — today's ceiling on card-less trials is reached."
      : "New signups add a card at the plan step; nothing is charged until the 7-day trial ends."
    : "New signups start a 7-day trial with no card — they confirm their email instead.";
  const source = p.source === "admin"
    ? `Admin switch${p.at ? ` · ${when(p.at)}` : ""}${p.by ? ` · ${p.by}` : ""}`
    : "Deployment default (env)";
  const ceiling = p.startsLastDay === null
    ? "Not applied — the switch asks for a card"
    : p.perDay === 0
      ? "Applied — CARDLESS_TRIALS_PER_DAY=0 pauses card-less trials"
      : `Applied — ${p.startsLastDay} of ${p.perDay} in the last 24 h${p.capReached ? ", reached" : ""}`;

  return (
    <section className={t.panel} aria-label="Free trial policy" data-mode={p.mode}>
      <div className={t.main}>
        <div className={t.kicker}>Free trial · card</div>
        <p className={t.now} aria-live="polite">{now}</p>
        <dl className={t.facts}>
          <div><dt>Source</dt><dd>{source}</dd></div>
          <div><dt>Value</dt><dd>{p.requiresCard ? "Card required" : "No card needed"}</dd></div>
          <div><dt>TRIAL_REQUIRES_CARD</dt><dd>{p.envDefault ? "Card required (default)" : "false — no card"}</dd></div>
          <div><dt>Daily ceiling</dt><dd data-reached={p.capReached}>{ceiling}</dd></div>
        </dl>
        <p className={t.why}>Takes effect for new signups within seconds, on the landing, /pricing and the plan step at once; trials already running keep their terms.</p>
        {error && <p className={t.err} role="alert">{error}</p>}
      </div>
      <div className={t.actions}>
        <button type="button" role="switch" aria-checked={p.requiresCard} className={t.switch} disabled={pending !== ""} onClick={() => void run("flip")}>
          <span className={t.track} aria-hidden="true"><span className={t.knob} /></span>
          <span className={t.label}>{p.requiresCard ? "Card required" : "No card needed"}</span>
          <span className={t.sub}>{pending === "flip" ? "Saving…" : p.requiresCard ? "press for a trial with no card" : "press to ask for a card"}</span>
        </button>
        <button
          type="button"
          className={`btn btn-ghost ${t.reset}`}
          disabled={pending !== "" || p.source === "env"}
          title={p.source === "env" ? "Already on the deployment's default" : undefined}
          onClick={() => void run("reset")}
        >
          {pending === "reset" ? "Resetting…" : "Reset to default (env)"}
        </button>
      </div>
    </section>
  );
}
