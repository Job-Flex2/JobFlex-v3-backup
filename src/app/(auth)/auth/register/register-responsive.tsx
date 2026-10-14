"use client";

// Viewport switch for /auth/register.
//
// One URL, two designs: the blueprint desktop build above 768px, the handheld
// rebuild at or below it. The switch is a MEDIA QUERY, never the user agent —
// the mobile-first rule forbids UA detection, and a query is also the only
// thing that makes DevTools' device toolbar work: drag the viewport under
// 768px and the surface swaps live, no reload and no second URL to remember.
//
// WHY A SIBLING FILE HERE, but an inline switch on /auth/login. This page is a
// server component (it owns `metadata`), so the switch has to be a separate
// client module regardless. Login's page is already `"use client"` and its
// desktop tree is defined in the same file, so a sibling switch there would
// have to import from the page while the page imported the switch — a cycle.
//
// EXACTLY ONE TREE IS MOUNTED, never both. Both branches call the same
// `registerAccount` server action and both mount the attribution capture that
// reads ?promo / ?ref; two live trees would put a second set of account fields
// in the tab order and run the capture twice against one page view.
//
// The handheld build previously shipped only at /mobile-v1/auth/register,
// which nothing linked to. That preview URL still works; this is what makes
// the real URL serve it.

import { useSearchParams } from "next/navigation";
import type { EditionId } from "@/lib/editions";
import { Suspense, useSyncExternalStore } from "react";
import { RegisterContent } from "@/components/v3/auth-register-blueprint/register-content";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import type { TradeType } from "@/lib/tradeTypes";
import type { SpotlightTool } from "@/lib/planSpotlight";
import type { UtmParams } from "@/components/v3/landing-e/landing-variants";
import type { SignupMode } from "@/lib/signupMode";
import type { OtpRestore } from "@/lib/signupOtp";

/** CLAUDE.md's handheld target: ≤768px. Matches the mobile module's own scale. */
const HANDHELD = "(max-width: 768px)";

// Paper-coloured full-bleed hold for the one chunk fetch that happens when the
// viewport first crosses 768px. Without it `dynamic` renders null and the swap
// blinks through to whatever is behind the app — which reads as a crash rather
// than a load. Inline styles on purpose: this has to paint before the handheld
// stylesheet has been fetched, which is also why the #f2f0eb drafting cream is
// written out rather than read from a token.

// Imported out of the (mobile) tree rather than copied, so /auth/register and
// /mobile-v1/auth/register cannot drift apart — one implementation, two entry
// points. Lazy and `ssr: false` so a desktop visitor never downloads the
// handheld bundle or its stylesheet for a tree they will not render.

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
// corrects during hydration. A phone therefore shows desktop for one frame; the
// alternative — render nothing until mounted — flashes blank for every visitor
// at every viewport, a worse trade on a signup page.
const getServerSnapshot = () => false;

/** A Google identity resolved ON THE SERVER from `?gsu=`, so the first paint
 *  is already step 2. Reading it client-side meant one frame of step 1 before
 *  the fetch resolved — the "shows step 1 for a second" the owner reported
 *  (2026-09-03). */
export interface GooglePrefill {
  handle: string;
  email: string;
  name: string;
}

/** What a Google signup already gave us: the page opens on step 2 with it. */
export interface SetupPrefill {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  companyPhone: string;
}

function RegisterSwitch({
  setup,
  google,
  industry,
  spotlight = null,
  edition = null,
  utm,
  inAppBrowser,
  requiresCard,
  initialError,
  offerCustom,
  steps,
  mode,
  otpRestore,
}: {
  mode: SignupMode;
  otpRestore: OtpRestore | null;
  offerCustom: boolean;
  /** The sign-up's steps, the owner's switch (lib/trialPolicyServer): 3 as built, or 2. */
  steps: 2 | 3;
  setup: SetupPrefill | null;
  google: GooglePrefill | null;
  industry: TradeType | null;
  /** The tool the visitor came for (lib/planSpotlight): marked on the plan step. */
  spotlight?: SpotlightTool | null;
  /** The door the visitor came in by (2026-10-11, lib/editions). */
  edition: EditionId | null;
  utm: UtmParams | null;
  inAppBrowser: InAppBrowser | null;
  requiresCard: boolean;
  initialError: string | null;
}) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const params = useSearchParams();
  /* PHASES THE HANDHELD BUILD DOES NOT IMPLEMENT (owner's report, 2026-09-03:
     "mobile authentication with Google doesn't work"). The handheld register is
     still the pre-paywall flow — it reads neither `?gsu=` (the return from
     Google) nor `?signup=` (the plan step and the return from Stripe), so a
     phone visitor who signed in with Google landed back on an empty step 1.
     For those two phases the blueprint build is mounted at every width; its
     stylesheet carries ≤1000px and ≤560px layouts, so it is a real phone
     layout rather than a desktop page squeezed onto a phone.
     This is a BRIDGE, not the destination: the handheld build still needs the
     pending-signup + plan port for its own password path. */
  /* 2026-09-04 (owner's batch): the blueprint build is the register at EVERY
     width. The handheld build was still the pre-paywall flow — it created the
     account at the end of step 2 with no plan, which is the one thing the
     owner's rule forbids — and it had no plan step, no Google hand-off and no
     Stripe return. The blueprint build carries ≤1000px / ≤768px / ≤560px
     layouts (a phone carousel for the plan step) so it is a real phone layout,
     not a desktop page squeezed. The handheld build stays reachable at
     /mobile-v1/auth/register as a preview only. `isHandheld` is kept for the
     day the handheld build is ported to the pending-signup flow. */
  void isHandheld;
  void params;
  return <RegisterContent setup={setup} google={google} industry={industry} spotlight={spotlight}
        edition={edition} utm={utm} inAppBrowser={inAppBrowser} requiresCard={requiresCard} initialError={initialError} offerCustom={offerCustom} steps={steps} mode={mode} otpRestore={otpRestore} />;
}

// The attribution capture under either tree reads the query string, so the
// boundary wraps the switch rather than either branch — a bare useSearchParams
// without one is a static-prerender bailout in Next.
export function RegisterResponsive({
  setup = null,
  google = null,
  industry = null,
  spotlight = null,
  edition = null,
  utm = null,
  inAppBrowser = null,
  requiresCard = true,
  initialError = null,
  offerCustom = false,
  steps = 3,
  mode = "password",
  otpRestore = null,
}: {
  /** The sign-up's mode (lib/signupMode): password as built, or passwordless. */
  mode?: SignupMode;
  /** Where a passwordless sign-up was left (lib/signupOtp draftRestore). */
  otpRestore?: OtpRestore | null;
  /** CUSTOM_PLAN_ENABLED, read on the server (lib/customPlanFlag). */
  offerCustom?: boolean;
  /** The sign-up's steps (lib/trialPolicyServer): 3 as built, or 2. */
  steps?: 2 | 3;
  setup?: SetupPrefill | null;
  google?: GooglePrefill | null;
  /** The landing's trade variant, resolved by the page — see page.tsx. */
  industry?: TradeType | null;
  /* The tool the visitor came for (lib/planSpotlight): marked on the plan step. */
  spotlight?: SpotlightTool | null;
  /* The door the visitor came in by (2026-10-11, lib/editions). */
  edition?: EditionId | null;
  /** The visit's utm_*, resolved by the page the same way. */
  utm?: UtmParams | null;
  /** The in-app browser the request's user agent names (lib/inAppBrowser). */
  inAppBrowser?: InAppBrowser | null;
  /** signupTrialMode (lib/trialPolicyServer) is "card", read on the server. */
  requiresCard?: boolean;
  /** Step 1's error on arrival — a refused Google address (lib/disposableEmail). */
  initialError?: string | null;
}) {
  return (
    <Suspense fallback={null}>
      <RegisterSwitch setup={setup} google={google} industry={industry} spotlight={spotlight}
        edition={edition} utm={utm} inAppBrowser={inAppBrowser} requiresCard={requiresCard} initialError={initialError} offerCustom={offerCustom} steps={steps} mode={mode} otpRestore={otpRestore} />
    </Suspense>
  );
}
