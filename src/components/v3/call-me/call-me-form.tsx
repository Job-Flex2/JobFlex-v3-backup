"use client";
// "HAVE THE AI DESK CALL ME" (2026-10-23, lib/outreach) — the page a contractor reaches from JobFlex's one email (their
// business filled in) or from anywhere else (empty). Their number, the box they tick — the words beside it are kept with
// the time as their consent (OUTREACH_CONSENT_TEXT) — and "Call me": JobFlex's AI desk rings them half a minute later
// and answers the way it would for their business. The consent is what lets it call any kind of phone.

import * as React from "react";
import { askForOutreachCall } from "@/actions/outreach";
import { OUTREACH_CONSENT_TEXT } from "@/lib/outreach/rules";
import s from "./call-me.module.css";

const TRADES = [
  ["roofing", "Roofing"],
  ["hvac", "HVAC"],
  ["fencing", "Fencing"],
  ["decks", "Decks"],
  ["remodeling", "Remodeling"],
  ["plumbing", "Plumbing"],
  ["electrical", "Electrical"],
  ["landscaping", "Landscaping"],
  ["painting", "Painting"],
  ["other", "Something else"],
] as const;

export function CallMeForm({ token, prefill }: { token: string | null; prefill: { name: string; business: string; phone: string; trade: string | null } | null }) {
  const [name, setName] = React.useState(prefill?.name ?? "");
  const [business, setBusiness] = React.useState(prefill?.business ?? "");
  const [phone, setPhone] = React.useState(prefill?.phone ? prefill.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "");
  // No trade picked until they pick one: a contractor already on JobFlex's list keeps the one it has.
  const [trade, setTrade] = React.useState<string>(prefill?.trade && TRADES.some(([k]) => k === prefill.trade) ? prefill.trade : "");
  const [email, setEmail] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ calling: boolean; note: string } | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agree) {
      setError("Tick the box so we may call you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await askForOutreachCall({ token, name, business, phone, email: email || null, trade: trade && trade !== "other" ? trade : null, consent: true });
      if (!r.ok) setError(r.error);
      else setDone({ calling: r.calling, note: r.note });
    } catch {
      setError("That didn't go through — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={s.page} data-call-me>
      <div className={s.card}>
        <div className={s.brand}>JobFlex</div>
        {done ? (
          <div className={s.done} data-call-me-done={done.calling ? "calling" : "queued"} role="status">
            <div className={s.ring} aria-hidden="true">
              ☎
            </div>
            <h1 className={s.h1}>{done.calling ? "Pick up — it's calling you" : "We have your request"}</h1>
            <p className={s.p}>{done.note}</p>
            <p className={s.fine}>It&rsquo;s JobFlex&rsquo;s virtual assistant. Say &ldquo;stop calling&rdquo; at any time and it won&rsquo;t call again.</p>
          </div>
        ) : (
          <form onSubmit={(e) => void send(e)} className={s.form}>
            <h1 className={s.h1}>Hear the AI desk answer for {prefill?.business || "your business"}</h1>
            <p className={s.p}>Tap the button and JobFlex&rsquo;s AI desk calls you in about half a minute — it answers the way it would answer your customers, books a visit, and tells you what JobFlex does. Two or three minutes.</p>
            <label className={s.lbl}>
              Your name
              <input className={s.in} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required data-call-me-name />
            </label>
            <label className={s.lbl}>
              Business
              <input className={s.in} value={business} onChange={(e) => setBusiness(e.target.value)} autoComplete="organization" data-call-me-business />
            </label>
            <label className={s.lbl}>
              Your phone
              <input className={s.in} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required data-call-me-phone />
            </label>
            <label className={s.lbl}>
              Your trade
              <select className={s.in} value={trade} onChange={(e) => setTrade(e.target.value)} data-call-me-trade>
                <option value="">Pick one</option>
                {TRADES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.lbl}>
              Email (optional — for the trial link)
              <input className={s.in} value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" />
            </label>
            <label className={s.agree}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-call-me-consent />
              <span>{OUTREACH_CONSENT_TEXT}</span>
            </label>
            {error ? (
              <p className={s.err} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className={s.btn} disabled={busy} data-call-me-send>
              {busy ? "Calling…" : "Call me"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
