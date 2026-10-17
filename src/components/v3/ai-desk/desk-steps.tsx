"use client";
// THE AI DESK — one piece for the desk pane and the handheld page. Blueprint since 2026-10-16 (owner: "it looks like
// another product — bring it to the JobFlex Blueprint"):
//   · the state, one line in the status tones (desk-overview.ts says which);
//   · one strip — the desk's number, minutes left (opens the minutes), calls this month, the voice;
//   · the setup, four steps in one row the way sign-up shows its steps — Phone, Business, Booking, Voice & test —
//     with the one next thing to do under it;
//   · the part picked, as a card: Phone & forwarding (desk-numbers), Your business (desk-brief), Booking
//     (desk-booking), Voice & test (desk-voice) or Minutes (desk-minutes). It opens on the first thing not done.
//     Every part stays mounted, so what is typed in one survives a look at another.
// The setup's look is on trial (owner, 2026-10-16), `?s=` picks it — the other two go once one is chosen:
//   1 (default) one segmented bar, like the plans' Monthly | Annual switch, a 4px line under each part;
//   2 the steps as a list beside the part, like the settings menu, with one solid progress bar over it;
//   3 a drawn line of four squares, like sign-up's steps — the line itself is the progress.
import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, Check, CheckCircle2, Copy, Mic, Phone, Timer } from "lucide-react";

import type { DeskFaq } from "@/lib/aiDesk/profile";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { deskOverview, firstTab, SETUP_TABS, type DeskTab, type TabState } from "./desk-overview";
import { DeskBooking } from "./desk-booking";
import { DeskBrief } from "./desk-brief";
import { DeskMinutes } from "./desk-minutes";
import { DeskNumbers } from "./desk-numbers";
import { DeskVoiceAndTest } from "./desk-voice";
import s from "./ai-desk.module.css";

const TABS: DeskTab[] = ["numbers", "business", "booking", "voice", "minutes"];
const TAB_KEY = "jf-desk-tab";
/** Under this many minutes the strip's figure turns amber (the minutes card warns at lib/aiDesk LOW_MINUTES_SECONDS). */
const FEW_MINUTES = 50;
/** Set once the page has hydrated: a desk built after that (the settings page rebuilding at another width) may read
 *  the tab this browser picked; the first, server-drawn one must not, or it would not match the server's HTML. */
let pageHydrated = false;
function rememberedTab(): DeskTab | null {
  if (typeof window === "undefined" || !pageHydrated) return null;
  try {
    const t = window.sessionStorage.getItem(TAB_KEY);
    return t && (TABS as string[]).includes(t) ? (t as DeskTab) : null;
  } catch {
    return null;
  }
}
const META: Record<DeskTab, { title: string; short: string; sub: string; Icon: typeof Phone }> = {
  numbers: { title: C.tabNumbers, short: C.tabNumbersShort, sub: C.step1Sub, Icon: Phone },
  business: { title: C.tabBusiness, short: C.tabBusinessShort, sub: C.step2Sub, Icon: Building2 },
  booking: { title: C.tabBooking, short: C.tabBooking, sub: C.step3Sub, Icon: CalendarDays },
  voice: { title: C.tabVoice, short: C.tabVoice, sub: C.step4Sub, Icon: Mic },
  minutes: { title: C.minutesTitle, short: C.minutesTitle, sub: C.minutesSub, Icon: Timer },
};

/** A status stamp: the tone's frame, its soft fill, the words in caps. */
function Stamp({ state }: { state: TabState }) {
  return (
    <span className={s.chip} data-tone={state.tone} data-step-chip>
      {state.words}
    </span>
  );
}

/** A step's stamp in the row: done, its count to check, or what is left — the panel's own stamp says the rest. */
function stepState(k: (typeof SETUP_TABS)[number], done: boolean, tab: TabState): TabState {
  if (done) return { tone: "done", words: C.stepDone };
  if (k === "numbers" && tab.tone === "check") return { tone: "check", words: C.checkThis };
  if (tab.tone === "check" || tab.tone === "warn") return tab;
  if (k === "voice") return tab;
  return { tone: "todo", words: C.stepTodo };
}

/** A step's status as a line: a square dot in its tone, then the words — no frame, so it never reads as a button. */
type Dot = "ok" | "todo" | "idle" | "bad";
function dotOf(k: (typeof SETUP_TABS)[number], state: TabState): Dot {
  if (state.tone === "done") return "ok";
  if (state.tone === "warn") return "bad";
  if (state.tone === "check") return "todo";
  return k === "voice" ? "idle" : "todo";
}
function StatusLine({ k, state, className }: { k: (typeof SETUP_TABS)[number]; state: TabState; className?: string }) {
  return (
    <span className={className ? `${s.st} ${className}` : s.st} data-dot={dotOf(k, state)} data-step-chip>
      <i aria-hidden />
      {state.words}
    </span>
  );
}

function CopyNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={s.iconBtn}
      aria-label={copied ? C.copied : `${C.copy} ${number}`}
      title={copied ? C.copied : C.copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(number);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} strokeWidth={2.4} aria-hidden /> : <Copy size={14} strokeWidth={2.2} aria-hidden />}
    </button>
  );
}

export function DeskSteps({
  desk,
  registration,
  onNumber,
  intro,
}: {
  desk: DeskSettingsData;
  registration: SmsRegistrationView | null;
  onNumber?: () => void;
  /** The pane's one line, where the host draws no pane head of its own (the handheld page). */
  intro?: string;
}) {
  const search = useSearchParams();
  const look = search?.get("s") === "2" ? "2" : search?.get("s") === "3" ? "3" : "1";
  const number = registration?.number ?? desk.assigned?.number ?? null;
  const [written, setWritten] = useState(desk.steps.profile);
  const [samples, setSamples] = useState<DeskFaq[]>([]);
  // The preset's highlighted parts: "Your business" reads "3 to check" until they are looked at.
  const [toCheck, setToCheck] = useState(desk.profile ? desk.review.length : 0);
  const o = deskOverview(desk, number, toCheck, written);
  // A rebuild of the page (another width) keeps the tab picked since it loaded; a fresh load reads the address.
  const [tab, setTab] = useState<DeskTab>(() => rememberedTab() ?? firstTab(o, typeof window !== "undefined" ? window.location.search : search ? `?${search.toString()}` : ""));
  useEffect(() => {
    pageHydrated = true;
  }, []);

  // The tab goes in the address too, so a reload — or the page rebuilding itself at another width — keeps it.
  const pick = (t: DeskTab) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode: the tab still changes */
    }
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("step", t);
      window.history.replaceState(window.history.state, "", u.toString());
    } catch {
      /* the tab still changes */
    }
  };
  const go = (t: DeskTab, then?: string) => {
    pick(t);
    window.setTimeout(() => {
      const el = (then && document.getElementById(then)) || document.getElementById(`desk-panel-${t}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  };

  const phone = desk.businessPhone ?? "";
  const b = desk.minutes.balance;
  const minutesLeft = Math.max(0, Math.floor(b.remainingSeconds / 60));
  const minutesTone = b.out ? "bad" : b.low || minutesLeft < FEW_MINUTES ? "warn" : undefined;
  const getNumber = onNumber ? (
    <button type="button" className={s.btn} onClick={onNumber} data-desk-get-number>
      {C.getNumber}
    </button>
  ) : (
    <a className={s.btn} href="/dashboard/settings?tab=texting#texting-own-number" data-desk-get-number>
      {C.getNumber}
    </a>
  );

  // The one next thing to do: the first step not done, or — all four done — a call to the desk.
  const nextBtn = o.next ? (
    <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => go(o.next!)} data-desk-next>
      {C.continueTo(META[o.next].title)}
      <ArrowRight size={15} strokeWidth={2.4} aria-hidden />
    </button>
  ) : (
    <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => go("voice", "desk-test")} data-desk-next>
      <Mic size={15} strokeWidth={2.4} aria-hidden />
      {C.callTheDesk}
    </button>
  );
  // Every part stays mounted; the one picked shows.
  const panels = TABS.map((k) => {
    const m = META[k];
    const stepAttrs = k !== "minutes" ? { "data-desk-step": SETUP_TABS.indexOf(k) + 1, "data-done": o.done[k] ? "1" : "0" } : {};
    return (
      <section
        key={k}
        role={k === "minutes" ? "region" : "tabpanel"}
        id={`desk-panel-${k}`}
        aria-labelledby={`desk-panel-${k}-t`}
        hidden={tab !== k}
        className={s.panel}
        data-desk-panel={k}
        {...stepAttrs}
      >
        <header className={s.panelHead}>
          <m.Icon size={16} strokeWidth={2.2} aria-hidden className={s.panelIcon} />
          <div className={s.panelTitles}>
            <h3 id={`desk-panel-${k}-t`}>{m.title}</h3>
            <p>{m.sub}</p>
          </div>
          <Stamp state={o.tabs[k]} />
        </header>
        <div className={s.panelBody}>
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
      </section>
    );
  });

  // data-nest: out of the shell's (0,1,0) margin/padding reset (dashboard-blueprint/blueprint.module.css), which the
  // production build emits after this module and which then zeroed every single-class rule here (2026-10-16).
  return (
    <div className={s.desk} data-desk-steps data-s={look} data-nest="">
      {intro ? <p className={s.intro}>{intro}</p> : null}

      {/* the state: amber while something stands between the desk and the calls, green once it answers */}
      {o.forwardingPending ? (
        <div className={s.notice} data-tone="warn" role="note" data-desk-fwd-banner data-desk-live>
          <AlertTriangle size={17} strokeWidth={2.2} aria-hidden />
          <span>{C.fwdBanner(phone)}</span>
          <button type="button" className={s.btn} onClick={() => go("numbers", "desk-forward")} data-desk-fwd-show>
            {C.fwdBannerBtn}
          </button>
        </div>
      ) : (
        <div className={s.notice} data-tone={o.status.tone} role="status" data-desk-live>
          {o.status.tone === "live" ? <CheckCircle2 size={17} strokeWidth={2.2} aria-hidden /> : <AlertTriangle size={17} strokeWidth={2.2} aria-hidden />}
          <span>{o.status.words}</span>
          {!number && desk.assistantOnPlan ? getNumber : null}
        </div>
      )}

      {/* the strip */}
      <dl className={s.strip} data-desk-overview aria-label={C.overviewLabel}>
        <div className={s.cell} data-cell="number">
          <dt>{C.statNumber}</dt>
          <dd className={s.cellNumber}>
            <span className={s.mono} data-desk-hero-number>
              {number ?? "—"}
            </span>
            {number ? <CopyNumber number={number} /> : null}
          </dd>
        </div>
        <div className={s.cell} data-cell="minutes" data-tone={minutesTone}>
          <dt>{C.statMinutes}</dt>
          <dd>
            <button
              type="button"
              className={s.cellBtn}
              id="desk-tab-minutes"
              aria-controls="desk-panel-minutes"
              aria-expanded={tab === "minutes"}
              onClick={() => go("minutes")}
              data-desk-tab="minutes"
            >
              <span className={s.big}>{minutesLeft}</span>
              <span className={s.unit}>min</span>
              <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </dd>
        </div>
        <div className={s.cell} data-cell="calls">
          <dt>{C.statCalls}</dt>
          <dd>
            <span className={s.big}>{desk.use.calls}</span>
          </dd>
        </div>
        <div className={s.cell} data-cell="voice">
          <dt>{C.statVoice}</dt>
          <dd>
            <span className={`${s.big} ${s.bigWord}`}>{desk.voice}</span>
          </dd>
        </div>
      </dl>

      {look === "1" ? (
        <>
          {/* ?s=1 — one segmented bar: number, name, status; a 4px line under each part says how far */}
          <section className={s.seg} aria-label={C.tabsLabel}>
            <div className={s.segRow} role="tablist" aria-label={C.tabsLabel} id="desk-panels">
              {SETUP_TABS.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  id={`desk-tab-${k}`}
                  aria-selected={tab === k}
                  aria-controls={`desk-panel-${k}`}
                  className={s.segBtn}
                  data-done={o.done[k] ? "1" : "0"}
                  data-bar={o.done[k] ? "done" : k === o.next ? "now" : undefined}
                  data-desk-tab={k}
                  onClick={() => pick(k)}
                >
                  <span className={s.segN} aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <b className={s.segName}>{META[k].short}</b>
                  <StatusLine k={k} state={stepState(k, o.done[k], o.tabs[k])} />
                </button>
              ))}
            </div>
          </section>
          <div className={s.segFoot}>
            <span className={s.count}>{C.progressWords(o.count)}</span>
            {nextBtn}
          </div>
          {panels}
        </>
      ) : null}

      {look === "2" ? (
        /* ?s=2 — the steps as a list beside the part, the settings menu's own items */
        <div className={s.split}>
          <aside className={s.side} aria-label={C.tabsLabel}>
            <div className={s.sideHead}>
              <span className={s.count}>{C.progressWords(o.count)}</span>
              <span className={s.fill} role="progressbar" aria-label={C.tabsLabel} aria-valuemin={0} aria-valuemax={SETUP_TABS.length} aria-valuenow={o.count}>
                <span style={{ "--p": o.count / SETUP_TABS.length } as CSSProperties} />
              </span>
            </div>
            <div className={s.list} role="tablist" aria-label={C.tabsLabel} aria-orientation="vertical" id="desk-panels">
              {SETUP_TABS.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  id={`desk-tab-${k}`}
                  aria-selected={tab === k}
                  aria-controls={`desk-panel-${k}`}
                  className={s.item}
                  data-done={o.done[k] ? "1" : "0"}
                  data-desk-tab={k}
                  onClick={() => pick(k)}
                >
                  <span className={s.itemN} aria-hidden>
                    {o.done[k] ? <Check size={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={s.itemText}>
                    <b>{META[k].short}</b>
                    <StatusLine k={k} state={stepState(k, o.done[k], o.tabs[k])} />
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <div className={s.main}>
            {panels}
            <div className={s.mainFoot}>{nextBtn}</div>
          </div>
        </div>
      ) : null}

      {look === "3" ? (
        <>
          {/* ?s=3 — a drawn line of four squares: done in green, the next in blue, the rest outlined */}
          <section className={s.track} aria-label={C.tabsLabel}>
            <div className={s.nodes} role="tablist" aria-label={C.tabsLabel} id="desk-panels">
              {SETUP_TABS.map((k, i) => {
                const after = SETUP_TABS[i + 1];
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    id={`desk-tab-${k}`}
                    aria-selected={tab === k}
                    aria-controls={`desk-panel-${k}`}
                    className={s.node}
                    data-done={o.done[k] ? "1" : "0"}
                    data-state={o.done[k] ? "done" : k === o.next ? "now" : "todo"}
                    data-link={after && o.done[k] && o.done[after] ? "done" : undefined}
                    data-desk-tab={k}
                    onClick={() => pick(k)}
                  >
                    <span className={s.nodeSq} aria-hidden>
                      {o.done[k] ? <Check size={16} strokeWidth={3} /> : i + 1}
                    </span>
                    <b className={s.nodeName}>{META[k].short}</b>
                    <StatusLine k={k} state={stepState(k, o.done[k], o.tabs[k])} className={s.nodeSt} />
                  </button>
                );
              })}
            </div>
            {nextBtn}
          </section>
          {panels}
        </>
      ) : null}
    </div>
  );
}
