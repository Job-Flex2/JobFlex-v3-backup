"use client";

// ADMIN USER ACTIVITY — BLUEPRINT
// /admin/activity
//
// Who did what across every workspace: a per-user ledger (proposals created,
// sent, accepted and their value; estimates made; last seen) over a range,
// and beneath it the trail itself — every recorded action, newest first,
// narrowed by user, by kind or by a word — with any proposal on it open to
// read in a sheet. Reads only; the page's loader shapes the DTOs.
//
// The proposal opens HERE, in a sheet, not on the client's page: the client
// page counts every open as a view and would put the admin's reading into
// the contractor's statistics.
//
// 2026-10-19 (owner: "search any client by his company name or email and look
// what he's doing … and keep on the ones that are working right now"): a
// search at the top finds any member by name, email or company and narrows
// the whole page to them — their counts, their trail and the screens they
// opened — and "Working right now" lists everyone in the app this minute,
// refreshed every half minute, one click from their trail.

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { refreshWorkingNow } from "@/actions/adminActivity";
import type { WorkingNowRow } from "@/lib/adminActivityRead";
import type { ActivityInsights } from "@/lib/activityInsights";
import { InsightsPanel } from "./insights-panel";
import { longDate, money, relative, shortDate } from "@/lib/format";
import { TEAM_TZ } from "@/lib/adminTasks/teamShared";
import { Chip, Empty, Ic, KpiStrip, Sheet, type Tone, cx, useMdl, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./activity.module.css";

export type ActivityRange = "7" | "30" | "90" | "all";

export interface ActivityUserRow {
  id: string;
  name: string;
  email: string | null;
  orgName: string | null;
  role: string | null;
  memberSince: string | null;
  /** Proposals created / sent / edited by this user (the trail, whole range). */
  created: number;
  sent: number;
  edited: number;
  /** Every recorded action, whatever its kind. */
  actions: number;
  lastActive: string | null;
  /** Outcomes on the proposals this user owns: value sent, accepted count and value. */
  sentValue: number;
  accepted: number;
  acceptedValue: number;
  /** Estimates made: roof measurements, HVAC sizings. */
  roof: number;
  hvac: number;
}

export interface ActivityEventDTO {
  id: string;
  at: string;
  kind: string;
  summary: string;
  actorId: string | null;
  actorName: string;
  orgName: string;
  proposalId: string | null;
  leadId: string | null;
  clientId: string | null;
}

export interface ProposalPeek {
  id: string;
  title: string;
  status: string;
  address: string | null;
  clientName: string | null;
  ownerName: string | null;
  orgName: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  createdAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  acceptedAt: string | null;
  declinedAt: string | null;
  paidAt: string | null;
  lineItems: { name: string; quantity: number; unitPrice: number; total: number }[];
}

export interface ActivityTotals {
  activeUsers: number;
  created: number;
  sent: number;
  accepted: number;
  acceptedValue: number;
  estimates: number;
  feedTruncated: boolean;
}

const RANGE_LABEL: Record<ActivityRange, string> = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All time" };

/* ── what a row of the trail says ── */

function describe(e: ActivityEventDTO): { verb: string; tone: Tone } {
  switch (e.kind) {
    case "CREATED":
      return e.proposalId ? { verb: "Created a proposal", tone: "bp" } : e.leadId ? { verb: "Added a lead", tone: "bp" } : { verb: "Created", tone: "bp" };
    case "SENT":
      return { verb: e.proposalId ? "Sent a proposal" : "Sent", tone: "ok" };
    case "EDITED":
      return { verb: "Edited a proposal", tone: "mute" };
    case "UPDATED":
      return { verb: "Updated", tone: "mute" };
    case "DELETED":
      return { verb: "Deleted", tone: "bad" };
    case "SCHEDULED":
      return { verb: "Scheduled a job", tone: "bp" };
    case "COMPLETED":
      return { verb: "Completed a job", tone: "ok" };
    case "ACCEPTED":
      return { verb: "Accepted", tone: "ok" };
    case "DECLINED":
      return { verb: "Declined", tone: "bad" };
    case "PAID":
    case "PAYMENT_MARKED":
      return { verb: "Marked paid", tone: "ok" };
    case "PAYMENT_UNMARKED":
      return { verb: "Unmarked a payment", tone: "mute" };
    case "PAYMENT_CONNECTED":
      return { verb: "Connected payments", tone: "ok" };
    case "PAYMENT_DISCONNECTED":
      return { verb: "Disconnected payments", tone: "bad" };
    case "NOTE":
      return { verb: "Left a note", tone: "mute" };
    case "EMAIL":
      return { verb: "Sent an email", tone: "mute" };
    case "TEXT":
    case "SMS":
      return { verb: "Sent a text", tone: "mute" };
    case "CALL":
      return { verb: "Made a call", tone: "mute" };
    case "ASSIGNED":
      return { verb: "Assigned a worker", tone: "bp" };
    case "REVIEW":
    case "REVIEW_REQUESTED":
      return { verb: "Asked for a review", tone: "bp" };
    case "ESTIMATE_ROOF":
      return { verb: "Measured a roof", tone: "wait" };
    case "ESTIMATE_HVAC":
      return { verb: "Sized an HVAC system", tone: "wait" };
    case "SCREEN":
      return { verb: "Opened a screen", tone: "mute" };
    case "PLAN_CHANGE":
      return { verb: "Plan changed by support", tone: "bp" };
    case "USAGE_RESET":
      return { verb: "Usage reset by support", tone: "bp" };
    default: {
      const words = e.kind.toLowerCase().replace(/_/g, " ");
      return { verb: words.charAt(0).toUpperCase() + words.slice(1), tone: "mute" };
    }
  }
}

type Group = "ALL" | "PROPOSALS" | "ESTIMATES" | "PEOPLE" | "SCREENS" | "OTHER";
const GROUPS: { key: Group; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PROPOSALS", label: "Proposals" },
  { key: "ESTIMATES", label: "Estimates" },
  { key: "PEOPLE", label: "Leads & clients" },
  { key: "SCREENS", label: "Screens" },
  { key: "OTHER", label: "Other" },
];
function groupOf(e: ActivityEventDTO): Exclude<Group, "ALL"> {
  if (e.kind === "SCREEN") return "SCREENS";
  if (e.kind === "ESTIMATE_ROOF" || e.kind === "ESTIMATE_HVAC") return "ESTIMATES";
  if (e.proposalId) return "PROPOSALS";
  if (e.leadId || e.clientId) return "PEOPLE";
  return "OTHER";
}

type Sort = "busiest" | "created" | "sent" | "won" | "recent";
const SORTS: { key: Sort; label: string }[] = [
  { key: "busiest", label: "Most active" },
  { key: "created", label: "Most created" },
  { key: "sent", label: "Most sent" },
  { key: "won", label: "Most won" },
  { key: "recent", label: "Last seen" },
];

const PROPOSAL_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  SENT: "bp",
  VIEWED: "wait",
  ACCEPTED: "ok",
  PAID: "ok",
  COMPLETED: "ok",
  DECLINED: "bad",
  EXPIRED: "bad",
  ARCHIVED: "mute",
};

const PAGE = 60;

type PeekHandle = { open: (p: ProposalPeek, trail: ActivityEventDTO[]) => void };

/** The page's address for a range and a search. */
function hrefFor(range: ActivityRange, q: string): Route {
  const sp = new URLSearchParams();
  if (range !== "30") sp.set("range", range);
  if (q.trim()) sp.set("q", q.trim());
  const qs = sp.toString();
  return (qs ? `/admin/activity?${qs}` : "/admin/activity") as Route;
}
const REFRESH_MS = 30_000;

export function AdminActivityContent({
  range,
  users,
  feed,
  proposals,
  totals,
  now,
  q,
  found,
  working: workingAtLoad,
  insights,
}: {
  range: ActivityRange;
  users: ActivityUserRow[];
  feed: ActivityEventDTO[];
  proposals: Record<string, ProposalPeek>;
  totals: ActivityTotals;
  /** The search, and how many members it found (null: no search). */
  q: string;
  found: number | null;
  /** Everyone in the app in the last ten minutes, as the page loaded; refreshed here every half minute. */
  working: WorkingNowRow[];
  /** The analyst's reading of the range (2026-10-28); null under a search or when the read failed. */
  insights: ActivityInsights | null;
  /** The server's clock at render. "4m ago" is drawn from it, so the server's
   *  HTML and the hydrating page agree (QA F-7f3279fd); this browser's clock
   *  takes over after mount. */
  now: number;
}) {
  const [clock, setClock] = useState(now);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's clock, read once after hydration
  useEffect(() => setClock(Date.now()), []);
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  // The search box: what's typed, sent to the server a moment after typing stops (or on Enter).
  const [draft, setDraft] = useState(q);
  const go = useCallback((text: string) => startSearch(() => router.replace(hrefFor(range, text), { scroll: false })), [range, router]);
  useEffect(() => {
    const t = draft.trim();
    if (t === q || (t.length > 0 && t.length < 2)) return;
    const id = window.setTimeout(() => go(t), 450);
    return () => window.clearTimeout(id);
  }, [draft, q, go]);
  // Who's in the app: refreshed every half minute while the page is in view.
  const [working, setWorking] = useState(workingAtLoad);
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await refreshWorkingNow().catch(() => null);
      if (r?.ok) {
        setWorking(r.rows);
        setClock(r.at);
      }
    };
    const id = window.setInterval(() => void tick(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  const lookAt = useCallback(
    (w: WorkingNowRow) => {
      const term = w.email ?? w.name;
      setDraft(term);
      startSearch(() => router.push(hrefFor(range, term), { scroll: false }));
    },
    [range, router],
  );
  // Days on the team's clock, never the machine's: the server runs on UTC.
  const when = { now: clock, timeZone: TEAM_TZ };
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const feedRef = useRef<HTMLElement>(null);
  const peekRef = useRef<PeekHandle | null>(null);

  const [sort, setSort] = useState<Sort>("busiest");
  const [userId, setUserId] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("ALL");
  const [query, setQuery] = useState("");
  // How many trail rows are unfolded, keyed by the filters: a new filter
  // starts the list over without an effect resetting state.
  const filterKey = `${userId ?? ""}|${group}|${query}|${range}`;
  const [unfolded, setUnfolded] = useState<{ key: string; n: number }>({ key: filterKey, n: PAGE });
  const shown = unfolded.key === filterKey ? unfolded.n : PAGE;

  const userRows = useMemo(() => {
    const score = (r: ActivityUserRow) => r.created + r.sent + r.roof + r.hvac;
    const by: Record<Sort, (a: ActivityUserRow, b: ActivityUserRow) => number> = {
      busiest: (a, b) => score(b) - score(a) || b.actions - a.actions,
      created: (a, b) => b.created - a.created || score(b) - score(a),
      sent: (a, b) => b.sent - a.sent || b.sentValue - a.sentValue,
      won: (a, b) => b.acceptedValue - a.acceptedValue || b.accepted - a.accepted,
      recent: (a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""),
    };
    return [...users].sort(by[sort]);
  }, [users, sort]);
  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  const groupCounts = useMemo(() => {
    const base = userId ? feed.filter((e) => e.actorId === userId) : feed;
    const c: Record<Group, number> = { ALL: base.length, PROPOSALS: 0, ESTIMATES: 0, PEOPLE: 0, SCREENS: 0, OTHER: 0 };
    for (const e of base) c[groupOf(e)] += 1;
    return c;
  }, [feed, userId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return feed.filter((e) => {
      if (userId && e.actorId !== userId) return false;
      if (group !== "ALL" && groupOf(e) !== group) return false;
      if (!q) return true;
      const p = e.proposalId ? proposals[e.proposalId] : undefined;
      return (
        e.summary.toLowerCase().includes(q) ||
        e.actorName.toLowerCase().includes(q) ||
        e.orgName.toLowerCase().includes(q) ||
        (p ? p.title.toLowerCase().includes(q) || (p.clientName ?? "").toLowerCase().includes(q) : false)
      );
    });
  }, [feed, userId, group, query, proposals]);
  const narrowTo = useCallback((id: string) => {
    setUserId((cur) => (cur === id ? null : id));
    requestAnimationFrame(() => feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const openProposal = useCallback(
    (id: string) => {
      const p = proposals[id];
      if (!p) return;
      peekRef.current?.open(
        p,
        feed.filter((e) => e.proposalId === id),
      );
    },
    [proposals, feed],
  );

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · People</div>
          <h1 className="page-title">User activity</h1>
        </div>
        <div className="page-actions">
          <nav className={styles.range} aria-label="Range">
            {(Object.keys(RANGE_LABEL) as ActivityRange[]).map((r) => (
              <Link key={r} href={hrefFor(r, q)} className={cx(styles.rangeBtn, r === range && styles.rangeOn)} aria-current={r === range ? "page" : undefined}>
                {RANGE_LABEL[r]}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* ── find anyone ── */}
      <form
        className={cx(styles.find, "rv")}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(draft);
        }}
      >
        <Ic name="search" />
        <input className={styles.findIn} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name, company or email" aria-label="Find a contractor by name, company or email" data-activity-find />
        {draft || q ? (
          <button
            type="button"
            className={styles.findX}
            aria-label="Clear the search"
            onClick={() => {
              setDraft("");
              go("");
            }}
          >
            <Ic name="x" />
          </button>
        ) : null}
        <button type="submit" className={cx("btn", "btn-primary", ui.btnSm)} disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {q ? (
        <p className={styles.findNote} data-activity-found>
          {found === 0 ? (
            <>No member&apos;s name, email or company holds “{q}”.</>
          ) : (
            <>
              {found === 1 ? "1 member matches" : `${found} members match`} “{q}” — the counts, the people and the trail below are {found === 1 ? "theirs" : "theirs alone"}, with every screen they opened
              {range === "all" ? "" : ` in the last ${RANGE_LABEL[range].toLowerCase()}`}.
            </>
          )}{" "}
          <Link href={hrefFor(range, "")} onClick={() => setDraft("")}>
            Show everyone
          </Link>
        </p>
      ) : null}

      {/* ── who's in the app now ── */}
      <section className="card rv" data-working-now>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">
              Working right now <span className={styles.liveDot} aria-hidden="true" /> <span className={styles.liveN}>{working.length}</span>
            </div>
            <div className="card-sub">Everyone with a screen open in JobFlex in the last ten minutes — the screen they&apos;re on, how long they&apos;ve been at it, the last thing they did. Refreshed every 30 seconds.</div>
          </div>
        </div>
        {working.length === 0 ? (
          <Empty>No one is in the app right now.</Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Working right now">
            {working.map((w) => {
              const mins = Math.max(1, Math.round((Date.parse(w.at) - Date.parse(w.since)) / 60000));
              const d = w.lastAction ? describe({ id: "", at: w.lastAction.at, kind: w.lastAction.kind, summary: w.lastAction.summary, actorId: null, actorName: "", orgName: "", proposalId: null, leadId: null, clientId: null }) : null;
              return (
                <div key={w.userId} className={cx(ui.tr, styles.liveCols)} role="row" data-working={w.userId}>
                  <div className={ui.tdWide}>
                    <div className={ui.tdName}>{w.name}</div>
                    <div className={ui.tdSub} title={w.email ?? undefined}>
                      {[w.company, w.email].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div>
                    <span className={ui.tdLbl}>On</span>
                    <Chip tone="bp">{w.screen}</Chip>
                    <span className={styles.whenSub}>
                      {mins} min · {w.screens} screen{w.screens === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className={ui.tdWide}>
                    <span className={ui.tdLbl}>Last did</span>
                    {w.lastAction && d ? (
                      <>
                        <div className={styles.detail}>{w.lastAction.summary || d.verb}</div>
                        <span className={styles.whenSub}>{relative(w.lastAction.at, when)}</span>
                      </>
                    ) : (
                      <span className={styles.whenSub}>Nothing saved this hour</span>
                    )}
                  </div>
                  <div>
                    <span className={ui.tdLbl}>Seen</span>
                    <span className={styles.when}>{relative(w.at, when)}</span>
                  </div>
                  <div className={ui.tdAct}>
                    <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm)} onClick={() => lookAt(w)} data-working-see={w.userId}>
                      <Ic name="eye" />
                      Their activity
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <KpiStrip
        cols={6}
        cells={[
          { label: "Active users", value: String(totals.activeUsers) },
          { label: "Proposals created", value: String(totals.created), accent: true },
          { label: "Proposals sent", value: String(totals.sent) },
          { label: "Accepted", value: String(totals.accepted), tone: totals.accepted ? "ok" : undefined },
          // Whole dollars: with the cents, six figures ran into the next tile.
          { label: "Won", value: `$${Math.round(totals.acceptedValue).toLocaleString("en-US")}`, tone: totals.acceptedValue ? "ok" : undefined },
          { label: "Estimates made", value: String(totals.estimates) },
        ]}
      />

      {/* ── what members do: the analyst (2026-10-28) ── */}
      {insights && !q && <InsightsPanel insights={insights} rangeWords={range === "all" ? "All time" : `Last ${RANGE_LABEL[range]}`} zoneWords="Pacific time" />}

      {/* ── by user ── */}
      <section className="card rv">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">By user</div>
            <div className="card-sub">
              Proposals created and sent by the member, what their proposals won, the estimates they ran, and when they were last seen — over the last{" "}
              {RANGE_LABEL[range].toLowerCase()}. Pick a row to narrow the trail below to that member.
            </div>
          </div>
          <div className={ui.filters} role="group" aria-label="Sort members">
            {SORTS.map((s) => (
              <button key={s.key} type="button" className={cx(ui.filter, sort === s.key && ui.filterOn)} aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {userRows.length === 0 ? (
          <Empty>{q ? "No member matches the search." : "No member did anything in this range."}</Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Activity by user">
            <div className={cx(ui.tr, ui.th, styles.userCols)} role="row">
              <span>Member</span>
              <span className={ui.thR}>Created</span>
              <span className={ui.thR}>Sent</span>
              <span className={ui.thR}>Accepted</span>
              <span className={ui.thR}>Estimates</span>
              <span>Last seen</span>
              <span />
            </div>
            {userRows.map((u) => (
              <div key={u.id} className={cx(ui.tr, styles.userCols, userId === u.id && styles.userRowOn)} role="row">
                <div className={ui.tdWide}>
                  <div className={ui.tdName} title={u.email ?? undefined}>
                    {u.name}
                  </div>
                  <div className={ui.tdSub} title={u.email ?? undefined}>
                    {[u.orgName, u.role ? u.role.toLowerCase() : null, u.email && u.email !== u.name ? u.email : null].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div className={cx(ui.tdNum, !u.created && ui.tdNumMute)}>
                  <span className={ui.tdLbl}>Created</span>
                  {u.created}
                  {u.edited ? <span className={styles.split}>{u.edited} edited</span> : null}
                </div>
                <div className={cx(ui.tdNum, !u.sent && ui.tdNumMute)}>
                  <span className={ui.tdLbl}>Sent</span>
                  {u.sent}
                  {u.sentValue ? <span className={styles.split}>{money(u.sentValue)}</span> : null}
                </div>
                <div className={cx(ui.tdNum, !u.accepted && ui.tdNumMute)}>
                  <span className={ui.tdLbl}>Accepted</span>
                  {u.accepted}
                  {u.acceptedValue ? <span className={styles.won}>{money(u.acceptedValue)}</span> : null}
                </div>
                <div className={cx(ui.tdNum, !(u.roof + u.hvac) && ui.tdNumMute)}>
                  <span className={ui.tdLbl}>Estimates</span>
                  {u.roof + u.hvac}
                  {u.roof + u.hvac ? <span className={styles.split}>{[u.roof ? `${u.roof} roof` : null, u.hvac ? `${u.hvac} hvac` : null].filter(Boolean).join(" · ")}</span> : null}
                </div>
                <div>
                  <span className={ui.tdLbl}>Last seen</span>
                  <span className={styles.when}>{u.lastActive ? relative(u.lastActive, when) : "—"}</span>
                  {u.actions ? <span className={styles.whenSub}>{u.actions} actions</span> : null}
                </div>
                <div className={ui.tdAct}>
                  <button type="button" className={cx("btn", userId === u.id ? "btn-primary" : ui.btnGhost, ui.btnSm)} aria-pressed={userId === u.id} onClick={() => narrowTo(u.id)}>
                    <Ic name="filter" />
                    {userId === u.id ? "Showing" : "Activity"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── the trail ── */}
      <section className="card rv" ref={feedRef}>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Activity</div>
            <div className="card-sub">
              Every recorded action, newest first{totals.feedTruncated ? " — the most recent few hundred; the counts above cover the whole range" : ""}. A proposal on a row opens here.
            </div>
          </div>
          <div className={ui.filters} role="group" aria-label="Filter activity">
            {userId ? (
              <span className={styles.who}>
                {userName.get(userId) ?? "Member"}
                <button type="button" className={styles.whoX} aria-label="Show every member" onClick={() => setUserId(null)}>
                  <Ic name="x" />
                </button>
              </span>
            ) : null}
            {GROUPS.filter((g) => g.key !== "SCREENS" || groupCounts.SCREENS > 0).map((g) => (
              <button key={g.key} type="button" className={cx(ui.filter, group === g.key && ui.filterOn)} aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>
                {g.label}
                <i>{groupCounts[g.key]}</i>
              </button>
            ))}
            <div className={styles.search}>
              <input className={styles.searchIn} type="search" aria-label="Search activity" placeholder="Filter the trail — a word, a proposal" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty>{feed.length === 0 ? "Nothing recorded in this range." : "Nothing matches these filters."}</Empty>
        ) : (
          <>
            <div className={ui.tbl} role="table" aria-label="Activity trail">
              <div className={cx(ui.tr, ui.th, styles.feedCols)} role="row">
                <span>When</span>
                <span>Member</span>
                <span>Did</span>
                <span>Detail</span>
                <span />
              </div>
              {rows.slice(0, shown).map((e) => {
                const d = describe(e);
                const p = e.proposalId ? proposals[e.proposalId] : undefined;
                return (
                  <div key={e.id} className={cx(ui.tr, styles.feedCols)} role="row">
                    <div>
                      <span className={styles.when} title={longDate(e.at, when)}>
                        {relative(e.at, when)}
                      </span>
                      <span className={styles.whenSub}>{shortDate(e.at, when)}</span>
                    </div>
                    <div>
                      <span className={ui.tdLbl}>Member</span>
                      <div className={ui.tdName}>{e.actorName}</div>
                      <div className={ui.tdSub} title={e.orgName}>
                        {e.orgName}
                      </div>
                    </div>
                    <div>
                      <span className={ui.tdLbl}>Did</span>
                      <Chip tone={d.tone}>{d.verb}</Chip>
                    </div>
                    <div className={ui.tdWide}>
                      <div className={styles.detail}>{e.summary}</div>
                      {p ? (
                        <span className={styles.detailRef}>
                          {p.title}
                          {p.clientName ? ` · ${p.clientName}` : ""} · {money(p.total, p.currency)} · {p.status.toLowerCase()}
                        </span>
                      ) : null}
                    </div>
                    <div className={ui.tdAct}>
                      {p ? (
                        <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm)} onClick={() => openProposal(p.id)}>
                          <Ic name="file" />
                          View proposal
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {rows.length > shown ? (
              <div className={styles.more}>
                <button type="button" className={cx("btn", ui.btnGhost)} onClick={() => setUnfolded({ key: filterKey, n: shown + PAGE })}>
                  Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <ProposalSheet handleRef={peekRef} />
    </div>
  );
}

/* ============================================================
   THE PROPOSAL, READ IN PLACE
   ============================================================ */

function ProposalSheet({ handleRef }: { handleRef: React.RefObject<PeekHandle | null> }) {
  const [p, setP] = useState<ProposalPeek | null>(null);
  const [trail, setTrail] = useState<ActivityEventDTO[]>([]);
  const { ref: mdlRef, open: openMdlDialog, close } = useMdl();
  const open = useCallback(
    (peek: ProposalPeek, events: ActivityEventDTO[]) => {
      setP(peek);
      setTrail(events);
      openMdlDialog();
    },
    [openMdlDialog],
  );
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  // The proposal's own milestones and the trail's rows about it, in date order.
  const timeline = useMemo(() => {
    if (!p) return [];
    const marks: { key: string; at: string; text: string }[] = (
      [
        ["Created", p.createdAt],
        ["Sent", p.sentAt],
        ["Last opened by the client", p.viewedAt],
        ["Accepted", p.acceptedAt],
        ["Declined", p.declinedAt],
        ["Paid", p.paidAt],
      ] as [string, string | null][]
    )
      .filter((x): x is [string, string] => !!x[1])
      .map(([text, at]) => ({ key: `m:${text}`, at, text }));
    const rows = trail.map((e) => ({ key: e.id, at: e.at, text: `${e.actorName} — ${e.summary}` }));
    return [...marks, ...rows].sort((a, b) => a.at.localeCompare(b.at));
  }, [p, trail]);

  return (
    <Sheet mdlRef={mdlRef} title="Proposal" titleId="actProposalTitle" size="lg" onClose={close}>
      {!p ? null : (
        <div>
          <div className={styles.pTitle}>{p.title}</div>
          <div className={styles.pSub}>
            {[p.clientName ? `For ${p.clientName}` : null, p.address, `${p.orgName}${p.ownerName ? ` · ${p.ownerName}` : ""}`].filter(Boolean).join(" · ")}
          </div>
          <div className={styles.pStatus}>
            <Chip tone={PROPOSAL_TONE[p.status] ?? "mute"}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Chip>
            {p.viewCount ? <span className={styles.pWhen}>opened {p.viewCount}×</span> : null}
          </div>

          <div className={styles.pMoney}>
            <div className={styles.pCell}>
              <div className={styles.pCellL}>Subtotal</div>
              <div className={styles.pCellV}>{money(p.subtotal, p.currency)}</div>
            </div>
            <div className={styles.pCell}>
              <div className={styles.pCellL}>Discount</div>
              <div className={styles.pCellV}>{p.discountTotal ? `−${money(p.discountTotal, p.currency)}` : "—"}</div>
            </div>
            <div className={styles.pCell}>
              <div className={styles.pCellL}>Tax</div>
              <div className={styles.pCellV}>{p.taxTotal ? money(p.taxTotal, p.currency) : "—"}</div>
            </div>
            <div className={styles.pCell}>
              <div className={styles.pCellL}>Total</div>
              <div className={cx(styles.pCellV, styles.pCellTotal)}>{money(p.total, p.currency)}</div>
            </div>
          </div>

          <div className={styles.pSec}>Timeline</div>
          <ul className={styles.pTimeline}>
            {timeline.map((row) => (
              <li key={row.key}>
                <span className={styles.pWhen}>{longDate(row.at, { timeZone: TEAM_TZ })}</span>
                <span>{row.text}</span>
              </li>
            ))}
          </ul>

          <div className={styles.pSec}>Lines</div>
          {p.lineItems.length === 0 ? (
            <Empty>No lines on this proposal.</Empty>
          ) : (
            <table className={styles.pItems}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className={styles.num}>Qty</th>
                  <th className={styles.num}>Unit</th>
                  <th className={styles.num}>Total</th>
                </tr>
              </thead>
              <tbody>
                {p.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td>{li.name}</td>
                    <td className={styles.num}>{li.quantity % 1 === 0 ? li.quantity : li.quantity.toFixed(2)}</td>
                    <td className={styles.num}>{money(li.unitPrice, p.currency)}</td>
                    <td className={styles.num}>{money(li.total, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Sheet>
  );
}
