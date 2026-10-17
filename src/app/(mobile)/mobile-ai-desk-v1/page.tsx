// MOBILE AI DESK — /mobile-ai-desk-v1
//
// The direct-review entry point for the handheld build of Automation → AI desk: always the
// mobile design, at any width. The desktop desk at /dashboard/phone is untouched, and its
// handheld half still mounts mobile-phone-v2 (app/dashboard/phone/phone-responsive) until the
// owner has reviewed this one.
//
// REAL DATA, NOT A FIXTURE. Exactly what /dashboard/phone loads, behind the same gates: the
// custom-plan page gate first (before anything is read), then the phone loader (call log, stat
// figures, Twilio state, webhook URL, the desk's line — and the login / no-org redirects, with
// this route as the way back), then the desk workspace (null for a role that does not manage the
// desk, as on the desktop). The role gate is the (mobile) group layout's, keyed to
// /dashboard/phone. MarkNavSeen clears the phone badge on open, as the desktop page does.

import type { Metadata, Viewport } from "next";
import { requireOrg } from "@/lib/orgContext";
import { loadDeskWorkspace } from "@/lib/settings/loadSettingsData";
import { loadPhoneProps } from "@/app/dashboard/phone/load-phone";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { MobileAiDesk } from "@/components/v3/mobile-ai-desk/mobile-ai-desk";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI desk · JobFlex Mobile",
  description: "The AI desk on a phone: is it answering, the call log with transcripts, and its setup.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function MobileAiDeskV1Page() {
  const gate = await customPageGate("phone", { handheld: true });
  if (gate) return gate;
  const props = await loadPhoneProps("/mobile-ai-desk-v1");
  const deskSettings = await loadDeskWorkspace(await requireOrg());
  return (
    <>
      <MarkNavSeen surface="phone" />
      <MobileAiDesk {...props} deskSettings={deskSettings} />
    </>
  );
}
