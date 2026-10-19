"use client";

// HVAC SERVICES — THE DESK (2026-10-18), under the HVAC estimator beside its
// inventory. Owner: "make that services more understandable — where you set up
// the service, what client is it, where to see the services schedule, who's
// the clients, do they belong to any project or proposal — and set the
// reminders for the contractor … an internal dashboard for HVAC services."
//
// The page answers in the contractor's order: the four steps of how the
// service side runs (each one a door to its tab), then Today (what needs you),
// Schedule (the season and every plan visit), Clients (who is on a plan, what
// it belongs to), Plans (enroll, the plans you sell) and Reminders (when
// JobFlex reminds you, and your own). Data is read on the server
// (lib/serviceDeskBook); every button is a server action, then a fresh read.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { ServiceDeskData } from "@/lib/serviceDeskBook";
import { clientErrorText } from "@/lib/staleDeploy";
import { DeskContext, Ic, cx, type Act, type DeskCtx, type DeskTab, type EnrollPreset, type ReminderPreset } from "./desk-shared";
import { TodayTab } from "./desk-today";
import { ScheduleTab } from "./desk-schedule";
import { ClientsTab } from "./desk-clients";
import { PlansTab } from "./desk-plans";
import { RemindersTab } from "./desk-reminders";

export type { DeskTab } from "./desk-shared";

const TAB_LABEL: Record<DeskTab, string> = { today: "Today", schedule: "Schedule", clients: "Clients", plans: "Plans", reminders: "Reminders" };
const TAB_ORDER: DeskTab[] = ["today", "schedule", "clients", "plans", "reminders"];

export function ServiceDeskContent({ data, initialTab }: { data: ServiceDeskData; initialTab: DeskTab }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<DeskTab>(initialTab);
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [enrollPreset, setEnrollPreset] = useState<EnrollPreset | null>(null);
  const [reminderPreset, setReminderPreset] = useState<ReminderPreset | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // The answer line clears itself after a while; an error waits a little longer.
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), msg.kind === "err" ? 9000 : 4000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const goTab = useCallback((t: DeskTab, f: string | null = null) => {
    setTab(t);
    setFocus(f);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* the address is a convenience */
    }
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);

  const act: Act = useCallback(
    async (key, fn, okNote) => {
      setBusy(key);
      setMsg(null);
      try {
        const r = (await fn()) as { ok?: boolean; error?: string; note?: string } | void;
        if (r && typeof r === "object" && r.ok === false) {
          setMsg({ kind: "err", text: r.error || "That didn't go through." });
          return false;
        }
        const note = (r && typeof r === "object" && r.note) || okNote;
        if (note) setMsg({ kind: "ok", text: note });
        startTransition(() => router.refresh());
        return true;
      } catch (err) {
        setMsg({ kind: "err", text: clientErrorText(err, "That didn't go through — refresh the page and try again.") });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const ctx: DeskCtx = useMemo(
    () => ({
      data,
      act,
      busy,
      goTab,
      focus,
      enroll: (p) => {
        setEnrollPreset({ ...p, nonce: Date.now() });
        goTab("plans", "enroll");
      },
      enrollPreset,
      remind: (p) => {
        setReminderPreset({ ...p, nonce: Date.now() });
        goTab("reminders", "add");
      },
      reminderPreset,
    }),
    [data, act, busy, goTab, focus, enrollPreset, reminderPreset],
  );

  const { stats, templates, plans, visits, prefs, texting } = data;
  const nextVisit = visits.find((v) => v.status === "SCHEDULED" && (v.stage === "today" || v.stage === "soon" || v.stage === "later"));
  const counts: Record<DeskTab, { n: number; hot: boolean }> = {
    today: { n: data.needs.filter((n) => n.tone === "now").length, hot: true },
    schedule: { n: stats.overdue + stats.visitsToday, hot: stats.overdue > 0 },
    clients: { n: plans.filter((p) => p.filter !== "past").length, hot: false },
    plans: { n: templates.length, hot: false },
    reminders: { n: data.reminders.filter((r) => r.state === "due" || r.state === "late").length, hot: true },
  };

  const steps: Array<{ tab: DeskTab; title: string; status: string; done: boolean }> = [
    {
      tab: "plans",
      title: "The plans you sell",
      status: templates.length ? `${templates.length} plan${templates.length === 1 ? "" : "s"} ready · ${templates.map((t) => t.name.replace(/ plan$/i, "")).slice(0, 3).join(", ")}` : "Not set up — start with the three starter plans",
      done: templates.length > 0,
    },
    {
      tab: "clients",
      title: "Clients on a plan",
      status: stats.members || stats.signing ? `${stats.members} active${stats.signing ? ` · ${stats.signing} waiting to sign` : ""}${stats.ending ? ` · ${stats.ending} ending` : ""}` : "Nobody yet — enroll a client",
      done: stats.members > 0,
    },
    {
      tab: "schedule",
      title: "Visits on the schedule",
      status: nextVisit ? `Next: ${nextVisit.dayText} ${nextVisit.time} · ${nextVisit.clientName}` : "They land on their own when a plan starts",
      done: !!nextVisit,
    },
    {
      tab: "reminders",
      title: "Reminders to you",
      status: `${prefs.dailyDigest ? "Daily digest" : "No digest"} · heads-up ${prefs.headsUpDays} day${prefs.headsUpDays === 1 ? "" : "s"} before · ${texting.names.length ? `texts to ${texting.names.slice(0, 2).join(", ")}${texting.names.length > 2 ? ` +${texting.names.length - 2}` : ""}` : "bell only"}`,
      done: prefs.dailyDigest && texting.names.length > 0,
    },
  ];

  return (
    <DeskContext.Provider value={ctx}>
      <div className={cx("desk")} data-service-desk>
        <div className={cx("page-head")}>
          <div>
            <div className={cx("kicker")}>HVAC estimator · Services</div>
            <h1 className={cx("page-title")}>HVAC services</h1>
            <p className={cx("page-lede")}>Maintenance plans, the visits they bring and the clients on them — set up, scheduled and reminded in one place.</p>
          </div>
          <div className={cx("page-actions")}>
            <button type="button" className={cx("btn", "btn-primary")} onClick={() => ctx.enroll({})} data-desk-enroll-open>
              <Ic id="i-userplus" /> Enroll a client
            </button>
            <button type="button" className={cx("btn", "btn-ghost")} onClick={() => ctx.remind({})} data-desk-remind-open>
              <Ic id="i-bell" /> Add a reminder
            </button>
            <Link className={cx("btn", "btn-ghost")} href={"/dashboard/calendar" as Route}>
              <Ic id="i-cal" /> Calendar
            </Link>
          </div>
        </div>

        <nav className={cx("steps")} aria-label="How the service side runs" data-desk-steps>
          {steps.map((s, i) => (
            <button key={s.tab} type="button" className={cx("step", s.done && "step--done", tab === s.tab && "step--on")} onClick={() => goTab(s.tab)} data-step={s.tab}>
              <span className={cx("step-n")}>{s.done ? <Ic id="i-check" /> : i + 1}</span>
              <span className={cx("step-t")}>{s.title}</span>
              <span className={cx("step-s")}>{s.status}</span>
            </button>
          ))}
        </nav>

        <div className={cx("tabs-wrap")} ref={tabsRef}>
          <div className={cx("tabs")} role="tablist" aria-label="HVAC services">
            {TAB_ORDER.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={cx("tab", tab === t && "tab--on")} onClick={() => goTab(t)} data-tab={t}>
                {TAB_LABEL[t]}
                {counts[t].n > 0 && <span className={cx("tab-n", counts[t].hot && "tab-n--hot")}>{counts[t].n}</span>}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" data-panel={tab}>
          {tab === "today" && <TodayTab />}
          {tab === "schedule" && <ScheduleTab />}
          {tab === "clients" && <ClientsTab />}
          {tab === "plans" && <PlansTab />}
          {tab === "reminders" && <RemindersTab />}
        </div>

        {msg && (
          <div className={cx("toast", msg.kind === "err" && "toast--err")} role="status" data-desk-msg={msg.kind}>
            <span>{msg.text}</span>
            <button type="button" onClick={() => setMsg(null)} aria-label="Close">
              ✕
            </button>
          </div>
        )}
      </div>
    </DeskContext.Provider>
  );
}
