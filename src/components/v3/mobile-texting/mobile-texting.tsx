"use client";

// TEXTING · HANDHELD (2026-10-16) — /dashboard/texting at ≤768px, and the
// standalone preview at /mobile-texting-v1.
//
// The phone edition of the Texting page (components/v3/texting-page, the desk
// edition, untouched). Its job in one line: who gets texted, from which number,
// saying what. Everything the desk page does is here (the inventory: scratchpad
// texting-inventory.md), composed for one thumb:
//
//   · the count and the status FIRST — the month's texts under the title, then
//     "is texting on, from which number" as the first framed line, with the four
//     steps under it (each step's button scrolls to its card);
//   · the setup in its order — 1 number, 2 team, 3 clients, 4 your own texts —
//     then the two extras (Also text, Lead texts from JobFlex) one under the
//     other, never side by side;
//   · one short line per card; the long instructions behind "How it works".
//
// THE SAME PARTS AS THE DESK. The status + steps, the number, the roster, the
// clients switch and your own texts are the shared components in texting-people/
// (their 712ecad9 quiet-blueprint look kept): their logic, actions and copy are
// not copied here. ./mobile-texting.css only re-sizes them for a hand — 44px
// targets, 16px inputs (no iOS focus zoom), stacked fields and full-width
// actions — from inside this page's root, so the desk never sees it. The cards
// that belong to the page itself (Also text, Lead texts, Your mobile) are drawn
// here, on the same actions (@/actions/sms) and the same copy (TEXTS_COPY,
// TEXTING_COPY, REGISTRATION_COPY, TEXTING_PAGE_COPY).
//
// Styles: ./mobile-texting.css — PLAIN css, every selector under the one literal
// root class `.jf-mobile-texting`, element prefix `mtx-`; never a CSS Module.

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  addNotificationPhone,
  confirmPhoneVerification,
  removeNotificationPhone,
  removeSmsPhone,
  sendTestText,
  setLeadTexts,
  setNotificationPhoneActive,
  startPhoneVerification,
  type SmsActionResult,
} from "@/actions/sms";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { TextingPeople } from "@/components/v3/texting-people/texting-people";
import { ClientTextsSwitch, TextingOverview } from "@/components/v3/texting-people/texting-overview";
import { TextRules } from "@/components/v3/texting-people/text-rules";
import { OwnNumber } from "@/components/v3/texting-people/own-number";
import { TEXTING_PAGE_COPY } from "@/components/v3/texting-page/texting-page";
import { REGISTRATION_COPY } from "@/lib/sms/registrationShared";
import { actionError } from "@/components/v3/settings-blueprint/ui";
import type { SmsSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { TEXTING_COPY, TEXTS_COPY } from "@/components/v3/settings-blueprint/settings-data";
import "./mobile-texting.css";

const P = TEXTING_PAGE_COPY;

export function MobileTexting({ sms }: { sms: SmsSettingsData }) {
  // Deep links (#texting-own-number from the AI desk, #texting-roster, …) land on
  // their card. The page scrolls inside its own <main>, not the window, so the
  // browser's own jump never happens: do it once the cards are in, and again when
  // the hash changes while the page is open.
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    const t = window.setTimeout(go, 120);
    window.addEventListener("hashchange", go);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", go);
    };
  }, []);

  return (
    <div className="jf-mobile-texting" data-texting-page data-texting-handheld data-manager={sms.canManage ? "1" : "0"}>
      {/* Shared handheld chrome: dark topbar + slide-out drawer + icon sprite. */}
      <MobileNav />

      <main className="mtx-scroll">
        <div className="mtx-content">
          <header className="mtx-head">
            <h1 className="mtx-title">{P.title}</h1>
            <p className="mtx-job">{sms.canManage ? P.job : P.jobMine}</p>
            {sms.canManage ? (
              <div className="mtx-usage" data-texting-usage title={TEXTS_COPY.overage}>
                <p className="mtx-usageN">
                  <b>{sms.monthCount}</b>
                  <span>/ {sms.allowance}</span>
                  <span className="mtx-usageL">{P.usageLabel}</span>
                </p>
                <p className="mtx-usageS">{TEXTS_COPY.overage}</p>
              </div>
            ) : null}
          </header>

          {sms.canManage ? (
            <>
              {/* Status first: what is texted now, and the four steps with where each stands. */}
              <section className="mtx-host mtx-status" id="texting-overview" aria-label="Where texting stands">
                <TextingOverview sms={sms} />
              </section>

              <Card id="texting-own-number" step={1} title={REGISTRATION_COPY.title} sub={P.number}>
                <OwnNumber view={sms.registration} configured={sms.configured} />
              </Card>

              <Card id="texting-roster" step={2} title={TEXTING_COPY.stepTeam} sub={P.team} how={TEXTING_COPY.peopleSub} data={{ "data-roster": "" }}>
                <TextingPeople roster={sms.roster} />
              </Card>

              <Card id="texting-clients" step={3} title={TEXTING_COPY.stepClients} sub={TEXTS_COPY.clientsSub}>
                <ClientTextsSwitch on={sms.clientsOn} />
                <p className="mtx-note">{REGISTRATION_COPY.consent}</p>
              </Card>

              <Card id="texting-rules" step={4} title={TEXTING_COPY.rulesTitle} sub={P.rules} how={TEXTING_COPY.rulesSub}>
                <TextRules rules={sms.rules} roster={sms.roster} clientsOn={sms.clientsOn} company={sms.companyName || "Your company"} />
              </Card>

              <div className="mtx-extras" role="group" aria-label={P.extras}>
                <ExtrasCard sms={sms} />
                <LeadTextsCard sms={sms} />
              </div>
            </>
          ) : (
            <>
              {!sms.configured ? (
                <p className="mtx-info" id="texting-status">
                  {TEXTING_COPY.notConfiguredLong}
                </p>
              ) : null}
              <MobileCard sms={sms} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ── one framed card: square step marker, title, one line, "How it works" ── */

function Card({
  id,
  step,
  title,
  sub,
  how,
  data,
  children,
}: {
  id: string;
  step?: number;
  title: string;
  sub: string;
  how?: string;
  data?: Record<string, string>;
  children: ReactNode;
}) {
  const headId = `${id}-h`;
  return (
    <section className="mtx-card mtx-host" id={id} aria-labelledby={headId} {...data}>
      <div className="mtx-cardH">
        {step ? (
          <span className="mtx-step" aria-hidden="true">
            {step}
          </span>
        ) : null}
        <div className="mtx-cardT">
          <h2 id={headId}>{title}</h2>
          <p>{sub}</p>
        </div>
      </div>
      {how ? (
        <details className="mtx-how">
          <summary>{P.howItWorks}</summary>
          <p>{how}</p>
        </details>
      ) : null}
      <div className="mtx-cardB">{children}</div>
    </section>
  );
}

/** One `run` per card: the action's note or its error, under the card's controls. */
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function run(label: string, fn: () => Promise<SmsActionResult>, after?: () => void) {
    setBusy(label);
    setNote("");
    setErr("");
    try {
      const r = await fn();
      if (r.ok) {
        setNote(r.note ?? "Done.");
        after?.();
        router.refresh();
      } else setErr(r.error);
    } catch (e) {
      setErr(actionError(e));
    } finally {
      setBusy(null);
    }
  }
  const notes = (
    <>
      {note ? (
        <p className="mtx-msg mtx-msg--ok" role="status">
          {note}
        </p>
      ) : null}
      {err ? (
        <p className="mtx-msg mtx-msg--err" role="alert">
          {err}
        </p>
      ) : null}
    </>
  );
  return { busy, run, notes };
}

const digits = (v: string) => v.replace(/\D/g, "").length;

/** A field in the owner's settings look: bold ink label over a 2px ink frame, 48px tall, 16px type. */
function Field({
  label,
  value,
  placeholder,
  disabled,
  kind = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  kind?: "text" | "tel" | "code";
  onChange: (next: string) => void;
}) {
  return (
    <label className="mtx-field">
      <span>{label}</span>
      <input
        type={kind === "tel" ? "tel" : "text"}
        inputMode={kind === "tel" ? "tel" : kind === "code" ? "numeric" : undefined}
        autoComplete={kind === "code" ? "one-time-code" : "off"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* ── Also text: numbers outside the team ─────────────────────────────── */

function ExtrasCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const [extraName, setExtraName] = useState("");
  const [extraPhone, setExtraPhone] = useState("");
  const canAdd = busy === null && extraName.trim().length > 0 && digits(extraPhone) >= 10;
  return (
    <Card id="texting-extras" title={TEXTS_COPY.extrasTitle} sub={TEXTS_COPY.extrasSub}>
      {sms.extras.length ? (
        <ul className="mtx-list">
          {sms.extras.map((x) => (
            <li key={x.id} className={x.active ? "" : "is-paused"} data-extra={x.id}>
              <div className="mtx-listT">
                <b>{x.name}</b>
                <span className="mtx-phone">{x.phone}</span>
                {x.stopped ? <span className="mtx-tag mtx-tag--warn">{TEXTS_COPY.stopped}</span> : !x.active ? <span className="mtx-tag">paused</span> : null}
              </div>
              <div className="mtx-listA">
                <button type="button" className="mtx-btn" disabled={busy !== null} onClick={() => run("toggle", () => setNotificationPhoneActive(x.id, !x.active))}>
                  {x.active ? TEXTS_COPY.pause : TEXTS_COPY.resume}
                </button>
                <button type="button" className="mtx-btn" disabled={busy !== null} onClick={() => run("drop", () => removeNotificationPhone(x.id))}>
                  {TEXTS_COPY.removeExtra}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="mtx-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd)
            void run("add", () => addNotificationPhone({ name: extraName, phone: extraPhone }), () => {
              setExtraName("");
              setExtraPhone("");
            });
        }}
      >
        <Field label={TEXTS_COPY.extraName} value={extraName} placeholder="Dispatch" onChange={setExtraName} />
        <Field label={TEXTS_COPY.extraPhone} value={extraPhone} placeholder={TEXTS_COPY.mobilePlaceholder} kind="tel" onChange={setExtraPhone} />
        <button type="submit" className="mtx-btn mtx-btn--primary mtx-btn--wide" disabled={!canAdd}>
          {busy === "add" ? "Adding…" : TEXTS_COPY.addExtra}
        </button>
      </form>
      {notes}
    </Card>
  );
}

/* ── Lead texts from JobFlex: JobFlex's own texts to the company phone ── */

function LeadTextsCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const on = sms.leadTexts.on;
  return (
    <Card id="texting-lead-texts" title={TEXTS_COPY.leadTitle} sub={TEXTS_COPY.leadSub} data={{ "data-lead-texts": on ? "on" : "off" }}>
      <div className="mtx-onoff" role="group" aria-label={TEXTS_COPY.leadTitle}>
        <button type="button" aria-pressed={on} className={on ? "is-on" : ""} disabled={busy !== null || on || !sms.leadTexts.phone} onClick={() => run("lead", () => setLeadTexts(true))}>
          {TEXTS_COPY.clientsOn}
        </button>
        <button type="button" aria-pressed={!on} className={on ? "" : "is-on"} disabled={busy !== null || !on} onClick={() => run("lead", () => setLeadTexts(false))}>
          {TEXTS_COPY.clientsOff}
        </button>
      </div>
      <p className="mtx-leadTo">
        {sms.leadTexts.phone ? (
          <>
            To <span className="mtx-phone">{sms.leadTexts.phone}</span>
          </>
        ) : (
          TEXTS_COPY.leadNoPhone
        )}
      </p>
      <p className="mtx-note" data-lead-consent>
        {TEXTS_COPY.leadConsent} <a href="/terms#sms">{TEXTS_COPY.terms}</a> · <a href="/privacy#sms">{TEXTS_COPY.privacy}</a>
      </p>
      {notes}
    </Card>
  );
}

/* ── Your mobile: a member who does not manage texting ───────────────── */

function MobileCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "code">("idle");
  return (
    <Card id="texting-mobile" title={TEXTING_COPY.mineTitle} sub={TEXTING_COPY.mineSub}>
      {sms.phone && stage === "idle" ? (
        <div className="mtx-mine">
          <div className="mtx-listT">
            <b className="mtx-phone mtx-phone--big">{sms.phone}</b>
            <span className={`mtx-tag${sms.stopped ? " mtx-tag--warn" : " mtx-tag--ok"}`}>{sms.stopped ? TEXTS_COPY.stopped : TEXTS_COPY.verified}</span>
          </div>
          <button type="button" className="mtx-btn mtx-btn--wide" disabled={busy !== null} onClick={() => run("test", sendTestText)}>
            {busy === "test" ? "Sending…" : TEXTS_COPY.testText}
          </button>
          <button type="button" className="mtx-btn mtx-btn--wide" disabled={busy !== null} onClick={() => run("remove", removeSmsPhone)}>
            {TEXTS_COPY.remove}
          </button>
        </div>
      ) : (
        <div className="mtx-form">
          {!sms.phone ? <p className="mtx-note">{TEXTS_COPY.noPhone}</p> : null}
          <Field label={TEXTS_COPY.mobileLabel} value={phone} placeholder={TEXTS_COPY.mobilePlaceholder} kind="tel" onChange={setPhone} disabled={stage === "code"} />
          {stage === "code" ? <Field label={TEXTS_COPY.codeLabel} value={code} placeholder="482913" kind="code" onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} /> : null}
          {stage === "idle" ? (
            <button type="button" className="mtx-btn mtx-btn--primary mtx-btn--wide" disabled={busy !== null || digits(phone) < 10} onClick={() => run("code", () => startPhoneVerification(phone), () => setStage("code"))}>
              {busy === "code" ? "Sending…" : TEXTS_COPY.sendCode}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="mtx-btn mtx-btn--primary mtx-btn--wide"
                disabled={busy !== null || code.length !== 6}
                onClick={() =>
                  run("verify", () => confirmPhoneVerification(code), () => {
                    setStage("idle");
                    setCode("");
                    setPhone("");
                  })
                }
              >
                {busy === "verify" ? "Checking…" : TEXTS_COPY.verify}
              </button>
              <button
                type="button"
                className="mtx-btn mtx-btn--wide"
                disabled={busy !== null}
                onClick={() => {
                  setStage("idle");
                  setCode("");
                }}
              >
                {TEXTS_COPY.change}
              </button>
            </>
          )}
          <p className="mtx-note" data-sms-consent>
            {TEXTS_COPY.consent} <a href="/terms">{TEXTS_COPY.terms}</a> · <a href="/privacy">{TEXTS_COPY.privacy}</a>
          </p>
        </div>
      )}
      {notes}
    </Card>
  );
}
