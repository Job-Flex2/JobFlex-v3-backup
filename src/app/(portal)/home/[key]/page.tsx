// THE HOME DASHBOARD — /home/[key] (2026-10-03, redesigned the same day).
// The homeowner's own page, made by their first request and reached through
// the key the emails carry. No account, no password (lib/home/portal says who
// may see what).
//
// Owner: "a homeowner's feel, not exactly JobFlex; welcome back with the
// first and last name; full-page, organised, more options." So: a top bar,
// a welcome band with the name and the house, a row of the things they can
// do, then two columns — the work on the left (what needs them, the projects,
// the finished ones as the house's record, the plans), the house's life on
// the right (calendar, contractors, memberships, documents, activity, their
// own details). One column on a phone. It re-reads itself while open.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadHomeDashboard, type HomeDashboard, type HomeNeed } from "@/lib/home/portal";
import type { RequestPortalView, ProposalStage } from "@/lib/requestPortal";
import { publicReviewsPath } from "@/lib/reviews/publicSummary";
import { LiveRefresh, LocalTime } from "@/components/portal/live-time";
import { Planner } from "./planner";
import { MessageBox } from "./message-box";
import { Calendar } from "./calendar";
import { DetailsForm } from "./details-form";
import { FolderBox } from "./folder-box";
import s from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your home — JobFlex",
  description: "Every project on your house, the proposals, your contractors and the jobs you're planning — in one place.",
  robots: { index: false, follow: false },
};

type Tone = "accent" | "emerald" | "rose" | "amber" | "neutral";
const TONE: Record<Tone, string> = { accent: s.stampAccent, emerald: s.stampEmerald, rose: s.stampRose, amber: s.stampAmber, neutral: s.stampNeutral };
const STATUS: Record<RequestPortalView["status2"], { label: string; tone: Tone }> = {
  WAITING: { label: "Finding a pro", tone: "neutral" },
  MATCHED: { label: "Matched", tone: "accent" },
  PROPOSAL: { label: "Proposal ready", tone: "accent" },
  HIRED: { label: "Hired", tone: "emerald" },
  DONE: { label: "Done", tone: "emerald" },
};
const STAGE_WORD: Record<ProposalStage, string> = { NEW: "New", OPENED: "Opened", ACCEPTED: "Accepted", DECLINED: "Declined", PAID: "Paid", COMPLETED: "Completed" };
const NEED_WORD: Record<HomeNeed["kind"], string> = { proposal: "Review", pay: "Pay", due: "Details", change: "Approve", visit: "Details", review: "Review", plan: "Submit", files: "Add photos" };
const NEED_PHRASE: Record<HomeNeed["kind"], string> = { proposal: "a proposal to review", pay: "a payment due", due: "a payment coming up", change: "a change to approve", visit: "a visit coming up", review: "a review to leave", plan: "a plan to submit", files: "photos to add" };
/** "a proposal to review and a visit coming up" — the welcome band's one line on what waits below. */
function needsSummary(needs: HomeNeed[]): string {
  const kinds = [...new Set(needs.map((n) => n.kind))];
  const first = kinds.slice(0, 2).map((k) => NEED_PHRASE[k]);
  return kinds.length > 2 ? `${first.join(", ")} and more` : first.join(" and ");
}
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function projectTitle(p: RequestPortalView): string {
  return `${p.trade ?? "Project"}${p.place ? ` · ${p.place}` : ""}`;
}

/** "Good morning" by the home's clock. */
function daypart(tz: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function HomePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const h = await loadHomeDashboard(key);
  if (!h) notFound();
  // In progress until the work is done — a hired job with a visit next week is not the record yet.
  const active = h.projects.filter((p) => p.status2 !== "DONE");
  const record = h.projects.filter((p) => p.status2 === "DONE");
  const newProjectHref = `/homeowner?home=${encodeURIComponent(h.key)}`;
  // The street line often carries the city and the ZIP already — say each once.
  const addr = h.details.address;
  const house = addr
    ? `${addr}${h.place && !addr.toLowerCase().includes(h.place.toLowerCase()) ? `, ${h.place}` : ""}${h.details.zip && !addr.includes(h.details.zip) && !(h.place ?? "").includes(h.details.zip) ? ` ${h.details.zip}` : ""}`
    : h.address ?? h.place ?? "Your home";

  return (
    <div className={s.page}>
      {/* ── top bar ───────────────────────────────────────────────────── */}
      <header className={s.bar}>
        <div className={s.barIn}>
          <Link href="/" className={s.brand}>
            <span className={s.mark} aria-hidden="true">J</span>
            <span className={s.brandText}>JobFlex <em>Home</em></span>
          </Link>
          <nav className={s.barNav} aria-label="On this page">
            <a href="#projects">Projects</a>
            <a href="#plans">Plans</a>
            <a href="#contractors">Contractors</a>
            <a href="#details">Details</a>
          </nav>
          <div className={s.barEnd}>
            <LiveRefresh className={s.live} />
            <a className={s.barCta} href={newProjectHref}><b aria-hidden="true">+</b>New project</a>
          </div>
        </div>
      </header>

      <main className={s.wrap}>
        {/* ── welcome ─────────────────────────────────────────────────── */}
        <section className={s.welcome} aria-labelledby="welcome-title">
          <div className={s.welcomeText}>
            <div className={s.kicker}>{h.returning ? "Welcome back" : "Welcome"} · {daypart(h.timeZone)}</div>
            <h1 id="welcome-title" className={s.title}>{h.name}</h1>
            <p className={s.house}>{house}</p>
            <div className={s.welcomeActions}>
              <a className={s.btnHero} href={newProjectHref}><b aria-hidden="true">+</b>Start a new project</a>
              <span className={s.heroNote}>Describe it in a minute — a local pro takes it from there.</span>
            </div>
            {h.needs.length > 0 && (
              <a className={s.next} href="#needs"><span className={s.count}>{h.needs.length}</span><span>{h.needs.length === 1 ? "One thing needs you" : `${h.needs.length} things need you`}: {needsSummary(h.needs)}</span></a>
            )}
            <p className={s.lede}>
              Every project on your house lives here — the proposals, your contractors, the record of what was done, and the jobs you&apos;re planning. No account, no password: keep this link.
            </p>
          </div>
          <dl className={s.stats}>
            <div><dt>Projects</dt><dd>{h.stats.projects}</dd></div>
            <div><dt>Hired</dt><dd>{h.stats.hired}</dd></div>
            <div><dt>Invested</dt><dd>{h.stats.spent > 0 ? usd.format(h.stats.spent) : "—"}</dd></div>
            <div><dt>With us since</dt><dd><LocalTime iso={h.since} kind="date" tz={h.timeZone} /></dd></div>
          </dl>
        </section>

        {/* ── what they can do ────────────────────────────────────────── */}
        <nav className={s.quick} aria-label="What you can do">
          <a className={s.quickItem} href="/price">
            <b>Price a project</b>
            <span>A roof range for your house in a minute — from the sky, no account</span>
          </a>
          <a className={s.quickItem} href="#plans">
            <b>Plan one for later</b>
            <span>Put it on the calendar; we remind you when the month comes</span>
          </a>
          <a className={s.quickItem} href="#contractors">
            <b>Reach a contractor</b>
            <span>Call, text, email, book a visit, hire again</span>
          </a>
          <a className={s.quickItem} href="#projects">
            <b>Add photos or a video</b>
            <span>Into the contractor&apos;s folder for the job — any time, or when they ask</span>
          </a>
        </nav>

        <div className={s.columns}>
          {/* ── the work ──────────────────────────────────────────────── */}
          <div className={s.main}>
            {h.needs.length > 0 && (
              <section className={`${s.card} ${s.cardAttention}`} id="needs" aria-labelledby="needs-title">
                <div className={s.cardHead}><h2 id="needs-title" className={s.label}>Needs you</h2><span className={s.count}>{h.needs.length}</span></div>
                {h.needs.map((n, i) => (
                  <div key={i} className={s.row}>
                    <div className={s.rowMain}>
                      <div className={s.rowTitle}>{n.text}</div>
                      {n.at && <div className={s.mono}><LocalTime iso={n.at} tz={h.timeZone} /></div>}
                    </div>
                    <a className={n.kind === "due" ? s.btnGhost : s.btnPrimary} href={n.href}>{NEED_WORD[n.kind]}</a>
                  </div>
                ))}
              </section>
            )}

            <section className={s.card} id="projects" aria-labelledby="projects-title">
              <div className={s.cardHead}>
                <h2 id="projects-title" className={s.label}>{active.length === 1 ? "Your project" : "Your projects"}</h2>
                <span className={s.mono}>{active.length} in progress · {record.length} finished</span>
              </div>
              {active.length === 0 && (
                <p className={s.empty}>Nothing in progress right now. <a className={s.link} href={newProjectHref}>Start a new project</a> — it takes a minute, and a local pro on JobFlex takes it from there.</p>
              )}
              {active.map((p) => <ProjectCard key={p.token} p={p} h={h} />)}
            </section>

            {record.length > 0 && (
              <section className={s.card} aria-labelledby="record-title">
                <div className={s.cardHead}>
                  <h2 id="record-title" className={s.label}>Done on your house</h2>
                  <span className={s.mono}>Your record — keep it for as long as you own the place</span>
                </div>
                {record.map((p) => <ProjectCard key={p.token} p={p} h={h} />)}
              </section>
            )}

            {h.plans.some((p) => p.estimate && p.status === "PLANNED") && (
              <section className={s.card} id="ranges" aria-labelledby="ranges-title" data-home-range>
                <div className={s.cardHead}>
                  <h2 id="ranges-title" className={s.label}>Your roof range</h2>
                  <span className={s.mono}>Priced on JobFlex · not a quote</span>
                </div>
                <div className={s.cardBody}>
                  {h.plans.filter((p) => p.estimate && p.status === "PLANNED").map((p) => (
                    <p key={p.id} className={s.text}>
                      <b>{p.estimate!.range}</b> · {p.estimate!.material} · {p.title}{" "}
                      <a href={`/price/roof?home=${encodeURIComponent(h.key)}&plan=${encodeURIComponent(p.id)}`}>Get quotes</a>
                    </p>
                  ))}
                  <p className={s.text}>A local pro confirms on site. Ready? Get quotes sends it to one local pro at a time.</p>
                </div>
              </section>
            )}

            <section className={s.card} id="plans" aria-labelledby="plans-title">
              <div className={s.cardHead}>
                <h2 id="plans-title" className={s.label}>Plan ahead</h2>
                <span className={s.mono}>We remind you by email when the month comes</span>
              </div>
              <div className={s.cardBody}>
                <p className={s.text}>
                  Thinking about the garage floor in spring, or paint before the holidays? Put it here with a month. When it comes, we remind you — and one tap sends it to a local pro.
                </p>
                <Planner homeKey={h.key} plans={h.plans} />
              </div>
            </section>
          </div>

          {/* ── the house's life ──────────────────────────────────────── */}
          <aside className={s.rail}>
            <section className={s.card} aria-labelledby="cal-title">
              <div className={s.cardHead}><h2 id="cal-title" className={s.label}>Calendar</h2></div>
              <Calendar items={h.calendar} timeZone={h.timeZone} icsHref={`/home/${encodeURIComponent(h.key)}/calendar.ics`} months={2} />
            </section>

            <section className={s.card} id="contractors" aria-labelledby="pros-title">
              <div className={s.cardHead}><h2 id="pros-title" className={s.label}>Your contractors</h2></div>
              {h.contractors.length === 0 && <p className={s.empty}>Your first contractor appears here once a pro takes your project.</p>}
              {h.contractors.map((c) => (
                <div key={c.org.id} className={s.pro}>
                  <div className={s.rowMain}>
                    <div className={s.rowTitle}>{c.org.name}</div>
                    <div className={s.proMeta}>
                      {c.org.place && <span>{c.org.place}</span>}
                      <span>{c.projects} {c.projects === 1 ? "project" : "projects"}</span>
                      {c.org.rating && (
                        <a className={s.link} href={publicReviewsPath(c.org.slug)} target="_blank" rel="noopener noreferrer">
                          ★ {c.org.rating.avg.toFixed(1)} · {c.org.rating.count} review{c.org.rating.count === 1 ? "" : "s"}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className={s.chips}>
                    {c.org.telHref && <a className={s.chip} href={c.org.telHref}>Call</a>}
                    {c.org.smsHref && <a className={s.chip} href={c.org.smsHref}>Text</a>}
                    {c.org.email && <a className={s.chip} href={`mailto:${c.org.email}`}>Email</a>}
                    {c.bookingHref && <a className={s.chip} href={c.bookingHref}>Book a visit</a>}
                    <a className={`${s.chip} ${s.chipStrong}`} href={c.hireHref}>Hire again</a>
                  </div>
                </div>
              ))}
            </section>

            {h.memberships.length > 0 && (
              <section className={s.card} aria-labelledby="plans-sp-title">
                <div className={s.cardHead}><h2 id="plans-sp-title" className={s.label}>Your memberships</h2></div>
                {h.memberships.map((m) => (
                  <div key={m.href} className={s.row}>
                    <div className={s.rowMain}>
                      <div className={s.rowTitle}>{m.name} · {m.orgName}</div>
                      <div className={s.mono}>
                        {m.status === "ACTIVE" ? "Member" : "Offered to you"}
                        {m.nextVisit && <> · next visit <LocalTime iso={m.nextVisit.at} kind="day" tz={h.timeZone} /> — {m.nextVisit.label}</>}
                        {m.endsAt && m.status === "ACTIVE" && <> · through <LocalTime iso={m.endsAt} kind="date" tz={h.timeZone} /></>}
                      </div>
                    </div>
                    <a className={m.status === "SENT" ? s.btnPrimary : s.btnGhost} href={m.href}>{m.status === "SENT" ? "See the plan" : "Open"}</a>
                  </div>
                ))}
              </section>
            )}

            <section className={s.card} id="documents" aria-labelledby="docs-title">
              <div className={s.cardHead}><h2 id="docs-title" className={s.label}>Documents</h2></div>
              {h.documents.length === 0 ? (
                <p className={s.empty}>Proposals, PDFs and change orders land here as contractors send them.</p>
              ) : (
                <ul className={s.docs}>
                  {h.documents.map((d, i) => (
                    <li key={i}>
                      <a className={s.link} href={d.href} target={d.kind === "pdf" ? "_blank" : undefined} rel={d.kind === "pdf" ? "noopener noreferrer" : undefined}>{d.label}</a>
                      <span className={s.mono}>{d.orgName} · <LocalTime iso={d.at} kind="date" tz={h.timeZone} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {h.activity.length > 0 && (
              <section className={s.card} aria-labelledby="activity-title">
                <div className={s.cardHead}><h2 id="activity-title" className={s.label}>Recent activity</h2></div>
                <ol className={s.timeline}>
                  {h.activity.map((e, i) => (
                    <li key={i}>
                      <span className={s.mono}><LocalTime iso={e.at} tz={h.timeZone} /></span>
                      <span className={s.tlText}>{e.text}</span>
                      <a className={s.tlProject} href={e.href}>{e.project}</a>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className={s.card} id="details" aria-labelledby="details-title">
              <div className={s.cardHead}><h2 id="details-title" className={s.label}>Your details</h2></div>
              <div className={s.cardBody}>
                <DetailsForm homeKey={h.key} details={h.details} />
              </div>
            </section>
          </aside>
        </div>

        <footer className={s.foot}>
          <p>
            This page is private to you — anyone with the link can see your projects, so share it carefully. Lost the link? Go to <Link href="/home">jobflex.app/home</Link> and we&apos;ll email it to {h.email}.
          </p>
          <p>
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/homeowner">JobFlex for homeowners</Link>
          </p>
        </footer>
      </main>
    </div>
  );
}

function ProjectCard({ p, h }: { p: RequestPortalView; h: HomeDashboard }) {
  const st = STATUS[p.status2];
  const href = `/request/${encodeURIComponent(p.token)}`;
  const open = p.proposals.find((q) => q.current && (q.stage === "NEW" || q.stage === "OPENED")) ?? null;
  const won = p.proposals.find((q) => q.current && (q.stage === "ACCEPTED" || q.stage === "PAID" || q.stage === "COMPLETED")) ?? null;
  const shown = open ?? won ?? p.proposals.find((q) => q.current) ?? null;
  const messages = h.messages[p.token] ?? [];
  return (
    <article className={s.project} data-status={p.status2} aria-label={projectTitle(p)}>
      <div className={s.projectTop}>
        <span className={`${s.stamp} ${TONE[st.tone]}`}>{st.label}</span>
        <span className={s.mono}>Sent <LocalTime iso={p.submittedAt} kind="date" tz={h.timeZone} /></span>
      </div>
      <h3 className={s.projectTitle}><a href={href}>{projectTitle(p)}</a></h3>
      {p.scope && <p className={s.scope}>{p.scope.split("\n")[0]}</p>}
      <dl className={s.facts}>
        {p.current ? (
          <div>
            <dt>Contractor</dt>
            <dd>
              {p.current.org.name}
              {p.current.org.telHref && <> · <a className={s.link} href={p.current.org.telHref}>{p.current.org.phoneDisplay}</a></>}
            </dd>
          </div>
        ) : (
          <div><dt>Contractor</dt><dd>Being matched — you&apos;ll get an email</dd></div>
        )}
        {won && (won.paid > 0 || won.remaining > 0) && (
          <div>
            <dt>Payments</dt>
            <dd>
              {won.remaining <= 0 ? "Paid in full" : `${usd.format(won.paid)} paid · ${usd.format(won.remaining)} left`}
              {won.nextDue && won.remaining > 0 && (won.payOnline
                ? <> · next: {won.nextDue.label} {usd.format(won.nextDue.amount)} — <a className={s.link} href={`/portal/q/${encodeURIComponent(won.publicId)}`}>pay</a></>
                : <> · next: {won.nextDue.label} {usd.format(won.nextDue.amount)} — {won.orgName} will tell you how to pay</>)}
            </dd>
          </div>
        )}
        {p.visits[0] && (
          <div>
            <dt>Next visit</dt>
            <dd><LocalTime iso={p.visits[0].startsAt} kind="day" tz={p.visits[0].timeZone} /> · <LocalTime iso={p.visits[0].startsAt} kind="time" tz={p.visits[0].timeZone} /> — {p.visits[0].title}</dd>
          </div>
        )}
        {p.changeOrders.length > 0 && (
          <div>
            <dt>Waiting for you</dt>
            <dd>{p.changeOrders.map((c) => <a key={c.token} className={s.link} href={`/co/${encodeURIComponent(c.token)}`}>{c.title}</a>).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}</dd>
          </div>
        )}
      </dl>
      {shown && (
        <div className={s.proposal} data-open={Boolean(open)} aria-label={`Proposal: ${shown.title}`}>
          <div className={s.proposalHead}>
            <span className={`${s.stamp} ${open ? s.stampAccent : won ? s.stampEmerald : s.stampNeutral}`}>{open ? (shown.stage === "NEW" ? "New proposal" : "Proposal · opened") : `Proposal · ${STAGE_WORD[shown.stage].toLowerCase()}`}</span>
            <span className={s.mono}>{shown.orgName} · sent <LocalTime iso={shown.sentAt ?? p.submittedAt} kind="date" tz={h.timeZone} /></span>
          </div>
          <h4 className={s.proposalTitle}>{shown.title}</h4>
          <div className={s.proposalSum}>
            <span className={s.proposalTotal}>{usd.format(shown.total + shown.approvedChanges)}</span>
            {shown.approvedChanges !== 0 && <span className={s.mono}>incl. approved changes</span>}
            {open && shown.validUntil && <span className={s.mono}>price held until <LocalTime iso={shown.validUntil ?? ""} kind="date" tz={h.timeZone} /></span>}
          </div>
          <div className={s.actions}>
            <a className={open ? s.btnPrimary : s.btnGhost} href={`/portal/q/${encodeURIComponent(shown.publicId)}`}>{open ? "Review & accept" : "Open proposal"}</a>
            <a className={s.btnGhost} href={`/api/public-quote/${encodeURIComponent(shown.publicId)}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a>
          </div>
        </div>
      )}
      <div className={s.actions}>
        <a className={shown ? s.btnGhost : s.btnPrimary} href={href}>Open project page</a>
      </div>
      {p.current && <MessageBox homeKey={h.key} token={p.token} orgName={p.current.org.name} sent={messages} timeZone={h.timeZone} />}
      <FolderBox homeKey={h.key} token={p.token} orgName={p.current?.org.name ?? null} files={h.folders[p.token]?.files ?? []} requests={h.folders[p.token]?.requests ?? []} storage={h.storage} timeZone={h.timeZone} />
    </article>
  );
}
