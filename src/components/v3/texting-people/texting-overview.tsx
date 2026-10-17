"use client";

// TEXTING AT A GLANCE (owner, 2026-10-13: "make the texting page understandable for contractors — request the number,
// set up all the texts and for who, easy on and off"). The top of Settings → Texting on the desk and the phone: one
// sentence on what is texted right now, then the steps in order — the company's own number (nothing is texted without
// it), the team, clients, your own texts — each with where it stands and the button that goes there. Clients switch
// on and off right here.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight } from "lucide-react";

import { setClientTextsOn } from "@/actions/sms";
import type { SmsSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { TEXTING_COPY, TEXTS_COPY } from "@/components/v3/settings-blueprint/settings-data";
import s from "./texting-people.module.css";

type Tone = "ok" | "wait" | "todo" | "bad";

export function TextingOverview({ sms, clientsInline = false }: { sms: SmsSettingsData; /** No clients card on this page (the phone): step 3 keeps its switch. */ clientsInline?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const C = TEXTING_COPY;
  const reg = sms.registration;
  // JobFlex's own company: the lent JobFlex line is its number (lib/sms/houseLine, 2026-10-14).
  const approvedNumber = reg?.stage === "approved" ? reg.number : reg?.assigned?.house ? reg.assigned.number : sms.ownNumber;
  const people = sms.roster;
  const on = people.filter((r) => r.phone && !r.stopped).length;
  const off = people.filter((r) => !r.phone && (r.paused || r.stopped)).length;
  const none = people.length - on - off;

  const number: { tone: Tone; line: string; go: string } = approvedNumber
    ? { tone: "ok", line: C.numberApproved(approvedNumber), go: C.numberOpen }
    : !reg || reg.stage === "none"
      ? reg && !reg.paying
        ? { tone: "todo", line: C.numberPaidOnly, go: C.numberOpen }
        : reg?.assigned
          ? { tone: "todo", line: reg.assigned.registrable && !reg.assigned.jobflexOwn ? C.numberLentRegistrable(reg.assigned.number) : C.numberLent(reg.assigned.number), go: reg.assigned.registrable && !reg.assigned.jobflexOwn ? C.numberGoRegister : C.numberGoOwn }
          : { tone: "todo", line: C.numberNone, go: C.numberGo }
      : reg.stage === "pending"
        ? { tone: "wait", line: C.numberPending, go: C.numberOpen }
        : reg.stage === "rejected"
          ? { tone: "bad", line: C.numberRejected, go: C.numberOpen }
          : { tone: "bad", line: C.numberFailed, go: C.numberOpen };
  const status = !sms.configured ? C.notConfiguredLong : approvedNumber ? C.statusLive(approvedNumber, on, sms.clientsOn) : C.statusWaiting;

  const flipClients = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await setClientTextsOn(!sms.clientsOn);
      if (r.ok) router.refresh();
      else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // The steps' squares (sign-up's and the AI desk's): done — a tick; the first one not done — blue; the rest — outlined.
  const doneSteps = { number: number.tone === "ok", team: on > 0, clients: sms.clientsOn, rules: sms.rules.length > 0 };
  const current = (["number", "team", "clients", "rules"] as const).find((k) => !doneSteps[k]) ?? null;
  const square = (k: keyof typeof doneSteps, n: number) => (
    <span className={s.stepN} aria-hidden="true">
      {doneSteps[k] ? <Check size={15} strokeWidth={3} /> : n}
    </span>
  );
  const stateOf = (k: keyof typeof doneSteps) => (doneSteps[k] ? "done" : current === k ? "current" : "todo");
  const live = Boolean(approvedNumber && sms.configured);
  const steps: Array<{ key: keyof typeof doneSteps; n: number; title: string; line: string; target: string; go: string; tone: Tone }> = [
    { key: "number", n: 1, title: C.stepNumber, line: number.line, target: "texting-own-number", go: number.go, tone: number.tone },
    { key: "team", n: 2, title: C.stepTeam, line: C.teamLine(on, off, none), target: "texting-roster", go: C.teamGo, tone: on ? "ok" : "todo" },
    { key: "clients", n: 3, title: C.stepClients, line: C.clientsLine, target: "texting-clients", go: "", tone: sms.clientsOn ? "ok" : "todo" },
    { key: "rules", n: 4, title: C.stepRules, line: C.rulesLine(sms.rules.length), target: "texting-rules", go: C.rulesGo, tone: sms.rules.length ? "ok" : "todo" },
  ];

  return (
    <div className={s.root} data-texting-overview data-nest="">
      <p className={`${s.status}${live ? ` ${s.statusLive}` : ""}`} data-texting-status>
        {live ? <CheckCircle2 size={17} strokeWidth={2.2} aria-hidden /> : <AlertTriangle size={17} strokeWidth={2.2} aria-hidden />}
        <span>{status}</span>
      </p>
      {/* The steps are the way to their sections (owner, 2026-10-16): a tap on a step goes there. Only the current step
          — the first not done — carries its button; the others an arrow. */}
      <ol className={s.steps}>
        {steps.map((st) => {
          const state = stateOf(st.key);
          return (
            <li key={st.key} className={s.step} data-step={st.key} data-state={state} data-tone={st.tone}>
              <a
                className={s.stepLink}
                href={`#${st.target}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(st.target);
                }}
              >
                {square(st.key, st.n)}
                <span className={s.stepT}>
                  <b>{st.title}</b>
                  <span>{st.line}</span>
                </span>
                {state === "current" || (st.key === "clients" && clientsInline) ? null : <ArrowRight size={16} strokeWidth={2.2} aria-hidden className={s.stepGo} />}
              </a>
              {state !== "current" && !(st.key === "clients" && clientsInline) ? null : st.key === "clients" ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={sms.clientsOn}
                  aria-label={C.stepClients}
                  className={`${s.switch}${sms.clientsOn ? ` ${s.switchOn}` : ""}`}
                  disabled={busy}
                  onClick={() => void flipClients()}
                  data-clients-switch
                >
                  <i aria-hidden="true" />
                  <span>{sms.clientsOn ? C.switchOn : C.switchOff}</span>
                </button>
              ) : (
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => go(st.target)} data-step-go>
                  {st.go}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {err ? <p className={`${s.note} ${s.noteErr}`} role="alert">{err}</p> : null}
    </div>
  );
}

/** The clients switch on its own — the Clients card shows it with what clients get. */
export function ClientTextsSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const flip = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await setClientTextsOn(!on);
      if (r.ok) router.refresh();
      else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${s.root} ${s.inline}`} data-clients-card data-nest="">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={TEXTING_COPY.stepClients}
        className={`${s.switch}${on ? ` ${s.switchOn}` : ""}`}
        disabled={busy}
        onClick={() => void flip()}
        data-clients-switch
      >
        <i aria-hidden="true" />
        <span>{on ? TEXTING_COPY.switchOn : TEXTING_COPY.switchOff}</span>
      </button>
      {err ? <p className={`${s.note} ${s.noteErr}`} role="alert">{err}</p> : null}
    </div>
  );
}

/**
 * ON | OFF in one framed switch (the Monthly | Annual pattern, components/billing/PlanTermSwitch): a radio group,
 * the picked half filled ink. Lead texts from JobFlex on the desk and the phone (2026-10-16).
 */
export function OnOffSegment({
  on,
  label,
  onPick,
  disabled,
  onDisabled,
  wide,
}: {
  on: boolean;
  label: string;
  onPick: (next: boolean) => void;
  disabled?: boolean;
  /** "On" can't be picked (no company phone yet); "Off" still can. */
  onDisabled?: boolean;
  wide?: boolean;
}) {
  const halves = [
    { v: true, words: TEXTS_COPY.clientsOn, off: Boolean(disabled || onDisabled) },
    { v: false, words: TEXTS_COPY.clientsOff, off: Boolean(disabled) },
  ];
  return (
    <div className={`${s.seg}${wide ? ` ${s.segWide}` : ""}`} role="radiogroup" aria-label={label} data-nest="" data-on-off={on ? "on" : "off"}>
      {halves.map((h) => (
        <button
          key={String(h.v)}
          type="button"
          role="radio"
          aria-checked={on === h.v}
          tabIndex={on === h.v ? 0 : -1}
          className={`${s.segBtn}${on === h.v ? ` ${s.segOn}` : ""}`}
          disabled={h.off && on !== h.v}
          onClick={() => {
            if (on !== h.v) onPick(h.v);
          }}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              const next = !on;
              if (!(next ? disabled || onDisabled : disabled)) onPick(next);
            }
          }}
        >
          {h.words}
        </button>
      ))}
    </div>
  );
}

/** A card's description cut to its first sentence; the rest goes under "How it works". */
export function firstSentence(words: string): { lead: string; rest: string } {
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(words.trim());
  return m ? { lead: m[1], rest: m[2] } : { lead: words.trim(), rest: "" };
}

/** "How it works ▾" — what a card used to say up front, folded (2026-10-16). Renders nothing when there is nothing more. */
export function HowItWorks({ words, children }: { words?: string; children?: ReactNode }) {
  if (!words && !children) return null;
  return (
    <details className={s.how} data-nest="" data-how-it-works>
      <summary>
        <ChevronRight size={15} strokeWidth={2.4} aria-hidden className={s.exArrow} />
        How it works
      </summary>
      <div className={s.howBody}>
        {words ? <p>{words}</p> : null}
        {children}
      </div>
    </details>
  );
}
