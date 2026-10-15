"use client";

// PUBLIC PROPOSAL PORTAL — the viewport switch.
// Route: /portal/q/[publicId].
//
// One URL, two designs: the desktop tree above 768px, the handheld rebuild at
// or below it. The switch is a MEDIA QUERY, never the user agent — CLAUDE.md's
// mobile-first rule forbids UA detection, and a query is also the only thing
// that makes DevTools' device toolbar work: drag the viewport under 768px and
// the surface swaps live, with no reload and no second URL to remember.
//
// Same shape as src/components/v3/responsive-shell/responsive-dashboard-shell.tsx,
// which is the house pattern — but written here rather than added there. That
// file switches whole /dashboard SHELLS keyed on pathname; this route has no
// shell at all (the `(portal)` group has no layout.tsx, and must not grow one:
// the reader is a homeowner, not a signed-in contractor), and it is a dynamic
// segment, so it does not fit that registry.
//
// EXACTLY ONE TREE IS MOUNTED, NEVER BOTH. The desktop tree arrives as
// `children` — still server-rendered, still the same RSC output — and is simply
// not placed in the tree when the handheld build is showing. Rendering both
// would put two copies of every literal DOM id from the mockup (#pvBtns,
// #pvNote, #pvErr) in one document and double the page's whole reading order
// for a screen reader.
//
// ── SSR IS NOT LOST ────────────────────────────────────────────────────────
// This is the surface a homeowner opens from an email and the return_url
// PayPal and Square bounce back to, so the server work stays on the server:
// page.tsx still does the Prisma read, still writes the VIEWED side-effect,
// still exports generateMetadata, and hands the handheld tree a fully
// formatted, serialisable view object. The handheld component fetches nothing.
//
// The dynamic() import is `ssr: false` because the switch cannot be evaluated
// on a server that has no viewport — the same trade the dashboard shell makes.
// The first paint on a phone is therefore the SSR'd desktop tree, replaced on
// hydration; `loading` is a paper-coloured full-bleed hold so the one chunk
// fetch reads as a load rather than a flash of nothing.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { PortalView } from "@/components/v3/mobile-proposal-client/portal-view";
import { HomeBackLink } from "./home-back-link";

/** CLAUDE.md's handheld target: ≤768px. Same constant as the dashboard shell. */
const HANDHELD = "(max-width: 768px)";

// Inline styles on purpose: this has to paint before the handheld stylesheet
// it is standing in for has been fetched, which is also why the #f2f0eb
// drafting cream is written out rather than read from a token.
const MobileHold = () => (
  <div style={{ position: "fixed", inset: 0, zIndex: 20, background: "#f2f0eb" }} />
);

// Imported out of the shared component directory rather than copied, so this
// route and /mobile-proposal-client-v2/[publicId] cannot drift apart — one
// implementation, two entry points. Lazy, so a desktop visitor never downloads
// the handheld bundle or its stylesheet.
const MobileProposalClient = dynamic(
  () =>
    import("@/components/v3/mobile-proposal-client/mobile-proposal-client").then(
      (m) => m.MobileProposalClient,
    ),
  { ssr: false, loading: MobileHold },
);

// Module scope so the identities are stable across renders — a fresh
// `subscribe` on every render makes useSyncExternalStore re-subscribe each
// time, which on a resize-driven store means tearing down the listener in the
// middle of the resize that triggered the render.
function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
// The server cannot know the viewport, so it renders desktop and the client
// corrects during hydration.
const getServerSnapshot = () => false;

export function PortalViewport({
  view,
  children,
}: {
  view: PortalView;
  children: React.ReactNode;
}) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (isHandheld) {
    return (
      <>
        <HomeBackLink phone />
        <MobileProposalClient view={view} />
      </>
    );
  }
  return <>{children}</>;
}
