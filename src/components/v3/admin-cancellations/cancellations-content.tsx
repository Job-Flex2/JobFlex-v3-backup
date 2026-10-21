"use client";

// ADMIN CANCELLATIONS — BLUEPRINT
// /admin/cancellations (owner, 2026-10-20)
//
// Every cancellation with its reasons (lib/cancelFeedback), newest first, and
// one filter: a reason. The counts above the table are the reasons' totals over
// every row (a cancellation may carry several). Read-only; furniture from the
// partner-money kit (admin-influencers/admin-ui).

import { useMemo, useRef, useState } from "react";
import { longDate, shortDate } from "@/lib/format";
import { CANCEL_REASONS, reasonLabel, type CancelReason } from "@/lib/cancelFeedback";
import { Empty, KpiStrip, Meta, cx, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./cancellations.module.css";

export interface CancellationDTO {
  id: string;
  orgName: string;
  email: string;
  planName: string;
  reasons: CancelReason[];
  otherText: string | null;
  /** When the plan switches to Free (the end of the paid cycle or trial). */
  periodEnd: string | null;
  createdAt: string;
}

type Filter = "ALL" | CancelReason;
export function AdminCancellationsContent({ rows, last30 }: { rows: CancellationDTO[] | null; /** Booked in the last 30 days (counted on the server). */ last30: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [filter, setFilter] = useState<Filter>("ALL");
  const list = useMemo(() => rows ?? [], [rows]);

  const counts = useMemo(() => {
    const c = new Map<Filter, number>([["ALL", list.length]]);
    for (const r of list) for (const k of r.reasons) c.set(k, (c.get(k) ?? 0) + 1);
    return c;
  }, [list]);
  const shown = useMemo(() => (filter === "ALL" ? list : list.filter((r) => r.reasons.includes(filter))), [list, filter]);
  const top = useMemo(
    () => CANCEL_REASONS.map((r) => ({ key: r.key, n: counts.get(r.key) ?? 0 })).sort((a, b) => b.n - a.n)[0],
    [counts],
  );

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Subscriptions</div>
          <h1 className="page-title">Cancellations</h1>
        </div>
      </div>

      {rows === null ? (
        <section className="card rv">
          <Empty>Cancellation reasons are not set up in this database yet — apply prisma/sql/prod-2026-10-20-cancel-feedback-trial-requests.sql.</Empty>
        </section>
      ) : (
        <>
          <KpiStrip
            cells={[
              { label: "Cancellations", value: String(list.length) },
              { label: "Last 30 days", value: String(last30), tone: last30 > 0 ? "warn" : undefined },
              { label: "In their own words", value: String(counts.get("other") ?? 0) },
              { label: top && top.n > 0 ? `Top reason · ${top.n}` : "Top reason", value: top && top.n > 0 ? reasonLabel(top.key) : "—", accent: true },
            ]}
          />

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Why they cancelled</div>
                <div className="card-sub">Ticked on &ldquo;Cancel &lt;plan&gt;?&rdquo; — one cancellation can give several reasons.</div>
              </div>
            </div>
            {/* A phone gets the house select: eight reasons as chips fill the screen. */}
            <label className={styles.pick}>
              <span className={ui.tdLbl}>Reason</span>
              <span className="bp-sel bp-sel--admin">
                <select className="bp-sel-in" value={filter} aria-label="Filter by reason" onChange={(e) => setFilter(e.target.value as Filter)}>
                  {([{ key: "ALL", label: "All reasons" }, ...CANCEL_REASONS] as { key: Filter; label: string }[]).map((f) => (
                    <option key={f.key} value={f.key}>{`${f.label} (${counts.get(f.key) ?? 0})`}</option>
                  ))}
                </select>
              </span>
            </label>
            <div className={cx(ui.filters, styles.filters)} role="group" aria-label="Filter by reason">
              {([{ key: "ALL", label: "All" }, ...CANCEL_REASONS] as { key: Filter; label: string }[]).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={cx(ui.filter, filter === f.key && ui.filterOn)}
                  aria-pressed={filter === f.key}
                  data-reason-filter={f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <i>{counts.get(f.key) ?? 0}</i>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <Empty>{list.length === 0 ? "No cancellations with reasons yet." : `Nobody gave “${reasonLabel(filter)}”.`}</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="Cancellations">
                <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                  <span>Date</span>
                  <span>Company</span>
                  <span>Plan</span>
                  <span>Reasons</span>
                  <span>To Free</span>
                </div>
                {shown.map((r) => (
                  <div key={r.id} className={cx(ui.tr, styles.cols)} role="row" data-cancellation={r.id}>
                    <span className={styles.date}>
                      <span className={ui.tdLbl}>Date</span>
                      <span title={longDate(r.createdAt)}>{shortDate(r.createdAt)}</span>
                    </span>
                    <span className={ui.tdWide}>
                      <span className={ui.tdName} title={r.orgName}>
                        {r.orgName}
                      </span>
                      <span className={ui.tdSub} title={r.email}>
                        {r.email}
                      </span>
                    </span>
                    <span className={styles.date}>
                      <span className={ui.tdLbl}>Plan</span>
                      {r.planName}
                    </span>
                    <span className={ui.tdWide}>
                      <span className={ui.tdLbl}>Reasons</span>
                      <span className={styles.reasons}>
                        {r.reasons.map((k) => (
                          <span key={k} className={styles.reason}>
                            {reasonLabel(k)}
                          </span>
                        ))}
                      </span>
                      {r.otherText ? <span className={styles.other}>{`“${r.otherText}”`}</span> : null}
                    </span>
                    <span className={styles.date}>
                      <span className={ui.tdLbl}>Switches to Free</span>
                      {r.periodEnd ? longDate(r.periodEnd) : <Meta>—</Meta>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
