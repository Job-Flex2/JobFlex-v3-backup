// Mobile phone — mobile-phone-v2. A handheld-first rebuild of the Phone
// surface in the Blueprint design system, sibling to /mobile-v2 (Overview),
// /mobile-clients-v2, /mobile-proposals-v2 and the rest of the handheld fleet.
// Lives beside the desktop /dashboard/phone rather than replacing it, per the
// mobile route strategy — and since 2026-09-03 it is the SECOND entry point
// to the same build /dashboard/phone mounts at ≤768px (see
// app/dashboard/phone/phone-responsive.tsx).
//
// Built with the jobflex-page-styler skill (visual system: tokens, palette,
// type scale, Motion System "Balanced", the mobile fluid scale) and the
// mobile-app-ui-design skill (structure: thumb zone, ≥44px targets, bottom
// sheets over modals, a real dial pad instead of a desktop table row).
//
// Data: REAL. The same loader the desktop page runs
// (app/dashboard/phone/load-phone) reads the org's AiPhoneCall rows, the three
// stat counts, the Twilio state and the webhook URL, and hands them down as
// props; nothing here is a fixture. The loader also owns the auth ladder
// (login redirect, no-org), with this route as the return path.

import type { Metadata, Viewport } from "next";
import { loadPhoneProps } from "@/app/dashboard/phone/load-phone";
import { requireOrg } from "@/lib/orgContext";
import { loadDeskWorkspace } from "@/lib/settings/loadSettingsData";
import { MobilePhone } from "./mobile-phone";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Phone · JobFlex Mobile",
  description:
    "Blueprint-edition mobile phone: the call log as a feed, with transcripts, recordings and a dial pad.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets the shell reserves.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function MobilePhoneV2Page() {
  const gate = await customPageGate("phone", { handheld: true });
  if (gate) return gate;
  const props = await loadPhoneProps("/mobile-phone-v2");
  const deskSettings = await loadDeskWorkspace(await requireOrg());
  return <MobilePhone {...props} deskSettings={deskSettings} />;
}
