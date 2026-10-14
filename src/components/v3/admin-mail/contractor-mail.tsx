"use client";
// THE CONTRACTOR EMAIL COMPOSER (owner, 2026-10-08: "right off the card …
// when we see that card, a free trial or he already subscribed, we can click
// and write the email from there"). One sheet for the whole console: the
// provider sits in the admin layout, and any card or row puts an
// <EmailContractorButton orgId=…/> next to the account — the signup rail's
// cards first. The sheet shows who it is (name, trade, the plan state, what
// they made), the topics that fit the account (a click writes the email at
// once), a box to say or type what to write (the browser's own dictation;
// the AI turns it into a professional email), the draft to edit, the real
// email as it will arrive, and Send — from the platform address, replies to
// the admin. lib/adminMail/compose holds every word; actions/adminMail the
// three server moves.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Mail, Mic, MicOff, Send, Sparkles, Eye, EyeOff, Check } from "lucide-react";
import { Sheet, SheetBody, SheetFoot, Note, Toggle, kx, useSheet } from "@/components/v3/admin-users/admin-kit";
import { getContractorMail, sendContractorMail, writeContractorMail, type ContractorMailView } from "@/actions/adminMail";
import { accountWords, contractorLetter, spammySubject, topicDraft, type Draft, type SentMail, type TopicKey } from "@/lib/adminMail/compose";
import s from "./contractor-mail.module.css";

/** What the card already knows, so the sheet's head is right before the read lands. */
export interface MailSeed { business?: string; ownerName?: string; ownerEmail?: string }

const Ctx = createContext<{ open: (orgId: string, seed?: MailSeed) => void } | null>(null);
/** The console's composer, or null outside the admin console. */
export function useContractorMail() {
  return useContext(Ctx);
}

type LoadState = { status: "loading" } | { status: "ok"; view: ContractorMailView } | { status: "error"; error: string };

export function ContractorMailProvider({ children }: { children: ReactNode }) {
  const sheet = useSheet();
  const [target, setTarget] = useState<{ orgId: string; seed: MailSeed; n: number } | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const seq = useRef(0);
  // The account is read from the click that opens the sheet; an answer for
  // an earlier click (the sheet reopened on someone else) is dropped.
  const fetchView = useCallback((orgId: string, n: number) => {
    setLoad({ status: "loading" });
    getContractorMail(orgId)
      .then((r) => { if (seq.current === n) setLoad(r.ok ? { status: "ok", view: r.view } : { status: "error", error: r.error }); })
      .catch(() => { if (seq.current === n) setLoad({ status: "error", error: "Couldn't read that account. Try again." }); });
  }, []);
  const open = useCallback((orgId: string, seed: MailSeed = {}) => {
    seq.current += 1;
    const n = seq.current;
    setTarget({ orgId, seed, n });
    fetchView(orgId, n);
    sheet.open();
  }, [sheet, fetchView]);
  const reload = useCallback(() => { if (target) fetchView(target.orgId, target.n); }, [target, fetchView]);
  const close = useCallback(() => sheet.close(), [sheet]);
  const value = useMemo(() => ({ open }), [open]);
  const who = target?.seed.ownerName || target?.seed.business || "the contractor";
  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet handle={sheet} wide kicker={target?.seed.business ?? "Contractor"} title={`Email ${who}`} onClose={close}>
        {target ? <Composer key={`${target.orgId}:${target.n}`} orgId={target.orgId} seed={target.seed} load={load} reload={reload} onClose={close} /> : null}
      </Sheet>
    </Ctx.Provider>
  );
}

/** The button a card or row carries. Renders nothing outside the console.
 *  `row` sets it on a line of its own at the card's foot, right-aligned;
 *  `spaced` gives it a little room above, left-aligned, in a stacked cell.
 *  Its click and its keys stop at the button, so a row that opens something
 *  of its own on click or Enter (the Users table) does not open as well. */
export function EmailContractorButton({ orgId, seed, className = "", label = "Email", row = false, spaced = false }: { orgId: string; seed?: MailSeed; className?: string; label?: string; row?: boolean; spaced?: boolean }) {
  const mail = useContractorMail();
  if (!mail) return null;
  const button = (
    <button
      type="button"
      className={`${s.cardBtn}${spaced ? ` ${s.spaced}` : ""} ${className}`}
      data-email-contractor={orgId}
      aria-label={`Email ${seed?.ownerName || seed?.business || "this contractor"}`}
      onClick={(e) => { e.stopPropagation(); mail.open(orgId, seed); }}
      // Only the keys that press it stop here; Escape still reaches the sheet.
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
    >
      <Mail size={13} aria-hidden="true" />
      {label}
    </button>
  );
  return row ? <div className={s.cardRow}>{button}</div> : button;
}

// ── Dictation: the browser's own speech recognition ───────────────────────

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type RecognitionCtor = new () => Recognition;
function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function useDictation(onFinal: (text: string) => void) {
  // The composer only ever mounts in the browser (after a click), so the check is safe at first render.
  const [supported] = useState(() => recognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError("");
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let fin = "", inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript; else inter += res[0].transcript;
      }
      if (fin.trim()) onFinal(fin.trim());
      setInterim(inter);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "The microphone is blocked — allow it in the browser's address bar, then press the mic again." : `Dictation stopped (${e.error}). Press the mic to go on, or type.`);
    };
    r.onend = () => { setListening(false); setInterim(""); rec.current = null; };
    rec.current = r;
    try { r.start(); setListening(true); } catch { setError("Dictation could not start. Type instead."); }
  }, [onFinal]);
  return { supported, listening, interim, error, start, stop };
}

// ── The composer ──────────────────────────────────────────────────────────

const EMPTY: Draft = { subject: "", body: "", cta: null };
const CLOCK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function Composer({ orgId, seed, load, reload, onClose }: { orgId: string; seed: MailSeed; load: LoadState; reload: () => void; onClose: () => void }) {
  const view = load.status === "ok" ? load.view : null;
  const loading = load.status === "loading";
  const loadError = load.status === "error" ? load.error : "";
  const [topic, setTopic] = useState<TopicKey | "custom">("custom");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [offer, setOffer] = useState(false);
  const [notes, setNotes] = useState("");
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState<{ to: string; at: string; offer: boolean } | null>(null);
  const [sentHistory, setSentHistory] = useState<SentMail[] | null>(null);
  const [offerUsed, setOfferUsed] = useState(false);
  const [preview, setPreview] = useState(false);
  const history = sentHistory ?? view?.profile.history ?? [];
  // Once a send has applied the 10%, it is not offered again from this sheet.
  const offerCan = !!view?.profile.offer.can && !offerUsed;

  const addWords = useCallback((text: string) => setNotes((cur) => (cur.trim() ? `${cur.trimEnd()} ${text}` : text)), []);
  const dict = useDictation(addWords);

  const pick = (key: TopicKey) => {
    if (!view) return;
    setTopic(key);
    setDraft(topicDraft(key, view.profile));
    setOffer(key === "offer" && offerCan);
    setSent(null); setSendError(""); setWriteError("");
  };

  const write = async () => {
    if (!view || writing) return;
    if (dict.listening) dict.stop();
    setWriting(true); setWriteError("");
    const r = await writeContractorMail({ orgId, notes, topic: topic === "custom" ? null : topic, offer: offer && offerCan }).catch(() => ({ ok: false as const, error: "Couldn't reach the AI. Try again." }));
    setWriting(false);
    if (!r.ok) { setWriteError(r.error); return; }
    setDraft((cur) => ({ ...r.draft, cta: cur.cta }));
    setSent(null); setSendError("");
  };

  const send = async () => {
    if (!view || sending) return;
    setSending(true); setSendError("");
    const r = await sendContractorMail({ orgId, topic, draft, offer: offer && offerCan }).catch(() => ({ ok: false as const, error: "The email could not be sent. Try again." }));
    setSending(false);
    if (!r.ok) { setSendError(r.error); return; }
    setSent({ to: r.to, at: r.sentAt, offer: !!r.offer });
    setSentHistory(r.history);
    if (r.offer) { setOfferUsed(true); setOffer(false); }
  };

  const p = view?.profile ?? null;
  const html = useMemo(() => {
    if (!p || !preview || !draft.subject.trim()) return "";
    const origin = typeof window === "undefined" ? "https://www.jobflex.app" : window.location.origin;
    // The unsubscribe link is signed on the server; the preview shows where it sits.
    return contractorLetter({ draft, p, offer: offer && offerCan, base: origin, sender: view?.sender ?? "The JobFlex team", unsubscribeUrl: "#unsubscribe" }).html;
  }, [p, preview, draft, offer, offerCan, view?.sender]);

  const optedOut = view?.profile.optedOut ?? null;
  const canSend = !!view && !!view.profile.owner.email && !optedOut && draft.subject.trim().length > 0 && draft.body.trim().length > 0 && !sending && !sent;
  const subjectWarning = draft.subject.trim() ? spammySubject(draft.subject) : null;
  const edit = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setSent(null); };

  return (
    <>
      <SheetBody>
        {/* WHO */}
        <section className={s.who} aria-label="The contractor">
          <div className={s.whoTop}>
            <b>{p?.owner.name || seed.ownerName || "No name on the account"}</b>
            <span className={s.mono}>{p?.owner.email ?? seed.ownerEmail ?? ""}</span>
          </div>
          {loading && !p && <div className={s.muted}>Reading the account…</div>}
          {loadError && <Note tone="danger">{loadError} <button type="button" className={s.linkBtn} onClick={reload}>Try again</button></Note>}
          {p && (
            <>
              <div className={s.facts}>
                <span className={s.fact} data-kind={p.account.kind}>{stateChip(p)}</span>
                {p.trade.name && <span className={s.fact}>{p.trade.name}</span>}
                <span className={s.fact}>Joined {DAY.format(new Date(p.joinedAt))}</span>
                <span className={s.fact}>{p.built.clients} clients · {p.built.proposals} proposals · {p.built.jobs} jobs</span>
                {p.lastSeenAt && <span className={s.fact}>Last in the app {DAY.format(new Date(p.lastSeenAt))}</span>}
                {p.internal && <span className={s.fact} data-kind="internal">Internal account</span>}
              </div>
              <div className={s.muted}>From <span className={s.mono}>{view?.from}</span> · replies go to <span className={s.mono}>{view?.replyTo}</span></div>
              {p.optedOut && <Note tone="danger">They unsubscribed from our emails on {DAY.format(new Date(p.optedOut.at))} — nothing more can be sent to them from here.</Note>}
              {history.length > 0 && (
                <ul className={s.history} aria-label="Emailed before">
                  {history.slice(0, 3).map((h) => <li key={h.at}><span className={s.mono}>{CLOCK.format(new Date(h.at))}</span> “{h.subject}”{h.offer ? " · with the 10% offer" : ""}</li>)}
                </ul>
              )}
            </>
          )}
        </section>

        {view && (
          <>
            {/* TOPICS */}
            <section className={s.block} aria-label="Ready-made topics">
              <h3 className={s.h}>Pick a topic <span>— it writes the email at once</span></h3>
              <div className={s.topics}>
                {[...view.topics].sort((a, b) => rank(view.suggested, a.key) - rank(view.suggested, b.key)).map((t) => (
                  <button key={t.key} type="button" className={s.topic} aria-pressed={topic === t.key} disabled={!t.ok} title={t.ok ? t.hint : t.reason ?? ""} onClick={() => pick(t.key)} data-topic={t.key}>
                    <b>{t.label}</b>
                    <span>{t.ok ? t.hint : t.reason}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* SAY IT */}
            <section className={s.block} aria-label="Say what to write">
              <h3 className={s.h}>Or say it <span>— speak or type the point; the AI writes it up for {view.profile.owner.firstName === "there" ? "them" : view.profile.owner.firstName}</span></h3>
              <div className={s.say}>
                <textarea
                  className={kx("in", "ta")}
                  rows={3}
                  value={notes + (dict.interim ? (notes ? " " : "") + dict.interim : "")}
                  onChange={(e) => setNotes(e.target.value)}
                  readOnly={dict.listening}
                  placeholder="e.g. thank him for signing up, ask what kind of roofs he does most, and offer to set up his prices on a call this week"
                  aria-label="What the email should say"
                  data-notes
                />
                <div className={s.sayBtns}>
                  {dict.supported && (
                    <button type="button" className={`${s.mic} ${dict.listening ? s.micOn : ""}`} aria-pressed={dict.listening} onClick={() => (dict.listening ? dict.stop() : dict.start())} data-mic>
                      {dict.listening ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
                      {dict.listening ? "Stop" : "Speak"}
                    </button>
                  )}
                  <button type="button" className={kx("btn", "btn-primary")} onClick={() => void write()} disabled={writing || notes.trim().length < 3 || !view.ai} title={view.ai ? "" : "AI writing is not configured here"} data-write>
                    <Sparkles size={14} aria-hidden="true" /> {writing ? "Writing…" : topic === "custom" ? "Write it" : "Rewrite with my words"}
                  </button>
                </div>
              </div>
              {dict.listening && <div className={s.listening} role="status"><i aria-hidden="true" /> Listening — speak naturally, press Stop when done</div>}
              {dict.error && <Note>{dict.error}</Note>}
              {!dict.supported && <div className={s.muted}>Dictation works in Chrome and Safari; here, type the point (or use your computer&apos;s own dictation).</div>}
              {!view.ai && <div className={s.muted}>AI writing is not configured on this copy — pick a topic or write the email below.</div>}
              {writeError && <Note tone="danger">{writeError}</Note>}
            </section>

            {/* THE DRAFT */}
            <section className={s.block} aria-label="The email">
              <h3 className={s.h}>The email <span>— change anything before it goes</span></h3>
              <label className={s.lbl} htmlFor="cm-subject">Subject</label>
              <input id="cm-subject" className={kx("in")} value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} maxLength={90} data-subject />
              {subjectWarning && <div className={s.warn} data-subject-warning>The subject has {subjectWarning} — spam filters read that as an ad. Plain words land in the inbox.</div>}
              <label className={s.lbl} htmlFor="cm-body">Message <span>· a blank line starts a new paragraph</span></label>
              <textarea id="cm-body" className={kx("in", "ta")} rows={9} value={draft.body} onChange={(e) => edit({ body: e.target.value })} data-body />
              <div className={s.toggles}>
                {draft.cta && <Toggle on={!!draft.cta} onChange={() => edit({ cta: null })} label={`Link: “${draft.cta.label}”`} sub="Opens the right page in their JobFlex — untick to send without it" />}
                {offerCan ? (
                  <Toggle on={offer} onChange={(v) => { setOffer(v); setSent(null); }} label="Attach 10% off for 3 months" sub={offerWords(view)} />
                ) : (
                  <div className={s.muted} data-offer-off>10% offer: {offerUsed ? "applied with the email you just sent" : view.profile.offer.can ? "" : view.profile.offer.reason}.</div>
                )}
              </div>
              {offer && offerCan && !/10%|percent/i.test(draft.body) && <Note>The offer box is on the email, but the message does not mention it — pick “10% off” or add a line about it.</Note>}
            </section>

            {preview && html && (
              <section className={s.block} aria-label="As it will arrive">
                <h3 className={s.h}>As it will arrive</h3>
                <iframe className={s.preview} title="Email preview" srcDoc={html} sandbox="" />
              </section>
            )}

            {sendError && <Note tone="danger">{sendError}</Note>}
            {sent && <Note tone="ok">Sent to {sent.to} at {CLOCK.format(new Date(sent.at))}{sent.offer ? " · the 10% is applied" : ""}.</Note>}
            {!view.live && <div className={s.muted}>This copy writes emails to its outbox folder instead of sending them.</div>}
          </>
        )}
      </SheetBody>
      <SheetFoot>
        <button type="button" className={kx("btn")} onClick={onClose}>{sent ? "Close" : "Cancel"}</button>
        <button type="button" className={kx("btn")} onClick={() => setPreview((v) => !v)} disabled={!draft.subject.trim()} data-preview>
          {preview ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {preview ? "Hide preview" : "Preview"}
        </button>
        <button type="button" className={kx("btn", "btn-primary")} onClick={() => void send()} disabled={!canSend} data-send>
          {sent ? <Check size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
          {sent ? "Sent" : sending ? "Sending…" : `Send to ${view?.profile.owner.email ?? "…"}`}
        </button>
      </SheetFoot>
    </>
  );
}

const rank = (suggested: TopicKey[], key: TopicKey) => { const i = suggested.indexOf(key); return i === -1 ? 99 : i; };

function stateChip(p: NonNullable<ContractorMailView["profile"]>): string {
  const a = p.account;
  switch (a.kind) {
    case "trialing": return `Trial · ${a.daysLeft ?? 0} ${a.daysLeft === 1 ? "day" : "days"} left · ${a.hasCard ? "card on file" : "no card"}`;
    case "paying": return `Paying · ${a.plan}${a.price ? ` ${a.price}` : ""}`;
    case "trial-ended": return `Free · trial ended${a.endedAt ? ` ${DAY.format(new Date(a.endedAt))}` : ""}`;
    case "past-due": return "Payment failed";
    case "canceled": return `Free · was ${a.plan}`;
    case "free": return "Free plan";
    default: return accountWords(p);
  }
}

function offerWords(view: ContractorMailView): string {
  const o = view.profile.offer;
  if (!o.can) return "";
  if (o.how === "winback") return o.existing ? `Their come-back offer is already running until ${DAY.format(new Date(o.until))} — the email reminds them.` : `Sending turns it on: taken off by itself when they add a card, until ${DAY.format(new Date(o.until))}.`;
  return o.yearly ? "Sending puts 10% off their next yearly charge on their Stripe subscription." : "Sending puts 10% off their next 3 monthly charges on their Stripe subscription.";
}
