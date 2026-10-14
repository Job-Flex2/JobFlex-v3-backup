"use client";

// THE INVESTOR LINK'S FRONT DOOR (owner, 2026-10-13): before the figures, the reader says who they are — name,
// company, what they do, an email — and we hear about it; then the page opens for them (a pass in this browser,
// lib/investorVisitors). And on the page itself, "We accept VC offers": a short offer, sent to us with the
// investor's address to reply to.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { introduceInvestorAction, sendInvestorOfferAction } from "@/actions/investorGate";
import { INVESTOR_KINDS, OFFER_AMOUNTS, OFFER_INSTRUMENTS, OFFER_TIMELINES, OFFER_TYPES, type InvestorVisitorView } from "@/lib/investorGate";
import s from "./investor-gate.module.css";

type Problems = Record<string, string>;

function Field({ id, label, hint, problem, children }: { id: string; label: string; hint?: string; problem?: string; children: React.ReactNode }) {
  return (
    <label className={`${s.field} ${problem ? s.bad : ""}`} htmlFor={id}>
      <span className={s.label}>
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      {children}
      {problem ? <span className={s.why}>{problem}</span> : null}
    </label>
  );
}

function Chips({ name, options, value, onPick, problem }: { name: string; options: readonly string[]; value: string; onPick: (v: string) => void; problem?: string }) {
  return (
    <div className={`${s.chipsWrap} ${problem ? s.bad : ""}`}>
      <div className={s.chips} role="radiogroup" aria-label={name}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={`${s.chip} ${value === o ? s.on : ""}`} onClick={() => onPick(o)}>
            {o}
          </button>
        ))}
      </div>
      {problem ? <span className={s.why}>{problem}</span> : null}
    </div>
  );
}

/** Before the figures: who is reading. */
export function InvestorGate({ token, adminPreview = false }: { token: string; adminPreview?: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", company: "", kind: "", email: "", phone: "" });
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setProblems((p) => ({ ...p, [k]: "" }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await introduceInvestorAction(token, f);
      if (!r.ok) {
        setError(r.error);
        setProblems(r.problems ?? {});
        return;
      }
      router.refresh();
    } catch {
      setError("That did not go through. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.gate} data-investor-gate>
      <div className={s.kicker}>JobFlex · Investors</div>
      <h1 className={s.h1}>Before the figures — who&apos;s reading?</h1>
      <p className={s.sub}>
        The live numbers are one step away: what the ads cost, how many contractors start a trial, and how soon the ads pay for themselves. Tell us who you are and the page opens — this browser remembers you.
      </p>
      {adminPreview ? <p className={s.note}>Admin preview: this is what a reader sees first. Your own visit is not recorded.</p> : null}
      <form className={s.form} onSubmit={submit} noValidate>
        <div className={s.pair}>
          <Field id="inv-name" label="Your name" problem={problems.name}>
            <input id="inv-name" className={s.input} autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="inv-company" label="Company or fund" problem={problems.company}>
            <input id="inv-company" className={s.input} autoComplete="organization" value={f.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
        </div>
        <div className={s.field}>
          <span className={s.label}>What you do</span>
          <Chips name="What you do" options={INVESTOR_KINDS} value={f.kind} onPick={(v) => set("kind", v)} problem={problems.kind} />
        </div>
        <div className={s.pair}>
          <Field id="inv-email" label="Email" hint="so we can answer you" problem={problems.email}>
            <input id="inv-email" className={s.input} type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field id="inv-phone" label="Phone" hint="optional" problem={problems.phone}>
            <input id="inv-phone" className={s.input} type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
        </div>
        {error ? (
          <p className={s.err} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={s.primary} disabled={busy || adminPreview} data-investor-open>
          {busy ? "Opening…" : "See the figures"}
        </button>
        <p className={s.fine}>Used only to know who is reading and to answer you. Never shared.</p>
      </form>
    </div>
  );
}

/** "We accept VC offers": the button at the top, and the short offer it opens. */
export function VcOfferButton({ token, visitor, lead }: { token: string; visitor: InvestorVisitorView | null; lead: boolean }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [o, setO] = useState({ type: "", amount: "", instrument: "", valuation: "", timeline: "", message: "", name: visitor?.name ?? "", company: visitor?.company ?? "", email: visitor?.email ?? "", phone: visitor?.phone ?? "" });
  const [editFrom, setEditFrom] = useState(!visitor);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const set = (k: keyof typeof o, v: string) => {
    setO((x) => ({ ...x, [k]: v }));
    setProblems((p) => ({ ...p, [k]: "" }));
  };
  // An intro call needs no figures yet: the open answers are picked for them.
  const pickType = (v: string) => {
    setO((x) => ({ ...x, type: v, ...(v === "Intro call first" ? { amount: x.amount || "Open", instrument: x.instrument || "Not sure yet", timeline: x.timeline || "Exploring" } : {}) }));
    setProblems((p) => ({ ...p, type: "" }));
  };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await sendInvestorOfferAction(token, o);
      if (!r.ok) {
        setError(r.error);
        setProblems(r.problems ?? {});
        if (r.problems && (r.problems.name || r.problems.company || r.problems.email)) setEditFrom(true);
        return;
      }
      setSent(true);
    } catch {
      setError("That did not go through. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={`${s.vc} ${lead ? s.vcLead : ""} ${sent ? s.vcSent : ""}`} onClick={() => setOpen(true)} data-vc-open>
        <span className={s.vcDot} aria-hidden="true" />
        {sent ? "Offer sent — thank you" : "We accept VC offers"}
      </button>
      {open ? (
        <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="vc-title" data-vc-dialog>
            <div className={s.dHead}>
              <div>
                <div className={s.kicker}>JobFlex · Investors</div>
                <h2 id="vc-title" className={s.h2}>
                  {sent ? "Received" : "We accept VC offers"}
                </h2>
              </div>
              <button type="button" className={s.x} onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            {sent ? (
              <div className={s.done} data-vc-done>
                <p>Your offer is in our inbox now. We read every one and answer by email{o.email ? ` at ${o.email}` : ""}.</p>
                <button type="button" className={s.primary} onClick={() => setOpen(false)}>
                  Back to the figures
                </button>
              </div>
            ) : (
              <form className={s.form} onSubmit={submit} noValidate>
                <p className={s.sub}>Open to term sheets and to a first conversation — SAFE, priced round or notes. A few taps; we answer by email.</p>
                <div className={s.field}>
                  <span className={s.label}>What you&apos;re sending</span>
                  <div className={`${s.chipsWrap} ${problems.type ? s.bad : ""}`}>
                    <div className={s.chips} role="radiogroup" aria-label="What you're sending">
                      {OFFER_TYPES.map((t, i) => (
                        <button key={t} ref={i === 0 ? firstRef : undefined} type="button" role="radio" aria-checked={o.type === t} className={`${s.chip} ${o.type === t ? s.on : ""}`} onClick={() => pickType(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    {problems.type ? <span className={s.why}>{problems.type}</span> : null}
                  </div>
                </div>
                <div className={s.field}>
                  <span className={s.label}>Amount</span>
                  <Chips name="Amount" options={OFFER_AMOUNTS} value={o.amount} onPick={(v) => set("amount", v)} problem={problems.amount} />
                </div>
                <div className={s.field}>
                  <span className={s.label}>Instrument</span>
                  <Chips name="Instrument" options={OFFER_INSTRUMENTS} value={o.instrument} onPick={(v) => set("instrument", v)} problem={problems.instrument} />
                </div>
                <div className={s.pair}>
                  <Field id="vc-val" label="Valuation or cap" hint="optional" problem={problems.valuation}>
                    <input id="vc-val" className={s.input} placeholder="e.g. $8M post" value={o.valuation} onChange={(e) => set("valuation", e.target.value)} />
                  </Field>
                  <div className={s.field}>
                    <span className={s.label}>Timeline</span>
                    <Chips name="Timeline" options={OFFER_TIMELINES} value={o.timeline} onPick={(v) => set("timeline", v)} problem={problems.timeline} />
                  </div>
                </div>
                <Field id="vc-msg" label="A note" hint={o.type === "Term sheet" ? "the terms in a line or two" : "optional"} problem={problems.message}>
                  <textarea id="vc-msg" className={s.textarea} rows={3} value={o.message} onChange={(e) => set("message", e.target.value)} />
                </Field>
                {editFrom ? (
                  <div className={s.pair}>
                    <Field id="vc-name" label="Your name" problem={problems.name}>
                      <input id="vc-name" className={s.input} value={o.name} onChange={(e) => set("name", e.target.value)} />
                    </Field>
                    <Field id="vc-company" label="Company or fund" problem={problems.company}>
                      <input id="vc-company" className={s.input} value={o.company} onChange={(e) => set("company", e.target.value)} />
                    </Field>
                    <Field id="vc-email" label="Email" problem={problems.email}>
                      <input id="vc-email" className={s.input} type="email" value={o.email} onChange={(e) => set("email", e.target.value)} />
                    </Field>
                    <Field id="vc-phone" label="Phone" hint="optional">
                      <input id="vc-phone" className={s.input} type="tel" value={o.phone} onChange={(e) => set("phone", e.target.value)} />
                    </Field>
                  </div>
                ) : (
                  <p className={s.from} data-vc-from>
                    From <b>{o.name}</b> · {o.company} · {o.email}{" "}
                    <button type="button" className={s.link} onClick={() => setEditFrom(true)}>
                      change
                    </button>
                  </p>
                )}
                {error ? (
                  <p className={s.err} role="alert">
                    {error}
                  </p>
                ) : null}
                <button type="submit" className={s.primary} disabled={busy} data-vc-send>
                  {busy ? "Sending…" : "Send the offer"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
