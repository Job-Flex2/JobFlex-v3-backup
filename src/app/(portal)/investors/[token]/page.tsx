// THE INVESTORS' PAGE — /investors/<token> (2026-10-06): the live figures the
// owner shares, with no admin around them. Open to anyone holding the link
// while the link is switched on (lib/investors); a stale or switched-off
// link gets a plain "not active" page. Search engines are told to stay out.
//
// WHO IS READING (owner, 2026-10-13): the figures open once the reader says
// who they are — name, company, what they do, an email — and we hear about it
// (lib/investorVisitors); this browser keeps a pass for the link. At the top,
// "We accept VC offers" sends a short offer to us. The door is for everyone
// (owner, 2026-10-14): a signed-in admin goes through it too and sees the page
// as a reader does — their entry marked as a test, told to nobody.
//
// AND WAITS FOR OUR YES (owner, 2026-10-20): with approvals on, a reader who
// introduced themselves waits here (InvestorWaiting) until an admin approves on
// /admin/investors; the page opens on its own then. ?open= carries a word back
// from an open link that could not open (expired, or not approved).
import type { Metadata } from "next";
import { forReaders, investorLinkOpen, investorReport, readInvestorSettings } from "@/lib/investors";
import { visitorForLink } from "@/lib/investorVisitors";
import { INVESTING_KINDS, mayRead, statusOf } from "@/lib/investorGate";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { InvestorReportView } from "@/components/v3/admin-investors/investor-report";
import { InvestorGate, InvestorWaiting, VcOfferButton } from "@/components/v3/investor-gate/investor-gate";
import { longDate } from "@/lib/investorModel";
import s from "./investors-public.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Investor figures", robots: { index: false, follow: false } };

async function signedInAdmin(): Promise<boolean> {
  try {
    await requirePlatformAdmin();
    return true;
  } catch {
    return false;
  }
}

export default async function InvestorsPublicPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ open?: string }> }) {
  const { token } = await params;
  const { open: openWord } = await searchParams;
  const notice = openWord === "expired" || openWord === "closed" ? openWord : undefined;
  const open = /^[A-Za-z0-9_-]{16,64}$/.test(token) && (await investorLinkOpen(token));
  if (!open) {
    return (
      <main className={s.page}>
        <div className={s.frame}>
          <div className={s.kicker}>JobFlex · Investors</div>
          <h1 className={s.h1}>This link is not active</h1>
          <p className={s.sub}>Ask for a current one.</p>
        </div>
      </main>
    );
  }
  const [admin, visitor, settings] = await Promise.all([signedInAdmin(), visitorForLink(token, { countVisit: true }), readInvestorSettings()]);
  if (!visitor) {
    return (
      <main className={s.page}>
        <InvestorGate token={token} admin={admin} approval={settings.approveReaders} notice={notice} />
      </main>
    );
  }
  if (!mayRead(visitor, settings.approveReaders)) {
    return (
      <main className={s.page}>
        <InvestorWaiting token={token} visitor={{ name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone }} status={statusOf(visitor) === "declined" ? "declined" : "pending"} />
      </main>
    );
  }
  // The reader's copy: the page's own figures, nothing that carries the no-card days' money (2026-10-25).
  const report = forReaders(await investorReport());
  const lead = INVESTING_KINDS.has(visitor.kind);
  return (
    <main className={s.page}>
      <div className={s.frame}>
        <div className={s.vcBar} data-vc-bar>
          <p className={s.vcWords}>
            {visitor.visits > 1 ? "Welcome back" : "Welcome"}, <b>{visitor.name}</b> · {visitor.company}. We&apos;re raising — offers and first conversations welcome.
            {visitor.admin ? <> <em data-admin-test>You are signed in as an admin: this is the page a reader sees. Your entry is kept out of the reader list; an offer from here is emailed as a test.</em></> : null}
          </p>
          <VcOfferButton token={token} visitor={{ name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone }} lead={lead} />
        </div>
        <header className={s.head}>
          <div>
            <div className={s.kicker}>JobFlex · Investors</div>
            <h1 className={s.h1}>Ads, trials and payback</h1>
            <p className={s.sub}>Day {report.launch.day.toLocaleString("en-US")} since JobFlex launched on {longDate(report.launch.date)}. {report.figures.since !== report.startDay ? <>Live figures since {longDate(report.figures.since)}, from when every trial needed a card.</> : <>Live figures since {longDate(report.figures.since)}, the day the first campaign went live.</>} Read {new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</p>
          </div>
          <a className={s.pdf} href={`/api/investors/${token}/pdf`}>Download PDF</a>
        </header>
        <InvestorReportView report={report} shared />
      </div>
    </main>
  );
}
