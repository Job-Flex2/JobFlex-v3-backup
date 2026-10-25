// THE PLATFORM TOUR — /investors/<token>/tour (owner, 2026-10-25: "an overview of the platform, kind of a slideshow —
// the tools, how the platform looks, screenshots… even the home portal, how everything works"). Behind the same door as
// the figures (../reader); the screens and their words are components/v3/investor-deck/tour-shots.
import type { Metadata } from "next";
import { PlatformTour } from "@/components/v3/investor-deck/platform-tour";
import { TOUR_SHOTS } from "@/components/v3/investor-deck/tour-shots";
import { InvestorTop, investorReader } from "../reader";
import s from "../investors-public.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Platform tour", robots: { index: false, follow: false } };

export default async function InvestorTourPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const door = await investorReader(token);
  if ("door" in door) return door.door;
  return (
    <main className={`${s.page} ${s.pageWide}`}>
      <div className={`${s.frame} ${s.frameWide}`}>
        <InvestorTop token={token} visitor={door.visitor} page="tour" />
        <header className={s.headWide}>
          <h1 className={s.h1Wide}>Platform tour</h1>
          <p className={s.subWide}>{TOUR_SHOTS.length} real JobFlex screens in the order a job lives — from the first call to the money. They were taken on test copies of the app, so every company, person and address on them is made up. F or Full screen gives them the whole screen.</p>
        </header>
        <PlatformTour />
      </div>
    </main>
  );
}
