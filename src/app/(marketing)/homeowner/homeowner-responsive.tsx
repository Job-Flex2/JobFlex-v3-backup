"use client";

// Viewport switch for /homeowner.
//
// One URL, two designs: the desktop marketing page above 768px, the handheld
// rebuild at or below it. The switch is a MEDIA QUERY, never the user agent —
// the mobile-first rule forbids UA detection, and a query is also the only
// thing that makes DevTools' device toolbar work: drag the viewport under
// 768px and the surface swaps live, no reload and no second URL to remember.
//
// This lives beside page.tsx rather than inside it because page.tsx must stay
// a SERVER component — it is where `export const metadata` ships the donor's
// <title> and <meta name="description"> as real route metadata, and "use
// client" would break that export. Same file, same folder, same owner; the
// switch is simply the client half of the route.
//
// It is a local copy of the house pattern in
// src/components/v3/responsive-shell/responsive-dashboard-shell.tsx and NOT an
// edit to it: that module is the dashboard fleet's, keyed by pathname against
// BlueprintShell, and /homeowner has no shell at all — it is a standalone
// marketing route under the root layout. Bending the dashboard shell around a
// shell-less public page would couple two things that have nothing in common.
//
// EXACTLY ONE TREE IS MOUNTED, never both. The two builds each ship a plain,
// root-class-prefixed stylesheet with its own `body:has()` host neutralizers;
// rendering both would put two competing page roots, two <symbol> sprites and
// two sets of `:has()` gates in the same document at once.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { HomeownerContent } from "@/components/v3/homeowner-landing/homeowner-content";
import type { WizardPrefill } from "@/lib/home/prefill";

/** CLAUDE.md's handheld target: ≤768px. */
const HANDHELD = "(max-width: 768px)";

// Paper-coloured full-bleed hold for the one chunk fetch that happens when the
// viewport first crosses 768px. Without it `dynamic` renders null and the swap
// blinks through to whatever is behind the app — which reads as a crash rather
// than a load. Inline styles on purpose: this has to paint before the handheld
// stylesheet has been fetched, which is also why the #f2f0eb drafting cream is
// written out rather than read from a token.
const MobileHold = () => (
  <div style={{ position: "fixed", inset: 0, zIndex: 20, background: "#f2f0eb" }} />
);

// Lazy and `ssr: false` so a desktop visitor never downloads the handheld
// bundle or its stylesheet for a page they will not render.
const MobileHomeowner = dynamic(
  () =>
    import("@/components/v3/mobile-homeowner/mobile-homeowner").then((m) => m.MobileHomeowner),
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
// corrects during hydration. A phone therefore shows desktop for one frame;
// the alternative — render nothing until mounted — flashes blank for every
// visitor on every viewport, which is a worse trade.
const getServerSnapshot = () => false;

export function HomeownerResponsive({ prefill = null, house = false }: { prefill?: WizardPrefill | null; house?: boolean }) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isHandheld ? <MobileHomeowner prefill={prefill} house={house} /> : <HomeownerContent prefill={prefill} house={house} />;
}
