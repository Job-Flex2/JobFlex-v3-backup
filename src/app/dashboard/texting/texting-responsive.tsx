"use client";

// Viewport switch for /dashboard/texting — the pattern of
// ../phone/phone-responsive.tsx and ../settings/settings-responsive.tsx.
//
//   · above 768px — TextingPageDesk (components/v3/texting-page), inside the
//     blueprint shell;
//   · at or below 768px — the handheld build in components/v3/mobile-texting,
//     dynamically imported. The route sits in responsive-dashboard-shell's
//     PAGE_OWNED_STATIC set, so at handheld width the shell renders this page
//     bare and the handheld build brings its own MobileNav. Exactly one tree
//     mounts. Both get the same server read.

import dynamic from "next/dynamic";
import { TextingPageDesk } from "@/components/v3/texting-page/texting-page";
import { HandheldHold, useIsHandheld } from "@/components/v3/responsive-shell/use-handheld";
import type { SmsSettingsData } from "@/components/v3/settings-blueprint/settings-data";

const MobileTexting = dynamic(
  () => import("@/components/v3/mobile-texting/mobile-texting").then((m) => m.MobileTexting),
  { ssr: false, loading: HandheldHold },
);

export function TextingResponsive(props: { sms: SmsSettingsData }) {
  const isHandheld = useIsHandheld();
  return isHandheld ? <MobileTexting {...props} /> : <TextingPageDesk {...props} />;
}
