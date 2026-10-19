"use client";

// HVAC SERVICES · CLIENTS (2026-10-18): who is on a plan. One line each — the
// client and their address, the plan and where it stands, the next visit, the
// visits done, the bills, and what the plan BELONGS TO (the proposal or project
// it was sold with). A line opens to the whole story: the plan's terms and its
// buttons, every visit and bill, the equipment at the home with its age read,
// the proposal or project to tie it to, and the client's other work.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { activateServicePlan, cancelServicePlan, markServicePlanInvoicePaid, renewServicePlan, sendServicePlan, setPlanAutoRenew } from "@/actions/servicePlans";
import { linkServicePlan } from "@/actions/serviceDesk";
import { money } from "@/lib/servicePlans";
import type { ClientFilter } from "@/lib/serviceDesk";
import type { DeskPlanRow } from "@/lib/serviceDeskBook";
import { PHASE_LABEL, Plate, clientHref, copyText, cx, shortDay, usd, useDesk } from "./desk-shared";
import { STAGE_WORD } from "./desk-schedule";

const FILTERS: Array<{ key: ClientFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "signing", label: "Waiting to sign" },
  { key: "ending", label: "Ending" },
  { key: "past", label: "Past" },
];

export function ClientsTab() {
  const { data, focus, enroll } = useDesk();
  const [filter, setFilter] = useState<ClientFilter>(() => {
    const f = focus ? data.plans.find((p) => p.id === focus) : undefined;
    return f && f.filter === "past" ? "past" : "all";
  });
  const [q, setQ] = useState("");
  // The line to open: the one the desk pointed at (a just-enrolled plan arrives with the fresh read, after
  // this tab mounts — so it is read on every render until the contractor opens or closes a line).
  const [picked, setOpen] = useState<string | null | undefined>(undefined);
  const open = picked === undefined ? focus : picked;
  const counts = useMemo(() => {
    const c: Record<ClientFilter, number> = { all: 0, active: 0, signing: 0, ending: 0, past: 0 };
    for (const p of data.plans) {
      c[p.filter]++;
      if (p.filter !== "past") c.all++;
    }
    return c;
  }, [data.plans]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.plans.filter((p) => (filter === "all" ? p.filter !== "past" : p.filter === filter)).filter((p) => !needle || [p.clientName, p.address, p.name, p.email, p.phone, p.link?.label].some((s) => s?.toLowerCase().includes(needle)));
  }, [data.plans, filter, q]);

  return (
    <section className={cx("card")} data-desk-clients>
      <div className={cx("card-h")}>
        <div className={cx("card-t")}>Clients on a plan</div>
        <div className={cx("card-s")}>who they are · what they signed · what it belongs to · open a line for the whole story</div>
      </div>
      <div className={cx("toolbar")}>
        <input className={cx("search")} type="search" placeholder="Find a client, address or plan…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a client" data-client-search />
        <div className={cx("chips")}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={cx("chip", filter === f.key && "chip--on")} onClick={() => setFilter(f.key)} data-client-filter={f.key}>
              {f.label} <b>{counts[f.key]}</b>
            </button>
          ))}
        </div>
        <button type="button" className={cx("btn", "btn-primary", "btn--sm")} onClick={() => enroll({})}>
          Enroll a client
        </button>
      </div>

      {rows.length === 0 ? (
        <div className={cx("empty")}>{data.plans.length === 0 ? "No one is on a plan yet. Enroll a client — the visits go on the calendar and the bills go out on their own." : "No client matches."}</div>
      ) : (
        <>
          <div className={cx("chead")} aria-hidden="true">
            <span>Client</span>
            <span>Plan</span>
            <span>Next visit</span>
            <span>Visits · bills</span>
            <span>Belongs to</span>
            <span />
          </div>
          <div className={cx("clist")}>
            {rows.map((p) => (
              <ClientRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ClientRow({ p, open, onToggle }: { p: DeskPlanRow; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { focus } = useDesk();
  useEffect(() => {
    if (open && focus === p.id) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open, focus, p.id]);
  const late = p.openInvoices.filter((i) => i.late).length;
  const candidate = p.units.some((u) => u.candidate);
  return (
    <div ref={ref} className={cx("crow", open && "crow--open")} data-plan-row={p.phase} data-plan={p.id}>
      <button type="button" className={cx("crow-h")} onClick={onToggle} aria-expanded={open}>
        <span>
          <span className={cx("who")}>{p.clientName}</span>
          <span className={cx("sub")}>{p.address ?? p.phone ?? p.email ?? "no address on file"}</span>
        </span>
        <span>
          <Plate tone={p.phase}>{PHASE_LABEL[p.phase] ?? p.phase}</Plate>
          <span className={cx("sub")}>{p.name}</span>
        </span>
        <span>
          {p.nextVisit ? (
            <>
              <span className={cx("mono")}>
                {p.nextVisit.dayText} {p.nextVisit.time}
              </span>
              <span className={cx("sub")}>{p.nextVisit.label}</span>
            </>
          ) : (
            <span className={cx("sub")}>{p.status === "ACTIVE" ? "none scheduled" : "starts when signed"}</span>
          )}
        </span>
        <span>
          <span className={cx("mono")}>
            {p.visitsDone}/{p.visitsTotal} done
          </span>
          <span className={cx("sub")}>{p.openInvoices.length ? `${p.openInvoices.length} bill${p.openInvoices.length === 1 ? "" : "s"} open${late ? ` · ${late} late` : ""}` : "paid up"}</span>
        </span>
        <span>
          {p.link ? (
            <span className={cx("tag", "tag--hvac")} title={p.link.label}>
              {p.link.label}
            </span>
          ) : (
            <span className={cx("sub")}>not tied</span>
          )}
          {candidate && <span className={cx("sub")}>replacement candidate</span>}
        </span>
        <svg className={cx("ic", "crow-chev")} aria-hidden="true">
          <use href="#i-chevr" />
        </svg>
      </button>
      {open && <ClientDetail p={p} />}
    </div>
  );
}

function ClientDetail({ p }: { p: DeskPlanRow }) {
  const { data, act, busy, remind } = useDesk();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const visits = data.visits.filter((v) => v.planId === p.id);
  const k = (w: string) => `plan:${p.id}:${w}`;
  const btn = (w: string, label: string, fn: () => Promise<unknown>, primary = false, ok?: string) => (
    <button type="button" className={cx("btn", primary ? "btn-primary" : "btn-ghost", "btn--xs")} disabled={!!busy} onClick={() => act(k(w), fn, ok)} data-plan-act={w}>
      {busy === k(w) ? "…" : label}
    </button>
  );
  const linkValue = p.link?.proposalId ? `p:${p.link.proposalId}` : p.link?.projectId ? `j:${p.link.projectId}` : "";
  const [tie, setTie] = useState(linkValue);
  const candidate = p.units.find((u) => u.candidate);

  return (
    <div className={cx("cdetail")} data-plan-detail>
      <div>
        <div className={cx("sec-h")}>The plan</div>
        <dl className={cx("facts")}>
          <dt>Plan</dt>
          <dd>
            <b>{p.name}</b> — {p.terms}
          </dd>
          <dt>Term</dt>
          <dd>{p.startsAt ? `${shortDay(p.startsAt, data.tz)} – ${shortDay(p.endsAt, data.tz)}` : p.sentAt ? `sent ${shortDay(p.sentAt, data.tz)}, not signed yet` : "not started"}</dd>
          {p.status === "ACTIVE" && (
            <>
              <dt>Then</dt>
              <dd>{p.autoRenew ? "renews on its own" : "ends — no renewal"}</dd>
            </>
          )}
          <dt>Client</dt>
          <dd>
            {[p.phone, p.email].filter(Boolean).join(" · ") || "no phone or email on file"}
          </dd>
        </dl>
        <div className={cx("acts")} style={{ marginTop: 10 }}>
          {(p.status === "DRAFT" || p.status === "SENT") && (
            <>
              {btn("send", p.status === "SENT" ? "Send again" : "Send to sign", () => sendServicePlan(p.id), true, p.email ? "Sent to sign." : "No email on file — copy the sign link instead.")}
              {btn("start", "Start today", () => activateServicePlan(p.id), false, "Started — the visits are on the calendar.")}
              <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => act(k("copy"), async () => ((await copyText(p.acceptHref)) ? { ok: true, note: "Sign link copied." } : { ok: false, error: p.acceptHref }))}>
                Copy sign link
              </button>
            </>
          )}
          {(p.phase === "expiring" || p.phase === "lapsed" || p.status === "EXPIRED") && btn("renew", "Renew now", () => renewServicePlan(p.id), true, "Renewed — new visits are on the calendar.")}
          {p.status === "ACTIVE" && btn("auto", p.autoRenew ? "Stop auto-renew" : "Auto-renew", () => setPlanAutoRenew(p.id, !p.autoRenew), false, p.autoRenew ? "It will end at the term's end." : "It renews on its own now.")}
          {p.status !== "CANCELED" &&
            p.status !== "EXPIRED" &&
            (confirmCancel ? (
              <>
                <button type="button" className={cx("btn", "btn-ghost", "btn--xs", "btn--danger")} disabled={!!busy} onClick={() => act(k("cancel"), () => cancelServicePlan(p.id), "Canceled — its visits are off the calendar.")} data-plan-cancel-confirm>
                  Yes, cancel it
                </button>
                <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => setConfirmCancel(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => setConfirmCancel(true)}>
                Cancel plan
              </button>
            ))}
        </div>
        {confirmCancel && <p className={cx("hint")}>Canceling takes the visits ahead off the calendar and voids the unpaid plan bills.</p>}
      </div>

      <div>
        <div className={cx("sec-h")}>Visits</div>
        {visits.length === 0 ? (
          <div className={cx("empty")}>The visits land on the calendar when the plan starts.</div>
        ) : (
          <div className={cx("mini")}>
            {visits.map((v) => (
              <div key={v.id}>
                <span>
                  <span className={cx("mono")}>{v.dayText}</span> · {v.label}
                </span>
                <span className={cx("acts")}>
                  <Plate tone={v.stage}>{STAGE_WORD[v.stage]}</Plate>
                  {v.appointmentId && (
                    <Link className={cx("linkish")} href={`/dashboard/visits/${v.appointmentId}` as Route}>
                      report
                    </Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className={cx("sec-h")}>Bills</div>
        {p.openInvoices.length === 0 ? (
          <div className={cx("empty")}>{p.status === "ACTIVE" ? `Paid up · ${money(p.priceCents)} ${p.billing === "YEARLY" ? "a year" : "a month"}` : "No bills until it starts."}</div>
        ) : (
          <div className={cx("mini")}>
            {p.openInvoices.map((i) => (
              <div key={i.id}>
                <span>
                  <span className={cx("mono")}>{i.number}</span> · {usd(i.amount)} · due {shortDay(i.dueDate, data.tz)}
                  {i.late && (
                    <>
                      {" "}
                      <Plate tone="late">Late</Plate>
                    </>
                  )}
                </span>
                {btn(`paid-${i.id}`, "Mark paid", () => markServicePlanInvoicePaid(i.id), false, "Marked paid — it counts in Financials.")}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className={cx("sec-h")}>Belongs to</div>
        <form
          className={cx("acts")}
          onSubmit={(e) => {
            e.preventDefault();
            act(k("tie"), () => linkServicePlan(p.id, { proposalId: tie.startsWith("p:") ? tie.slice(2) : null, projectId: tie.startsWith("j:") ? tie.slice(2) : null }));
          }}
          data-plan-tie
        >
          <select className={cx("sel", "sel--sm")} value={tie} onChange={(e) => setTie(e.target.value)} aria-label="The proposal or project this plan belongs to">
            <option value="">Not tied to a proposal or project</option>
            {p.proposals.length > 0 && (
              <optgroup label="Proposals">
                {p.proposals.map((x) => (
                  <option key={x.id} value={`p:${x.id}`}>
                    {x.title} · {usd(x.total)} · {x.accepted ? "accepted" : x.status.toLowerCase()}
                  </option>
                ))}
              </optgroup>
            )}
            {p.projects.length > 0 && (
              <optgroup label="Projects">
                {p.projects.map((x) => (
                  <option key={x.id} value={`j:${x.id}`}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="submit" className={cx("btn", "btn-ghost", "btn--xs")} disabled={!!busy || tie === linkValue}>
            {busy === k("tie") ? "…" : "Save"}
          </button>
        </form>
        {p.link && (
          <p className={cx("hint")}>
            Sold with{" "}
            <Link className={cx("linkish")} href={p.link.href as Route}>
              {p.link.label}
            </Link>
          </p>
        )}

        <div className={cx("sec-h")}>Equipment at the home</div>
        {p.units.length === 0 ? (
          <div className={cx("empty")}>
            Nothing on file.{" "}
            <Link className={cx("linkish")} href={clientHref(p.clientId) as Route}>
              Add it on the client page
            </Link>{" "}
            — a nameplate photo fills it in.
          </div>
        ) : (
          p.units.map((u) => (
            <div key={u.line} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                {u.line} {u.candidate && <span className={cx("tag", "tag--warn")}>replacement candidate</span>}
              </div>
              {u.advice && <div className={cx("advice")}>{u.advice}</div>}
            </div>
          ))
        )}

        {(p.proposals.length > 0 || p.projects.length > 0) && (
          <>
            <div className={cx("sec-h")}>Their other work</div>
            <div className={cx("mini")}>
              {p.proposals.slice(0, 5).map((x) => (
                <div key={x.id}>
                  <Link href={`/dashboard/proposals/${x.id}` as Route}>{x.title}</Link>
                  <span className={cx("tag", x.hvac && "tag--hvac")}>{x.accepted ? "accepted" : x.status.toLowerCase()}</span>
                </div>
              ))}
              {p.projects.slice(0, 3).map((x) => (
                <div key={x.id}>
                  <Link href={`/dashboard/projects/${x.id}` as Route}>Project · {x.name}</Link>
                  <span className={cx("tag")}>{x.status.toLowerCase().replace("_", " ")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={cx("cfoot")}>
        <Link className={cx("btn", "btn-ghost", "btn--xs")} href={clientHref(p.clientId) as Route}>
          Client page
        </Link>
        <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => remind({ clientId: p.clientId, planId: p.id })}>
          Add a reminder{p.reminders ? ` · ${p.reminders} open` : ""}
        </button>
        {candidate && (
          <Link className={cx("btn", "btn-primary", "btn--xs")} href={`/dashboard/hvac-estimator?client=${encodeURIComponent(p.clientId)}` as Route}>
            Quote the replacement
          </Link>
        )}
      </div>
    </div>
  );
}
