// THE INVESTORS' PAGE — /investors/<token> (2026-10-06): the live figures the
// owner shares, with no admin around them. Open to anyone holding the link
// while the link is switched on (lib/investors); a stale or switched-off
// link gets a plain "not active" page. Search engines are told to stay out.
//
// WHO IS READING (owner, 2026-10-13): the figures open once the reader says
// who they are — name, company, what they do, an email — and we hear about it
// (lib/investorVisitors); this browser keeps a pass for the link. At the top,
// "We accept VC offers" sends a short offer to us. A signed-in platform admin
// sees the figures straight away (?preview=gate shows the form investors get).
import type { Metadata } from "next";
import { investorLinkOpen, investorReport } from "@/lib/investors";
import { visitorForLink } from "@/lib/investorVisitors";
import { INVESTING_KINDS } from "@/lib/investorGate";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { InvestorReportView } from "@/components/v3/admin-investors/investor-report";
import { InvestorGate, VcOfferButton } from "@/components/v3/investor-gate/investor-gate";
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

export default async function InvestorsPublicPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { token } = await params;
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
  const [admin, visitor, sp] = await Promise.all([signedInAdmin(), visitorForLink(token, { countVisit: true }), searchParams]);
  if (!visitor && (!admin || sp.preview === "gate")) {
    return (
      <main className={s.page}>
        <InvestorGate token={token} adminPreview={admin} />
      </main>
    );
  }
  const report = await investorReport();
  const lead = !!visitor && INVESTING_KINDS.has(visitor.kind);
  return (
    <main className={s.page}>
      <div className={s.frame}>
        <div className={s.vcBar} data-vc-bar>
          <p className={s.vcWords}>
            {visitor ? (
              <>
                {visitor.visits > 1 ? "Welcome back" : "Welcome"}, <b>{visitor.name}</b> · {visitor.company}. We&apos;re raising — offers and first conversations welcome.
              </>
            ) : (
              <>Admin view — investors introduce themselves first (<a href={`/investors/${token}?preview=gate`}>see the form</a>).</>
            )}
          </p>
          <VcOfferButton token={token} visitor={visitor ? { name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone } : null} lead={lead} />
        </div>
        <header className={s.head}>
          <div>
            <div className={s.kicker}>JobFlex · Investors</div>
            <h1 className={s.h1}>Ads, trials and payback</h1>
            <p className={s.sub}>Live figures since {longDate(report.figures.since)}, the day the first campaign went live. Read {new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</p>
          </div>
          <a className={s.pdf} href={`/api/investors/${token}/pdf`}>Download PDF</a>
        </header>
        <InvestorReportView report={report} shared />
      </div>
    </main>
  );
}
