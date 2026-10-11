"use client";

// THE SIGN-UP'S STEPS (owner, 2026-10-07), under the card switch on Admin →
// Trials: 3 (account · company · plan) or 2 (account with the business name
// and the trades, folded · plan). Same clothes as the card panel.
// 2026-10-10: a third setting, Passwordless — name and email, a code from an
// email, then the plan (lib/signupOtp). One row, three answers, so the
// switch became a three-way choice.
import { useState } from "react";
import { setSignupStepsAction } from "@/actions/trialPolicy";
import type { SignupFlow } from "@/lib/trialPolicyServer";
import t from "./trial-policy.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

type Choice = "3" | "2" | "otp";
const CHOICES: Array<{ id: Choice; label: string }> = [
  { id: "3", label: "3 steps" },
  { id: "2", label: "2 steps" },
  { id: "otp", label: "Passwordless" },
];

export function SignupStepsPanel({ initial }: { initial: SignupFlow }) {
  const [p, setP] = useState(initial);
  const [pending, setPending] = useState<Choice | null>(null);
  const [error, setError] = useState("");
  const current: Choice = p.passwordless ? "otp" : p.steps === 2 ? "2" : "3";
  const pick = async (c: Choice) => {
    if (c === current || pending) return;
    setPending(c);
    setError("");
    try {
      const res = await setSignupStepsAction(c === "otp" ? { steps: 2, passwordless: true } : { steps: c === "2" ? 2 : 3 });
      if (res.ok) setP(res.signup);
      else setError(res.error);
    } catch {
      setError("The switch could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  };
  const now =
    current === "otp"
      ? "Passwordless: name and email, then a six-digit code from an email, then the plan. Google sits on top. The business name and the trades are set later on the company page."
      : current === "2"
        ? "Two steps: one account screen — name, email, password, business name and the trades, folded — then the plan. The trades say what the shop does, not what leads it gets: leads come once it sets its specialties and address on its company page."
        : "Three steps: account, then the company (name, address, phone, trades), then the plan — as built.";
  const why = p.source === "admin" ? `Set here${p.at ? ` on ${when(p.at)}` : ""}${p.by ? ` by ${p.by}` : ""}.` : "The default; nothing set here yet.";
  return (
    <section className={t.panel} aria-label="Sign-up steps" data-steps={p.steps} data-passwordless={p.passwordless || undefined}>
      <div className={t.main}>
        <div className={t.kicker}>Sign-up · steps</div>
        <p className={t.now} aria-live="polite">{now}</p>
        <p className={t.why}>
          {why} Takes effect for new signups within seconds; every sign-up step event carries its step count and its mode, so the settings can be compared on the traffic page. /auth/register?flow=otp opens the passwordless sign-up in one browser whatever is set here (?flow=off forgets it).
        </p>
        {error && <p className={t.err} role="alert">{error}</p>}
      </div>
      <div className={t.actions}>
        <div className={t.seg} role="radiogroup" aria-label="Sign-up">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={current === c.id}
              className={t.segBtn}
              disabled={pending !== null}
              onClick={() => void pick(c.id)}
            >
              {pending === c.id ? "Saving…" : c.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
