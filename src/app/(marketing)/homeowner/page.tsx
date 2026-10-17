// /homeowner — the public homeowner intake page.
//
// A verbatim port of the approved mockup `jobflex-homeowner (13).html`. The
// page body is a client component (the wizard, the vignettes, the count-up and
// the parallax all need the browser); this file stays a server component so the
// donor's <title> and <meta name="description"> ship as real route metadata.
//
// CONVENTION (2026-08-11): a re-port REPLACES its predecessor in place — same
// route path, same component files, never a parallel `-blueprint` route beside
// the old one. This reverses the earlier side-by-side rule once recorded in
// headers like src/app/dashboard/subscription-blueprint/page.tsx (deleted
// 2026-08-12 when its port was promoted; git history has it) and
// src/app/(auth)/auth/login/page.tsx ("a donor surface is never overwritten by
// its successor").
//
// THE ONE HOMEOWNER PAGE (owner, 2026-10-02). /homeowner is the homeowner
// portal: the intake, the status link and the referral code all live here. The
// older surfaces — the classic form (plural address), the Blueprint portal
// wizard (homeowner-blueprint) and the standalone handheld preview — were
// deleted with their components; their addresses answer 404. What they had and this
// page lacked was carried into the two wizards here, not copied beside them.
//
// CHROME: this is a standalone marketing page carrying the donor's own <nav>
// and <footer>. There is no src/app/(marketing)/layout.tsx, so nothing wraps it
// but the root layout — nothing is doubled. It is deliberately NOT mounted
// inside blueprint-shell.
//
// The figures on the page are static fixture copy and the wizard's attachments
// never leave the browser. The project does: the contact step calls
// submitHomeownerRequest (actions/homeowner), which writes the lead, routes it
// and emails the homeowner their status link.

// RESPONSIVE (2026-08-12): this route serves TWO designs from one URL — the
// desktop build below at >768px, and the handheld rebuild
// (src/components/v3/mobile-homeowner/) at ≤768px. The switch is a media query in
// ./homeowner-responsive.tsx, never user-agent detection, and exactly one tree
// is ever mounted. It lives in a sibling client file because this file has to
// stay a server component for the `metadata` export below.

import type { Metadata } from "next";
import { HomeownerResponsive } from "./homeowner-responsive";
import { loadWizardPrefill } from "@/lib/home/portal";
import { projectStarter } from "@/lib/home/homeownerDoor";

export const metadata: Metadata = {
  title: "JobFlex Homeowner Portal — Describe your project, get real quotes",
  description:
    "Describe your project in plain English. JobFlex turns it into a contractor-ready scope and sends it to a local pro on JobFlex — free, no account required.",
  alternates: { canonical: "/homeowner" },
  openGraph: {
    type: "website",
    url: "/homeowner",
    siteName: "JobFlex",
    title: "JobFlex Homeowner Portal — Describe your project, get real quotes",
    description: "Describe your project in plain English and JobFlex sends it to a local pro on JobFlex — free, no account required.",
  },
};

// From the home dashboard (lib/home/portal, 2026-10-03): ?home=<key> fills the
// contact fields, ?plan=<id> gives the first words — the request then joins
// that dashboard. Anything else is the plain intake.
export default async function HomeownerLandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const fromHome = await loadWizardPrefill(typeof sp.home === "string" ? sp.home : null, typeof sp.plan === "string" ? sp.plan : null, typeof sp.with === "string" ? sp.with : null);
  // ?project=fencing — a homeowner sent here from a trade's contractor page (lib/home/homeownerDoor): their request
  // starts in their words, "I'm looking for a fence. ", and the rest is theirs to write.
  const starter = !fromHome && typeof sp.project === "string" ? projectStarter(sp.project) : "";
  const prefill = fromHome ?? (starter ? { name: "", email: "", phone: "", address: "", zip: "", homeKey: "", planId: null, description: starter } : null);
  return <HomeownerResponsive prefill={prefill} />;
}
