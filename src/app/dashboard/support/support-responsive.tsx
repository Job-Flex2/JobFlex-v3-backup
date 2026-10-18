"use client";

// Viewport switch for /dashboard/support — the pattern of ../texting/texting-responsive.tsx.
//
//   · above 768px — the desk workspace (components/v3/support-blueprint), inside
//     the blueprint shell: the list of tickets beside the open conversation;
//   · at or below 768px — the handheld build, dynamically imported: the list
//     first, a tap opens the conversation over it with a back button and the
//     reply box on the bottom edge. The route sits in responsive-dashboard-
//     shell's PAGE_OWNED_STATIC set, so at handheld width the shell renders
//     this page bare and the handheld build brings its own chrome
//     (BlueprintHandheldFrame: MobileNav + the blueprint classes).
// Exactly one tree mounts. Both get the same server read.

import dynamic from "next/dynamic";
import { SupportWorkspace, type SupportTicketView } from "@/components/v3/support-blueprint/support-workspace";
import { HandheldHold, useIsHandheld } from "@/components/v3/responsive-shell/use-handheld";

const SupportHandheld = dynamic(
  () => import("@/components/v3/support-blueprint/support-handheld").then((m) => m.SupportHandheld),
  { ssr: false, loading: HandheldHold },
);

export function SupportResponsive(props: { tickets: SupportTicketView[]; openId: string | null }) {
  const isHandheld = useIsHandheld();
  return isHandheld ? <SupportHandheld {...props} /> : <SupportWorkspace {...props} handheld={false} />;
}
