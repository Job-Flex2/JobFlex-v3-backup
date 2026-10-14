"use client";
// STEP 2 · TELL THE DESK ABOUT YOUR COMPANY (2026-10-14): a brief, typed or spoken →
// "write the instructions" (actions/aiDesk composeDeskProfile) → the desk's instructions,
// readable at a glance and editable line by line, with the questions it still has.
// The try-it box and the test moved to step 4 (desk-voice.tsx); the numbers to step 1.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { composeDeskProfile, saveDeskProfile } from "@/actions/aiDesk";
import { DictateButton } from "@/components/estimator/DictateButton";
import { PROFILE_SECTIONS, profileFromFacts, type DeskFaq, type DeskProfile } from "@/lib/aiDesk/profile";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

const asLines = (xs: string[]) => xs.join("\n");
const fromLines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

export function DeskBrief({ desk, onWritten }: { desk: DeskSettingsData; onWritten?: (samples: DeskFaq[]) => void }) {
  const router = useRouter();
  const [brief, setBrief] = useState(desk.brief);
  const [profile, setProfile] = useState<DeskProfile>(desk.profile ?? profileFromFacts(desk.facts));
  const [written, setWritten] = useState(Boolean(desk.profile));
  const [questions, setQuestions] = useState<string[]>(desk.questions);
  // Written instructions open folded (a glance, not twelve fields); a draft stays open so it can be edited at once.
  const [showDetails, setShowDetails] = useState(!desk.profile);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "compose" | "save">(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

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
        setWritten(true);
        setDirty(false);
        setNote(r.note ?? "Written.");
        onWritten?.(r.samples);
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

  const facts = [desk.facts.name, ...desk.facts.trades, desk.facts.city ?? "", desk.facts.hoursWords, ...desk.facts.services.slice(0, 4), desk.facts.phone ?? ""].filter(Boolean);

  return (
    <div className={s.root} data-desk-setup data-written={written ? "1" : "0"}>
      {/* 1 · the brief */}
      <div className={s.sec}>
        <div className={s.h}>{C.briefTitleShort}</div>
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
        <textarea className={s.area} value={brief} placeholder={C.briefPlaceholder} aria-label={C.briefTitleShort} disabled={!desk.canManage} onChange={(e) => setBrief(e.target.value)} data-desk-brief />
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

      {/* 2 · the instructions, section by section — folded once written */}
      <div className={s.sections} data-desk-profile data-open={showDetails ? "1" : "0"}>
        <div className={s.secHead}>
          <div>
            <div className={s.h}>{written ? C.profileTitle : C.profileTitleDraft}</div>
            <p className={s.note}>{written ? C.profileSub : C.profileSubDraft}</p>
          </div>
          <button type="button" className={s.btn} onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails} data-desk-details>
            {showDetails ? C.hideDetails : C.showDetails}
          </button>
        </div>
        {!showDetails ? (
          <div className={s.glance} data-desk-glance>
            <p>
              <b>Greeting.</b> {profile.greeting || "—"}
            </p>
            {profile.about ? (
              <p>
                <b>About.</b> {profile.about}
              </p>
            ) : null}
            {profile.services.length ? (
              <p>
                <b>Services.</b> {profile.services.join(" · ")}
              </p>
            ) : null}
            {profile.hours ? (
              <p>
                <b>Hours.</b> {profile.hours}
              </p>
            ) : null}
            {profile.pricing ? (
              <p>
                <b>Prices.</b> {profile.pricing}
              </p>
            ) : null}
            {profile.faqs.length ? (
              <p>
                <b>Callers ask.</b> {profile.faqs.map((f) => f.q).join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className={s.fields} hidden={!showDetails}>
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
        </div>
        <div className={s.acts}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || !desk.canManage || (!dirty && written)} onClick={() => void save()} data-desk-save>
            {busy === "save" ? C.saving : C.save}
          </button>
          {dirty ? <span className={s.note}>{C.unsaved}</span> : null}
        </div>
      </div>

      {note ? <p className={`${s.note} ${s.noteOk}`} role="status">{note}</p> : null}
      {err ? <p className={`${s.note} ${s.noteErr}`} role="alert">{err}</p> : null}
    </div>
  );
}
