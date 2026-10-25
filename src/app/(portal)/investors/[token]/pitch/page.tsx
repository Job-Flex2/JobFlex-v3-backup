// THE PITCH DECK — /investors/<token>/pitch (owner, 2026-10-25: "one more page where the pitch deck for JobFlex —
// who we are and what we're doing"). Behind the same door as the figures (../reader). Every number on it is the
// Figures page's own reading (lib/investors, the readers' copy), the prices are the live plan catalogue, the
// comparison is the landing page's researched table, the homeowner side is the Lead Center's own count
// (lib/investorLeads), and the team, the raise and what is next are the owner's words from /admin/investors
// (lib/investorPitch) — a slide with no words does not show.
import type { Metadata } from "next";
import { forReaders, investorReport } from "@/lib/investors";
import { readLeadMarket } from "@/lib/investorLeads";
import { MAX_LEAD_PRICE_CENTS, MIN_LEAD_PRICE_CENTS } from "@/lib/leadCenter/purchase";
import { DESK_PACK } from "@/lib/aiDesk/shared";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { pitchLines, readInvestorPitch } from "@/lib/investorPitch";
import { INVESTING_KINDS } from "@/lib/investorGate";
import { CAVEAT_LABEL, COMPARE_COMPETITORS, COMPARE_ROWS } from "@/components/v3/landing-e/landing-compare";
import { VcOfferButton } from "@/components/v3/investor-gate/investor-gate";
import { PitchDeck, type PitchData } from "@/components/v3/investor-deck/pitch-deck";
import { InvestorTop, investorReader } from "../reader";
import s from "../investors-public.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Pitch deck", robots: { index: false, follow: false } };

export default async function InvestorPitchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const door = await investorReader(token);
  if ("door" in door) return door.door;
  const visitor = door.visitor;
  const [report, plans, pitch, leads] = await Promise.all([
    investorReport().then(forReaders),
    getPlanCatalog().catch(() => []),
    readInvestorPitch(),
    readLeadMarket(),
  ]);
  const f = report.figures;
  const data: PitchData = {
    token,
    launch: { day: report.launch.day, date: report.launch.date },
    traction: {
      since: f.since, signups: f.signups, paying: f.paying.count, payingMrrCents: f.paying.mrrCents, trialsNow: f.trials.count,
      ratePct: f.rate.pct, ratePaid: f.rate.paid, rateEnded: f.rate.ended, rateLowPct: f.rate.lowPct, rateHighPct: f.rate.highPct,
      collected: { read: report.collected.read, cents: report.collected.cents, invoices: report.collected.invoices },
      at: report.at,
    },
    unit: {
      spendCents: f.spend.totalCents, won: f.paying.won, wonMrrCents: f.paying.wonMrrCents, arrCents: f.paying.arrCents,
      costPerPayingCents: f.unit.costPerPayingCents, costPerSignupCents: f.unit.costPerSignupCents, paybackMonths: f.unit.paybackMonths,
      expectedPayers: f.expected.payers, expectedMrrCents: f.expected.mrrCents,
    },
    leads,
    leadPrice: { minCents: MIN_LEAD_PRICE_CENTS, maxCents: MAX_LEAD_PRICE_CENTS },
    deskPack: { minutes: DESK_PACK.minutes, cents: DESK_PACK.cents },
    plans: plans
      .filter((p) => p.active && !p.isFree)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ name: p.name, priceCents: p.priceCents, yearlyPriceCents: p.yearlyPriceCents, trialDays: p.trialDays, highlight: p.highlight, features: p.features })),
    compare: {
      competitors: COMPARE_COMPETITORS,
      rows: COMPARE_ROWS.map((r) => ({ id: r.id, label: r.label, detail: r.detail, them: r.them })),
      caveats: CAVEAT_LABEL,
    },
    words: { team: pitchLines(pitch.team), ask: pitchLines(pitch.ask), roadmap: pitchLines(pitch.roadmap) },
  };
  return (
    <main className={`${s.page} ${s.pageWide}`}>
      <div className={`${s.frame} ${s.frameWide}`}>
        <InvestorTop token={token} visitor={visitor} page="pitch" />
        <header className={s.headWide}>
          <h1 className={s.h1Wide}>Pitch deck</h1>
          <p className={s.subWide}>Who we are, what JobFlex is worth to a contractor, and how it earns. Arrow keys or a swipe turn it, F or Full screen gives it the whole screen; the traction and the homeowner leads are read live.</p>
        </header>
        <PitchDeck data={data} offer={<VcOfferButton key="offer" token={token} visitor={{ name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone }} lead={INVESTING_KINDS.has(visitor.kind)} />} />
      </div>
    </main>
  );
}
