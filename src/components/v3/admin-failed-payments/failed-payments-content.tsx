"use client";

// ADMIN FAILED PAYMENTS — BLUEPRINT
// /admin/revenue/failed-payments (owner, 2026-10-21)
//
// Why plan charges fail and how many come back. The server hands over the
// last 90 days of tries (lib/paymentFailures); everything here is a cut of
// that list. The numbers count INVOICES (a bill that failed three times is one
// failed bill); the table at the foot lists every try. "Missed bills" leaves
// out the tries Stripe reported on a subscription that owed nothing (a
// declined plan change — `ignored`); "All declines" counts them too. An
// invoice's reason and card are its first failed try's in the period.
// Read-only; furniture from the partner-money kit (admin-influencers/admin-ui).

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { longDate, shortDate } from "@/lib/format";
import { CARD_FUNDINGS, FUNDING_LABELS, failureLabel, type CardFunding } from "@/lib/paymentFailureShared";
import { Chip, Empty, KpiStrip, Meta, Seg, cx, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./failed-payments.module.css";

export interface FailureRowDTO {
  id: string;
  at: string;
  orgId: string | null;
  orgName: string;
  invoiceId: string;
  attempt: number;
  amountCents: number;
  currency: string;
  /** The decline code, else Stripe's error code (lib/paymentFailureShared failureCode). */
  code: string;
  errorCode: string | null;
  message: string | null;
  cardBrand: string | null;
  cardFunding: CardFunding;
  cardLast4: string | null;
  isTrialEnd: boolean;
  ignored: boolean;
  recoveredAt: string | null;
}

type Period = "7" | "30" | "90";
type Scope = "owed" | "all";
const PT = { timeZone: "America/Los_Angeles" };
const PAGE = 50;

type Bill = { invoiceId: string; first: FailureRowDTO; amountCents: number; trial: boolean; recovered: boolean };
type Cut = { key: string; label: string; n: number; trial: number; recovered: number };

function cutBy(bills: Bill[], keyOf: (b: Bill) => string, labelOf: (k: string) => string, keep: readonly string[] = []): Cut[] {
  const m = new Map<string, Cut>(keep.map((k) => [k, { key: k, label: labelOf(k), n: 0, trial: 0, recovered: 0 }]));
  for (const b of bills) {
    const k = keyOf(b);
    const c = m.get(k) ?? { key: k, label: labelOf(k), n: 0, trial: 0, recovered: 0 };
    c.n += 1;
    if (b.trial) c.trial += 1;
    if (b.recovered) c.recovered += 1;
    m.set(k, c);
  }
  const out = [...m.values()];
  return keep.length ? out : out.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const brandName = (b: string | null) => (b ? (b === "amex" ? "Amex" : b.charAt(0).toUpperCase() + b.slice(1)) : null);

export function AdminFailedPaymentsContent({
  rows,
  asOf,
  truncated,
  stripeTest,
}: {
  rows: FailureRowDTO[] | null;
  /** When the server read the rows (epoch ms) — the periods count back from it. */
  asOf: number;
  /** The server stopped at its row cap: older tries of the window are missing. */
  truncated: boolean;
  stripeTest: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [period, setPeriod] = useState<Period>("30");
  const [scope, setScope] = useState<Scope>("owed");
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => rows ?? [], [rows]);
  const currency = list[0]?.currency ?? "usd";
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100);

  const inPeriod = useMemo(() => {
    const since = asOf - Number(period) * 86_400_000;
    return list.filter((r) => Date.parse(r.at) >= since);
  }, [list, period, asOf]);
  const notOwed = useMemo(() => inPeriod.filter((r) => r.ignored).length, [inPeriod]);
  const tries = useMemo(() => (scope === "owed" ? inPeriod.filter((r) => !r.ignored) : inPeriod), [inPeriod, scope]);

  const bills = useMemo<Bill[]>(() => {
    const m = new Map<string, FailureRowDTO[]>();
    for (const r of tries) m.set(r.invoiceId, [...(m.get(r.invoiceId) ?? []), r]);
    return [...m.entries()].map(([invoiceId, rs]) => {
      const byTry = rs.slice().sort((a, b) => a.attempt - b.attempt || Date.parse(a.at) - Date.parse(b.at));
      return {
        invoiceId,
        first: byTry[0],
        amountCents: byTry[byTry.length - 1].amountCents,
        trial: rs.some((r) => r.isTrialEnd),
        recovered: rs.some((r) => r.recoveredAt),
      };
    });
  }, [tries]);

  const total = bills.length;
  const trial = bills.filter((b) => b.trial).length;
  const recovered = bills.filter((b) => b.recovered).length;
  const lost = bills.filter((b) => !b.recovered).reduce((s, b) => s + b.amountCents, 0);
  const wonBack = bills.filter((b) => b.recovered).reduce((s, b) => s + b.amountCents, 0);
  const byReason = useMemo(() => cutBy(bills, (b) => b.first.code, failureLabel), [bills]);
  const byFunding = useMemo(() => cutBy(bills, (b) => b.first.cardFunding, (k) => FUNDING_LABELS[k as CardFunding], CARD_FUNDINGS), [bills]);
  const stripeBase = `https://dashboard.stripe.com/${stripeTest ? "test/" : ""}invoices/`;

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Revenue</div>
          <h1 className="page-title">Failed payments</h1>
        </div>
        <div className="page-actions">
          <Link className="btn" href="/admin/revenue">
            Revenue overview
          </Link>
        </div>
      </div>

      {rows === null ? (
        <section className="card rv">
          <Empty>Failed payments are not set up in this database yet — apply prisma/sql/prod-2026-10-21-payment-failures.sql.</Empty>
        </section>
      ) : (
        <>
          <div className={cx(styles.controls, "rv")}>
            <div className={styles.period}>
              <Seg<Period>
                label="Period"
                value={period}
                onChange={(v) => {
                  setPeriod(v);
                  setShown(PAGE);
                }}
                options={[
                  { value: "7", label: "7 days" },
                  { value: "30", label: "30 days" },
                  { value: "90", label: "90 days" },
                ]}
              />
            </div>
            <div className={styles.scope}>
              <Seg<Scope>
                label="Which failures"
                value={scope}
                onChange={(v) => {
                  setScope(v);
                  setShown(PAGE);
                }}
                options={[
                  { value: "owed", label: "Missed bills" },
                  { value: "all", label: `All declines${notOwed ? ` (+${notOwed})` : ""}` },
                ]}
              />
            </div>
          </div>

          <KpiStrip
            cols={6}
            cells={[
              { label: "Failed invoices", value: String(total), tone: total > 0 ? "bad" : undefined },
              { label: "At trial end", value: String(trial), tone: trial > 0 ? "warn" : undefined },
              { label: "Recovered", value: String(recovered), tone: recovered > 0 ? "ok" : undefined },
              { label: "Recovery rate", value: pct(recovered, total), accent: true },
              { label: "Lost", value: money(lost), tone: lost > 0 ? "bad" : undefined },
              { label: "Won back", value: money(wonBack), tone: wonBack > 0 ? "ok" : undefined },
            ]}
          />
          {total > 0 ? (
            <p className={cx(styles.note, "rv")}>
              {trial} of {total} failed invoices ({pct(trial, total)}) were the first charge after a trial.
              {truncated ? " Only the newest 5,000 tries of the 90 days are loaded." : ""}
            </p>
          ) : truncated ? (
            <p className={cx(styles.note, "rv")}>Only the newest 5,000 tries of the 90 days are loaded.</p>
          ) : null}

          <div className={cx(styles.cuts, "rv")}>
            <CutCard
              title="By decline reason"
              sub="The bank's decline code, else Stripe's error — the invoice's first failed try."
              cuts={byReason}
              total={total}
              mono
            />
            <CutCard title="By card type" sub="What the declined card was. Prepaid cards are their own row." cuts={byFunding} total={total} />
          </div>

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Latest failures</div>
                <div className="card-sub">
                  Every declined try, newest first — a bill Stripe retried shows once per try. {tries.length} {tries.length === 1 ? "try" : "tries"}.
                </div>
              </div>
            </div>
            {tries.length === 0 ? (
              <Empty>{list.length === 0 ? "No failed plan payments on record yet." : "No failed plan payments in this period."}</Empty>
            ) : (
              <>
                <div className={ui.tbl} role="table" aria-label="Failed payments">
                  <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                    <span>Date</span>
                    <span>Company</span>
                    <span className={ui.thR}>Amount</span>
                    <span>Try</span>
                    <span>Reason</span>
                    <span>Card</span>
                    <span>Trial</span>
                    <span>Outcome</span>
                  </div>
                  {tries.slice(0, shown).map((r) => (
                    <div key={r.id} className={cx(ui.tr, styles.cols)} role="row" data-failure={r.id}>
                      <span className={styles.cell}>
                        <span className={ui.tdLbl}>Date</span>
                        <span title={longDate(r.at, PT)}>{shortDate(r.at, PT)}</span>
                      </span>
                      <span className={ui.tdWide}>
                        {r.orgId ? (
                          <Link className={styles.org} href={`/admin/subscribers?org=${encodeURIComponent(r.orgId)}`} title={r.orgName}>
                            {r.orgName}
                          </Link>
                        ) : (
                          <span className={ui.tdName}>{r.orgName}</span>
                        )}
                        <a className={styles.inv} href={stripeBase + r.invoiceId} target="_blank" rel="noreferrer">
                          {r.invoiceId} ↗
                        </a>
                      </span>
                      <span className={cx(ui.tdAmt, styles.amt)}>
                        <span className={ui.tdLbl}>Amount</span>
                        {money(r.amountCents)}
                      </span>
                      <span className={styles.cell}>
                        <span className={ui.tdLbl}>Try</span>#{r.attempt}
                      </span>
                      <span className={styles.cell}>
                        <span className={ui.tdLbl}>Reason</span>
                        <span className={styles.reason} title={r.message ?? undefined}>
                          {failureLabel(r.code)}
                        </span>
                        <Meta>{r.code}</Meta>
                      </span>
                      <span className={styles.cell}>
                        <span className={ui.tdLbl}>Card</span>
                        {r.cardBrand || r.cardLast4 ? `${brandName(r.cardBrand) ?? "Card"}${r.cardLast4 ? ` ·· ${r.cardLast4}` : ""}` : "—"}
                        <span className={ui.tdSub}>{FUNDING_LABELS[r.cardFunding]}</span>
                      </span>
                      <span className={styles.cell}>
                        <span className={ui.tdLbl}>Trial end</span>
                        {r.isTrialEnd ? <Chip tone="wait">Trial end</Chip> : <Meta>—</Meta>}
                      </span>
                      <span className={styles.cell}>
                        <span className={ui.tdLbl}>Outcome</span>
                        {r.recoveredAt ? (
                          <span title={longDate(r.recoveredAt, PT)}>
                            <Chip tone="ok">Recovered {shortDate(r.recoveredAt, PT)}</Chip>
                          </span>
                        ) : r.ignored ? (
                          <Chip tone="mute">Not owed</Chip>
                        ) : (
                          <Chip tone="bad">Unpaid</Chip>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {tries.length > shown ? (
                  <div className={styles.more}>
                    <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
                      Show {Math.min(PAGE, tries.length - shown)} more
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CutCard({ title, sub, cuts, total, mono = false }: { title: string; sub: string; cuts: Cut[]; total: number; mono?: boolean }) {
  return (
    <section className="card">
      <div className={cx("card-head", ui.cardHead)}>
        <div className="card-titles">
          <div className="card-title">{title}</div>
          <div className="card-sub">{sub}</div>
        </div>
      </div>
      {cuts.length === 0 ? (
        <Empty>Nothing failed in this period.</Empty>
      ) : (
        <div className={ui.tbl} role="table" aria-label={title}>
          <div className={cx(ui.tr, ui.th, styles.cutCols)} role="row">
            <span>{mono ? "Reason" : "Card"}</span>
            <span className={ui.thR}>Invoices</span>
            <span className={ui.thR}>Share</span>
            <span className={ui.thR}>Trial end</span>
            <span className={ui.thR}>Recovered</span>
          </div>
          {cuts.map((c) => (
            <div key={c.key} className={cx(ui.tr, styles.cutCols)} role="row" data-cut={c.key}>
              <span className={ui.tdWide}>
                <span className={styles.reason}>{c.label}</span>
                {mono ? <Meta>{c.key}</Meta> : null}
              </span>
              <span className={cx(ui.tdNum, c.n === 0 && ui.tdNumMute)}>
                <span className={ui.tdLbl}>Invoices</span>
                {c.n}
              </span>
              <span className={cx(ui.tdNum, c.n === 0 && ui.tdNumMute)}>
                <span className={ui.tdLbl}>Share</span>
                {pct(c.n, total)}
              </span>
              <span className={cx(ui.tdNum, c.trial === 0 && ui.tdNumMute)}>
                <span className={ui.tdLbl}>Trial end</span>
                {c.trial}
              </span>
              <span className={cx(ui.tdNum, c.recovered === 0 && ui.tdNumMute)}>
                <span className={ui.tdLbl}>Recovered</span>
                {c.n ? `${c.recovered} · ${pct(c.recovered, c.n)}` : "0"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
