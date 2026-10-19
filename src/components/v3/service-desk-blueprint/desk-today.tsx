"use client";

// HVAC SERVICES · TODAY (2026-10-18): the numbers, then everything the service
// side asks of the contractor (lib/serviceDesk needsYou) in the order to do it
// — each with the one button that clears it — beside the next seven days and
// the reminders due.

import Link from "next/link";
import type { Route } from "next";
import { activateServicePlan, completePlanVisit, markServicePlanInvoicePaid, renewServicePlan, sendServicePlan, setPlanAutoRenew } from "@/actions/servicePlans";
import { setServiceReminderDone, snoozeServiceReminder } from "@/actions/serviceDesk";
import { money } from "@/lib/servicePlans";
import { TONE_LABEL, type NeedTone } from "@/lib/serviceDesk";
import type { ServiceDeskData } from "@/lib/serviceDeskBook";
import { Plate, clientHref, copyText, cx, useDesk } from "./desk-shared";
import { STAGE_WORD } from "./desk-schedule";

type Need = ServiceDeskData["needs"][number];

export function TodayTab() {
  const { data } = useDesk();
  const { stats, needs } = data;
  const groups = (["now", "soon", "idea"] as NeedTone[]).map((tone) => ({ tone, items: needs.filter((n) => n.tone === tone) })).filter((g) => g.items.length);
  const week = data.visits.filter((v) => v.status === "SCHEDULED" && (v.stage === "today" || v.stage === "soon" || (v.stage === "later" && Date.parse(v.startsAt) - Date.parse(data.now) <= 7 * 86400000)));
  const due = data.reminders.filter((r) => r.state === "due" || r.state === "late");
  const ahead = data.reminders.filter((r) => r.state === "ahead").slice(0, 3);

  return (
    <div className={cx("stack")}>
      <div className={cx("kpis")} data-desk-kpis>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Clients on a plan</div>
          <div className={cx("kpi-val")} data-kpi="members">{stats.members}</div>
          <div className={cx("kpi-sub")}>{stats.signing ? `${stats.signing} waiting to sign` : "every plan signed"}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Visits · 30 days</div>
          <div className={cx("kpi-val")} data-kpi="visits">{stats.visits30}</div>
          <div className={cx("kpi-sub")}>{stats.visitsToday} today{stats.overdue ? ` · ${stats.overdue} overdue` : ""}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Monthly recurring</div>
          <div className={cx("kpi-val")} data-kpi="mrr">{money(stats.mrrCents)}</div>
          <div className={cx("kpi-sub")}>{money(stats.mrrCents * 12)} a year at this pace</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Open plan bills</div>
          <div className={cx("kpi-val")} data-kpi="bills">{money(stats.openCents)}</div>
          <div className={cx("kpi-sub")}>{stats.openCount} open{stats.lateCount ? ` · ${stats.lateCount} late` : ""}</div>
        </div>
      </div>

      <div className={cx("grid2")}>
        <section className={cx("card")} data-desk-needs>
          <div className={cx("card-h")}>
            <div className={cx("card-t")}>Needs you</div>
            <div className={cx("card-s")}>in the order to do it · each line clears with its button</div>
          </div>
          {groups.length === 0 ? (
            <div className={cx("empty")}>Nothing needs you. Every visit is on time, every plan signed, every bill paid.</div>
          ) : (
            groups.map((g) => (
              <div key={g.tone}>
                <div className={cx("tone-h")} data-tone={g.tone}>
                  {TONE_LABEL[g.tone]} · {g.items.length}
                </div>
                {g.items.map((n) => (
                  <NeedRow key={n.key} n={n} />
                ))}
              </div>
            ))
          )}
        </section>

        <div className={cx("stack")}>
          <section className={cx("card")} data-desk-week>
            <div className={cx("card-h")}>
              <div className={cx("card-t")}>Next 7 days</div>
              <WeekLink />
            </div>
            {week.length === 0 ? (
              <div className={cx("empty")}>No plan visits in the next seven days.</div>
            ) : (
              <div className={cx("vlist")}>
                {week.map((v) => (
                  <div key={v.id} className={cx("vline")}>
                    <div className={cx("vline-when")}>
                      <b>{v.dayText}</b>
                      {v.time}
                    </div>
                    <div>
                      <Link className={cx("who")} href={clientHref(v.clientId) as Route}>
                        {v.clientName}
                      </Link>
                      <span className={cx("sub")}>
                        {v.label} · {v.techs.length ? v.techs.join(", ") : "no tech yet"}
                      </span>
                    </div>
                    <Plate tone={v.stage}>{STAGE_WORD[v.stage]}</Plate>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={cx("card")} data-desk-today-reminders>
            <div className={cx("card-h")}>
              <div className={cx("card-t")}>Your reminders</div>
              <RemindLink />
            </div>
            {due.length === 0 && ahead.length === 0 ? (
              <div className={cx("empty")}>None set. Add one for a call back, a filter swap, a quote to follow — it rings on its day.</div>
            ) : (
              <div className={cx("vlist")}>
                {[...due, ...ahead].map((r) => (
                  <div key={r.id} className={cx("vline")}>
                    <div className={cx("vline-when")}>
                      <b>{r.dayText}</b>
                    </div>
                    <div>
                      <span className={cx("rem-t")}>{r.note}</span>
                      {r.clientName && <span className={cx("sub")}>{r.clientName}</span>}
                    </div>
                    <Plate tone={r.state}>{r.state === "late" ? "Late" : r.state === "due" ? "Today" : "Ahead"}</Plate>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function WeekLink() {
  const { goTab } = useDesk();
  return (
    <button type="button" className={cx("linkish")} onClick={() => goTab("schedule")}>
      Full schedule
    </button>
  );
}

function RemindLink() {
  const { remind } = useDesk();
  return (
    <button type="button" className={cx("linkish")} onClick={() => remind({})}>
      Add one
    </button>
  );
}

function NeedRow({ n }: { n: Need }) {
  const { data, act, busy, goTab, enroll, remind } = useDesk();
  const plan = n.ref.planId ? data.plans.find((p) => p.id === n.ref.planId) : undefined;
  const visit = n.ref.visitId ? data.visits.find((v) => v.id === n.ref.visitId) : undefined;
  const k = (what: string) => `${n.key}:${what}`;
  const b = (what: string) => busy === k(what);
  const btn = (what: string, label: string, fn: () => Promise<unknown>, primary = false, ok?: string) => (
    <button type="button" className={cx("btn", primary ? "btn-primary" : "btn-ghost", "btn--xs")} disabled={!!busy} onClick={() => act(k(what), fn, ok)} data-need-act={what}>
      {b(what) ? "…" : label}
    </button>
  );

  let acts: React.ReactNode = null;
  switch (n.kind) {
    case "visit-overdue":
    case "visit-today":
      acts = (
        <>
          {n.ref.appointmentId && (
            <Link className={cx("btn", n.kind === "visit-overdue" ? "btn-primary" : "btn-ghost", "btn--xs")} href={`/dashboard/visits/${n.ref.appointmentId}` as Route}>
              {visit?.report === "saved" ? "Send the report" : "Report"}
            </Link>
          )}
          {n.ref.visitId && btn("done", "Mark done", () => completePlanVisit(n.ref.visitId!), false, "Visit marked done.")}
        </>
      );
      break;
    case "visit-soon":
      acts = (
        <>
          {visit?.phone && (
            <a className={cx("btn", "btn-ghost", "btn--xs")} href={`tel:${visit.phone.replace(/[^\d+]/g, "")}`}>
              Call
            </a>
          )}
          <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => goTab("schedule", n.ref.visitId ?? null)}>
            Move · staff
          </button>
        </>
      );
      break;
    case "reminder":
      acts = (
        <>
          {btn("done", "Done", () => setServiceReminderDone(n.ref.reminderId!, true), true, "Reminder done.")}
          {btn("snooze", "Tomorrow", () => snoozeServiceReminder(n.ref.reminderId!, 1), false, "Moved to tomorrow.")}
        </>
      );
      break;
    case "bill-late":
      acts = btn("paid", "Mark paid", () => markServicePlanInvoicePaid(n.ref.invoiceId!), true, "Marked paid — it counts in Financials.");
      break;
    case "lapsed":
      acts = btn("renew", "Renew now", () => renewServicePlan(n.ref.planId!), true, "Renewed — new visits are on the calendar.");
      break;
    case "renew":
      acts = (
        <>
          {btn("renew", "Renew now", () => renewServicePlan(n.ref.planId!), true, "Renewed — new visits are on the calendar.")}
          {plan?.status === "ACTIVE" && !plan.autoRenew && btn("auto", "Auto-renew", () => setPlanAutoRenew(n.ref.planId!, true), false, "It renews on its own now.")}
        </>
      );
      break;
    case "unsigned":
    case "draft":
      acts = (
        <>
          {btn("send", n.kind === "unsigned" ? "Send again" : "Send to sign", () => sendServicePlan(n.ref.planId!), n.kind === "draft", "Sent.")}
          {btn("start", "Start today", () => activateServicePlan(n.ref.planId!), false, "Started — the visits are on the calendar.")}
          {plan && (
            <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => act(k("copy"), async () => ((await copyText(plan.acceptHref)) ? { ok: true, note: "Sign link copied." } : { ok: false, error: plan.acceptHref }))}>
              Copy link
            </button>
          )}
        </>
      );
      break;
    case "replace":
      acts = (
        <>
          {n.clientId && (
            <Link className={cx("btn", "btn-primary", "btn--xs")} href={`/dashboard/hvac-estimator?client=${encodeURIComponent(n.clientId)}` as Route}>
              Quote the replacement
            </Link>
          )}
          <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => remind({ clientId: n.clientId, note: `Talk replacement — ${n.title.replace(/^Replacement candidate:\s*/, "")}` })}>
            Remind me
          </button>
        </>
      );
      break;
    case "offer-plan":
      acts = (
        <button type="button" className={cx("btn", "btn-primary", "btn--xs")} onClick={() => enroll({ clientId: n.clientId ?? undefined, proposalId: n.ref.proposalId ?? null })}>
          Offer a plan
        </button>
      );
      break;
  }

  return (
    <div className={cx("need")} data-tone={n.tone} data-need={n.kind}>
      <div>
        <div className={cx("need-t")}>{n.title}</div>
        {n.who && n.clientId && (
          <div className={cx("need-who")}>
            {plan ? (
              <button type="button" className={cx("linkish")} onClick={() => goTab("clients", plan.id)}>
                {n.who}
              </button>
            ) : (
              <Link className={cx("who")} href={clientHref(n.clientId) as Route}>
                {n.who}
              </Link>
            )}
          </div>
        )}
        <span className={cx("sub")}>{n.detail}</span>
      </div>
      <div className={cx("acts")}>{acts}</div>
    </div>
  );
}

