// The homeowner's request page — the project's home after they submit it.
// Reached only through the capability token the confirmation email carries
// (/request/[token]); the token IS the authorization, so there is no session
// and no account, like the intake that created the request.
//
// Owner, 2026-10-02: "the client's dashboard — show the status up top, render
// the proposal the contractor sent, request another contractor at any time,
// and update when a new contractor is matched." So, in the order the
// homeowner needs it: where things stand (status + four steps), who the
// contractor is and how to reach them, anything waiting for their ok, the
// proposals (the current contractor's, then any earlier one's — each drawn
// like the proposal email draws it, the full proposal one tap away), the next
// visit, "find me another contractor" (never locked), what they asked for, and
// the request's history. The page re-reads itself every 30 seconds while it
// is open (live.tsx), so a new match or a proposal appears without a reload.
// What it may read about a contractor's proposals: lib/requestPortal.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRequestPortal, type PortalProposal, type ProposalStage } from "@/lib/requestPortal";
import { publicReviewsPath } from "@/lib/reviews/publicSummary";
import { LiveRefresh, LocalTime } from "@/components/portal/live-time";
import { RerouteButton } from "./reroute";
import s from "./request.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your project — JobFlex",
  description: "Follow your project: your contractor, their proposal and what happens next.",
  robots: { index: false, follow: false },
};

type Tone = "accent" | "emerald" | "rose" | "amber" | "neutral";
const TONE: Record<Tone, string> = {
  accent: s.stampAccent,
  emerald: s.stampEmerald,
  rose: s.stampRose,
  amber: s.stampAmber,
  neutral: s.stampNeutral,
};
const STAGE: Record<ProposalStage, { label: string; tone: Tone }> = {
  NEW: { label: "New", tone: "accent" },
  OPENED: { label: "Opened", tone: "neutral" },
  ACCEPTED: { label: "Accepted", tone: "emerald" },
  DECLINED: { label: "Declined", tone: "rose" },
  PAID: { label: "Paid", tone: "emerald" },
  COMPLETED: { label: "Completed", tone: "emerald" },
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const money = (n: number) => usd.format(n);
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : `+${money(n)}`);
const pct = (fraction: number) => `${Math.round(fraction * 100 * 100) / 100}%`;
const isOpen = (st: ProposalStage) => st === "NEW" || st === "OPENED";
const isWon = (st: ProposalStage) => st === "ACCEPTED" || st === "PAID" || st === "COMPLETED";

export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await loadRequestPortal(token);
  if (!v) notFound();

  const cur = v.current;
  const curProps = v.proposals.filter((p) => p.current);
  const earlierProps = v.proposals.filter((p) => !p.current);
  const open = curProps.find((p) => isOpen(p.stage)) ?? null;
  const won = curProps.find((p) => isWon(p.stage)) ?? null;
  const lastLeft = v.previous[v.previous.length - 1]?.org.name ?? null;

  // ── where things stand: the one thing that matters most right now ────────
  let stamp: { label: string; tone: Tone };
  let title: string;
  let body: string;
  if (cur && open) {
    stamp = { label: "Proposal ready", tone: "accent" };
    title = "Your proposal is ready";
    body = `${cur.org.name} sent you a proposal. Look it over below — you can accept it online.`;
  } else if (cur && v.changeOrders.length > 0) {
    stamp = { label: "Needs your ok", tone: "amber" };
    title = "A change needs your approval";
    body = `${cur.org.name} sent a change to the job. Review it below.`;
  } else if (cur && won) {
    stamp = { label: won.stage === "PAID" ? "Paid" : won.stage === "COMPLETED" ? "Complete" : "Hired", tone: "emerald" };
    title = `You hired ${cur.org.name}`;
    body = "You accepted their proposal — they'll be in touch to schedule the work.";
  } else if (cur && curProps.length > 0) {
    stamp = { label: "Matched", tone: "accent" };
    title = "You're matched";
    body = `You declined ${cur.org.name}'s proposal. They may send a new one — or you can ask for another contractor below.`;
  } else if (cur) {
    stamp = { label: "Matched", tone: "accent" };
    title = "You're matched";
    body = `${cur.org.name} has your details and will reach out to you.`;
  } else if (lastLeft && v.status !== "MATCHED") {
    stamp = { label: "Matching", tone: "amber" };
    title = "Finding your next contractor";
    body = `We let ${lastLeft} know. You'll get an email the moment a new contractor takes your project — and this page updates on its own.`;
  } else if (v.status === "OFFERED") {
    stamp = { label: "Matching", tone: "neutral" };
    title = "A contractor is reviewing your request";
    body = "We've offered your project to a local pro — they have up to 24 hours to take it on.";
  } else if (v.status === "MANUAL_QUEUE") {
    // Neutral (owner, 2026-10-03): the same words whether the queue holds the
    // lead by design (manual mode) or because no shop took it.
    stamp = { label: "Finding a pro", tone: "neutral" };
    title = "We're finding the right contractor for you";
    body = "We're matching your project with a qualified local pro. You'll get an email the moment one takes it on — no action needed.";
  } else {
    stamp = { label: "Finding a pro", tone: "neutral" };
    title = "We're finding your contractor";
    body = "Your request is being matched with a local pro on JobFlex right now. You'll get an email the moment one takes it on.";
  }

  const steps = [
    { label: "Request sent", done: true },
    { label: "Pro matched", done: !!cur },
    { label: "Proposal ready", done: curProps.length > 0 },
    { label: "Accepted", done: !!won },
  ];
  const nowAt = steps.findIndex((x) => !x.done);
  // A home that exists sends the next request through the dashboard, so it lands there too.
  const newProjectHref = v.homeKey ? `/homeowner?home=${encodeURIComponent(v.homeKey)}` : "/homeowner";

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.top}>
          <Link href="/" className={s.brand}>
            <span className={s.mark} aria-hidden="true">
              J
            </span>
            JobFlex
          </Link>
          <div className={s.topRight}>
            {v.homeKey && (
              <a className={s.homeLink} href={`/home/${encodeURIComponent(v.homeKey)}`}>
                Your home dashboard
              </a>
            )}
            {/* The next project starts from the top of the page, not a footer link (owner, 2026-10-10). */}
            <a className={`${s.btnPrimary} ${s.topCta}`} href={newProjectHref}>
              + New project
            </a>
            <LiveRefresh className={s.live} />
          </div>
        </header>

        {/* ── status ─────────────────────────────────────────────────── */}
        <section className={s.hero} aria-labelledby="status-title">
          <div className={s.heroMeta}>
            <span className={`${s.stamp} ${TONE[stamp.tone]}`}>{stamp.label}</span>
            <span className={s.kicker}>Your project{v.trade ? ` · ${v.trade}` : ""}</span>
          </div>
          <h1 id="status-title" className={s.title}>
            {title}
          </h1>
          <p className={s.lede}>{body}</p>
          <ol className={s.steps} aria-label="Progress">
            {steps.map((st, i) => (
              <li
                key={st.label}
                className={[s.step, st.done ? s.stepDone : "", i === nowAt ? s.stepNow : ""].join(" ")}
                aria-current={i === nowAt ? "step" : undefined}
              >
                <span className={s.stepLabel}>
                  <span className={s.stepNum} aria-hidden="true">
                    {st.done ? "✓" : i + 1}
                  </span>
                  {st.label}
                  {st.done && <span className={s.srOnly}> — done</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── the contractor ─────────────────────────────────────────── */}
        {cur && (
          <section className={s.card} aria-labelledby="pro-title">
            <div className={s.cardHead}>
              <h2 id="pro-title" className={s.label}>
                Your contractor
              </h2>
              {cur.matchedAt && (
                <span className={s.mono}>
                  Matched <LocalTime iso={cur.matchedAt} tz={v.timeZone} />
                </span>
              )}
            </div>
            <div className={s.cardBody}>
              <div>
                <div className={s.proName}>{cur.org.name}</div>
                {(cur.org.place || cur.org.rating) && (
                  <div className={s.proMeta}>
                    {cur.org.place && <span>{cur.org.place}</span>}
                    {cur.org.rating && (
                      <a className={s.link} href={publicReviewsPath(cur.org.slug)} target="_blank" rel="noopener noreferrer">
                        ★ {cur.org.rating.avg.toFixed(1)} · {cur.org.rating.count} review{cur.org.rating.count === 1 ? "" : "s"}
                      </a>
                    )}
                  </div>
                )}
              </div>
              {cur.org.telHref || cur.org.email ? (
                <div className={`${s.actions} ${s.contact}`}>
                  {cur.org.telHref && (
                    <a className={s.btnPrimary} href={cur.org.telHref}>
                      Call {cur.org.phoneDisplay}
                    </a>
                  )}
                  {cur.org.smsHref && (
                    <a className={s.btnGhost} href={cur.org.smsHref}>
                      Text
                    </a>
                  )}
                  {cur.org.email && (
                    <a className={s.btnGhost} href={`mailto:${cur.org.email}`}>
                      Email
                    </a>
                  )}
                </div>
              ) : (
                <p className={s.text}>They have your contact details and will reach out.</p>
              )}
            </div>
          </section>
        )}

        {/* ── waiting for the homeowner's ok ─────────────────────────── */}
        {v.changeOrders.length > 0 && (
          <section className={`${s.card} ${s.cardAttention}`} aria-labelledby="co-title">
            <div className={s.cardHead}>
              <h2 id="co-title" className={s.label}>
                Needs your approval
              </h2>
            </div>
            {v.changeOrders.map((c) => (
              <div key={c.token} className={s.row}>
                <div className={s.rowMain}>
                  <div className={s.rowTitle}>
                    {c.number ? `Change order #${c.number} · ` : ""}
                    {c.title}
                  </div>
                  <div className={s.mono}>
                    {c.total != null ? signed(c.total) : ""}
                    {c.total != null && c.proposalTitle ? " · " : ""}
                    {c.proposalTitle}
                  </div>
                </div>
                <a className={s.btnPrimary} href={`/co/${c.token}`}>
                  Review &amp; approve
                </a>
              </div>
            ))}
          </section>
        )}

        {/* ── proposals ──────────────────────────────────────────────── */}
        {(cur || v.proposals.length > 0) && (
          <section className={s.card} aria-labelledby="props-title">
            <div className={s.cardHead}>
              <h2 id="props-title" className={s.label}>
                {v.proposals.length > 1 ? "Proposals" : "Your proposal"}
              </h2>
            </div>
            {curProps.map((p) => (
              <ProposalCard key={p.publicId} p={p} tz={v.timeZone} />
            ))}
            {cur && curProps.length === 0 && (
              <p className={s.empty}>
                No proposal yet. When {cur.org.name} sends one, it comes to your email and shows up here.
              </p>
            )}
            {earlierProps.length > 0 && (
              <>
                <div className={s.subLabel}>
                  {new Set(earlierProps.map((p) => p.orgId)).size === 1 ? "From your earlier contractor" : "From your earlier contractors"}
                </div>
                {earlierProps.map((p) => (
                  <ProposalCard key={p.publicId} p={p} tz={v.timeZone} />
                ))}
              </>
            )}
          </section>
        )}

        {/* ── the next visit ─────────────────────────────────────────── */}
        {v.visits.length > 0 && (
          <section className={s.card} aria-labelledby="visit-title">
            <div className={s.cardHead}>
              <h2 id="visit-title" className={s.label}>
                {v.visits.length === 1 ? "Upcoming visit" : "Upcoming visits"}
              </h2>
            </div>
            {v.visits.map((x) => (
              <div key={x.startsAt} className={s.row}>
                <div className={s.rowMain}>
                  <div className={s.rowTitle}>
                    <LocalTime iso={x.startsAt} kind="day" tz={x.timeZone} />
                    {" · "}
                    <LocalTime iso={x.startsAt} kind="time" tz={x.timeZone} />
                    {"–"}
                    <LocalTime iso={x.endsAt} kind="time" tz={x.timeZone} />
                  </div>
                  <div className={s.mono}>
                    {x.title} · {x.orgName}
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* ── another contractor, any time ───────────────────────────── */}
        {cur && (
          <section className={s.card} aria-labelledby="fit-title">
            <div className={s.cardHead}>
              <h2 id="fit-title" className={s.label}>
                Not the right fit?
              </h2>
            </div>
            <div className={s.cardBody}>
              <p className={s.text}>
                You can ask for another contractor at any time. We&apos;ll let {cur.org.name} know and match your project
                with another local pro on JobFlex — your request and its details carry over.
              </p>
              <div className={s.actions}>
                <RerouteButton token={v.token} orgName={cur.org.name} accepted={!!won} />
              </div>
            </div>
          </section>
        )}

        {/* ── what they asked for ────────────────────────────────────── */}
        <section className={s.card} aria-labelledby="project-title">
          <div className={s.cardHead}>
            <h2 id="project-title" className={s.label}>
              Your project
            </h2>
            <span className={s.mono}>
              Sent <LocalTime iso={v.submittedAt} tz={v.timeZone} />
            </span>
          </div>
          <div className={s.cardBody}>
            {(v.trade || v.place) && (
              <dl className={s.facts}>
                {v.trade && (
                  <div>
                    <dt>Type</dt>
                    <dd>{v.trade}</dd>
                  </div>
                )}
                {v.place && (
                  <div>
                    <dt>Where</dt>
                    <dd>{v.place}</dd>
                  </div>
                )}
              </dl>
            )}
            {v.estimate && (
              <div className={s.scope} data-request-range>
                <p><b>Your range: {v.estimate.range}</b> · {v.estimate.material} · {v.estimate.basis}</p>
                <p>{v.estimate.basis === "from your home's size" ? "An estimate range from your home’s size and local prices, not a quote. A local pro measures and confirms on site." : "An estimate range from aerial data and local prices, not a quote. A local pro confirms on site."}</p>
              </div>
            )}
            {v.scope && (
              // Open (2026-10-14): on a fresh request it is the only thing on the page that is theirs.
              <details className={s.scope} open>
                <summary>What you asked for</summary>
                <p>{v.scope}</p>
              </details>
            )}
          </div>
        </section>

        {/* ── history ────────────────────────────────────────────────── */}
        {v.events.length > 1 && (
          <section className={s.card} aria-labelledby="history-title">
            <div className={s.cardHead}>
              <h2 id="history-title" className={s.label}>
                Activity
              </h2>
            </div>
            <ol className={s.timeline}>
              {[...v.events].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className={s.mono}>
                    <LocalTime iso={e.at} tz={v.timeZone} />
                  </span>
                  <span className={s.tlText}>{e.text}</span>
                  {e.note && <span className={s.tlNote}>{e.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <footer className={s.foot}>
          <p>
            Keep this link — it&apos;s your project&apos;s page and it stays up to date. It&apos;s private to you: anyone
            with the link can see your request, so share it carefully. Questions? Reply to any of our emails.
          </p>
          <p>
            <a href={newProjectHref}>Start another project</a>
            {" · "}
            <Link href="/privacy">Privacy</Link>
            {" · "}
            <Link href="/terms">Terms</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}

/** One proposal, drawn like the proposal email draws it; the full proposal (accept, pay, PDF) is one tap away. */
function ProposalCard({ p, tz }: { p: PortalProposal; tz: string }) {
  const st = STAGE[p.stage];
  const act = p.current && isOpen(p.stage);
  return (
    <article className={s.prop} aria-label={p.title}>
      <div className={s.propTop}>
        <span className={`${s.stamp} ${TONE[st.tone]}`}>{st.label}</span>
        {p.sentAt && (
          <span className={s.mono}>
            Sent <LocalTime iso={p.sentAt} kind="date" tz={tz} />
          </span>
        )}
      </div>
      <div>
        <div className={s.propTitle}>{p.title}</div>
        {!p.current && <div className={s.propFrom}>{p.orgName}</div>}
      </div>
      <table className={s.lines}>
        <tbody>
          {p.lines.map((li, i) => (
            <tr key={i}>
              <th scope="row">{li.name}</th>
              <td>{money(li.total)}</td>
            </tr>
          ))}
          {p.more && (
            <tr className={s.quiet}>
              <th scope="row">
                {p.more.count} more item{p.more.count === 1 ? "" : "s"}
              </th>
              <td>{money(p.more.total)}</td>
            </tr>
          )}
          {p.taxTotal > 0 && (
            <tr className={s.quiet}>
              <th scope="row">Tax ({pct(p.taxRate)})</th>
              <td>{money(p.taxTotal)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className={p.approvedChanges ? undefined : s.grand}>
            <th scope="row">Total</th>
            <td>{money(p.total)}</td>
          </tr>
          {p.approvedChanges !== 0 && (
            <>
              <tr className={s.quiet}>
                <th scope="row">Approved changes</th>
                <td>{signed(p.approvedChanges)}</td>
              </tr>
              <tr className={s.grand}>
                <th scope="row">Contract total</th>
                <td>{money(Math.round((p.total + p.approvedChanges) * 100) / 100)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
      {isOpen(p.stage) && p.validUntil && (
        <div className={s.mono}>
          Price held until <LocalTime iso={p.validUntil} kind="date" tz={tz} />
        </div>
      )}
      <div className={s.actions}>
        <a className={act ? s.btnPrimary : s.btnGhost} href={`/portal/q/${p.publicId}`}>
          {act ? "Review & accept" : "Open proposal"}
        </a>
        <a className={s.btnGhost} href={`/api/public-quote/${p.publicId}/pdf`}>
          PDF
        </a>
      </div>
    </article>
  );
}
