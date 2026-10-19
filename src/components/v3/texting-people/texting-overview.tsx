"use client";

// TEXTING AT A GLANCE (owner, 2026-10-13: "make the texting page understandable for contractors — request the number,
// set up all the texts and for who, easy on and off"). The top of Settings → Texting on the desk and the phone: one
// sentence on what is texted right now, then the steps in order — the company's own number (nothing is texted without
// it), the team, clients, your own texts — each with where it stands and the button that goes there. Clients switch
// on and off right here.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { setClientTextsOn } from "@/actions/sms";
import type { SmsSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { TEXTING_COPY } from "@/components/v3/settings-blueprint/settings-data";
import "./texting-kit.css";

export type TextingTone = "ok" | "wait" | "todo" | "bad";
type Tone = TextingTone;

/** Where texting stands, pure: the one status sentence and each step's tone and line. The Texting page's checklist
 *  (texting-page) and this overview both read it. */
export function textingSteps(sms: SmsSettingsData) {
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
  return {
    status,
    live: !!approvedNumber && sms.configured,
    number,
    team: { tone: (on ? "ok" : "todo") as Tone, line: C.teamLine(on, off, none) },
    clients: { tone: (sms.clientsOn ? "ok" : "todo") as Tone, line: C.clientsLine },
    rules: { tone: (sms.rules.length ? "ok" : "todo") as Tone, line: C.rulesLine(sms.rules.length) },
  };
}

export function TextingOverview({ sms }: { sms: SmsSettingsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const C = TEXTING_COPY;
  const { status, live, number, team, clients, rules } = textingSteps(sms);

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

  return (
    <div className="jf-tx tk-overview" data-texting-overview data-nest="">
      <p className="tk-callout" data-tone={live ? "ok" : "wait"} data-texting-status>
        {status}
      </p>
      <ol className="tk-steps">
        <li className="tk-step" data-step="number" data-tone={number.tone}>
          <span className="tk-stepN" aria-hidden="true">1</span>
          <span className="tk-stepT">
            <b>{C.stepNumber}</b>
            <span>{number.line}</span>
          </span>
          <button type="button" className={`tk-btn${number.tone === "todo" || number.tone === "bad" ? " tk-btn--primary" : ""}`} onClick={() => go("texting-own-number")}>
            {number.go}
          </button>
        </li>
        <li className="tk-step" data-step="team" data-tone={team.tone}>
          <span className="tk-stepN" aria-hidden="true">2</span>
          <span className="tk-stepT">
            <b>{C.stepTeam}</b>
            <span>{team.line}</span>
          </span>
          <button type="button" className="tk-btn" onClick={() => go("texting-roster")}>
            {C.teamGo}
          </button>
        </li>
        <li className="tk-step" data-step="clients" data-tone={clients.tone}>
          <span className="tk-stepN" aria-hidden="true">3</span>
          <span className="tk-stepT">
            <b>{C.stepClients}</b>
            <span>{clients.line}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={sms.clientsOn}
            aria-label={C.stepClients}
            className={`tk-switch${sms.clientsOn ? " is-on" : ""}`}
            disabled={busy}
            onClick={() => void flipClients()}
            data-clients-switch
          >
            <i aria-hidden="true" />
            <span>{sms.clientsOn ? C.switchOn : C.switchOff}</span>
          </button>
        </li>
        <li className="tk-step" data-step="rules" data-tone={rules.tone}>
          <span className="tk-stepN" aria-hidden="true">4</span>
          <span className="tk-stepT">
            <b>{C.stepRules}</b>
            <span>{rules.line}</span>
          </span>
          <button type="button" className="tk-btn" onClick={() => go("texting-rules")}>
            {C.rulesGo}
          </button>
        </li>
      </ol>
      {err ? <p className="tk-msg is-err" role="alert">{err}</p> : null}
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
  // The state in words beside the switch (2026-10-18): what it means right now, not only ON / OFF.
  return (
    <div className="jf-tx tk-clients" data-clients-card data-nest="">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={TEXTING_COPY.stepClients}
        className={`tk-switch${on ? " is-on" : ""}`}
        disabled={busy}
        onClick={() => void flip()}
        data-clients-switch
      >
        <i aria-hidden="true" />
        <span>{on ? TEXTING_COPY.switchOn : TEXTING_COPY.switchOff}</span>
      </button>
      <span className="tk-clientsState">{on ? TEXTING_COPY.clientsStateOn : TEXTING_COPY.clientsStateOff}</span>
      {err ? <p className="tk-msg is-err" role="alert">{err}</p> : null}
    </div>
  );
}
