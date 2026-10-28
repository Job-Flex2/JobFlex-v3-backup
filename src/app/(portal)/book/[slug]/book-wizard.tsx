"use client";

// BOOK A VISIT (2026-09-23) — the customer's four steps: the service, the
// time, who and where (with the one or two questions that matter for that
// visit), the receipt. Everything the shop set up is in `services`; the
// open times come from the calendar through bookingAvailability.
// Styled by ../book-public.css (2026-10-28): every class here is `jfb-*` under `.jf-book`.

import { bookingConsentText } from "@/lib/sms/registrationShared";
import { useState, useTransition } from "react";
import { bookingAvailability, createBookingPublic, type PublicDay } from "@/actions/booking";
import type { BookingService } from "@/lib/booking";

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

// The day picker and the time grid — shared with the customer's own manage link.
export function DayPicker({ days, day, onDay }: { days: PublicDay[]; day: string | null; onDay: (d: string) => void }) {
  return (
    <div className="jfb-days" role="tablist" aria-label="Day" data-book-days>
      {days.map((d) => (
        <button key={d.day} type="button" role="tab" aria-selected={day === d.day} onClick={() => onDay(d.day)} className={`jfb-day${day === d.day ? " is-on" : ""}`}>
          <span className="jfb-day-w">{d.weekday.slice(0, 3)}</span>
          <span className="jfb-day-d">{d.day.slice(5).replace("-", "/")}</span>
          <span className="jfb-day-n">{d.slots.length} open</span>
        </button>
      ))}
    </div>
  );
}

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
    <div className="jfb-wizard" data-book-step={step}>
      <ol className="jfb-steps" aria-label="Steps">
        {["Service", "Time", "Details", "Booked"].map((s, i) => (
          <li key={s} className={`jfb-step${i + 1 === step ? " is-on" : i + 1 < step ? " is-done" : ""}`} aria-current={i + 1 === step ? "step" : undefined}>
            <span className="jfb-step-n">{i + 1 < step ? "✓" : i + 1}</span>
            <span className="jfb-step-l">{s}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          {intro && <p className="jfb-intro">{intro}</p>}
          <h2 className="jfb-h2">What do you need?</h2>
          <div className="jfb-services" data-book-services>
            {services.map((s) => (
              <button key={s.key} type="button" onClick={() => pickService(s)} className="jfb-service" data-book-service={s.key}>
                <span className="jfb-service-top">
                  <span className="jfb-service-n">{s.label}</span>
                  <span className="jfb-service-h">{hours(s.minutes)}</span>
                </span>
                {s.urgent ? <span className="jfb-urgent">today / tomorrow</span> : null}
                <span className="jfb-service-p">
                  {s.priceText}
                  {s.memberPriceText ? <em> · members: {s.memberPriceText.toLowerCase()}</em> : null}
                </span>
                {s.description && <span className="jfb-service-d">{s.description}</span>}
                <span className="jfb-service-go" aria-hidden="true">Choose →</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && service && (
        <>
          <div className="jfb-pick">
            <div className="jfb-pick-v">
              <span className="jfb-pick-k">Service</span>
              <strong>{service.label}</strong>
            </div>
            <button type="button" className="jfb-change" onClick={() => setService(null)}>change</button>
          </div>
          <h2 className="jfb-h2">Pick a time</h2>
          {!days ? (
            <p className="jfb-wait" aria-live="polite">Checking the calendar…</p>
          ) : days.length === 0 ? (
            <p className="jfb-state">Nothing open in the next few weeks — please call {orgName}.</p>
          ) : (
            <>
              <DayPicker days={days} day={day} onDay={setDay} />
              <div className="jfb-slots" data-book-slots>
                {(days.find((d) => d.day === day)?.slots ?? []).map((s) => (
                  <button key={s.iso} type="button" onClick={() => setSlot(s)} className="jfb-slot">{s.label}</button>
                ))}
              </div>
              {arrivalWindow > 0 && <p className="jfb-hint">Times are arrival windows — the technician arrives inside the window and calls on the way.</p>}
            </>
          )}
          {err && <p className="jfb-err" role="alert">{err}</p>}
        </>
      )}

      {step === 3 && service && slot && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="jfb-form"
          data-book-details
        >
          <div className="jfb-pick">
            <div className="jfb-pick-v">
              <span className="jfb-pick-k">{service.label}</span>
              <strong>{slot.label}</strong>
            </div>
            <button type="button" className="jfb-change" onClick={() => setSlot(null)}>change</button>
          </div>
          {(service.questions ?? []).map((q) => (
            <div key={q.key} className="jfb-fld">
              <div className="jfb-lbl">{q.label}</div>
              {q.options ? (
                <div className="jfb-opts">
                  {q.options.map((o) => (
                    <button key={o} type="button" aria-pressed={answers[q.key] === o} onClick={() => setAnswers((a) => ({ ...a, [q.key]: o }))} className={`jfb-opt${answers[q.key] === o ? " is-on" : ""}`}>{o}</button>
                  ))}
                </div>
              ) : (
                <input className="jfb-in" aria-label={q.label} value={answers[q.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
              )}
            </div>
          ))}
          <label className="jfb-fld"><span className="jfb-lbl">Full name</span><input className="jfb-in" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
          <div className="jfb-two">
            <label className="jfb-fld"><span className="jfb-lbl">Email</span><input className="jfb-in" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" placeholder="for the confirmation" /></label>
            <label className="jfb-fld"><span className="jfb-lbl">Phone</span><input className="jfb-in" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label>
          </div>
          {/* Texting consent (2026-10-02): the opt-in every contractor's own texting number is registered on (lib/sms/consent). */}
          <label className="jfb-consent" data-sms-optin>
            <input type="checkbox" checked={form.smsOk} onChange={(e) => setForm({ ...form, smsOk: e.target.checked })} />
            <span>
              <b>{bookingConsentText(orgName).lead}</b> {bookingConsentText(orgName).rest}{" "}
              {/* The terms and the privacy policy beside the box (2026-10-12) — carriers look for them next to the consent. */}
              <a href={`/book/${encodeURIComponent(slug)}/texting`} target="_blank" rel="noreferrer">Texting terms</a> ·{" "}
              <a href={`/book/${encodeURIComponent(slug)}/privacy`} target="_blank" rel="noreferrer">Privacy policy</a>
            </span>
          </label>
          <label className="jfb-fld"><span className="jfb-lbl">Address of the visit</span><input className="jfb-in" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoComplete="street-address" /></label>
          <label className="jfb-fld"><span className="jfb-lbl">Anything else?</span><textarea className="jfb-in jfb-ta" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <p className="jfb-hint">On a service plan? Use the email on your plan — your member price applies automatically.</p>
          {err && <p className="jfb-err" role="alert">{err}</p>}
          <div className="jfb-acts">
            <button type="submit" className="jfb-btn jfb-btn--primary" disabled={pending} data-book-submit>{pending ? "Booking…" : "Book this visit"}</button>
            <button type="button" className="jfb-btn" onClick={() => setSlot(null)}>Back</button>
          </div>
        </form>
      )}

      {step === 4 && receipt && (
        <div className="jfb-receipt" data-book-receipt>
          <div className="jfb-receipt-mark" aria-hidden="true">✓</div>
          <div className="jfb-kicker">Booked</div>
          <div className="jfb-receipt-when">{receipt.when}</div>
          <p className="jfb-receipt-p">{receipt.serviceLabel} · {receipt.priceText}{receipt.member ? " · member" : ""}. {orgName} calls on the way{form.email ? `; the confirmation is in your email` : ""}.</p>
          <a className="jfb-btn" href={`/book/manage/${receipt.manageToken}`}>Change or cancel this visit</a>
        </div>
      )}
    </div>
  );
}
