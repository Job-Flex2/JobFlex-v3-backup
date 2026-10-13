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
import s from "./texting-people.module.css";

type Tone = "ok" | "wait" | "todo" | "bad";

export function TextingOverview({ sms }: { sms: SmsSettingsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const C = TEXTING_COPY;
  const reg = sms.registration;
  const approvedNumber = reg?.stage === "approved" ? reg.number : sms.ownNumber;
  const people = sms.roster;
  const on = people.filter((r) => r.phone && !r.stopped).length;
  const off = people.filter((r) => !r.phone && (r.paused || r.stopped)).length;
  const none = people.length - on - off;

  const number: { tone: Tone; line: string; go: string } = approvedNumber
    ? { tone: "ok", line: C.numberApproved(approvedNumber), go: C.numberOpen }
    : !reg || reg.stage === "none"
      ? reg && !reg.paying
        ? { tone: "todo", line: C.numberPaidOnly, go: C.numberOpen }
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

  return (
    <div className={s.root} data-texting-overview>
      <p className={`${s.status}${approvedNumber && sms.configured ? ` ${s.statusLive}` : ""}`} data-texting-status>
        {status}
      </p>
      <ol className={s.steps}>
        <li className={s.step} data-step="number" data-tone={number.tone}>
          <span className={s.stepN} aria-hidden="true">1</span>
          <span className={s.stepT}>
            <b>{C.stepNumber}</b>
            <span>{number.line}</span>
          </span>
          <button type="button" className={`${s.btn}${number.tone === "todo" || number.tone === "bad" ? ` ${s.btnPrimary}` : ""}`} onClick={() => go("texting-own-number")}>
            {number.go}
          </button>
        </li>
        <li className={s.step} data-step="team" data-tone={on ? "ok" : "todo"}>
          <span className={s.stepN} aria-hidden="true">2</span>
          <span className={s.stepT}>
            <b>{C.stepTeam}</b>
            <span>{C.teamLine(on, off, none)}</span>
          </span>
          <button type="button" className={s.btn} onClick={() => go("texting-roster")}>
            {C.teamGo}
          </button>
        </li>
        <li className={s.step} data-step="clients" data-tone={sms.clientsOn ? "ok" : "todo"}>
          <span className={s.stepN} aria-hidden="true">3</span>
          <span className={s.stepT}>
            <b>{C.stepClients}</b>
            <span>{C.clientsLine}</span>
          </span>
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
        </li>
        <li className={s.step} data-step="rules" data-tone={sms.rules.length ? "ok" : "todo"}>
          <span className={s.stepN} aria-hidden="true">4</span>
          <span className={s.stepT}>
            <b>{C.stepRules}</b>
            <span>{C.rulesLine(sms.rules.length)}</span>
          </span>
          <button type="button" className={s.btn} onClick={() => go("texting-rules")}>
            {C.rulesGo}
          </button>
        </li>
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
    <div className={`${s.root} ${s.inline}`} data-clients-card>
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
