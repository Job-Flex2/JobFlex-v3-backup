// Main phone — Blueprint edition.
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// The classic page it replaces is archived at
// old-design-pages/dashboard/phone/page.tsx.
//
// This is NOT a fixture. The call log, the three stat figures, the Twilio
// configuration state and the webhook URL are read in ./load-phone and handed
// to BOTH editions through ./phone-responsive — the desktop sheet above 768px,
// the handheld build at or below — so both describe the same line, and both
// create leads through the real `createLeadFromCall` action.

import { requireOrg } from "@/lib/orgContext";
import { loadDeskWorkspace } from "@/lib/settings/loadSettingsData";
import type { Metadata } from "next";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { loadPhoneProps } from "./load-phone";
import { PhoneResponsive } from "./phone-responsive";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Phone",
  description: "Phone — webhook setup, call volume and the full call log with transcripts.",
};

export default async function PhonePage() {
  const gate = await customPageGate("phone");
  if (gate) return gate;
  const props = await loadPhoneProps("/dashboard/phone");
  const deskSettings = await loadDeskWorkspace(await requireOrg());

  return (
    <>
      {/* Clears the phone nav badge (missed inbound calls) on open. Both
          editions: the page owns the viewport switch, so this mounts on a
          phone too (the shell's HANDHELD_SEEN stamp for this route is gone). */}
      <MarkNavSeen surface="phone" />
      <PhoneResponsive {...props} deskSettings={deskSettings} />
    </>
  );
}
