"use client";

// MOBILE AI DESK — /mobile-ai-desk-v1 (the handheld build of Automation → AI desk).
//
// The desktop desk (/dashboard/phone: DeskWorkspaceHeader → DeskSteps, plus the call log in
// phone-blueprint) re-composed for a phone. Same loader (app/dashboard/phone/load-phone +
// loadDeskWorkspace), same actions, same copy — nothing here is a fixture.
//
//   · STATUS FIRST. One framed block answers "is the desk answering my number right now?":
//     deskOverview()'s status words in their tone (or the forwarding warning), the desk's number
//     with Copy, and "Get your number" when there is none.
//   · The desk's figures: minutes left (opens Minutes), calls this month, the voice.
//   · Two tabs, as on the desk: Calls | AI desk setup (`?tab=settings`, as the desktop links use).
//     Without desk settings (a role that does not manage the desk) the status is the phone
//     loader's desk line (deskStripWords) — the desktop stopped drawing that line on 2026-10-16.
//   · CALLS: the Twilio banner when unconfigured, the four figures, search + filter (a bottom sheet over the desktop's
//     chip rail), the log as a feed under day rules, and the call as a bottom sheet — recording,
//     what the desk did (and the visit it booked), summary, transcript, Call back, Create / Open lead.
//   · SETUP: progress, the four steps + Minutes as a list, the one next thing to do. A step opens
//     as its own screen (drill-in, `?step=`, the phone's Back closes it) holding the desk's OWN step
//     component — DeskNumbers, DeskBrief, DeskBooking (+ DeskHours), DeskVoiceAndTest (+ DeskTest),
//     DeskMinutes — so every control, state and write is the desktop's. Every step stays mounted, so
//     what is typed in one survives a look at another (the desktop's rule).
//
// The step components keep their own stylesheet (ai-desk.module.css, which already carries a ≤768px
// block); they sit inside `.desk[data-nest]` so this page's reset steps around them. Everything this
// page draws itself is in the PLAIN mobile-ai-desk.css under the one root class `.jf-mobile-ai-desk`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  ListFilter,
  Mic,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Search,
  Target,
  Timer,
  X,
} from "lucide-react";

import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { createLeadFromCall } from "@/actions/aiPhoneCalls";
import type { PhoneProps } from "@/app/dashboard/phone/load-phone";
import {
  KIND_LABEL,
  actionError,
  counterparty,
  dayGroup,
  fmtDur,
  kindOf,
  matchesQuery,
  telHref,
  type Kind,
} from "@/app/(mobile)/mobile-phone-v2/phone-data";
import { deskStripWords, type Call } from "@/components/v3/phone-blueprint/phone-data";
import { DESK_COPY as C } from "@/components/v3/settings-blueprint/settings-data";
import type { DeskFaq } from "@/lib/aiDesk/profile";
import { deskOverview, SETUP_TABS, type DeskTab, type TabState } from "@/components/v3/ai-desk/desk-overview";
import { DeskNumbers } from "@/components/v3/ai-desk/desk-numbers";
import { DeskBrief } from "@/components/v3/ai-desk/desk-brief";
import { DeskBooking } from "@/components/v3/ai-desk/desk-booking";
import { DeskVoiceAndTest } from "@/components/v3/ai-desk/desk-voice";
import { DeskMinutes } from "@/components/v3/ai-desk/desk-minutes";
import desk$ from "@/components/v3/ai-desk/ai-desk.module.css";
import "./mobile-ai-desk.css";

export type MobileAiDeskProps = PhoneProps;

/* ── the desk's own vocabulary (DESK_COPY), the same table DeskSteps draws from ── */
const TABS: DeskTab[] = ["numbers", "business", "booking", "voice", "minutes"];
const META: Record<DeskTab, { title: string; sub: string; Icon: typeof Phone }> = {
  numbers: { title: C.tabNumbers, sub: C.step1Sub, Icon: Phone },
  business: { title: C.tabBusiness, sub: C.step2Sub, Icon: Building2 },
  booking: { title: C.tabBooking, sub: C.step3Sub, Icon: CalendarDays },
  voice: { title: C.tabVoice, sub: C.step4Sub, Icon: Mic },
  minutes: { title: C.minutesTitle, sub: C.minutesSub, Icon: Timer },
};
/** Under this many minutes the figure turns amber — DeskSteps' FEW_MINUTES. */
const FEW_MINUTES = 50;
const isTab = (v: string | null | undefined): v is DeskTab => !!v && (TABS as string[]).includes(v);

/** A step's state in the list — DeskSteps' stepState, the same rule. */
function stepState(k: (typeof SETUP_TABS)[number], done: boolean, tab: TabState): TabState {
  if (done) return { tone: "done", words: C.stepDone };
  if (k === "numbers" && tab.tone === "check") return { tone: "check", words: C.checkThis };
  if (tab.tone === "check" || tab.tone === "warn") return tab;
  if (k === "voice") return tab;
  return { tone: "todo", words: C.stepTodo };
}

/* ── the call log's words. phone-behavior.ts (the desktop log) builds its strings inline in an
   imperative module and exports none, so they are mirrored here verbatim, not reworded. ── */
const LOG = {
  tabCalls: "Calls",
  tabSettings: "AI desk setup",
  stats: [
    { k: "today", l: "Calls today" },
    { k: "week", l: "Calls · 7d" },
    { k: "leads", l: "Auto-leads · 7d" },
    { k: "deskMinutes", l: "Desk minutes · month" },
  ] as const,
  filters: [
    { k: "ALL", l: "All" },
    { k: "INBOUND", l: "Inbound" },
    { k: "OUTBOUND", l: "Outbound" },
    { k: "LEADS", l: "Became leads" },
    { k: "DESK", l: "AI desk" },
  ],
  logTitle: "Call log",
  emptyT: "No calls yet",
  emptyOn: "Your number is connected. The first inbound call will land here, transcribed and summarized.",
  emptyOff: "Wire up your number to the webhook above to start auto-capturing inbound calls as leads.",
  noMatchT: "No matches",
  noMatchS: "No call matches that search and filter.",
  clear: "Clear filters",
  search: "Search number, summary or transcript…",
  noSummaryRow: "No transcript yet",
  callFrom: (n: string) => `Call from ${n}`,
  recording: "Recording",
  recordingOff: "Recording unavailable",
  theDesk: "The AI desk",
  deskFailed: (err: string | null) => `The desk couldn't take this call${err ? `: ${err}` : ""} — the caller was asked to leave a message.`,
  deskDid: (label: string, dur: string) => `The desk ${label} and was on the line ${dur}.`,
  openVisit: (when: string) => `Open the visit · ${when}`,
  summary: "Call summary",
  noSummary: "No summary yet — it is written once the recording finishes processing.",
  transcript: "Transcript",
  noTranscript: "No transcript yet — it is posted once the recording completes.",
  who: (w: string) => (w === "desk" ? "AI desk" : w === "agent" ? "Shop" : "Caller"),
  createLead: "Create lead",
  creating: "Creating…",
  openLead: "Open lead",
  callBack: "Call back",
  lead: "lead",
  aiDesk: "AI desk",
  cfgT: "Twilio isn’t configured",
  deskSettingsFail: "Desk settings could not be loaded. Refresh to try again.",
};

const KIND_ICON: Record<Kind, typeof Phone> = { in: PhoneIncoming, out: PhoneOutgoing, missed: PhoneMissed, live: PhoneCall };

function matchesLogFilter(c: Call, f: string): boolean {
  if (f === "LEADS") return Boolean(c.lead);
  if (f === "DESK") return Boolean(c.desk);
  if (f === "INBOUND" || f === "OUTBOUND") return c.dir === f;
  return true;
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const copy = useCallback((text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      } catch {
        setCopied(false);
      }
    })();
  }, []);
  return [copied, copy];
}

export function MobileAiDesk({ entries, stats, webhookUrl, twilioConfigured, desk: strip, deskSettings }: MobileAiDeskProps) {
  const router = useRouter();
  const search = useSearchParams();
  const desk = deskSettings?.desk ?? null;
  const registration = deskSettings?.registration ?? null;
  const scrollRef = useRef<HTMLElement>(null);

  /* ── where the page opens: the desktop's own address words (?tab=settings, ?step=, ?pack_paid=) ── */
  const [tab, setTab] = useState<"calls" | "setup">(() => {
    const step = search?.get("step");
    return search?.get("tab") === "settings" || isTab(step) || search?.get("pack_paid") || search?.get("pack_checkout") ? "setup" : "calls";
  });
  const [view, setView] = useState<DeskTab | null>(() => {
    const step = search?.get("step");
    if (isTab(step)) return step;
    if (search?.get("pack_paid") || search?.get("pack_checkout")) return "minutes";
    return null;
  });
  const pushed = useRef(false);
  const listScroll = useRef(0);
  /** The row a step was opened from, for focus on the way back. */
  const lastStep = useRef<string | null>(null);

  const writeUrl = useCallback((t: "calls" | "setup", v: DeskTab | null, push: boolean) => {
    try {
      const u = new URL(window.location.href);
      if (t === "setup") u.searchParams.set("tab", "settings");
      else u.searchParams.delete("tab");
      if (v) u.searchParams.set("step", v);
      else u.searchParams.delete("step");
      if (push) window.history.pushState(null, "", u.toString());
      else window.history.replaceState(null, "", u.toString());
    } catch {
      /* the view still changes */
    }
  }, []);

  const pickTab = (t: "calls" | "setup") => {
    if (t === tab) return;
    setTab(t);
    writeUrl(t, null, false);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const openView = useCallback(
    (k: DeskTab) => {
      if (scrollRef.current && view === null) listScroll.current = scrollRef.current.scrollTop;
      lastStep.current = k === "minutes" ? "minutes-row" : k;
      setTab("setup");
      setView(k);
      writeUrl("setup", k, view === null);
      if (view === null) pushed.current = true;
    },
    [view, writeUrl],
  );
  const closeView = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    setView(null);
    writeUrl("setup", null, false);
  };
  // The phone's Back closes a step the way the in-page Back does.
  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      const step = new URL(window.location.href).searchParams.get("step");
      setView(isTab(step) ? step : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // A step opens at its top; back on the list, the list is where it was.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: view ? 0 : listScroll.current });
    // Keyboard and screen-reader focus follows: onto the step's Back, or back onto the step's row.
    const target = view ? document.querySelector<HTMLElement>(`#desk-panel-${view} .mad-back`) : lastStep.current ? document.querySelector<HTMLElement>(`.mad-step[data-desk-tab="${lastStep.current}"]`) : null;
    target?.focus({ preventScroll: true });
  }, [view]);

  /** DeskSteps' `go`: open the part, then bring a named block of it into view. */
  const go = (k: DeskTab, then?: string) => {
    openView(k);
    window.setTimeout(() => {
      const el = (then && document.getElementById(then)) || null;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };
  const onNumber = () => router.push("/dashboard/texting#texting-own-number");

  /* ── the desk's state (DeskSteps' own wiring) ── */
  const number = registration?.number ?? desk?.assigned?.number ?? null;
  const [written, setWritten] = useState(desk?.steps.profile ?? false);
  const [samples, setSamples] = useState<DeskFaq[]>([]);
  const [toCheck, setToCheck] = useState(desk?.profile ? desk.review.length : 0);
  const o = desk ? deskOverview(desk, number, toCheck, written) : null;
  const phone = desk?.businessPhone ?? "";
  const b = desk?.minutes.balance ?? null;
  const minutesLeft = b ? Math.max(0, Math.floor(b.remainingSeconds / 60)) : 0;
  const minutesTone = b ? (b.out ? "bad" : b.low || minutesLeft < FEW_MINUTES ? "warn" : undefined) : undefined;
  const [numCopied, copyNumber] = useCopied();
  const [hookCopied, copyHook] = useCopied();

  // The status line: the overview's words, or — when the number forwards and that is not
  // confirmed — the warning the desk shows instead. Without desk settings (a role that does not
  // manage it) the desk's line from the phone loader says the same thing.
  const status: { tone: "live" | "warn" | "off"; words: string } | null = o
    ? o.forwardingPending
      ? { tone: "warn", words: C.fwdBanner(phone) }
      : o.status
    : strip
      ? { tone: strip.out || !strip.number || !strip.on ? "warn" : "live", words: deskStripWords(strip) }
      : null;

  const nextAction = o ? (
    o.next ? (
      <button type="button" className="mad-btn mad-btn--primary mad-btn--wide" onClick={() => openView(o.next!)} data-desk-next>
        {C.continueTo(META[o.next].title)}
        <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
      </button>
    ) : (
      <button type="button" className="mad-btn mad-btn--primary mad-btn--wide" onClick={() => go("voice", "desk-test")} data-desk-next>
        <Mic size={16} strokeWidth={2.4} aria-hidden />
        {C.callTheDesk}
      </button>
    )
  ) : null;

  /* ── the call log ── */
  const [data, setData] = useState<Call[]>(entries);
  const [seed, setSeed] = useState(entries);
  if (seed !== entries) {
    setSeed(entries);
    setData(entries);
  }
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [makingLead, setMakingLead] = useState<string | null>(null);
  const [leadErr, setLeadErr] = useState("");
  const [freshLeads, setFreshLeads] = useState<string[]>([]);

  const visible = useMemo(() => data.filter((c) => matchesLogFilter(c, filter) && matchesQuery(c, query)), [data, filter, query]);
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: Call[] }> = [];
    for (const c of visible) {
      const label = dayGroup(c.when);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(c);
      else out.push({ key: `${label}-${c.id}`, label, rows: [c] });
    }
    return out;
  }, [visible]);
  // A lead made here counts until the server's own figure catches up (self-cancelling).
  const leadCount = stats.leads + freshLeads.filter((id) => !entries.find((c) => c.id === id)?.lead).length;
  const statValue = (k: (typeof LOG.stats)[number]["k"]) => (k === "leads" ? leadCount : stats[k]);
  const detail = openId === null ? null : (data.find((c) => c.id === openId) ?? null);
  const activeFilter = LOG.filters.find((f) => f.k === filter) ?? LOG.filters[0];
  const countFor = (k: string) => data.filter((c) => matchesLogFilter(c, k)).length;

  const detailDrag = useSheetDrag(Boolean(detail), () => setOpenId(null));
  const filterDrag = useSheetDrag(filterOpen, () => setFilterOpen(false));

  const makeLead = async (id: string) => {
    if (makingLead) return;
    setMakingLead(id);
    setLeadErr("");
    try {
      const res = await createLeadFromCall(id);
      setData((prev) => prev.map((x) => (x.id === id ? { ...x, lead: res.leadId ?? x.lead } : x)));
      setFreshLeads((prev) => (prev.includes(id) ? prev : [...prev, id]));
      router.refresh();
    } catch (err) {
      setLeadErr(actionError(err));
    } finally {
      setMakingLead(null);
    }
  };

  /* ── the recording: a real <audio> off AiPhoneCall.recordingUrl, one at a time ── */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [play, setPlay] = useState<{ on: boolean; t: number; total: number | null; err: boolean }>({ on: false, t: 0, total: null, err: false });
  const recUrl = detail?.rec ?? null;
  const [playFor, setPlayFor] = useState<string | null>(recUrl);
  if (playFor !== recUrl) {
    setPlayFor(recUrl);
    setPlay({ on: false, t: 0, total: null, err: false });
  }
  useEffect(() => {
    if (!recUrl) {
      audioRef.current = null;
      return;
    }
    const el = new Audio(recUrl);
    el.preload = "metadata";
    audioRef.current = el;
    const total = () => (isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    const onTime = () => setPlay((p) => ({ ...p, t: el.currentTime, total: total() ?? p.total }));
    const onMeta = () => setPlay((p) => ({ ...p, total: total() ?? p.total }));
    const onPlay = () => setPlay((p) => ({ ...p, on: true, err: false }));
    const onPause = () => setPlay((p) => ({ ...p, on: false }));
    const onEnd = () => setPlay((p) => ({ ...p, on: false, t: 0 }));
    const onErr = () => setPlay((p) => ({ ...p, on: false, err: true }));
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onErr);
    return () => {
      el.pause();
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onErr);
      el.removeAttribute("src");
      el.load();
      audioRef.current = null;
    };
  }, [recUrl]);
  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlay((p) => ({ ...p, on: false, err: true })));
    else el.pause();
  };
  const playDur = play.total ?? detail?.dur ?? 0;

  // Escape closes the topmost sheet this page owns (the drawer's own Escape lives in MobileNav).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filterOpen) setFilterOpen(false);
      else if (openId) setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, openId]);

  const anySheet = Boolean(detail) || filterOpen;
  // A sheet takes focus when it opens and hands it back to what opened it when it closes.
  const sheetFrom = useRef<HTMLElement | null>(null);
  const detailX = useRef<HTMLButtonElement>(null);
  const filterX = useRef<HTMLButtonElement>(null);
  const detailOpen = Boolean(detail);
  useEffect(() => {
    if (detailOpen || filterOpen) {
      if (!sheetFrom.current) sheetFrom.current = document.activeElement as HTMLElement | null;
      (detailOpen ? detailX : filterX).current?.focus({ preventScroll: true });
    } else if (sheetFrom.current) {
      sheetFrom.current.focus({ preventScroll: true });
      sheetFrom.current = null;
    }
  }, [detailOpen, filterOpen]);
  const detailTel = detail ? telHref(counterparty(detail)) : null;

  /* ── the figures under the status ── */
  const figures = desk ? (
    <dl className="mad-figs" aria-label={C.overviewLabel}>
      <div className="mad-fig mad-fig--wide" data-tone={minutesTone}>
        <dt>{C.statMinutes}</dt>
        <dd>
          <button type="button" className="mad-figbtn" onClick={() => openView("minutes")} aria-label={`${C.statMinutes}: ${minutesLeft} min — ${C.minutesTitle}`} data-desk-tab="minutes">
            <span className="mad-big">{minutesLeft}</span>
            <span className="mad-unit">min</span>
            <ChevronRight size={20} strokeWidth={2.4} aria-hidden className="mad-figarrow" />
          </button>
        </dd>
      </div>
      <div className="mad-fig">
        <dt>{C.statCalls}</dt>
        <dd>
          <span className="mad-big">{desk.use.calls}</span>
        </dd>
      </div>
      <div className="mad-fig">
        <dt>{C.statVoice}</dt>
        <dd>
          <span className="mad-word">{desk.voice}</span>
        </dd>
      </div>
    </dl>
  ) : null;

  return (
    <div className="jf-mobile-ai-desk" data-view={view ?? undefined}>
      <MobileNav />

      <main className="mad-scroll" ref={scrollRef}>
        {/* ════════ THE PAGE (status, figures, tabs) — hidden while a step is open ════════ */}
        <div className="mad-content" hidden={view !== null && desk !== null}>
          <h1 className="mad-title">{C.title}</h1>

          {status ? (
            <section className="mad-state" data-tone={status.tone} aria-label={C.overviewLabel} data-desk-live>
              <div className="mad-state-line" role="status">
                {status.tone === "live" ? <CheckCircle2 size={22} strokeWidth={2.4} aria-hidden /> : <AlertTriangle size={22} strokeWidth={2.4} aria-hidden />}
                <span>{status.words}</span>
              </div>
              <div className="mad-state-num">
                <span className="mad-label">{C.statNumber}</span>
                {number || strip?.number ? (
                  <span className="mad-numrow">
                    <span className="mad-num" data-desk-hero-number>
                      {number ?? strip?.number}
                    </span>
                    <button
                      type="button"
                      className="mad-iconbtn"
                      aria-label={numCopied ? C.copied : `${C.copy} ${number ?? strip?.number}`}
                      onClick={() => copyNumber((number ?? strip?.number) as string)}
                    >
                      {numCopied ? <Check size={18} strokeWidth={2.6} aria-hidden /> : <Copy size={18} strokeWidth={2.2} aria-hidden />}
                    </button>
                  </span>
                ) : (
                  <span className="mad-num mad-num--none">{C.noNumberShort}</span>
                )}
              </div>
              {o?.forwardingPending ? (
                <button type="button" className="mad-btn mad-btn--primary mad-btn--wide" onClick={() => go("numbers", "desk-forward")} data-desk-fwd-show>
                  {C.fwdBannerBtn}
                </button>
              ) : desk && !number && desk.assistantOnPlan ? (
                <button type="button" className="mad-btn mad-btn--primary mad-btn--wide" onClick={onNumber} data-desk-get-number>
                  {C.getNumber}
                </button>
              ) : null}
            </section>
          ) : null}

          {figures}

          <div className="mad-tabs" role="tablist" aria-label={C.title}>
            <button type="button" role="tab" id="mad-tab-calls" aria-controls="mad-pane-calls" aria-selected={tab === "calls"} className="mad-tab" onClick={() => pickTab("calls")}>
              {LOG.tabCalls}
            </button>
            <button type="button" role="tab" id="mad-tab-setup" aria-controls="mad-pane-setup" aria-selected={tab === "setup"} className="mad-tab" onClick={() => pickTab("setup")}>
              {LOG.tabSettings}
            </button>
          </div>

          {/* ──────────── CALLS ──────────── */}
          <section id="mad-pane-calls" role="tabpanel" aria-labelledby="mad-tab-calls" hidden={tab !== "calls"} className="mad-pane">
            {!twilioConfigured ? (
              <div className="mad-cfg" role="note">
                <b className="mad-cfg-t">{LOG.cfgT}</b>
                <p className="mad-cfg-h">
                  Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> and <code>TWILIO_PHONE_NUMBER</code>, then point the number&apos;s <b>A call comes in</b> webhook at this URL.
                </p>
                <div className="mad-hook">
                  <span className="mad-hook-url">{webhookUrl}</span>
                  <button type="button" className="mad-btn" onClick={() => copyHook(webhookUrl)}>
                    {hookCopied ? <Check size={15} strokeWidth={2.6} aria-hidden /> : <Copy size={15} strokeWidth={2.2} aria-hidden />}
                    {hookCopied ? C.copied : C.copy}
                  </button>
                </div>
              </div>
            ) : null}

            <dl className="mad-stats">
              {LOG.stats.map((x) => (
                <div key={x.k} className="mad-stat" data-stat={x.k}>
                  <dt>{x.l}</dt>
                  <dd className={x.k === "leads" ? "is-accent" : undefined}>{statValue(x.k)}</dd>
                </div>
              ))}
            </dl>

            <h2 className="mad-h2">{LOG.logTitle}</h2>
            <div className="mad-find">
              <label className="mad-search">
                <Search size={18} strokeWidth={2.2} aria-hidden />
                <input type="search" value={query} placeholder={LOG.search} autoComplete="off" aria-label={LOG.search} onChange={(e) => setQuery(e.target.value)} />
                {query ? (
                  <button type="button" className="mad-search-x" aria-label={LOG.clear} onClick={() => setQuery("")}>
                    <X size={18} strokeWidth={2.4} aria-hidden />
                  </button>
                ) : null}
              </label>
              <button type="button" className="mad-filterbtn" aria-haspopup="dialog" aria-expanded={filterOpen} onClick={() => setFilterOpen(true)} data-filter={filter}>
                <ListFilter size={18} strokeWidth={2.4} aria-hidden />
                <span>{activeFilter.l}</span>
                <span className="mad-count">{countFor(filter)}</span>
              </button>
            </div>

            {visible.length === 0 ? (
              <div className="mad-empty">
                {data.length === 0 ? (
                  <>
                    <b>{LOG.emptyT}</b>
                    <p>{twilioConfigured ? LOG.emptyOn : LOG.emptyOff}</p>
                  </>
                ) : (
                  <>
                    <b>{LOG.noMatchT}</b>
                    <p>{LOG.noMatchS}</p>
                    <button
                      type="button"
                      className="mad-btn"
                      onClick={() => {
                        setFilter("ALL");
                        setQuery("");
                      }}
                    >
                      {LOG.clear}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="mad-feed">
                {groups.map((g) => (
                  <div key={g.key} className="mad-day">
                    <div className="mad-dayrule">
                      <span>{g.label}</span>
                      <span className="mad-dayn">{g.rows.length}</span>
                    </div>
                    <ul className="mad-calls">
                      {g.rows.map((c) => {
                        const kind = kindOf(c);
                        const KIcon = KIND_ICON[kind];
                        return (
                          <li key={c.id}>
                            <button type="button" className="mad-call" data-kind={kind} onClick={() => setOpenId(c.id)} data-call={c.id}>
                              <span className="mad-call-ic" aria-hidden>
                                <KIcon size={18} strokeWidth={2.4} />
                              </span>
                              <span className="mad-call-main">
                                <span className="mad-call-top">
                                  <span className="mad-call-num">{counterparty(c)}</span>
                                  <span className="mad-call-when">{c.when}</span>
                                </span>
                                <span className="mad-tags">
                                  <span className="mad-tag" data-kind={kind}>
                                    {KIND_LABEL[kind]}
                                  </span>
                                  {c.desk ? <span className="mad-tag mad-tag--desk">{c.desk.label}</span> : null}
                                  {c.lead ? <span className="mad-tag mad-tag--lead">{LOG.lead}</span> : null}
                                  <span className="mad-call-dur">{fmtDur(c.dur)}</span>
                                </span>
                                <span className={c.summary ? "mad-call-sum" : "mad-call-sum is-none"}>{c.summary ?? LOG.noSummaryRow}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ──────────── SETTINGS ──────────── */}
          <section id="mad-pane-setup" role="tabpanel" aria-labelledby="mad-tab-setup" hidden={tab !== "setup"} className="mad-pane">
            {desk && o ? (
              <>
                <div className="mad-progress">
                  <span className="mad-progress-w">{C.progressWords(o.count)}</span>
                  <span className="mad-progress-bar" role="progressbar" aria-label={C.tabsLabel} aria-valuemin={0} aria-valuemax={SETUP_TABS.length} aria-valuenow={o.count}>
                    {SETUP_TABS.map((k) => (
                      <i key={k} data-done={o.done[k] ? "1" : "0"} data-now={k === o.next ? "1" : undefined} />
                    ))}
                  </span>
                </div>
                <ol className="mad-steps" aria-label={C.tabsLabel}>
                  {SETUP_TABS.map((k, i) => {
                    const st = stepState(k, o.done[k], o.tabs[k]);
                    return (
                      <li key={k}>
                        <button type="button" className="mad-step" data-done={o.done[k] ? "1" : "0"} data-now={k === o.next ? "1" : undefined} onClick={() => openView(k)} data-desk-tab={k}>
                          <span className="mad-step-n" aria-hidden>
                            {o.done[k] ? <Check size={18} strokeWidth={3} /> : i + 1}
                          </span>
                          <span className="mad-step-text">
                            <b>{META[k].title}</b>
                            <span className="mad-chip" data-tone={st.tone}>
                              {st.words}
                            </span>
                          </span>
                          <ChevronRight size={20} strokeWidth={2.4} aria-hidden className="mad-step-go" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <button type="button" className="mad-step mad-step--minutes" onClick={() => openView("minutes")} data-desk-tab="minutes-row">
                  <span className="mad-step-n" aria-hidden>
                    <Timer size={18} strokeWidth={2.4} />
                  </span>
                  <span className="mad-step-text">
                    <b>{C.minutesTitle}</b>
                    <span className="mad-chip" data-tone={o.tabs.minutes.tone}>
                      {o.tabs.minutes.words}
                    </span>
                  </span>
                  <ChevronRight size={20} strokeWidth={2.4} aria-hidden className="mad-step-go" />
                </button>
                {nextAction}
              </>
            ) : (
              <p className="mad-empty">{deskSettings ? C.managersOnly : LOG.deskSettingsFail}</p>
            )}
          </section>
        </div>

        {/* ════════ A STEP, OPENED — every step mounted, the one picked shown ════════ */}
        {desk && o ? (
          <div className="mad-views">
            {TABS.map((k) => {
              const m = META[k];
              const state = o.tabs[k];
              return (
                <section key={k} className="mad-view" id={`desk-panel-${k}`} hidden={view !== k} aria-labelledby={`mad-view-${k}-t`} data-desk-panel={k}>
                  <div className="mad-viewbar">
                    <button type="button" className="mad-back" onClick={closeView} aria-label={`${C.stepClose}: ${m.title}`}>
                      <ChevronLeft size={22} strokeWidth={2.6} aria-hidden />
                      <span>{LOG.tabSettings}</span>
                    </button>
                    <span className="mad-chip" data-tone={state.tone}>
                      {state.words}
                    </span>
                  </div>
                  <header className="mad-viewhead">
                    <h2 id={`mad-view-${k}-t`}>
                      <m.Icon size={20} strokeWidth={2.4} aria-hidden />
                      {m.title}
                    </h2>
                    <p>{m.sub}</p>
                  </header>
                  {/* data-nest: this page's reset steps around the desk's own component */}
                  <div className={desk$.desk} data-nest="">
                    <div className="mad-stepcard">
                      <div className={desk$.panelBody}>
                        {k === "numbers" ? <DeskNumbers desk={desk} registration={registration} onNumber={onNumber} /> : null}
                        {k === "business" ? (
                          <DeskBrief
                            desk={desk}
                            onWritten={(xs) => {
                              setWritten(true);
                              setSamples(xs);
                            }}
                            onReview={setToCheck}
                          />
                        ) : null}
                        {k === "booking" ? <DeskBooking desk={desk} /> : null}
                        {k === "voice" ? <DeskVoiceAndTest desk={desk} samples={samples} /> : null}
                        {k === "minutes" ? <DeskMinutes desk={desk} /> : null}
                      </div>
                    </div>
                  </div>
                  <div className="mad-viewfoot">
                    {o.next && o.next !== k ? (
                      <button type="button" className="mad-btn mad-btn--primary mad-btn--wide" onClick={() => openView(o.next!)}>
                        {C.continueTo(META[o.next].title)}
                        <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
                      </button>
                    ) : !o.next && k !== "voice" ? (
                      <button type="button" className="mad-btn mad-btn--primary mad-btn--wide" onClick={() => go("voice", "desk-test")}>
                        <Mic size={16} strokeWidth={2.4} aria-hidden />
                        {C.callTheDesk}
                      </button>
                    ) : null}
                    <button type="button" className="mad-btn mad-btn--wide" onClick={closeView}>
                      <ChevronLeft size={16} strokeWidth={2.4} aria-hidden />
                      {LOG.tabSettings}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </main>

      {/* ════════ SHEETS ════════ */}
      <div
        className={anySheet ? "mad-scrim is-on" : "mad-scrim"}
        aria-hidden="true"
        onClick={() => {
          setOpenId(null);
          setFilterOpen(false);
        }}
      />

      {/* the filter — the desktop's chip rail, as a sheet */}
      <div className={filterOpen ? "mad-sheet mad-sheet--short is-on" : "mad-sheet mad-sheet--short"} role="dialog" aria-modal="true" aria-label={LOG.logTitle} aria-hidden={!filterOpen} {...filterDrag.sheetProps}>
        <div className="mad-sheet-grab" {...filterDrag.handleProps} />
        <div className="mad-sheet-head" {...filterDrag.handleProps}>
          <b className="mad-sheet-t">{LOG.logTitle}</b>
          <button type="button" className="mad-iconbtn" ref={filterX} aria-label={C.cancel} onClick={() => setFilterOpen(false)}>
            <X size={20} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
        <div className="mad-sheet-body">
          {LOG.filters.map((f) => (
            <button
              key={f.k}
              type="button"
              className="mad-opt"
              aria-pressed={filter === f.k}
              onClick={() => {
                setFilter(f.k);
                setFilterOpen(false);
              }}
              data-f={f.k}
            >
              <span>{f.l}</span>
              <span className="mad-count">{countFor(f.k)}</span>
              {filter === f.k ? <Check size={18} strokeWidth={2.8} aria-hidden /> : null}
            </button>
          ))}
        </div>
      </div>

      {/* the call */}
      <div className={detail ? "mad-sheet is-on" : "mad-sheet"} role="dialog" aria-modal="true" aria-label={detail ? LOG.callFrom(detail.from) : LOG.transcript} aria-hidden={!detail} {...detailDrag.sheetProps}>
        <div className="mad-sheet-grab" {...detailDrag.handleProps} />
        <div className="mad-sheet-head" {...detailDrag.handleProps}>
          <b className="mad-sheet-t">{detail ? LOG.callFrom(detail.from) : ""}</b>
          <button type="button" className="mad-iconbtn" ref={detailX} aria-label={C.cancel} onClick={() => setOpenId(null)}>
            <X size={20} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
        <div className="mad-sheet-body">
          {detail ? (
            <>
              <div className="mad-tags mad-tags--sheet">
                <span className="mad-tag" data-kind={kindOf(detail)}>
                  {KIND_LABEL[kindOf(detail)]}
                </span>
                <span className="mad-tag">{detail.status.toLowerCase().replace("_", " ")}</span>
                <span className="mad-tag">{fmtDur(detail.dur)}</span>
                <span className="mad-tag">{detail.when}</span>
                {detail.lead ? <span className="mad-tag mad-tag--lead">{LOG.lead}</span> : null}
              </div>

              {detail.rec ? (
                <div className="mad-sec">
                  <div className="mad-label">{LOG.recording}</div>
                  <div className="mad-player">
                    <button type="button" className="mad-play" disabled={play.err} aria-label={play.on ? "Pause recording" : "Play recording"} onClick={togglePlay}>
                      {play.on ? <Pause size={20} strokeWidth={2.4} aria-hidden /> : <Play size={20} strokeWidth={2.4} aria-hidden />}
                    </button>
                    <span className="mad-track">
                      <span style={{ transform: `scaleX(${playDur ? Math.min(1, play.t / playDur) : 0})` }} />
                    </span>
                    <span className="mad-time">{play.err ? LOG.recordingOff : `${fmtDur(play.t)} / ${fmtDur(play.total ?? detail.dur)}`}</span>
                  </div>
                </div>
              ) : null}

              {detail.desk ? (
                <div className="mad-sec" data-sheet-desk>
                  <div className="mad-label">{LOG.theDesk}</div>
                  <p className="mad-text">{detail.desk.word === "failed" ? LOG.deskFailed(detail.desk.error) : LOG.deskDid(detail.desk.label, fmtDur(detail.desk.seconds))}</p>
                  {detail.desk.appointment ? (
                    <a
                      className="mad-btn mad-btn--wide"
                      href={`/dashboard/calendar?date=${encodeURIComponent(detail.desk.appointment.date)}&ev=apt:${encodeURIComponent(detail.desk.appointment.id)}`}
                      data-desk-visit
                    >
                      <ExternalLink size={15} strokeWidth={2.4} aria-hidden />
                      {LOG.openVisit(detail.desk.appointment.when)}
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div className="mad-sec">
                <div className="mad-label">{LOG.summary}</div>
                {detail.summary ? <p className="mad-text">{detail.summary}</p> : <p className="mad-text is-none">{LOG.noSummary}</p>}
              </div>

              <div className="mad-sec">
                <div className="mad-label">{LOG.transcript}</div>
                {detail.script.length ? (
                  <div className="mad-script">
                    {detail.script.map((l, i) => (
                      <div key={`${detail.id}-${i}`} className="mad-script-line" data-who={l[0]}>
                        <span className="mad-script-who">{LOG.who(l[0])}</span>
                        <span>{l[1]}</span>
                      </div>
                    ))}
                  </div>
                ) : detail.transcript ? (
                  <p className="mad-text mad-raw">{detail.transcript}</p>
                ) : (
                  <p className="mad-text is-none">{LOG.noTranscript}</p>
                )}
              </div>
              {leadErr ? (
                <p className="mad-err" role="alert">
                  {leadErr}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="mad-sheet-foot">
          {detailTel ? (
            <a className="mad-btn" href={detailTel}>
              <Phone size={16} strokeWidth={2.4} aria-hidden />
              {LOG.callBack}
            </a>
          ) : null}
          {detail?.lead ? (
            <a className="mad-btn mad-btn--primary" href={`/dashboard/leads/${encodeURIComponent(detail.lead)}`}>
              <ExternalLink size={16} strokeWidth={2.4} aria-hidden />
              {LOG.openLead}
            </a>
          ) : (
            <button type="button" className="mad-btn mad-btn--primary" disabled={Boolean(makingLead) || !detail} onClick={() => detail && void makeLead(detail.id)} data-act="make-lead">
              <Target size={16} strokeWidth={2.4} aria-hidden />
              {makingLead && detail && makingLead === detail.id ? LOG.creating : LOG.createLead}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
