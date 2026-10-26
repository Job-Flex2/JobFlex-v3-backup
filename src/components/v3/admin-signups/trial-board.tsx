"use client";

// ADMIN · SIGNUPS & TRIALS — /admin/traffic/signups (owner, 2026-10-12: "move the sign up section to its own page under
// Traffic … how many on the trial with a card and without, in order who expires first, who started paying and with the
// card or with no card, a statistic for the seven days of the trial … super smart, very easy to understand … and on each
// trial card what they did").
//
// Top to bottom, the way the owner reads it: three sentences, four numbers, the trials in the order they end (each with
// its card, its day of seven, its odds and what it made — open it for everything it did), the calendar of signup days
// and what became of each day's trials, who started paying and how, who left without paying, and the full signups list
// that used to sit at the foot of the traffic page. Every day is the traffic page's day (lib/trialBoard).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { getTrialActivity, getTrialBoard } from "@/actions/trialBoard";
import type { ActivityItem, ProposalLook, TrialActivity } from "@/lib/trialBoardRead";
import { DAY_MS, PAID_HOW_LABEL, dayInline, dayWords, fromNow, leftWords, pct, timeWords, workWords, type BoardRow, type CohortDay, type TrialBoard } from "@/lib/trialBoard";
import { TRAFFIC_TZ } from "@/lib/traffic-visitor";
import type { SignupLedger } from "@/lib/traffic-live";
import { SignupLedgerPanel } from "@/components/v3/admin-traffic/signup-ledger";
import { EmailContractorButton } from "@/components/v3/admin-mail/contractor-mail";
import { Ic } from "@/components/v3/admin-overview/admin-ui";
import ts from "@/components/v3/admin-traffic/traffic.module.css";
import b from "./trial-board.module.css";

const REFRESH_MS = 60_000;
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
/** "Professional · $79/mo", "Professional" when no price is on record. */
const planPrice = (r: BoardRow) => [r.plan || (r.monthlyCents !== null ? "Plan" : ""), r.monthlyCents !== null ? `${money(r.monthlyCents)}/mo` : ""].filter(Boolean).join(" · ");

export function TrialBoardContent({ initial, ledger }: { initial: TrialBoard; ledger: SignupLedger | null }) {
  const [board, setBoard] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // A new server read (router refresh) replaces the board — adjusted while rendering, not from an effect.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setBoard(initial);
  }
  const reload = useCallback(async () => {
    setPending(true);
    try {
      setBoard(await getTrialBoard());
      setError("");
    } catch {
      setError("The board could not be refreshed. It shows the last read.");
    } finally {
      setPending(false);
    }
  }, []);
  // A minute at a time while the page is in front: a trial ending, a card added, a payer.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") void reload();
        tick();
      }, REFRESH_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, [reload]);

  const now = board.now;
  const byId = useMemo(() => new Map(board.rows.map((r) => [r.orgId, r])), [board.rows]);
  const rowsOf = (ids: readonly string[]) => ids.map((id) => byId.get(id)).filter((r): r is BoardRow => !!r);
  const ending = rowsOf(board.ending);
  const payers = rowsOf(board.startedPaying);
  const left = rowsOf(board.left);
  const w = board.decided.week;
  const t = board.onTrial;

  // The trials, under the day they end.
  const endingDays: Array<{ label: string; rows: BoardRow[] }> = [];
  for (const r of ending) {
    const label = r.trialEnd === null ? "No end date" : dayWords(r.trialEnd, now);
    const last = endingDays[endingDays.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else endingDays.push({ label, rows: [r] });
  }

  return (
    <div className={b.page} aria-busy={pending}>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · Traffic</div>
          <h1 className="page-title">Signups &amp; trials</h1>
        </div>
        <div className={b.headSide}>
          <span className={b.updated}>Updated {timeWords(now)}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void reload()} disabled={pending} data-board-refresh>
            <Ic id="i-undo" />
            {pending ? "Refreshing…" : "Refresh"}
          </button>
          <Link className="btn btn-ghost" href={"/admin/traffic" as Route}>
            <Ic id="i-chart" />
            Traffic
          </Link>
        </div>
      </div>

      <p className={b.headline} data-board-headline>
        {board.headline}
      </p>
      {error && (
        <p className={b.error} role="status">
          {error}
        </p>
      )}

      <div className={`kpi-grid ${b.kpi5}`}>
        <div className="kpi" data-kpi="on-trial">
          <div className="kpi-lbl">On a trial now</div>
          <div className="kpi-val">{t.total}</div>
          <div className={b.kpiSub}>
            <span className={b.dot} data-tone="good" />
            {t.card} with a card · <span className={b.dot} data-tone="warn" />
            {t.nocard} without
          </div>
        </div>
        {/* SET TO CANCEL (owner, 2026-10-12): trials whose owner pressed Cancel — they end with the trial and are
            charged nothing, card or not, unless they resume. */}
        <div className="kpi" data-kpi="set-to-cancel">
          <div className="kpi-lbl">Set to cancel at trial end</div>
          <div className={t.setToCancel > 0 ? `kpi-val ${b.kpiBad}` : "kpi-val"}>{t.setToCancel}</div>
          <div className={b.kpiSub}>{t.setToCancelCard} with a card · nothing is charged unless they resume</div>
        </div>
        <div className="kpi" data-kpi="ending">
          <div className="kpi-lbl">Trials ending today</div>
          <div className={t.endsToday > 0 ? "kpi-val accent" : "kpi-val"}>{t.endsToday}</div>
          <div className={b.kpiSub}>{t.endsTomorrow} tomorrow</div>
        </div>
        <div className="kpi" data-kpi="started">
          <div className="kpi-lbl">Trials started · 7 days</div>
          <div className="kpi-val">{board.started.trials}</div>
          <div className={b.kpiSub}>
            <span className={b.dot} data-tone="good" />
            {board.started.card} with a card · <span className={b.dot} data-tone="warn" />
            {board.started.nocard} without
          </div>
          <div className={b.kpiSub}>signed up since {dayInline(board.since, now)}</div>
        </div>
        {/* ENDED, NOT "DECIDED" (owner, 2026-10-26: "is it for the last 7 days or how does it count? It's confusing"):
            the trials whose 7 days ran out on the same days as the tile beside it, and how many of them pay. */}
        <div className="kpi" data-kpi="decided">
          <div className="kpi-lbl">Trials ended · 7 days</div>
          <div className="kpi-val">
            {w.paid}{" "}
            <span className={b.kpiOf}>
              paid of {w.total}
              {w.total > 0 ? ` · ${pct(w.paid, w.total)}%` : ""}
            </span>
          </div>
          <div className={b.kpiSub}>
            {w.total - w.paid} didn&apos;t pay{w.failed > 0 ? ` (${w.failed} card failed)` : ""}
            {w.nocard.total > 0 ? ` · card ${w.card.paid}/${w.card.total} · no card ${w.nocard.paid}/${w.nocard.total}` : ""}
          </div>
          <div className={b.kpiSub}>trials that ended since {dayInline(board.since, now)}</div>
        </div>
      </div>

      {/* ── the trials, in the order they end ── */}
      <section className={b.card} aria-labelledby="board-ending" data-board-ending>
        <header className={b.cardHead}>
          <div>
            <h2 id="board-ending">Ending next</h2>
            <p>Every account on a trial now, the one that ends first at the top.</p>
          </div>
          {t.priced > 0 && (
            <div className={b.cardFacts}>
              <b>{money(t.monthlyCents)}/mo</b> if all {t.priced} pay · <b>{money(t.likelyCents)}</b> likely
              {t.priced < t.total ? ` · ${t.total - t.priced} without a price` : ""}
            </div>
          )}
        </header>
        {ending.length === 0 ? (
          <p className={b.empty}>No one is on a trial right now.</p>
        ) : (
          endingDays.map((day) => (
            <div key={day.label} className={b.dayGroup}>
              <h3 className={b.dayLabel}>
                {day.label}
                <span>
                  {day.rows.length} {day.rows.length === 1 ? "trial ends" : "trials end"}
                </span>
              </h3>
              <ol className={b.trials}>
                {day.rows.map((r) => (
                  <TrialCard key={r.orgId} r={r} now={now} />
                ))}
              </ol>
            </div>
          ))
        )}
      </section>

      {/* ── the seven-day calendar ── */}
      <section className={b.card} aria-labelledby="board-calendar" data-board-calendar>
        <header className={b.cardHead}>
          <div>
            <h2 id="board-calendar">The 7-day calendar</h2>
            <p>Each signup day of the last two weeks and what became of its trials — a trial is seven days, so a day&apos;s trials are decided a week later. Open a day to see who.</p>
          </div>
          <div className={b.legend} aria-hidden="true">
            <span data-seg="paying">Paying</span>
            <span data-seg="trial">On trial</span>
            <span data-seg="left">Left</span>
            <span data-seg="failed">Card failed</span>
          </div>
        </header>
        <Calendar days={board.calendar} byId={byId} now={now} />
      </section>

      {/* ── who pays, and how ── */}
      <section className={b.card} aria-labelledby="board-paying" data-board-paying>
        <header className={b.cardHead}>
          <div>
            <h2 id="board-paying">Started paying</h2>
            <p>Every paying account, the newest payer first — and whether the card came with the signup or after it.</p>
          </div>
          <div className={b.cardFacts}>
            <b>{payers.length}</b> paying
            {payers.some((r) => r.monthlyCents !== null) ? (
              <>
                {" "}· <b>{money(payers.reduce((sum, r) => sum + (r.monthlyCents ?? 0), 0))}</b>/mo
              </>
            ) : null}
          </div>
        </header>
        {payers.length === 0 ? (
          <p className={b.empty}>No one pays yet.</p>
        ) : (
          <ol className={b.list}>
            {payers.map((r) => (
              <li key={r.orgId} className={b.listRow} data-paid-how={r.paidHow ?? ""}>
                <div className={b.listWho}>
                  <b>{r.orgName}</b>
                  <span>{[r.ownerName, r.ownerEmail].filter(Boolean).join(" · ") || "no owner yet"}</span>
                </div>
                <div className={b.listWhat}>
                  <span className={b.chip} data-tone={r.paidHow === "card-at-signup" ? "good" : "info"}>
                    {r.paidHow ? PAID_HOW_LABEL[r.paidHow] : "Paying"}
                  </span>
                  {planPrice(r) && <span>{planPrice(r)}</span>}
                </div>
                <div className={b.listWhen}>
                  <b>{r.paidFrom !== null ? dayWords(r.paidFrom, now) : "—"}</b>
                  <span>{workWords(r.work)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── who left ── */}
      <section className={b.card} aria-labelledby="board-left" data-board-left>
        <header className={b.cardHead}>
          <div>
            <h2 id="board-left">Left without paying</h2>
            <p>Trials of the last two weeks that ended with no payment — and what they had done by then.</p>
          </div>
        </header>
        {left.length === 0 ? (
          <p className={b.empty}>No trial has ended without paying in the last two weeks.</p>
        ) : (
          <ol className={b.list}>
            {left.map((r) => (
              <li key={r.orgId} className={b.listRow} data-left={r.phase}>
                <div className={b.listWho}>
                  <b>{r.orgName}</b>
                  <span>{[r.ownerName, r.ownerEmail].filter(Boolean).join(" · ") || "no owner yet"}</span>
                </div>
                <div className={b.listWhat}>
                  <span className={b.chip} data-tone={r.phase === "failed" ? "bad" : "muted"}>
                    {leftWords(r)}
                  </span>
                  <span>{r.kind === "card" ? "Card at signup" : r.cardNow ? "Added a card" : "No card at signup"}</span>
                </div>
                <div className={b.listWhen}>
                  <b>{r.decidedAt !== null ? dayWords(r.decidedAt, now) : "—"}</b>
                  <span>{workWords(r.work)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── every signup (moved here from the traffic page) ── */}
      {ledger && (
        <div className={ts.root} data-board-ledger>
          <SignupLedgerPanel initial={ledger} timezone={TRAFFIC_TZ} title="Every signup" intro="Every account made in the span — trial or not — where it came from, and what it is now." />
        </div>
      )}
      {board.tests > 0 && (
        <p className={b.foot}>
          {board.tests} test-mode {board.tests === 1 ? "trial is" : "trials are"} left out of every count.
        </p>
      )}
    </div>
  );
}

/** One trial: who, when it ends, its card, its day of seven, its odds, what it made — and everything it did, opened. */
function TrialCard({ r, now }: { r: BoardRow; now: number }) {
  const [open, setOpen] = useState(false);
  const soon = r.trialEnd !== null && r.trialEnd - now < DAY_MS;
  const card = r.kind === "card" ? "Card at signup" : r.cardNow ? `Card added ${r.cardAddedAt !== null ? dayInline(r.cardAddedAt, now) : ""}`.trim() : "No card";
  return (
    <li className={b.trial} data-card={r.cardNow ? "card" : "nocard"} data-board-trial={r.orgId}>
      <div className={b.trialTop}>
        <div className={b.who}>
          <b>{r.orgName}</b>
          <span>
            {[r.ownerName, r.ownerEmail].filter(Boolean).join(" · ") || "no owner yet"}
            {r.source ? ` · ${r.fromAd ? "ad · " : ""}${r.source}` : ""}
            {r.campaign ? ` · ${r.campaign}` : ""}
          </span>
        </div>
        {r.trialEnd !== null && (
          <div className={b.ends} data-soon={soon ? "" : undefined}>
            <b>
              Ends {dayInline(r.trialEnd, now)} {timeWords(r.trialEnd)}
            </b>
            <span>{fromNow(r.trialEnd, now)}</span>
          </div>
        )}
      </div>
      <div className={b.chips}>
        <span className={b.chip} data-tone={r.cardNow ? "good" : "warn"} data-board-card>
          {card}
        </span>
        {r.cancelsAtEnd && (
          <span className={b.chip} data-tone="bad" data-board-cancel>
            Set to cancel{r.canceledAt !== null ? ` ${dayInline(r.canceledAt, now)}` : ""} — ends with the trial
          </span>
        )}
        {planPrice(r) && <span className={b.chip}>{planPrice(r)}</span>}
        {r.trialDays !== null && r.dayOfTrial !== null && <TrialDays day={r.dayOfTrial} of={r.trialDays} />}
        {r.chance !== null && (
          <span className={b.chip} data-tone="info">
            {Math.round(r.chance * 100)}% likely{r.tierLabel ? ` · ${r.tierLabel}` : ""}
          </span>
        )}
      </div>
      <p className={b.did}>
        <b>Did:</b> {workWords(r.work)}
        {r.work.lastSeen !== null ? ` · last seen ${fromNow(r.work.lastSeen, now)}` : " · not seen in the app yet"}
      </p>
      <div className={b.trialActions}>
        <button type="button" className={b.openBtn} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-board-activity-toggle>
          {open ? "Hide what they did" : "See what they did"}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {r.ownerEmail && <EmailContractorButton orgId={r.orgId} seed={{ business: r.orgName, ownerName: r.ownerName, ownerEmail: r.ownerEmail }} />}
      </div>
      {open && <ActivityPanel orgId={r.orgId} now={now} />}
    </li>
  );
}

/** Day N of the trial as N filled cells of its length. */
function TrialDays({ day, of }: { day: number; of: number }) {
  const cells = Math.min(of, 31);
  return (
    <span className={b.days} aria-label={`Day ${day} of ${of}`} data-board-day={`${day}/${of}`}>
      <span className={b.daysCells} aria-hidden="true">
        {Array.from({ length: cells }, (_, i) => (
          <i key={i} data-on={i < day ? "" : undefined} data-last={i === cells - 1 ? "" : undefined} />
        ))}
      </span>
      Day {day} of {of}
    </span>
  );
}

const KIND_WORD: Record<ActivityItem["kind"], string> = {
  action: "Did",
  client: "Client",
  proposal: "Proposal",
  estimate: "Estimate",
  brief: "Smart Proposal",
  session: "In the app",
};

/** Everything the account did, newest first, by day; a proposal opens to its lines. */
function ActivityPanel({ orgId, now }: { orgId: string; now: number }) {
  const [state, setState] = useState<{ activity?: TrialActivity; error?: string } | null>(null);
  const [all, setAll] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getTrialActivity({ orgId })
      .then((res) => {
        if (live) setState(res.ok ? { activity: res.activity } : { error: res.error });
      })
      .catch(() => {
        if (live) setState({ error: "The activity could not be read. Try again." });
      });
    return () => {
      live = false;
    };
  }, [orgId]);
  if (!state) return <div className={b.activity} data-board-activity="loading">Reading what they did…</div>;
  if (state.error || !state.activity) return <div className={b.activity} data-board-activity="error">{state.error}</div>;
  const a = state.activity;
  const items = all ? a.items : a.items.slice(0, 40);
  const days: Array<{ label: string; items: ActivityItem[] }> = [];
  for (const it of items) {
    const label = dayWords(Date.parse(it.at), now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(it);
    else days.push({ label, items: [it] });
  }
  return (
    <div className={b.activity} data-board-activity="ready">
      {a.items.length === 0 ? (
        <p className={b.empty}>Nothing recorded yet — no proposal, estimate or brief, and no time in the app{a.viewsAvailable ? "" : " (page views are not recorded in this database)"}.</p>
      ) : (
        days.map((d) => (
          <div key={d.label} className={b.actDay}>
            <h4>{d.label}</h4>
            <ol>
              {d.items.map((it) => {
                const p: ProposalLook | undefined = it.proposalId ? a.proposals[it.proposalId] : undefined;
                return (
                  <li key={it.id} data-kind={it.kind}>
                    <time>{timeWords(Date.parse(it.at))}</time>
                    <span className={b.actKind}>{KIND_WORD[it.kind]}</span>
                    <span className={b.actText}>
                      {it.text}
                      {it.who ? <em> · {it.who}</em> : null}
                      {p && (
                        <button type="button" className={b.peekBtn} aria-expanded={peek === it.id} onClick={() => setPeek(peek === it.id ? null : it.id)} data-board-peek={p.id}>
                          {peek === it.id ? "Close the proposal" : "Open the proposal"}
                        </button>
                      )}
                    </span>
                    {p && peek === it.id && <ProposalPeek p={p} now={now} />}
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
      {a.items.length > 40 && (
        <button type="button" className={b.moreBtn} onClick={() => setAll((x) => !x)}>
          {all ? "Show the latest 40" : `Show all ${a.items.length}`}
        </button>
      )}
    </div>
  );
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A proposal as it stands — its lines and its totals, read from the database (opening the client's page would count as the client's view). */
function ProposalPeek({ p, now }: { p: ProposalLook; now: number }) {
  const facts = [
    p.clientName ? `for ${p.clientName}` : "",
    p.address ?? "",
    p.sentAt ? `sent ${dayInline(Date.parse(p.sentAt), now)}` : "not sent",
    p.viewedAt ? `opened by the client ${p.viewCount > 1 ? `${p.viewCount} times` : "once"}` : "",
    p.acceptedAt ? `accepted ${dayInline(Date.parse(p.acceptedAt), now)}` : "",
  ].filter(Boolean);
  return (
    <div className={b.peek} data-board-proposal={p.id}>
      <div className={b.peekHead}>
        <b>{p.title}</b>
        <span>
          {p.status.toLowerCase()} · {facts.join(" · ")}
        </span>
      </div>
      {p.lines.length === 0 ? (
        <p className={b.empty}>No lines on it yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((li, i) => (
              <tr key={i}>
                <td>{li.name}</td>
                <td>{li.quantity}</td>
                <td>{usd(li.unitPrice)}</td>
                <td>{usd(li.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={b.peekTotals}>
        <span>Subtotal {usd(p.subtotal)}</span>
        {p.discountTotal ? <span>Discount −{usd(p.discountTotal)}</span> : null}
        {p.taxTotal ? <span>Tax {usd(p.taxTotal)}</span> : null}
        <b>Total {usd(p.total)}</b>
      </div>
    </div>
  );
}

/** The calendar: a row per signup day, a bar of what became of its trials, opened to the accounts. */
function Calendar({ days, byId, now }: { days: CohortDay[]; byId: Map<string, BoardRow>; now: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const most = Math.max(1, ...days.map((d) => d.trials));
  return (
    <div className={b.calWrap}>
      <table className={b.cal}>
        <thead>
          <tr>
            <th scope="col">Signed up</th>
            <th scope="col">Trials</th>
            <th scope="col">Card · no card</th>
            <th scope="col">Trials end</th>
            <th scope="col">What became of them</th>
            <th scope="col">Paid</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const decided = d.paying + d.left + d.failed;
            const isOpen = open === d.dayStart;
            const seg = (n: number) => `${(n / most) * 100}%`;
            return (
              <Fragment key={d.dayStart}>
                <tr data-board-day-row={dayWords(d.dayStart, now)} data-finished={d.finished ? "" : undefined} data-empty={d.trials === 0 ? "" : undefined}>
                  <th scope="row">
                    {d.trials > 0 ? (
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.dayStart)}>
                        {dayWords(d.dayStart, now)}
                      </button>
                    ) : (
                      <span>{dayWords(d.dayStart, now)}</span>
                    )}
                    {d.signedUp > d.trials && <small>{d.signedUp} signed up</small>}
                  </th>
                  <td data-label="Trials">{d.trials || "—"}</td>
                  <td data-label="Card · no card">{d.trials ? `${d.card} · ${d.nocard}` : "—"}</td>
                  <td data-label="Trials end">{d.endsOn !== null ? dayWords(d.endsOn, now) : "—"}</td>
                  <td data-label="What became of them">
                    {d.trials > 0 ? (
                      <span className={b.bar} role="img" aria-label={`${d.paying} paying, ${d.onTrial} on trial, ${d.left} left, ${d.failed} card failed`}>
                        {d.paying > 0 && <i data-seg="paying" style={{ width: seg(d.paying) }} />}
                        {d.onTrial > 0 && <i data-seg="trial" style={{ width: seg(d.onTrial) }} />}
                        {d.left > 0 && <i data-seg="left" style={{ width: seg(d.left) }} />}
                        {d.failed > 0 && <i data-seg="failed" style={{ width: seg(d.failed) }} />}
                      </span>
                    ) : (
                      <span className={b.muted}>no trials</span>
                    )}
                  </td>
                  <td data-label="Paid">
                    {decided > 0 ? (
                      <b data-board-rate>
                        {d.paying} of {decided} · {pct(d.paying, decided)}%
                      </b>
                    ) : d.trials > 0 ? (
                      <span className={b.muted}>decides {d.endsOn !== null ? dayInline(d.endsOn, now) : "later"}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className={b.calOpen}>
                    <td colSpan={6}>
                      <ul>
                        {d.orgIds.map((id) => {
                          const r = byId.get(id);
                          if (!r) return null;
                          return (
                            <li key={id} data-phase={r.phase}>
                              <b>{r.orgName}</b>
                              <span>{r.kind === "card" ? "card at signup" : r.cardNow ? "added a card" : "no card"}</span>
                              <span className={b.chip} data-tone={r.phase === "paying" ? "good" : r.phase === "trial" ? "info" : r.phase === "failed" ? "bad" : "muted"}>
                                {r.phase === "paying" ? "paying" : r.phase === "trial" ? `on trial · ends ${r.trialEnd !== null ? dayInline(r.trialEnd, now) : "—"}${r.cancelsAtEnd ? " · set to cancel" : ""}` : r.phase === "failed" ? "card failed" : "left"}
                              </span>
                              <span className={b.muted}>{workWords(r.work)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
