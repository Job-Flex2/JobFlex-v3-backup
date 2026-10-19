"use client";

// TEXTING — the desk page (2026-10-16). Owner: move Settings → Texting to its
// own page, in the sidebar under AI desk. Its job in one line: who gets
// texted, from which number, saying what.
//
// Everything the Settings pane did is here (the inventory: scratchpad
// texting-inventory.md) — the same components in texting-people/ (their inside
// redrawn for clarity 2026-10-18, texting-kit.css) and the pane's own cards, rebuilt for a
// page: a page head with the month's count, the status and steps first, then
// the setup in its order — 1 number, 2 team, 3 clients, 4 your own texts — and
// the two extras side by side at the foot. Long instructions moved behind a
// "How it works" disclosure; each card keeps one short line of what it is for.
//
// Styles: ./texting-page.css — PLAIN css, every selector under `.jf-texting`,
// and the root carries `data-nest` so the shell's `* { margin:0; padding:0 }`
// reset skips this tree (it tied single-class rules in production builds).

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
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
import { TextingPeople } from "@/components/v3/texting-people/texting-people";
import { ClientTextsSwitch, textingSteps, type TextingTone } from "@/components/v3/texting-people/texting-overview";
import { TextRules } from "@/components/v3/texting-people/text-rules";
import { OwnNumber } from "@/components/v3/texting-people/own-number";
import { REGISTRATION_COPY } from "@/lib/sms/registrationShared";
import { actionError } from "@/components/v3/settings-blueprint/ui";
import type { SmsSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { TEXTING_COPY, TEXTS_COPY } from "@/components/v3/settings-blueprint/settings-data";
import "./texting-page.css";

/** The page's own words: the one-line job, and one short line per card (the long ones sit under "How it works"). */
export const TEXTING_PAGE_COPY = {
  title: "Texting",
  job: "Who gets texted, from which number, saying what.",
  jobMine: "Your mobile — where the company’s texts to you go.",
  usageLabel: "texts this month",
  number: "Every text goes out from it, in your company’s name.",
  team: "Switch texts on per person, then tick what each one gets.",
  rules: "A text for any moment — when it goes out, who gets it, what it says.",
  howItWorks: "How it works",
  extras: "Extra numbers",
  setupTitle: "Set up texting",
  progress: (n: number) => `${n} of 4 set up`,
  open: "Open",
  close: "Close",
  stamp: { ok: "Done", wait: "Pending", todo: "To do", bad: "Needs a fix" } as Record<TextingTone, string>,
  clientsStamp: (on: boolean) => (on ? "On" : "Off"),
} as const;

type StepKey = "number" | "team" | "clients" | "rules";
/** Each step's card id — the deep links (#texting-own-number from the AI desk) open the step they name. */
const STEP_ID: Record<StepKey, string> = { number: "texting-own-number", team: "texting-roster", clients: "texting-clients", rules: "texting-rules" };

export function TextingPageDesk({ sms }: { sms: SmsSettingsData }) {
  const P = TEXTING_PAGE_COPY;

  return (
    <div className="jf-texting" data-nest="" data-texting-page data-manager={sms.canManage ? "1" : "0"}>
      <header className="txp-head">
        <div className="txp-headT">
          <h1 className="txp-title">{P.title}</h1>
          <p className="txp-job">{sms.canManage ? P.job : P.jobMine}</p>
        </div>
        {sms.canManage ? (
          <div className="txp-usage" data-texting-usage title={TEXTS_COPY.overage}>
            <span className="txp-usageN">
              <b>{sms.monthCount}</b>
              <span aria-hidden="true">/</span>
              {sms.allowance}
            </span>
            <span className="txp-usageL">{P.usageLabel}</span>
            <span className="txp-usageS">{TEXTS_COPY.overage}</span>
          </div>
        ) : null}
      </header>

      {sms.canManage ? (
        <>
          <TextingSetup sms={sms} />

          <div className="txp-pair" aria-label={P.extras} role="group">
            <ExtrasCard sms={sms} />
            <LeadTextsCard sms={sms} />
          </div>
        </>
      ) : (
        <>
          {!sms.configured ? (
            <p className="txp-info" id="texting-status">{TEXTING_COPY.notConfiguredLong}</p>
          ) : null}
          <MobileCard sms={sms} />
        </>
      )}
    </div>
  );
}

/** The status line and the setup checklist — the Texting page's body, drawn by the desk page and the handheld build
 *  alike (inside a `.jf-texting` root, whose stylesheet it uses). */
export function TextingSetup({ sms }: { sms: SmsSettingsData }) {
  const P = TEXTING_PAGE_COPY;
  const st = textingSteps(sms);
  // The checklist (owner, 2026-10-17 — the AI desk's pattern): every step closed until picked, except the one a deep
  // link names (#texting-own-number from the AI desk), which opens and is scrolled to.
  const [open, setOpen] = useState<StepKey | null>(null);
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const key = (Object.keys(STEP_ID) as StepKey[]).find((k) => STEP_ID[k] === id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the hash is only readable after mount
    if (key) setOpen(key);
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 120);
    return () => window.clearTimeout(t);
  }, []);
  const done = (["number", "team", "clients", "rules"] as StepKey[]).filter((k) => st[k].tone === "ok").length;
  return (
    <>
    {/* Status first: one line on what is texted now. */}
    <p className={`txp-status${st.live ? " is-live" : ""}`} id="texting-overview" role="status" data-texting-status>
      {st.status}
    </p>

    {/* The setup: one checklist, a row per step that opens its part right under it. */}
    <section className="txp-setup" aria-labelledby="txp-setup-t">
      <header className="txp-setupH">
        <h2 id="txp-setup-t">{P.setupTitle}</h2>
        <div className="txp-progress">
          <span className="txp-count">{P.progress(done)}</span>
          <span className="txp-fill" role="progressbar" aria-label={P.setupTitle} aria-valuemin={0} aria-valuemax={4} aria-valuenow={done}>
            <span style={{ width: `${(done / 4) * 100}%` }} />
          </span>
        </div>
      </header>
      <ol className="txp-steps">
        <Step k="number" n={1} title={REGISTRATION_COPY.title} line={st.number.line} tone={st.number.tone} stamp={P.stamp[st.number.tone]} open={open} onPick={setOpen}>
          <p className="txp-lead">{P.number}</p>
          <OwnNumber view={sms.registration} configured={sms.configured} />
        </Step>
        <Step k="team" n={2} title={TEXTING_COPY.stepTeam} line={st.team.line} tone={st.team.tone} stamp={P.stamp[st.team.tone]} open={open} onPick={setOpen} data={{ "data-roster": "" }}>
          <p className="txp-lead">{P.team}</p>
          <How text={TEXTING_COPY.peopleSub} />
          <TextingPeople roster={sms.roster} />
        </Step>
        <Step k="clients" n={3} title={TEXTING_COPY.stepClients} line={TEXTS_COPY.clientsSub} tone={st.clients.tone} stamp={P.clientsStamp(sms.clientsOn)} open={open} onPick={setOpen}>
          <ClientTextsSwitch on={sms.clientsOn} />
          <p className="txp-note">{REGISTRATION_COPY.consent}</p>
        </Step>
        <Step k="rules" n={4} title={TEXTING_COPY.rulesTitle} line={st.rules.line} tone={st.rules.tone} stamp={P.stamp[st.rules.tone]} open={open} onPick={setOpen}>
          <p className="txp-lead">{P.rules}</p>
          <How text={TEXTING_COPY.rulesSub} />
          <TextRules rules={sms.rules} roster={sms.roster} clientsOn={sms.clientsOn} company={sms.companyName || "Your company"} />
        </Step>
      </ol>
    </section>
    </>
  );
}

/* ── a checklist row: number (a tick once done), name, its line, stamp, Open/Close; its part unfolds under it ── */

function Step({
  k,
  n,
  title,
  line,
  tone,
  stamp,
  open,
  onPick,
  data,
  children,
}: {
  k: StepKey;
  n: number;
  title: string;
  line: string;
  tone: TextingTone;
  stamp: string;
  open: StepKey | null;
  onPick: (k: StepKey | null) => void;
  data?: Record<string, string>;
  children: ReactNode;
}) {
  const isOpen = open === k;
  const id = STEP_ID[k];
  return (
    <li className="txp-stepRow" id={id} data-open={isOpen ? "1" : "0"} data-tone={tone} {...data}>
      <button
        type="button"
        className="txp-stepBtn"
        id={`${id}-h`}
        aria-expanded={isOpen}
        aria-controls={`${id}-b`}
        onClick={() => onPick(isOpen ? null : k)}
      >
        <span className="txp-stepN" aria-hidden="true">
          {tone === "ok" ? <Check size={16} strokeWidth={3} /> : n}
        </span>
        <span className="txp-stepT">
          <b>{title}</b>
          <span>{line}</span>
        </span>
        <span className="txp-stamp" data-tone={tone}>{stamp}</span>
        <span className="txp-stepGo" aria-hidden="true">
          <span className="txp-stepGoT">{isOpen ? TEXTING_PAGE_COPY.close : TEXTING_PAGE_COPY.open}</span>
          <ChevronDown size={16} strokeWidth={2.4} />
        </span>
      </button>
      <div className="txp-stepB" id={`${id}-b`} role="region" aria-labelledby={`${id}-h`} hidden={!isOpen}>
        {children}
      </div>
    </li>
  );
}

/** The long instructions, one click away. */
function How({ text }: { text: string }) {
  return (
    <details className="txp-how">
      <summary>{TEXTING_PAGE_COPY.howItWorks}</summary>
      <p>{text}</p>
    </details>
  );
}

/* ── one framed card: title, one line; an optional control at the right and "How it works" ── */

function Card({
  id,
  step,
  title,
  sub,
  how,
  aside,
  data,
  children,
}: {
  id: string;
  step?: number;
  title: string;
  sub: string;
  how?: string;
  aside?: ReactNode;
  data?: Record<string, string>;
  children: ReactNode;
}) {
  const headId = `${id}-h`;
  return (
    <section className="txp-card" id={id} aria-labelledby={headId} {...data}>
      <div className="txp-cardH">
        {step ? (
          <span className="txp-step" aria-hidden="true">
            {step}
          </span>
        ) : null}
        <div className="txp-cardT">
          <h2 id={headId}>{title}</h2>
          <p>{sub}</p>
          {how ? (
            <details className="txp-how">
              <summary>{TEXTING_PAGE_COPY.howItWorks}</summary>
              <p>{how}</p>
            </details>
          ) : null}
        </div>
        {aside ? <div className="txp-cardA">{aside}</div> : null}
      </div>
      <div className="txp-cardB">{children}</div>
    </section>
  );
}

/** One `run` for every button in a card: the action's note or its error, under the card. */
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
      {note ? <p className="txp-note txp-note--ok" role="status">{note}</p> : null}
      {err ? <p className="txp-note txp-note--err" role="alert">{err}</p> : null}
    </>
  );
  return { busy, run, notes };
}

const digits = (v: string) => v.replace(/\D/g, "").length;

/** A field in the owner's settings look (2026-09-26): bold ink label, 2px ink frame, 46px tall. Settings' own `.fld`
 *  rules are scoped to the Settings route, so the page draws its own. */
function TxField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const tel = label === TEXTS_COPY.mobileLabel || label === TEXTS_COPY.extraPhone;
  const code = label === TEXTS_COPY.codeLabel;
  return (
    <label className="txp-field">
      <span>{label}</span>
      <input
        type={tel ? "tel" : "text"}
        inputMode={tel ? "tel" : code ? "numeric" : undefined}
        autoComplete={code ? "one-time-code" : "off"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* ── numbers outside the team ──────────────────────────────────────── */

function ExtrasCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const [extraName, setExtraName] = useState("");
  const [extraPhone, setExtraPhone] = useState("");
  const canAdd = busy === null && extraName.trim().length > 0 && digits(extraPhone) >= 10;
  return (
    <Card id="texting-extras" title={TEXTS_COPY.extrasTitle} sub={TEXTS_COPY.extrasSub}>
      {sms.extras.length ? (
        <ul className="txp-list">
          {sms.extras.map((x) => (
            <li key={x.id} className={x.active ? "" : "is-paused"} data-extra={x.id}>
              <span className="txp-listT">
                <b>{x.name}</b>
                <span className="txp-listS">
                  <span className="txp-phone">{x.phone}</span>
                  {x.stopped ? <span className="txp-tag txp-tag--warn">{TEXTS_COPY.stopped}</span> : !x.active ? <span className="txp-tag">paused</span> : null}
                </span>
              </span>
              <span className="txp-listA">
                <button type="button" className="txp-btn txp-btn--sm" disabled={busy !== null} onClick={() => run("toggle", () => setNotificationPhoneActive(x.id, !x.active))}>
                  {x.active ? TEXTS_COPY.pause : TEXTS_COPY.resume}
                </button>
                <button type="button" className="txp-btn txp-btn--sm" disabled={busy !== null} onClick={() => run("drop", () => removeNotificationPhone(x.id))}>
                  {TEXTS_COPY.removeExtra}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="txp-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) void run("add", () => addNotificationPhone({ name: extraName, phone: extraPhone }), () => { setExtraName(""); setExtraPhone(""); });
        }}
      >
        {/* The add row (2026-10-18): name, mobile and the one blue button on one line, their bottoms aligned. */}
        <div className="txp-fields txp-fields--add">
          <TxField label={TEXTS_COPY.extraName} value={extraName} placeholder="Dispatch" onChange={setExtraName} />
          <TxField label={TEXTS_COPY.extraPhone} value={extraPhone} placeholder={TEXTS_COPY.mobilePlaceholder} onChange={setExtraPhone} />
          <button type="submit" className="txp-btn txp-btn--primary txp-btn--field" disabled={!canAdd}>
            {busy === "add" ? "Adding…" : TEXTS_COPY.addExtra}
          </button>
        </div>
      </form>
      {notes}
    </Card>
  );
}

/* ── JobFlex's own lead texts to the company (a different number: JobFlex's) ── */

function LeadTextsCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const on = sms.leadTexts.on;
  return (
    <Card id="texting-lead-texts" title={TEXTS_COPY.leadTitle} sub={TEXTS_COPY.leadSub} data={{ "data-lead-texts": on ? "on" : "off" }}>
      <div className="txp-leadRow">
        <div className="txp-onoff" role="group" aria-label={TEXTS_COPY.leadTitle}>
          <button type="button" aria-pressed={on} className={on ? "is-on" : ""} disabled={busy !== null || on || !sms.leadTexts.phone} onClick={() => run("lead", () => setLeadTexts(true))}>
            {TEXTS_COPY.clientsOn}
          </button>
          <button type="button" aria-pressed={!on} className={on ? "" : "is-on"} disabled={busy !== null || !on} onClick={() => run("lead", () => setLeadTexts(false))}>
            {TEXTS_COPY.clientsOff}
          </button>
        </div>
        <span className="txp-leadTo">{sms.leadTexts.phone ? <>To <span className="txp-phone">{sms.leadTexts.phone}</span></> : TEXTS_COPY.leadNoPhone}</span>
      </div>
      <p className="txp-note" data-lead-consent>
        {TEXTS_COPY.leadConsent} <a href="/terms#sms">{TEXTS_COPY.terms}</a> · <a href="/privacy#sms">{TEXTS_COPY.privacy}</a>
      </p>
      {notes}
    </Card>
  );
}

/* ── my mobile (a member who does not manage texting) ─────────────── */

function MobileCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "code">("idle");
  return (
    <Card id="texting-mobile" title={TEXTING_COPY.mineTitle} sub={TEXTING_COPY.mineSub}>
      {sms.phone && stage === "idle" ? (
        <div className="txp-mine">
          <span className="txp-listT">
            <b className="txp-phone txp-phone--big">{sms.phone}</b>
            <span className={`txp-tag${sms.stopped ? " txp-tag--warn" : " txp-tag--ok"}`}>{sms.stopped ? TEXTS_COPY.stopped : TEXTS_COPY.verified}</span>
          </span>
          <span className="txp-listA">
            <button type="button" className="txp-btn" disabled={busy !== null} onClick={() => run("test", sendTestText)}>
              {busy === "test" ? "Sending…" : TEXTS_COPY.testText}
            </button>
            <button type="button" className="txp-btn" disabled={busy !== null} onClick={() => run("remove", removeSmsPhone)}>
              {TEXTS_COPY.remove}
            </button>
          </span>
        </div>
      ) : (
        <div className="txp-verify">
          {!sms.phone ? <p className="txp-note">{TEXTS_COPY.noPhone}</p> : null}
          <div className="txp-fields">
            <TxField label={TEXTS_COPY.mobileLabel} value={phone} placeholder={TEXTS_COPY.mobilePlaceholder} onChange={setPhone} disabled={stage === "code"} />
            {stage === "code" ? <TxField label={TEXTS_COPY.codeLabel} value={code} placeholder="482913" onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} /> : null}
          </div>
          <div className="txp-acts">
            {stage === "idle" ? (
              <button type="button" className="txp-btn txp-btn--primary" disabled={busy !== null || digits(phone) < 10} onClick={() => run("code", () => startPhoneVerification(phone), () => setStage("code"))}>
                {busy === "code" ? "Sending…" : TEXTS_COPY.sendCode}
              </button>
            ) : (
              <>
                <button type="button" className="txp-btn txp-btn--primary" disabled={busy !== null || code.length !== 6} onClick={() => run("verify", () => confirmPhoneVerification(code), () => { setStage("idle"); setCode(""); setPhone(""); })}>
                  {busy === "verify" ? "Checking…" : TEXTS_COPY.verify}
                </button>
                <button type="button" className="txp-btn" disabled={busy !== null} onClick={() => { setStage("idle"); setCode(""); }}>
                  {TEXTS_COPY.change}
                </button>
              </>
            )}
          </div>
          <p className="txp-note" data-sms-consent>
            {TEXTS_COPY.consent} <a href="/terms">{TEXTS_COPY.terms}</a> · <a href="/privacy">{TEXTS_COPY.privacy}</a>
          </p>
        </div>
      )}
      {notes}
    </Card>
  );
}
