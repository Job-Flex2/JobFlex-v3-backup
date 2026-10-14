"use client";

// BOOK A VISIT (2026-09-23) — the customer's four steps: the service, the
// time, who and where (with the one or two questions that matter for that
// visit), the receipt. Everything the shop set up is in `services`; the
// open times come from the calendar through bookingAvailability.

import { bookingConsentText } from "@/lib/sms/registrationShared";
import { useState, useTransition } from "react";
import { bookingAvailability, createBookingPublic, type PublicDay } from "@/actions/booking";
import type { BookingService } from "@/lib/booking";

const BTN = "rounded-[10px] bg-[color:var(--ink,#111)] px-4 py-2.5 text-[13px] font-medium text-[color:var(--paper,#fff)] disabled:opacity-50";
const GHOST = "rounded-[10px] border border-[color:var(--ink,#111)] px-4 py-2.5 text-[13px] font-medium";
const IN = "w-full rounded-[10px] border border-[color:var(--ink-line,#ccc)] px-3 py-2 text-[14px]";

export function BookWizard({ slug, orgName, services, intro, arrivalWindow }: { slug: string; orgName: string; services: BookingService[]; intro?: string; arrivalWindow: number }) {
  const [service, setService] = useState<BookingService | null>(null);
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ iso: string; label: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "", smsOk: false });
  const [err, setErr] = useState("");
  const [receipt, setReceipt] = useState<{ when: string; serviceLabel: string; member: boolean; priceText: string; manageToken: string } | null>(null);
  const [pending, start] = useTransition();

  // Picking a service asks the calendar for its open times — in the click,
  // not an effect, so nothing re-runs behind the customer's back.
  const pickService = (s: BookingService) => {
    setService(s);
    setDays(null);
    setDay(null);
    setSlot(null);
    setErr("");
    start(async () => {
      const r = await bookingAvailability(slug, s.key);
      if (r.ok) {
        setDays(r.days);
        setDay(r.days[0]?.day ?? null);
      } else setErr(r.error);
    });
  };

  const step = receipt ? 4 : !service ? 1 : !slot ? 2 : 3;
  const submit = () => {
    if (!service || !slot) return;
    setErr("");
    start(async () => {
      const r = await createBookingPublic(slug, {
        serviceKey: service.key,
        startsAtISO: slot.iso,
        name: form.name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        notes: form.notes,
        smsOk: form.smsOk,
        answers: (service.questions ?? []).map((q) => ({ key: q.key, label: q.label, value: answers[q.key] ?? "" })).filter((a) => a.value),
      });
      if (r.ok) setReceipt(r);
      else setErr(r.error);
    });
  };

  return (
    <div data-book-step={step}>
      <ol className="flex gap-2 text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-muted,#666)] mb-4">
        {["Service", "Time", "Details", "Booked"].map((s, i) => (
          <li key={s} className={i + 1 === step ? "font-semibold text-[color:var(--ink,#111)]" : ""}>{i + 1}. {s}</li>
        ))}
      </ol>

      {step === 1 && (
        <>
          {intro && <p className="mb-4 text-[14px]">{intro}</p>}
          <div className="grid gap-3" data-book-services>
            {services.map((s) => (
              <button key={s.key} type="button" onClick={() => pickService(s)} className="text-left rounded-[12px] border border-[color:var(--ink-line,#ddd)] p-4 hover:border-[color:var(--ink,#111)]" data-book-service={s.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-semibold text-[15px]">{s.label}{s.urgent ? <span className="ml-2 text-[11px] uppercase tracking-wide text-[#a83232]">today / tomorrow</span> : null}</div>
                  <div className="text-[13px] text-[color:var(--ink-muted,#666)] whitespace-nowrap">{Math.round(s.minutes / 60 * 10) / 10} h</div>
                </div>
                <div className="text-[13px] mt-1">{s.priceText}{s.memberPriceText ? <span className="text-[color:var(--ink-muted,#666)]"> · members: {s.memberPriceText.toLowerCase()}</span> : null}</div>
                {s.description && <div className="text-[13px] text-[color:var(--ink-muted,#666)] mt-1">{s.description}</div>}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && service && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">{service.label}</div>
            <button type="button" className="text-[13px] underline" onClick={() => setService(null)}>change</button>
          </div>
          {!days ? (
            <p className="text-[14px] text-[color:var(--ink-muted,#666)]">Checking the calendar…</p>
          ) : days.length === 0 ? (
            <p className="text-[14px]">Nothing open in the next few weeks — please call {orgName}.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4" data-book-days>
                {days.map((d) => (
                  <button key={d.day} type="button" onClick={() => setDay(d.day)} className={`rounded-[10px] border px-3 py-2 text-[13px] ${day === d.day ? "border-[color:var(--ink,#111)] bg-[color:var(--ink,#111)] text-white" : "border-[color:var(--ink-line,#ddd)]"}`}>
                    {d.weekday.slice(0, 3)} {d.day.slice(5).replace("-", "/")}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-book-slots>
                {(days.find((d) => d.day === day)?.slots ?? []).map((s) => (
                  <button key={s.iso} type="button" onClick={() => setSlot(s)} className="rounded-[10px] border border-[color:var(--ink-line,#ddd)] px-3 py-2 text-[13px] hover:border-[color:var(--ink,#111)]">{s.label}</button>
                ))}
              </div>
              {arrivalWindow > 0 && <p className="mt-3 text-[12px] text-[color:var(--ink-muted,#666)]">Times are arrival windows — the technician arrives inside the window and calls on the way.</p>}
            </>
          )}
        </>
      )}

      {step === 3 && service && slot && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-3"
          data-book-details
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold">{service.label} · {slot.label}</div>
            <button type="button" className="text-[13px] underline" onClick={() => setSlot(null)}>change</button>
          </div>
          {(service.questions ?? []).map((q) => (
            <div key={q.key}>
              <div className="text-[12px] font-medium mb-1">{q.label}</div>
              {q.options ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <button key={o} type="button" onClick={() => setAnswers((a) => ({ ...a, [q.key]: o }))} className={`rounded-full border px-3 py-1 text-[13px] ${answers[q.key] === o ? "border-[color:var(--ink,#111)] bg-[color:var(--ink,#111)] text-white" : "border-[color:var(--ink-line,#ddd)]"}`}>{o}</button>
                  ))}
                </div>
              ) : (
                <input className={IN} value={answers[q.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
              )}
            </div>
          ))}
          <label className="text-[12px] font-medium">Full name<input className={IN} required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-[12px] font-medium">Email<input className={IN} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" placeholder="for the confirmation" /></label>
            <label className="text-[12px] font-medium">Phone<input className={IN} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label>
          </div>
          {/* Texting consent (2026-10-02): the opt-in every contractor's own texting number is registered on (lib/sms/consent). */}
          <label className="flex items-start gap-2 text-[12px] leading-snug" data-sms-optin>
            <input type="checkbox" className="mt-[2px] h-4 w-4 shrink-0" checked={form.smsOk} onChange={(e) => setForm({ ...form, smsOk: e.target.checked })} />
            <span>
              <b className="font-medium">{bookingConsentText(orgName).lead}</b> {bookingConsentText(orgName).rest}{" "}
              {/* The terms and the privacy policy beside the box (2026-10-12) — carriers look for them next to the consent. */}
              <a className="underline" href={`/book/${encodeURIComponent(slug)}/texting`} target="_blank" rel="noreferrer">Texting terms</a> ·{" "}
              <a className="underline" href={`/book/${encodeURIComponent(slug)}/privacy`} target="_blank" rel="noreferrer">Privacy policy</a>
            </span>
          </label>
          <label className="text-[12px] font-medium">Address of the visit<input className={IN} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoComplete="street-address" /></label>
          <label className="text-[12px] font-medium">Anything else?<textarea className={IN} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <p className="text-[12px] text-[color:var(--ink-muted,#666)]">On a service plan? Use the email on your plan — your member price applies automatically.</p>
          {err && <p className="text-[13px] text-[#a83232]" role="alert">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" className={BTN} disabled={pending} data-book-submit>{pending ? "Booking…" : "Book this visit"}</button>
            <button type="button" className={GHOST} onClick={() => setSlot(null)}>Back</button>
          </div>
        </form>
      )}

      {step === 4 && receipt && (
        <div className="rounded-[12px] border border-[color:var(--ink,#111)] p-4" data-book-receipt>
          <div className="quiet-caps mb-1">Booked</div>
          <div className="text-[18px] font-semibold">{receipt.when}</div>
          <p className="mt-2 text-[14px]">{receipt.serviceLabel} · {receipt.priceText}{receipt.member ? " · member" : ""}. {orgName} calls on the way{form.email ? `; the confirmation is in your email` : ""}.</p>
          <a className="mt-3 inline-block text-[13px] underline" href={`/book/manage/${receipt.manageToken}`}>Change or cancel this visit</a>
        </div>
      )}
    </div>
  );
}
