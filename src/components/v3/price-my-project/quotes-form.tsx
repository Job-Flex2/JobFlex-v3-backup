"use client";
// GET QUOTES / EMAIL ME THIS RANGE (2026-10-27). "Get quotes": name, email, phone and the consent box — the range
// becomes a Lead Center lead that carries the whole estimate; photos, if any, go into the request's folder after.
// "Email me this range": the email alone, no consent box — a planned project on their home dashboard. Every refusal
// comes back in words under the button.
import * as React from "react";
import { useRouter } from "next/navigation";
import { publicRoofEmail, publicRoofLead } from "@/actions/publicEstimate";
import { LEAD_CONSENT_TEXT, consentPageFromLocation } from "@/lib/leadConsent";
import { moneyRange, materialWords } from "@/lib/publicEstimate/roof";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { trackTraffic } from "@/lib/traffic-client";
import { attachmentsLine, useRequestAttachments } from "@/components/v3/homeowner-landing/wizard/use-request-attachments";
import { WIZARD_MAX_FILES } from "@/lib/home/freshRequest";
import type { Priced } from "./range-view";
import type { Site } from "./place-field";
import s from "./price.module.css";

export type ResumePlan = { homeKey: string; planId: string };

export function QuotesForm({ mode, site, priced, resume, onBack }: { mode: "quotes" | "email"; site: Site; priced: Priced; resume?: ResumePlan | null; onBack: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [emailRange, setEmailRange] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<{ homePath: string | null } | null>(null);
  const att = useRequestAttachments();
  const hpRef = React.useRef<HTMLInputElement>(null);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Read at send time, never in render: the honeypot's value and the browser's zone.
    const common = {
      ...site,
      website: hpRef.current?.value ?? "",
      answers: priced.answers,
      basis: priced.range.basis,
      budgetCents: priced.budgetCents,
      homeSqft: priced.homeSqft ?? undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    try {
      if (mode === "quotes") {
        const res = await publicRoofLead({ ...common, name, email, phone, consent, emailRange, page: consentPageFromLocation(), homeKey: resume?.homeKey, planId: resume?.planId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        trackTraffic(TRAFFIC_EVENTS.priceLead, { trade: "roof", photos: att.items.length });
        if (att.items.length && res.requestToken) await att.send(res.requestToken).catch(() => null);
        router.push(res.statusPath as Parameters<typeof router.push>[0]);
      } else {
        const res = await publicRoofEmail({ ...common, email, name: name || undefined });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        trackTraffic(TRAFFIC_EVENTS.priceEmailOnly, { trade: "roof" });
        setSent({ homePath: res.homePath });
      }
    } catch {
      setError("We couldn't send that just now — nothing was lost. Please try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={s.panel} data-price-sent>
        <p className={s.ok}>Sent — check your inbox for your range. It stays on your home dashboard too{sent.homePath ? "" : " — the link to it is in the email"}.</p>
        {sent.homePath ? (
          <div className={s.acts}>
            <a className={s.btn} href={sent.homePath}>Open my home dashboard</a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className={s.panel}
      data-price-form={mode}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div>
        <p className={s.kicker}>{mode === "quotes" ? "Get quotes from local pros" : "Email me this range"}</p>
        <p className={s.muted} data-price-form-range>
          Your range: <b>{moneyRange(priced.range)}</b> · {materialWords(priced.answers.material)} · {site.address}, {site.city}
        </p>
      </div>
      <input ref={hpRef} className={s.hp} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
      <div className={s.two}>
        {mode === "quotes" ? (
          <div className={s.field}>
            <label className={s.label} htmlFor="pq-name">Your name</label>
            <input id="pq-name" name="name" className={s.input} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        ) : (
          <div className={s.field}>
            <label className={s.label} htmlFor="pq-name">Your name <span className={s.small}>(optional)</span></label>
            <input id="pq-name" name="name" className={s.input} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className={s.field}>
          <label className={s.label} htmlFor="pq-email">Email</label>
          <input id="pq-email" name="email" type="email" className={s.input} autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode === "quotes" ? (
          <div className={s.field}>
            <label className={s.label} htmlFor="pq-phone">Phone</label>
            <input id="pq-phone" name="phone" type="tel" className={s.input} autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
        ) : null}
      </div>
      {mode === "quotes" ? (
        <>
          <div className={s.photos}>
            <label className={s.label} htmlFor="pq-photos">Photos of the roof <span className={s.small}>(optional, up to {WIZARD_MAX_FILES})</span></label>
            <input id="pq-photos" type="file" accept="image/*,video/*,application/pdf" multiple onChange={(e) => e.target.files && att.add(e.target.files)} data-price-photos />
            {att.items.length ? <p className={s.small}>{att.items.map((a) => a.name).join(", ")}</p> : null}
            {attachmentsLine(att) ? <p className={s.small}>{attachmentsLine(att)}</p> : null}
          </div>
          <label className={s.check} style={{ justifySelf: "start" }}>
            <input type="checkbox" name="emailRange" checked={emailRange} onChange={(e) => setEmailRange(e.target.checked)} />
            Send me the range by email too
          </label>
          <label className={s.consent}>
            <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-price-consent />
            <span>{LEAD_CONSENT_TEXT}</span>
          </label>
          <p className={s.small}>We send this to one local pro at a time. The range is an estimate; the pro confirms on site.</p>
        </>
      ) : (
        <p className={s.small}>No calls, no contractors — just the range, and a note in two days in case you want quotes then.</p>
      )}
      {error ? <p className={s.err} data-price-form-error>{error}</p> : null}
      <div className={s.acts}>
        <button type="submit" className={s.btn} disabled={busy} data-price-send>
          {busy ? "Sending…" : mode === "quotes" ? "Get quotes" : "Email me the range"}
        </button>
        <button type="button" className={`${s.btn} ${s.btnQuiet}`} onClick={onBack} data-price-form-back>
          ← Back to my range
        </button>
      </div>
    </form>
  );
}
