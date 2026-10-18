"use client";

// SUPPORT · HANDHELD (2026-10-17) — /dashboard/support at ≤768px.
//
// The same workspace as the desk (./support-workspace), composed for one thumb:
// the list of tickets first, and a tap opens the conversation as a full layer
// under the app's top bar — a back button, the messages, the reply box pinned
// to the bottom edge. "New ticket" opens its form the same way.
//
// The chrome is BlueprintHandheldFrame: MobileNav (top bar, drawer, the support
// launcher) and the blueprint root classes, so the shared .page-head / .btn /
// .card / .pstatus treatments are the desk's own.

import { BlueprintHandheldFrame } from "@/components/v3/responsive-shell/blueprint-handheld-frame";
import { SupportWorkspace, type SupportTicketView } from "./support-workspace";

export function SupportHandheld(props: { tickets: SupportTicketView[]; openId: string | null }) {
  return (
    <BlueprintHandheldFrame>
      <SupportWorkspace {...props} handheld />
    </BlueprintHandheldFrame>
  );
}
