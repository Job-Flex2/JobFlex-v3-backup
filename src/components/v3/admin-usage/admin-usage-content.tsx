"use client";

// ADMIN API USAGE — BLUEPRINT
// /admin/usage (owner, 2026-10-22)
//
// What each company's use of the paid APIs costs us in a period, and what it
// cost over everything kept (13 months). The server cuts the period in the
// database (lib/apiUsageReport); the period switch navigates (?period=), so a
// link to a period is a link to the same numbers. A company whose spend is
// over its plan's monthly price carries a flat red square, over half an amber
// one (lib/apiUsageShared spendFlag) — the page's main signal: we pay more for
// the company than it pays us. A row opens to its services. `?org=` opens one
// company and keeps it listed with no spend. Read-only; furniture from the
// partner-money kit (admin-influencers/admin-ui).

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PAID_SERVICE_LABEL, formatSpend } from "@/lib/paidApiCosts";
import { formatPlanPrice } from "@/lib/planCatalog";
import { USAGE_PERIOD_LABEL, spendFlag, type UsageOrgDTO, type UsagePeriod, type UsageReport, type UsageStatus } from "@/lib/apiUsageShared";
import { Chip, Empty, KpiStrip, Meta, Seg, cx, useReveal, type Tone } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./admin-usage.module.css";

const STATUS: Record<UsageStatus, { label: string; tone: Tone }> = {
  paying: { label: "Paying", tone: "ok" },
  trial: { label: "Trial", tone: "bp" },
  free: { label: "Free", tone: "mute" },
  grant: { label: "Grant", tone: "mute" },
};

const FLAG_TEXT = {
  over: "Spend in this period is over the plan's monthly price",
  half: "Spend in this period is over half the plan's monthly price",
} as const;

type SortKey = "period" | "all";

const calls = (n: number) => n.toLocaleString("en-US");
const callCount = (n: number) => `${calls(n)} ${n === 1 ? "call" : "calls"}`;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function usageHref(period: UsagePeriod, org: string | null): Route {
  const qs = new URLSearchParams();
  if (period !== "30") qs.set("period", period);
  if (org) qs.set("org", org);
  const s = qs.toString();
  return (s ? `/admin/usage?${s}` : "/admin/usage") as Route;
}

export function AdminUsageContent({ report, period, focusOrgId }: { report: UsageReport | null; period: UsagePeriod; focusOrgId: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sort, setSort] = useState<SortKey>("period");
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusOrgId ? [focusOrgId] : []));

  useEffect(() => {
    if (!focusOrgId) return;
    document.querySelector(`[data-usage-org="${CSS.escape(focusOrgId)}"]`)?.scrollIntoView({ block: "center" });
  }, [focusOrgId]);

  const orgs = useMemo(() => {
    const list = report?.orgs ?? [];
    return sort === "period" ? list : [...list].sort((a, b) => b.allCents - a.allCents || b.periodCents - a.periodCents);
  }, [report, sort]);
  const flagged = useMemo(() => orgs.filter((o) => spendFlag(o.periodCents, o.planCents) === "over").length, [orgs]);
  const focus = focusOrgId ? (report?.orgs.find((o) => o.id === focusOrgId) ?? null) : null;

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div ref={rootRef} className={cx(styles.root, pending && styles.pending)} aria-busy={pending}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Costs</div>
          <h1 className="page-title">API usage</h1>
        </div>
        <div className="page-actions">
          <Link className="btn" href="/admin/trials">
            Trial watch
          </Link>
        </div>
      </div>

      {report === null ? (
        <section className="card rv">
          <Empty>API spend is not set up in this database yet — apply prisma/sql/prod-2026-10-22-api-spend.sql.</Empty>
        </section>
      ) : (
        <>
          <div className={cx(styles.controls, "rv")}>
            <div className={styles.period}>
              <Seg<UsagePeriod>
                label="Period"
                value={period}
                onChange={(v) => startTransition(() => router.replace(usageHref(v, focusOrgId), { scroll: false }))}
                options={(["7", "30", "month", "last"] as const).map((value) => ({ value, label: USAGE_PERIOD_LABEL[value] }))}
              />
            </div>
            <p className={styles.range}>
              {dayLabel(report.from)} – {dayLabel(report.to)}, UTC days
            </p>
          </div>

          <KpiStrip
            cols={4}
            cells={[
              { label: "Spent", value: formatSpend(report.totalCents), accent: true },
              { label: "Companies with spend", value: String(report.orgsWithSpend) },
              { label: "Per paying company", value: report.payingOrgs ? formatSpend(report.payingCents / report.payingOrgs) : "—" },
              { label: "Over plan price", value: String(flagged), tone: flagged > 0 ? "bad" : undefined },
            ]}
          />
          <p className={cx(styles.note, "rv")}>
            {calls(report.totalCalls)} billed {report.totalCalls === 1 ? "call" : "calls"}. Per paying company is the paying companies&apos; spend over all{" "}
            {report.payingOrgs} of them. List-price estimates, not invoices; QA companies are not recorded.
          </p>

          {focusOrgId ? (
            <p className={cx(styles.focus, "rv")}>
              <span>{focus ? `Showing ${focus.name} open.` : "That company has no API spend on record."}</span>
              <Link href={usageHref(period, null)}>Show every company</Link>
            </p>
          ) : null}

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">By company</div>
                <div className="card-sub">Companies with spend in the period. Open a row for its services.</div>
              </div>
              <div className={styles.legend} aria-label="Legend">
                <span>
                  <i className={styles.flag} data-flag="over" aria-hidden="true" />
                  Over the plan&apos;s monthly price
                </span>
                <span>
                  <i className={styles.flag} data-flag="half" aria-hidden="true" />
                  Over half of it
                </span>
              </div>
            </div>
            {orgs.length === 0 ? (
              <Empty>No API spend in this period.</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="API spend by company">
                <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                  <span role="columnheader">Company</span>
                  <span role="columnheader">Plan</span>
                  <span role="columnheader">Status</span>
                  <SortHead label="Period" active={sort === "period"} onClick={() => setSort("period")} />
                  <SortHead label="All time" active={sort === "all"} onClick={() => setSort("all")} />
                  <span role="columnheader">
                    <span className={styles.sr}>Services</span>
                  </span>
                </div>
                {orgs.map((o) => (
                  <OrgRow key={o.id} org={o} open={open.has(o.id)} focused={o.id === focusOrgId} onToggle={() => toggle(o.id)} />
                ))}
              </div>
            )}
          </section>

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">By service</div>
                <div className="card-sub">Every company together, in the period. The operations under each name.</div>
              </div>
            </div>
            {report.services.length === 0 ? (
              <Empty>No billed calls in this period.</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="API spend by service">
                <div className={cx(ui.tr, ui.th, styles.svcCols)} role="row">
                  <span role="columnheader">Service</span>
                  <span role="columnheader" className={ui.thR}>
                    Calls
                  </span>
                  <span role="columnheader" className={ui.thR}>
                    Cost
                  </span>
                  <span role="columnheader" className={ui.thR}>
                    Share
                  </span>
                </div>
                {report.services.map((s) => (
                  <div key={s.service} className={cx(ui.tr, styles.svcCols)} role="row" data-usage-service={s.service}>
                    <span className={ui.tdWide} role="cell">
                      <span className={styles.name}>{PAID_SERVICE_LABEL[s.service] ?? s.service}</span>
                      <Meta>{s.ops.map((op) => `${op.op} ${formatSpend(op.cents)}`).join(" · ")}</Meta>
                    </span>
                    <span className={ui.tdNum} role="cell">
                      <span className={ui.tdLbl}>Calls</span>
                      {calls(s.calls)}
                    </span>
                    <span className={cx(ui.tdAmt, styles.amt)} role="cell" title={`${s.cents.toFixed(2)}¢`}>
                      <span className={ui.tdLbl}>Cost</span>
                      {formatSpend(s.cents)}
                    </span>
                    <span className={ui.tdNum} role="cell">
                      <span className={ui.tdLbl}>Share</span>
                      {pct(s.cents, report.totalCents)}
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

function SortHead({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <span role="columnheader" aria-sort={active ? "descending" : "none"} className={ui.thR}>
      <button type="button" className={cx(styles.sort, active && styles.sortOn)} onClick={onClick}>
        {label}
        {active ? " ↓" : ""}
      </button>
    </span>
  );
}

function OrgRow({ org, open, focused, onToggle }: { org: UsageOrgDTO; open: boolean; focused: boolean; onToggle: () => void }) {
  const flag = spendFlag(org.periodCents, org.planCents);
  const status = STATUS[org.status];
  const panelId = `usage-ops-${org.id}`;
  return (
    <div className={cx(ui.tr, styles.cols, focused && styles.focused)} role="row" data-usage-org={org.id} data-flag={flag ?? undefined}>
      <span className={ui.tdWide} role="cell">
        <span className={styles.company}>
          {flag ? <i className={styles.flag} data-flag={flag} role="img" aria-label={FLAG_TEXT[flag]} title={FLAG_TEXT[flag]} /> : null}
          {org.exists ? (
            <Link className={styles.org} href={`/admin/subscribers?org=${encodeURIComponent(org.id)}` as Route} title={org.name}>
              {org.name}
            </Link>
          ) : (
            <span className={ui.tdName}>{org.name}</span>
          )}
        </span>
      </span>
      <span className={styles.cell} role="cell">
        <span className={ui.tdLbl}>Plan</span>
        {org.planName}
        <span className={ui.tdSub}>{org.planCents === null ? "price unknown" : `${formatPlanPrice(org.planCents)}/mo`}</span>
      </span>
      <span className={styles.cell} role="cell">
        <span className={ui.tdLbl}>Status</span>
        <Chip tone={status.tone}>{status.label}</Chip>
      </span>
      <span className={cx(ui.tdAmt, styles.amt, flag && styles[`amt_${flag}`])} role="cell">
        <span className={ui.tdLbl}>Period</span>
        {formatSpend(org.periodCents)}
        <span className={ui.tdSub}>{org.planCents ? `${pct(org.periodCents, org.planCents)} of plan` : callCount(org.periodCalls)}</span>
      </span>
      <span className={cx(ui.tdNum, styles.all)} role="cell">
        <span className={ui.tdLbl}>All time</span>
        {formatSpend(org.allCents)}
      </span>
      <span className={styles.act} role="cell">
        <button type="button" className={cx("btn", "btn-sm", "btn-ghost", styles.open)} aria-expanded={open} aria-controls={panelId} onClick={onToggle} disabled={org.ops.length === 0}>
          {open ? "Hide" : "Services"}
        </button>
      </span>
      {open ? (
        <div id={panelId} className={styles.ops} role="cell">
          {org.ops.length === 0 ? (
            <span className={styles.opsNone}>No billed calls in this period.</span>
          ) : (
            org.ops.map((op) => (
              <div key={`${op.service} ${op.op}`} className={styles.op}>
                <span className={styles.opName}>
                  {PAID_SERVICE_LABEL[op.service] ?? op.service} <span className={styles.opKey}>{op.op}</span>
                </span>
                <span className={styles.opNum}>{callCount(op.calls)}</span>
                <span className={styles.opAmt}>{formatSpend(op.cents)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
