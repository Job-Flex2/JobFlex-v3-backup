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
//
// BESIDE IT (owner, 2026-10-25): the pitch deck (./pitch) and the platform tour (./tour), behind the same door
// (./reader) and reached from the tabs under the greeting.
import type { Metadata } from "next";
import { forReaders, investorReport } from "@/lib/investors";
import { InvestorReportView } from "@/components/v3/admin-investors/investor-report";
import { longDate } from "@/lib/investorModel";
import { InvestorTop, investorReader } from "./reader";
import s from "./investors-public.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Investor figures", robots: { index: false, follow: false } };

export default async function InvestorsPublicPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ open?: string }> }) {
  const { token } = await params;
  const { open: openWord } = await searchParams;
  const door = await investorReader(token, { openWord, countVisit: true });
  if ("door" in door) return door.door;
  // The reader's copy: the page's own figures, nothing that carries the no-card days' money (2026-10-25).
  const report = forReaders(await investorReport());
  return (
    <main className={s.page}>
      <div className={s.frame}>
        <InvestorTop token={token} visitor={door.visitor} page="figures" />
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
