"use client";
// STEP 4 · VOICE AND A TEST (2026-10-14): the voice (with "hear it"), the month's minutes,
// "try it" by text — three sample answers after the instructions were written, then any
// question — and "test it here" by voice (desk-test.tsx).
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { askDesk, previewDeskVoice, setDeskVoice } from "@/actions/aiDesk";
import type { DeskFaq } from "@/lib/aiDesk/profile";
import { minutesLeftWords, minutesOf, VOICE_WORDS, VOICES, type DeskVoice } from "@/lib/aiDesk/shared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { DeskTest } from "./desk-test";
import s from "./ai-desk.module.css";

export function DeskVoiceAndTest({ desk, samples }: { desk: DeskSettingsData; samples: DeskFaq[] }) {
  const router = useRouter();
  const [voice, setVoice] = useState<DeskVoice>(desk.voice);
  const [hear, setHear] = useState<"idle" | "loading" | "playing">("idle");
  const player = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState<null | "voice" | "ask">(null);
  const [err, setErr] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const used = desk.use.callSeconds + desk.use.testSeconds;

  const pickVoice = async (next: DeskVoice) => {
    if (next === voice || busy) return;
    const prev = voice;
    setVoice(next);
    setBusy("voice");
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
      setBusy(null);
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

  return (
    <div className={s.root} data-desk-voice-step>
      <div className={s.voiceRow} data-desk-voice>
        <label className={s.h} htmlFor="desk-voice">
          {C.voiceTitle}
        </label>
        <div className={s.voiceLine}>
          <select id="desk-voice" className={s.sel} value={voice} disabled={busy !== null || !desk.canManage} onChange={(e) => void pickVoice(e.target.value as DeskVoice)}>
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

      {/* try it, by text */}
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

      {/* test it here, by voice */}
      <DeskTest desk={desk} />

      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
