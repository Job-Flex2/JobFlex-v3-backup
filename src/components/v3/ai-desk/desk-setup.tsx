"use client";
// THE AI DESK, set up by its owner (2026-10-13) — two pieces for the desk's Settings →
// AI desk pane and the handheld settings page:
//   DeskStatus  the company's number and who answers (the desk, or the company phone first)
//   DeskSetup   "tell us about your company" (typed or spoken) → the desk's instructions,
//               editable section by section, the questions it still has, "try it" by text,
//               and "test it here" by voice (desk-test.tsx)
// The status card also picks the desk's voice (with "hear it") and shows the month's minutes.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { askDesk, composeDeskProfile, previewDeskVoice, saveDeskProfile, setDeskMode, setDeskVoice } from "@/actions/aiDesk";
import { DictateButton } from "@/components/estimator/DictateButton";
import { PROFILE_SECTIONS, profileFromFacts, type DeskFaq, type DeskProfile } from "@/lib/aiDesk/profile";
import { minutesLeftWords, minutesOf, VOICE_WORDS, VOICES, type DeskMode, type DeskVoice } from "@/lib/aiDesk/shared";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { DeskTest } from "./desk-test";
import s from "./ai-desk.module.css";

export function DeskStatus({ desk, registration, onNumber }: { desk: DeskSettingsData; registration: SmsRegistrationView | null; onNumber?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<DeskMode>(desk.mode);
  const [voice, setVoice] = useState<DeskVoice>(desk.voice);
  const [hear, setHear] = useState<"idle" | "loading" | "playing">("idle");
  const player = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The number it bought, else the line JobFlex assigned to it (calls only; texting keeps its own).
  // A registration without a number (none started, or still being filed) says nothing about calls.
  const number = registration?.number ?? desk.assigned?.number ?? null;
  const calls = registration?.number ? registration.calls : desk.assigned ? { on: true, go: desk.assigned.go, phone: desk.assigned.phone } : (registration?.calls ?? null);
  const pickVoice = async (next: DeskVoice) => {
    if (next === voice || busy) return;
    const prev = voice;
    setVoice(next);
    setBusy(true);
    setErr("");
    try {
      const r = await setDeskVoice(next);
      if (r.ok) router.refresh();
      else {
        setVoice(prev);
        setErr(r.error);
      }
    } catch {
      setVoice(prev);
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const hearIt = async () => {
    if (hear !== "idle") return;
    setHear("loading");
    setErr("");
    try {
      const r = await previewDeskVoice(voice);
      if (!r.ok) {
        setErr(r.error);
        setHear("idle");
        return;
      }
      player.current?.pause();
      const a = new Audio(`data:audio/mpeg;base64,${r.mp3}`);
      player.current = a;
      a.onended = () => setHear("idle");
      a.onerror = () => setHear("idle");
      setHear("playing");
      await a.play();
    } catch {
      setErr("Couldn't play the voice here.");
      setHear("idle");
    }
  };
  const used = desk.use.callSeconds + desk.use.testSeconds;
  const flip = async (next: DeskMode) => {
    if (next === mode || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await setDeskMode(next);
      if (r.ok) {
        setMode(next);
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${s.root} ${s.status}`} data-desk-status data-mode={mode}>
      <div className={s.statusLine}>
        {number ? (
          <>
            <b>{number}</b>
            <span className={s.note}>{calls?.on ? (calls.go === "assistant" ? C.callsDesk : calls.go === "phone" ? C.callsPhone(calls.phone ?? "") : C.callsNone) : C.callsOff}</span>
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
      <div className={s.modes} role="group" aria-label={C.whoAnswers}>
        <button type="button" className={s.mode} aria-pressed={mode === "ANSWER"} disabled={busy || !desk.canManage} onClick={() => flip("ANSWER")} data-mode-btn="ANSWER">
          <b>{C.modeAnswer}</b>
          <span>{C.modeAnswerSub}</span>
        </button>
        <button type="button" className={s.mode} aria-pressed={mode === "FORWARD"} disabled={busy || !desk.canManage} onClick={() => flip("FORWARD")} data-mode-btn="FORWARD">
          <b>{C.modeForward}</b>
          <span>{C.modeForwardSub(calls?.phone ?? desk.facts.phone ?? "")}</span>
        </button>
      </div>
      {/* the voice, and the month's minutes */}
      <div className={s.voiceRow} data-desk-voice>
        <label className={s.h} htmlFor="desk-voice">
          {C.voiceTitle}
        </label>
        <div className={s.voiceLine}>
          <select id="desk-voice" className={s.sel} value={voice} disabled={busy || !desk.canManage} onChange={(e) => void pickVoice(e.target.value as DeskVoice)}>
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v} — {VOICE_WORDS[v]}
              </option>
            ))}
          </select>
          <button type="button" className={s.btn} disabled={hear !== "idle" || !desk.aiConfigured} onClick={() => void hearIt()} data-desk-hear>
            {hear === "loading" ? C.hearing : hear === "playing" ? C.playing : C.hear}
          </button>
        </div>
        <p className={s.note} data-desk-minutes>
          {desk.use.calls || desk.use.tests ? C.minutes(minutesOf(used), desk.use.calls, desk.use.tests) : C.minutesNone} · {minutesLeftWords(desk.minutes.balance)}
        </p>
      </div>
      {err ? <p className={`${s.note} ${s.noteErr}`} role="alert">{err}</p> : null}
    </div>
  );
}

const asLines = (xs: string[]) => xs.join("\n");
const fromLines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

export function DeskSetup({ desk }: { desk: DeskSettingsData }) {
  const router = useRouter();
  const [brief, setBrief] = useState(desk.brief);
  const [profile, setProfile] = useState<DeskProfile>(desk.profile ?? profileFromFacts(desk.facts));
  const [written, setWritten] = useState(Boolean(desk.profile));
  const [questions, setQuestions] = useState<string[]>(desk.questions);
  const [samples, setSamples] = useState<DeskFaq[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "compose" | "save" | "ask">(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const set = <K extends keyof DeskProfile>(k: K, v: DeskProfile[K]) => {
    setProfile((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  const compose = async () => {
    setBusy("compose");
    setNote("");
    setErr("");
    try {
      const r = await composeDeskProfile(brief);
      if (r.ok) {
        setProfile(r.profile);
        setQuestions(r.questions);
        setSamples(r.samples);
        setWritten(true);
        setDirty(false);
        setNote(r.note ?? "Written.");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setNote("");
    setErr("");
    try {
      const r = await saveDeskProfile(profile);
      if (r.ok) {
        setQuestions(r.questions);
        setWritten(true);
        setDirty(false);
        setNote(r.note ?? "Saved.");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const ask = async () => {
    setBusy("ask");
    setErr("");
    setAnswer("");
    try {
      const r = await askDesk(question);
      if (r.ok) setAnswer(r.answer);
      else setErr(r.error);
    } catch {
      setErr("Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const facts = [desk.facts.name, ...desk.facts.trades, desk.facts.city ?? "", desk.facts.hoursWords, ...desk.facts.services.slice(0, 4), desk.facts.phone ?? ""].filter(Boolean);

  return (
    <div className={s.root} data-desk-setup data-written={written ? "1" : "0"}>
      {/* 1 · the brief */}
      <div className={s.sec}>
        <div className={s.h}>{C.briefTitle}</div>
        <p className={s.note}>{C.briefSub}</p>
        {facts.length ? (
          <div className={s.facts} aria-label={C.knownAlready}>
            {facts.map((f) => (
              <span key={f} className={s.fact}>
                {f}
              </span>
            ))}
          </div>
        ) : null}
        <textarea className={s.area} value={brief} placeholder={C.briefPlaceholder} aria-label={C.briefTitle} disabled={!desk.canManage} onChange={(e) => setBrief(e.target.value)} data-desk-brief />
        <DictateButton id="deskBriefDictate" label={C.speak} value={brief} onChange={setBrief} wrapClassName={s.dictate} buttonClassName={s.btn} onClassName={s.dictateOn} noteClassName={s.dictateNote} iconClassName={s.ic} />
        <div className={s.acts}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || !desk.canManage || !desk.aiConfigured} onClick={() => void compose()} data-desk-compose>
            {busy === "compose" ? C.composing : written ? C.recompose : C.compose}
          </button>
          {!desk.aiConfigured ? <span className={`${s.note} ${s.noteErr}`}>{C.aiOff}</span> : null}
        </div>
      </div>

      {questions.length ? (
        <div className={s.qs} data-desk-questions>
          <b>{C.questionsTitle}</b>
          <ul>
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 2 · the instructions, section by section */}
      <div className={s.sections} data-desk-profile>
        <div className={s.h}>{written ? C.profileTitle : C.profileTitleDraft}</div>
        <p className={s.note}>{written ? C.profileSub : C.profileSubDraft}</p>
        {PROFILE_SECTIONS.map((sec) => (
          <div key={sec.key} className={s.sec} data-section={sec.key}>
            <div className={s.secHead}>
              <label className={s.h} htmlFor={`desk-${sec.key}`}>
                {sec.label}
              </label>
              <span className={s.secHint}>{sec.hint}</span>
            </div>
            {sec.kind === "faq" ? (
              <div className={s.faqs}>
                {profile.faqs.map((f, i) => (
                  <div key={i} className={s.faq}>
                    <input className={s.in} value={f.q} placeholder="Question" aria-label={`Question ${i + 1}`} disabled={!desk.canManage} onChange={(e) => set("faqs", profile.faqs.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} />
                    <input className={s.in} value={f.a} placeholder="The desk's answer" aria-label={`Answer ${i + 1}`} disabled={!desk.canManage} onChange={(e) => set("faqs", profile.faqs.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))} />
                    <button type="button" className={s.x} aria-label={`Remove question ${i + 1}`} disabled={!desk.canManage} onClick={() => set("faqs", profile.faqs.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  </div>
                ))}
                <div className={s.acts}>
                  <button type="button" className={s.btn} disabled={!desk.canManage || profile.faqs.length >= 12} onClick={() => set("faqs", [...profile.faqs, { q: "", a: "" }])}>
                    {C.addFaq}
                  </button>
                </div>
              </div>
            ) : sec.kind === "list" ? (
              <textarea id={`desk-${sec.key}`} className={s.area} style={{ minHeight: 76 }} value={asLines(profile[sec.key] as string[])} disabled={!desk.canManage} onChange={(e) => set(sec.key, fromLines(e.target.value) as never)} />
            ) : sec.kind === "long" ? (
              <textarea id={`desk-${sec.key}`} className={s.area} style={{ minHeight: 76 }} value={profile[sec.key] as string} disabled={!desk.canManage} onChange={(e) => set(sec.key, e.target.value as never)} />
            ) : (
              <input id={`desk-${sec.key}`} className={s.in} value={profile[sec.key] as string} disabled={!desk.canManage} onChange={(e) => set(sec.key, e.target.value as never)} />
            )}
          </div>
        ))}
        <div className={s.acts}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || !desk.canManage || (!dirty && written)} onClick={() => void save()} data-desk-save>
            {busy === "save" ? C.saving : C.save}
          </button>
          {dirty ? <span className={s.note}>{C.unsaved}</span> : null}
        </div>
      </div>

      {/* 3 · try it */}
      <div className={s.sec} data-desk-try>
        <div className={s.h}>{C.tryTitle}</div>
        <p className={s.note}>{C.trySub}</p>
        {samples.length ? (
          <div className={s.samples} data-desk-samples>
            {samples.map((x) => (
              <div key={x.q} className={s.sample}>
                <b>{x.q}</b>
                <span>{x.a}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className={s.tryRow}>
          <input
            className={s.in}
            value={question}
            placeholder={C.tryPlaceholder}
            aria-label={C.tryTitle}
            disabled={!desk.aiConfigured}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && question.trim()) void ask();
            }}
            data-desk-question
          />
          <button type="button" className={s.btn} disabled={busy !== null || !desk.aiConfigured || question.trim().length < 2} onClick={() => void ask()} data-desk-ask>
            {busy === "ask" ? C.asking : C.ask}
          </button>
        </div>
        {answer ? (
          <div className={s.answer} data-desk-answer>
            {answer}
            <small>{C.answerTag}</small>
          </div>
        ) : null}
      </div>

      {/* 4 · test it here, by voice */}
      <DeskTest desk={desk} />

      {note ? <p className={`${s.note} ${s.noteOk}`} role="status">{note}</p> : null}
      {err ? <p className={`${s.note} ${s.noteErr}`} role="alert">{err}</p> : null}
    </div>
  );
}
