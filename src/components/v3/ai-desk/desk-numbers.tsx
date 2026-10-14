"use client";
// STEP 1 · YOUR NUMBERS (2026-10-14): the desk's number, the business phone customers
// already call, how the two meet (give out the desk's number, or forward the business
// phone at the carrier — all calls, or only the missed ones), and who picks up.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { setBusinessPhone, setDeskForwarding, setDeskMode } from "@/actions/aiDesk";
import { callsGo, type DeskForwarding, type DeskMode } from "@/lib/aiDesk/shared";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

export function DeskNumbers({ desk, registration, onNumber }: { desk: DeskSettingsData; registration: SmsRegistrationView | null; onNumber?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<DeskMode>(desk.mode);
  const [forwarding, setForwarding] = useState<DeskForwarding>(desk.forwarding);
  const [phone, setPhone] = useState(desk.businessPhone ?? "");
  const [savedPhone, setSavedPhone] = useState(desk.businessPhone ?? "");
  const [busy, setBusy] = useState<null | "mode" | "forward" | "phone">(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  // The number it bought, else the line JobFlex assigned to it (calls only; texting keeps its own).
  const number = registration?.number ?? desk.assigned?.number ?? null;
  const callsOn = registration?.number ? Boolean(registration.calls?.on) : Boolean(desk.assigned);
  const go = callsGo({ mode, assistantOnPlan: desk.assistantOnPlan, companyPhone: forwarding === "all" ? null : savedPhone || null });
  const callsWords = !number ? C.noNumber : !callsOn ? C.callsOff : go === "assistant" ? C.callsDesk : go === "phone" ? C.callsPhone(savedPhone) : C.callsNone;

  const flip = async (next: DeskMode) => {
    if (next === mode || busy) return;
    setBusy("mode");
    setErr("");
    setNote("");
    try {
      const r = await setDeskMode(next);
      if (r.ok) {
        setMode(next);
        setNote(r.note ?? "");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const pickForwarding = async (next: DeskForwarding) => {
    if (next === forwarding || busy) return;
    const prev = forwarding;
    setForwarding(next);
    setBusy("forward");
    setErr("");
    setNote("");
    try {
      const r = await setDeskForwarding(next);
      if (r.ok) {
        if (next === "all") setMode("ANSWER");
        setNote(r.note ?? "");
        router.refresh();
      } else {
        setForwarding(prev);
        setErr(r.error);
      }
    } catch {
      setForwarding(prev);
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const savePhone = async () => {
    if (busy) return;
    setBusy("phone");
    setErr("");
    setNote("");
    try {
      const r = await setBusinessPhone(phone);
      if (r.ok) {
        setSavedPhone(r.phone ?? "");
        setPhone(r.phone ?? "");
        setNote(r.note ?? "");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const opts: Array<{ key: DeskForwarding; title: string; sub: string }> = [
    { key: "none", title: C.forwardNone, sub: C.forwardNoneSub(number ?? "the desk's number") },
    { key: "missed", title: C.forwardMissed, sub: C.forwardMissedSub(number ?? "the desk's number") },
    { key: "all", title: C.forwardAll, sub: C.forwardAllSub(number ?? "the desk's number") },
  ];

  return (
    <div className={`${s.root} ${s.status}`} data-desk-status data-mode={mode} data-forwarding={forwarding}>
      {/* the desk's number */}
      <div className={s.sec}>
        <div className={s.h}>{C.deskNumberTitle}</div>
        <div className={s.statusLine}>
          {number ? (
            <>
              <b>{number}</b>
              <span className={s.note}>{callsWords}</span>
            </>
          ) : (
            <>
              <span className={s.note}>{C.noNumber}</span>
              {onNumber ? (
                <button type="button" className={s.btn} onClick={onNumber}>
                  {C.getNumber}
                </button>
              ) : (
                <a className={s.btn} href="/dashboard/settings?tab=texting#texting-own-number">{C.getNumber}</a>
              )}
            </>
          )}
        </div>
        {!desk.assistantOnPlan ? <p className={`${s.note} ${s.noteErr}`}>{C.notOnPlan}</p> : null}
      </div>

      {/* the business phone */}
      <div className={s.sec}>
        <div className={s.h}>{C.businessTitle}</div>
        <p className={s.note}>{C.businessSub}</p>
        <div className={s.tryRow}>
          <input className={s.in} value={phone} placeholder={C.businessPlaceholder} aria-label={C.businessTitle} inputMode="tel" disabled={!desk.canManage || busy === "phone"} onChange={(e) => setPhone(e.target.value)} data-desk-business-phone />
          <button type="button" className={s.btn} disabled={!desk.canManage || busy !== null || phone.trim() === savedPhone} onClick={() => void savePhone()} data-desk-business-save>
            {busy === "phone" ? C.saving : C.businessSave}
          </button>
        </div>
      </div>

      {/* how customers reach the desk */}
      <div className={s.sec} role="radiogroup" aria-label={C.forwardTitle}>
        <div className={s.h}>{C.forwardTitle}</div>
        {!number ? <p className={s.note}>{C.forwardNeedsNumber}</p> : null}
        <div className={s.radios}>
          {opts.map((o) => (
            <label key={o.key} className={`${s.radio} ${forwarding === o.key ? s.radioOn : ""}`} data-forward-opt={o.key}>
              <input type="radio" name="desk-forwarding" value={o.key} checked={forwarding === o.key} disabled={!desk.canManage || !number || busy !== null} onChange={() => void pickForwarding(o.key)} />
              <span>
                <b>{o.title}</b>
                <span className={s.note}>{o.sub}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* who answers */}
      <div className={s.sec}>
        <div className={s.h}>{C.whoAnswers}</div>
        <div className={s.modes} role="group" aria-label={C.whoAnswers}>
          <button type="button" className={s.mode} aria-pressed={mode === "ANSWER"} disabled={busy !== null || !desk.canManage} onClick={() => void flip("ANSWER")} data-mode-btn="ANSWER">
            <b>{C.modeAnswer}</b>
            <span>{C.modeAnswerSub}</span>
          </button>
          <button type="button" className={s.mode} aria-pressed={mode === "FORWARD"} disabled={busy !== null || !desk.canManage || forwarding === "all" || !savedPhone} onClick={() => void flip("FORWARD")} data-mode-btn="FORWARD">
            <b>{C.modeForward}</b>
            <span>{forwarding === "all" ? C.modeForwardOff : C.modeForwardSub(savedPhone)}</span>
          </button>
        </div>
      </div>

      {note ? (
        <p className={`${s.note} ${s.noteOk}`} role="status">
          {note}
        </p>
      ) : null}
      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
