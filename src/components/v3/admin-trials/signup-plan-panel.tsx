"use client";

// THE PLAN AT SIGN-UP (owner, 2026-10-15), under the steps switch on Admin → Trials: the plan cards as built, or
// straight to Professional — name and email (or Google), then the card page for Professional's 7-day trial, and a
// welcome card in the app saying the plan can be changed any time (lib/signupAutoPlan). Same clothes as the others.
import { useState } from "react";
import { setSignupPlanAction } from "@/actions/trialPolicy";
import type { SignupPlanSetting } from "@/lib/trialPolicyServer";
import type { SignupPlanMode } from "@/lib/signupAutoPlan";
import t from "./trial-policy.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const CHOICES: Array<{ id: SignupPlanMode; label: string }> = [
  { id: "pick", label: "Visitor picks a plan" },
  { id: "auto", label: "Straight to Professional" },
];

export function SignupPlanPanel({ initial, requiresCard }: { initial: SignupPlanSetting; requiresCard: boolean }) {
  const [p, setP] = useState(initial);
  const [pending, setPending] = useState<SignupPlanMode | null>(null);
  const [error, setError] = useState("");
  const pick = async (mode: SignupPlanMode) => {
    if (mode === p.mode || pending) return;
    setPending(mode);
    setError("");
    try {
      const res = await setSignupPlanAction({ mode });
      if (res.ok) setP(res.plan);
      else setError(res.error);
    } catch {
      setError("The switch could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  };
  const now =
    p.mode === "auto"
      ? requiresCard
        ? "Straight to Professional: name and email (no password, no code) or Google, then Stripe's card page for Professional's 7-day trial — no company screen, no plan cards. In the app a welcome card says they can change the plan any time. The company name and trades are asked inside the app."
        : "Straight to Professional, no card: Google opens the trial at once; an email sign-up confirms the address with a code (without a card it's the only check), then the trial starts. No company screen, no plan cards; the welcome card in the app says they can change the plan any time."
      : "The plan cards, as built: the visitor compares the plans and picks one before the card page.";
  const why = p.source === "admin" ? `Set here${p.at ? ` on ${when(p.at)}` : ""}${p.by ? ` by ${p.by}` : ""}.` : "The default; nothing set here yet.";
  return (
    <section className={t.panel} aria-label="Plan at sign-up" data-signup-plan={p.mode}>
      <div className={t.main}>
        <div className={t.kicker}>Sign-up · plan</div>
        <p className={t.now} aria-live="polite">
          {now}
        </p>
        <p className={t.why}>
          {why} Takes effect for new signups within seconds and wins over the steps switch above. A visitor who chose a plan
          on the pricing page keeps it; one from an ad for a tool Professional doesn&apos;t have gets the plan that has it; one
          who backs out of the card page sees the plan cards. Every sign-up event carries <code>plan_mode</code>, so the two
          can be compared on the traffic page.
        </p>
        {error && (
          <p className={t.err} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={t.actions}>
        <div className={t.seg} role="radiogroup" aria-label="Plan at sign-up">
          {CHOICES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={p.mode === c.id} className={t.segBtn} disabled={pending !== null} onClick={() => void pick(c.id)}>
              {pending === c.id ? "Saving…" : c.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
