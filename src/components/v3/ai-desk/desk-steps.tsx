"use client";
// THE AI DESK (2026-10-14 redesign — owner: "organize the AI desk and make a better design … it's everything in one
// colour, black, so basic; get me something better, modern"). One piece for the desk pane and the handheld page:
//   · the overview — the desk's number and whether it is live, how calls reach it, minutes, calls, voice, how much of
//     the setup is done and the one next thing to do (desk-overview.ts says which);
//   · tabs, one part at a time — Phone & forwarding (desk-numbers), Your business (desk-brief), Booking
//     (desk-booking), Voice & test (desk-voice), Minutes (desk-minutes) — each with its state; it opens on the first
//     thing not done. Every panel stays mounted, so what is typed in one survives a look at another.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, Check, Copy, Mic, Phone, Timer } from "lucide-react";

import type { DeskFaq } from "@/lib/aiDesk/profile";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { deskOverview, firstTab, type DeskTab, type TabState } from "./desk-overview";
import { DeskBooking } from "./desk-booking";
import { DeskBrief } from "./desk-brief";
import { DeskMinutes } from "./desk-minutes";
import { DeskNumbers } from "./desk-numbers";
import { DeskVoiceAndTest } from "./desk-voice";
import s from "./ai-desk.module.css";

const TABS: DeskTab[] = ["numbers", "business", "booking", "voice", "minutes"];
const TAB_KEY = "jf-desk-tab";
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
const META: Record<DeskTab, { title: string; short: string; sub: string; Icon: typeof Phone; accent: string; n: number | null }> = {
  numbers: { title: C.tabNumbers, short: C.tabNumbersShort, sub: C.step1Sub, Icon: Phone, accent: "blue", n: 1 },
  business: { title: C.tabBusiness, short: C.tabBusinessShort, sub: C.step2Sub, Icon: Building2, accent: "violet", n: 2 },
  booking: { title: C.tabBooking, short: C.tabBooking, sub: C.step3Sub, Icon: CalendarDays, accent: "teal", n: 3 },
  voice: { title: C.tabVoice, short: C.tabVoice, sub: C.step4Sub, Icon: Mic, accent: "coral", n: 4 },
  minutes: { title: C.minutesTitle, short: C.minutesTitle, sub: C.minutesSub, Icon: Timer, accent: "amber", n: null },
};

function Chip({ state }: { state: TabState }) {
  return (
    <span className={s.chip} data-tone={state.tone} data-step-chip>
      {state.tone === "done" ? <Check size={13} strokeWidth={2.6} aria-hidden /> : null}
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
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
    </button>
  );
}

export function DeskSteps({ desk, registration, onNumber }: { desk: DeskSettingsData; registration: SmsRegistrationView | null; onNumber?: () => void }) {
  const search = useSearchParams();
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
      const el = (then && document.getElementById(then)) || document.getElementById("desk-panels");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  };

  const phone = desk.businessPhone ?? "";
  const reach = !number
    ? C.reachNone
    : desk.mode === "FORWARD" && desk.forwarding !== "all"
      ? C.reachRingFirst(phone)
      : desk.forwarding === "all"
        ? C.reachAll(phone)
        : desk.forwarding === "missed"
          ? C.reachMissed(phone)
          : C.reachDirect;
  const b = desk.minutes.balance;

  return (
    <div className={s.desk} data-desk-steps>
      {/* the overview */}
      <section className={s.hero} data-desk-overview data-tone={o.status.tone} aria-label={C.overviewLabel}>
        <div className={s.heroTop}>
          <div className={s.heroMain}>
            <span className={s.live} data-tone={o.status.tone} data-desk-live>
              <span className={s.liveDot} aria-hidden />
              {o.status.words}
            </span>
            <div className={s.heroNumber}>
              <span data-desk-hero-number>{number ?? C.noNumberShort}</span>
              {number ? <CopyNumber number={number} /> : null}
            </div>
            <p className={s.heroSub}>{reach}</p>
          </div>
          <dl className={s.stats}>
            <div className={s.stat} data-tone={b.out ? "warn" : b.low ? "check" : "info"}>
              <dt>{C.statMinutes}</dt>
              <dd>
                {b.out ? C.statOut : Math.floor(b.remainingSeconds / 60)}
                {b.out ? null : <small> min</small>}
              </dd>
            </div>
            <div className={s.stat}>
              <dt>{C.statCalls}</dt>
              <dd>{desk.use.calls}</dd>
            </div>
            <div className={s.stat}>
              <dt>{C.statVoice}</dt>
              <dd className={s.statWord}>{desk.voice.replace(/^\w/, (c) => c.toUpperCase())}</dd>
            </div>
          </dl>
        </div>
        <div className={s.heroFoot}>
          <div className={s.progress}>
            <span>{C.progressWords(o.count)}</span>
            <span className={s.progressBar} aria-hidden>
              {(["numbers", "business", "booking", "voice"] as const).map((k) => (
                <i key={k} data-on={o.done[k] ? "1" : "0"} />
              ))}
            </span>
          </div>
          {o.next ? (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => go(o.next!)} data-desk-next>
              {C.continueTo(META[o.next].title)}
              <ArrowRight size={16} aria-hidden />
            </button>
          ) : (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => go("voice")} data-desk-next>
              {C.callTheDesk}
              <Mic size={16} aria-hidden />
            </button>
          )}
        </div>
        {o.forwardingPending ? (
          <div className={s.fwdBanner} role="note" data-desk-fwd-banner>
            <AlertTriangle size={18} aria-hidden />
            <span>{C.fwdBanner(phone)}</span>
            <button type="button" className={s.btn} onClick={() => go("numbers", "desk-forward")} data-desk-fwd-show>
              {C.fwdBannerBtn}
            </button>
          </div>
        ) : null}
      </section>

      {/* the parts, one at a time */}
      <div className={s.tabs} role="tablist" aria-label={C.tabsLabel} id="desk-panels">
        {TABS.map((k) => {
          const m = META[k];
          return (
            <button
              key={k}
              type="button"
              role="tab"
              id={`desk-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`desk-panel-${k}`}
              className={s.tab}
              data-accent={m.accent}
              data-desk-tab={k}
              onClick={() => pick(k)}
            >
              <span className={s.tabIcon} aria-hidden>
                <m.Icon size={18} strokeWidth={2.1} />
              </span>
              <span className={s.tabText}>
                <b>{m.short}</b>
                <small data-tone={o.tabs[k].tone}>{o.tabs[k].words}</small>
              </span>
            </button>
          );
        })}
      </div>

      {TABS.map((k) => {
        const m = META[k];
        const stepAttrs = m.n ? { "data-desk-step": m.n, "data-done": o.done[k as keyof typeof o.done] ? "1" : "0" } : {};
        return (
          <section key={k} role="tabpanel" id={`desk-panel-${k}`} aria-labelledby={`desk-tab-${k}`} hidden={tab !== k} className={s.panel} data-accent={m.accent} data-desk-panel={k} {...stepAttrs}>
            <header className={s.panelHead}>
              <span className={s.panelIcon} aria-hidden>
                <m.Icon size={20} strokeWidth={2.1} />
              </span>
              <div className={s.panelTitles}>
                <h3>{m.title}</h3>
                <p>{m.sub}</p>
              </div>
              <Chip state={o.tabs[k]} />
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
      })}
    </div>
  );
}
