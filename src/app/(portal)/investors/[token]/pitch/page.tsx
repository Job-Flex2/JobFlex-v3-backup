// THE PITCH DECK — /investors/<token>/pitch (owner, 2026-10-25: "one more page where the pitch deck for JobFlex —
// who we are and what we're doing"). Behind the same door as the figures (../reader). Every number on it is the
// Figures page's own reading (lib/investors, the readers' copy), the prices are the live plan catalogue, the
// comparison is the landing page's researched table (no Lead Center count — the homeowner side is not open yet), and
// the raise and what is next are the owner's words from /admin/investors (the team is shared after a preliminary
// offer, never on the link)
// (lib/investorPitch) — a slide with no words does not show.
import type { Metadata } from "next";
import { forReaders, investorReport } from "@/lib/investors";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { readInvestorPitch } from "@/lib/investorPitch";
import { buildPitchData } from "@/lib/investorPitchData";
import { INVESTING_KINDS } from "@/lib/investorGate";
import { VcOfferButton } from "@/components/v3/investor-gate/investor-gate";
import { PitchDeck } from "@/components/v3/investor-deck/pitch-deck";
import { InvestorTop, investorReader } from "../reader";
import s from "../investors-public.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Pitch deck", robots: { index: false, follow: false } };

export default async function InvestorPitchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const door = await investorReader(token);
  if ("door" in door) return door.door;
  const visitor = door.visitor;
  const [report, plans, pitch] = await Promise.all([
    investorReport().then(forReaders),
    getPlanCatalog().catch(() => []),
    readInvestorPitch(),
  ]);
  const data = buildPitchData(token, report, plans, pitch);
  return (
    <main className={`${s.page} ${s.pageWide}`}>
      <div className={`${s.frame} ${s.frameWide}`}>
        <InvestorTop token={token} visitor={visitor} page="pitch" />
        <header className={s.headWide}>
          <h1 className={s.h1Wide}>Pitch deck</h1>
          <p className={s.subWide}>Who we are, what JobFlex is worth to a contractor, and how it earns. Arrow keys or a swipe turn it, F or Full screen gives it the whole screen; the traction is read live.</p>
        </header>
        <PitchDeck data={data} offer={<VcOfferButton key="offer" token={token} visitor={{ name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone }} lead={INVESTING_KINDS.has(visitor.kind)} />} />
      </div>
    </main>
  );
}
