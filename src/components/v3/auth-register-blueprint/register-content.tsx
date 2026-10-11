"use client";

// Auth · Create account — Blueprint edition. Pixel-identical port of
// `jobflex-auth-register-blueprint.html`.
//
// This page is STANDALONE: an auth surface ships its own chrome (brand lockup,
// split layout, dark drafting-sheet right panel) and does NOT mount inside
// components/v3/blueprint-shell — that shell's sidebar + topbar belong to the
// signed-in contractor dashboard. `.bp` is the wrapper that carries the donor's
// `:root` tokens and `body` rules — see the header of auth-register.module.css.
//
// The markup below is the donor's <body> verbatim, in source order:
//   sprite · main.auth ( section.auth-form [ brand · ref-banner · stepper ·
//   step1 · step2 · stepDone ] · aside.auth-side [ side-wash · side-perk ·
//   side-card ] )
//
// Adaptations (format only): HTML attributes become their JSX spellings
// (class → className, …), the donor's HTML entities (&amp; …) become the
// characters they encode, and the donor's three inert `href="…html"` links
// become the app routes they name.
//
// BEHAVIOUR. The donor's own script is ported in full — show/hide password,
// chip toggling with its live counter, the two-step progression with its
// literal validation strings, the perk/Google button label swaps, and the
// `--news-h` measurement that positions the perk block above the quote card.
// Grafted onto it, unchanged, is the live registration wiring the classic
// /auth/register page carried: registerAccount (server action) → next-auth
// signIn, the promo/referral attribution capture, and the Google OAuth entry.
// No server action, API route or Prisma call was added or altered.

import { PlanConfetti } from "@/components/billing/PlanConfetti";
import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { trackTraffic, trafficIdentity } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { createPortal } from "react-dom";
import { attachPlacesSuggest } from "@/components/v3/blueprint-shell/places-suggest";
import { toast } from "@/components/ui/Toast";
import { checkEmailAvailable, completeCompanySetup } from "@/actions/auth";
import type { GooglePrefill, SetupPrefill } from "@/app/(auth)/auth/register/register-responsive";
import { TRADE_TYPES, type TradeType } from "@/lib/tradeTypes";
import type { UtmParams } from "@/components/v3/landing-e/landing-variants";
import { GoogleOneTap } from "@/components/auth/google-one-tap";
import { OpenInBrowser } from "@/components/auth/open-in-browser";
import { useInAppBrowser } from "@/components/auth/use-in-app-browser";
import { effectiveConsent } from "@/lib/consent";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import { metaTrackWithServer } from "@/lib/metaEvents";
import { metaTrack, newEventId, readMetaCookies } from "@/lib/metaPixel";
import { RegisterSprite } from "./register-sprite";
import { ReferralBanner, type RegisterAttribution } from "./referral-banner";
import { PasswordlessStep } from "./passwordless-step";
import { rememberSignupMode, type SignupMode, type SignupModeLabel } from "@/lib/signupMode";
import type { OtpRestore } from "@/lib/signupOtp";
import { rememberFbclidForGoogle, writeLandingCookies } from "@/components/v3/landing-e/landing-variant-effects";
import { resolveLandingVariant } from "@/components/v3/landing-e/landing-variants";
import {
  applySignupPromo,
  googleSignupIdentity,
  signupPlans,
  type SignupPlan,
  type SignupPromo,
} from "@/actions/signupPaywall";
import { useTrialOffer, useTrialOfferExposure } from "@/components/providers/trial-offer";
import { trialLine } from "@/lib/trialPolicy";
import {
  completePendingSignup,
  requestCardlessTrial,
  startPendingSignup,
  startVerifiedCardlessTrial,
  updatePendingSignupAttribution,
  updatePendingSignupPages,
} from "@/actions/signupCheckout";
import {
  CUSTOM_BASE_CENTS,
  CUSTOM_BASE_FEATURES,
  CUSTOM_PAGES,
  CUSTOM_PAGE_CENTS,
  CUSTOM_PLAN_SLUG,
  CUSTOM_YEAR_MULTIPLIER,
  customPriceCents,
} from "@/lib/customPlan";
import styles from "./auth-register.module.css";

// 1 account · 2 company · 3 THE PLAN (the paywall) · 4 done.
/** The picker's exit, in step with the 0.22s transform in the stylesheet. */
const PICKER_EXIT_MS = 220;

type Step = 1 | 2 | 3 | 4;

/** What a step says when its server action THREW. A production build withholds
 *  a thrown message (the visitor read "Minified React error #441", 2026-10-07),
 *  so a refusal the visitor should read is returned by the action, and a throw
 *  means our side failed. */
const SERVER_TROUBLE = "Something went wrong on our side. Try again in a minute.";

// How long the "Your shop is live" panel holds before it hands over to the
// dashboard. Shared by both register surfaces.
export const REDIRECT_SECONDS = 5;

// Donor `setStep`: items[0] is `on` at step 1 and `done` after it; items[1] is
// `on` at step 2, `done` at step 3, and bare at step 1.
function stItem(index: 0 | 1 | 2, step: Step): string {
  if (index === 0) return "st-item" + (step === 1 ? " on" : " done");
  if (index === 1) return "st-item" + (step === 2 ? " on" : step > 2 ? " done" : "");
  return "st-item" + (step === 3 ? " on" : step > 3 ? " done" : "");
}

/* THE CUSTOM PLAN AT SIGNUP is offered beside the catalogue cards only while
   CUSTOM_PLAN_ENABLED is on (lib/customPlanFlag, owner 2026-10-06: off sale
   until the custom plan's billing and page gate are rebuilt). The page reads
   the flag on the server and hands it in as `offerCustom`; the checkout
   routes refuse a custom purchase on their own when it is off. */

// Donor `#tradeNote`, verbatim.
function tradeNote(n: number): string {
  return n === 0
    ? "Pick at least one — leads are matched to these."
    : n + (n === 1 ? " trade" : " trades") + " selected — leads will be matched to these.";
}

export function RegisterContent({
  setup = null,
  google: googlePrefill = null,
  industry = null,
  utm = null,
  inAppBrowser: inAppInitial = null,
  requiresCard: requiresCardInitial = true,
  initialError = null,
  offerCustom = false,
  steps = 3,
  mode = "password",
  otpRestore = null,
}: {
  /* THE PASSWORDLESS SIGN-UP (2026-10-10, lib/signupMode): step 1 is
     ./passwordless-step — name, email, a code from an email — and the plan
     follows; no password, no company screen. "password" is the sign-up as
     built, untouched. */
  mode?: SignupMode;
  /* Where a passwordless sign-up was left: the code screen, or the plan step
     of the pending signup it became (lib/signupOtp draftRestore). */
  otpRestore?: OtpRestore | null;
  /* THE SIGN-UP'S STEPS (owner, 2026-10-07, lib/trialPolicyServer): 3 =
     account · company · plan as built; 2 = step 1 also takes the business
     name and the trades (folded — what the shop does, not lead matching:
     leads come once specialties and the address are set in Settings) and
     goes straight to the plan; the company screen is never drawn. */
  steps?: 2 | 3;
  /* CUSTOM_PLAN_ENABLED (lib/customPlanFlag), read on the server: the custom
     plan's card and page picker on the plan step. */
  offerCustom?: boolean;
  /* signupTrialMode (lib/trialPolicyServer), read on the server. True: the plan
     step opens Stripe Checkout and the card is taken there, as it always was.
     False: the plan step starts the assigned trial with no card (onStartCardless). */
  requiresCard?: boolean;
  setup?: SetupPrefill | null;
  /* Instagram / Facebook / LINE / TikTok webview, read from the request's
     user agent on the server (lib/inAppBrowser), so the first paint already
     has no Google button. Corrected in the browser either way. */
  inAppBrowser?: InAppBrowser | null;
  /* The visit's utm_*, resolved on the server (query, else the landing's
     cookie). Rides into the signup intent and onto the organization. */
  utm?: UtmParams | null;
  /* Resolved from `?gsu=` on the server, so step 2 is what the first frame
     paints. Null on every other arrival. */
  google?: GooglePrefill | null;
  /* The trade the landing was opened on (`?industry=fencing`), resolved on
     the server. Pre-selects that chip on step 2 — a suggestion the visitor
     can change, never a lock — and rides along into the signup intent. */
  industry?: TradeType | null;
  /* Step 1's error on arrival: a Google address the server refused (a
     throwaway-mail domain — lib/disposableEmail). */
  initialError?: string | null;
}) {
  const offer = useTrialOffer();
  const router = useRouter();
  /* The trial takes a card when the server says so on the first render
     (signupTrialMode — the switch, the deployment's default and the day's
     ceiling on card-less trials, lib/trialPolicyServer), or when the plan step's request is told so later. */
  const [requiresCard, setRequiresCard] = React.useState(requiresCardInitial);
  /* IN-APP BROWSERS (2026-10-01): Google refuses its sign-in inside them
     ("403 disallowed_useragent") and One Tap does not render, so step 1 is
     the email form alone, with a quiet "Open in Safari / Chrome for Google
     sign-in" under it (components/auth/open-in-browser). */
  const inApp = useInAppBrowser(inAppInitial);
  /* SETUP MODE: a Google signup finishing step 2. Step 1 is done (Google did
     it), the plan step follows in the app (/dashboard/upgrade), and there is
     no pending-signup intent to park: the account already exists. */
  const setupMode = setup !== null;
  /* The two-step sign-up: the company's part folds into step 1 (never in
     setup mode, which is the company screen on its own). */
  const otp = mode === "otp" && !setupMode;
  const twoStep = steps === 2 && !setupMode && !otp;
  /* THE FORM (landing-e pass A, 2026-09-11; the only form since 2026-09-16):
     step 1 is name, email, password and — since 2026-09-26 (owner) — a
     password confirmation, checked here in the browser only; the business
     name is on step 2 — the progress shows all three steps from the first
     screen, every analytics event carries `variant: "e"` and the pending
     signup records it (the admin's d-vs-e history reads on). */
  const rootRef = React.useRef<HTMLDivElement>(null);
  const addrRef = React.useRef<HTMLInputElement>(null);

  /* THE RETURN FROM STRIPE. `?signup=<token>&session_id=…` is the success URL
     the checkout route set, and it is the only input this needs. Read through
     useSearchParams — NOT window.location: the window read returned null on
     the server render, so the server drew step 1 and the client drew step 3,
     and React threw the hydration-mismatch that made the whole return from a
     PAID checkout arrive as a crash-and-regenerate (owner's report,
     2026-08-31). useSearchParams gives both renders the same answer; the
     RegisterSwitch above already provides the Suspense boundary it needs. */
  const searchParams = useSearchParams();
  const ret = React.useMemo<{ token: string; sessionId: string | null; cancelled: boolean } | null>(() => {
    const t = searchParams?.get("signup");
    if (!t) return null;
    return {
      token: t,
      sessionId: searchParams.get("session_id"),
      cancelled: searchParams.get("checkout") === "cancelled",
    };
    // Read once: the params only change via full navigations on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A PAID RETURN OPENS ON THE DONE PANEL, not on the plan page. Until
     2026-09-02 the plan step was drawn while completePendingSignup ran, so the
     visitor saw the pricing they had just paid for flash past before "Your
     shop is live" — which read as being sent back (owner's report). The done
     panel now carries a finalizing state (`payBusy`) for that second. */
  const [step, setStep] = React.useState<Step>(
    setupMode ? 2 : ret ? (ret.sessionId && !ret.cancelled ? 4 : 3) : otpRestore?.signupToken ? 3 : googlePrefill ? (twoStep || otp ? 1 : 2) : 1,
  );
  useTrialOfferExposure(step === 3);
  /* GOOGLE ON THIS PAGE proves who the visitor is and nothing more (owner,
     2026-09-03). The auth callback parks the verified identity and comes back
     here with ?gsu=<handle>; the handle is read once and step 1 is filled
     from it, with the password fields replaced by a "verified" note. */
  const gsu = React.useMemo(() => searchParams?.get("gsu") ?? null, [searchParams]);
  const [google, setGoogle] = React.useState<{ handle: string; email: string } | null>(
    googlePrefill ? { handle: googlePrefill.handle, email: googlePrefill.email } : null,
  );
  const lastTrackedStep = React.useRef("");
  /* The passwordless sign-up's email path reads "otp" (traffic page: Email
     code signup); every step event also says which mode it ran in. */
  const trafficFlow = setupMode ? "setup" : google ? "google" : otp ? "otp" : "standard";
  const signupMode: SignupMode = otp ? "otp" : "password";
  /* The same mode as the reports split completions (lib/signupMode), on the
     browser's copies of CompleteRegistration / StartTrial. */
  const modeLabel: SignupModeLabel = otp ? "passwordless" : twoStep ? "2-step" : "3-step";
  React.useEffect(() => {
    if (step === 4) return;
    const key = `${trafficFlow}:${step}`;
    if (lastTrackedStep.current === key) return;
    // Parent route effects must record the entry pageview before this screen.
    const timer = window.setTimeout(() => {
      lastTrackedStep.current = key;
      trackTraffic(TRAFFIC_EVENTS.step, { step, flow: trafficFlow, variant: "e", steps: twoStep || otp ? 2 : 3, mode: signupMode });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [step, trafficFlow, twoStep, otp, signupMode]);
  /* `?flow=otp` / `?flow=off` are kept for this browser (lib/signupMode). */
  React.useEffect(() => {
    rememberSignupMode(searchParams?.get("flow") ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens
  }, []);
  /* True once the ticket minted by completePendingSignup has been redeemed:
     the browser holds a session, and step 4 may point at the dashboard. */
  const [signedIn, setSignedIn] = React.useState(false);

  /* THE PLAN STEP. Everything here is read from the live catalog after the
     account exists — the step cannot price itself before there is an org to
     price for, and `signupPlans` is owner-scoped. */
  const [plans, setPlans] = React.useState<SignupPlan[]>([]);
  /* Custom and catalog plans share the saved offer returned by signupPlans. */
  const [customTrialDays, setCustomTrialDays] = React.useState<number>(offer.days);
  /* THE CAROUSEL STARTS AT THE FIRST CARD. With `scroll-snap-type: x
     mandatory` Chrome picks its initial snap target while the plan sheet is
     still sliding in, and lands on the LAST card (verified at 390×844: the
     sheet arrived showing "Custom"). One reset after the cards exist and
     the sheet has settled puts Starter first; a later swipe is untouched. */
  const plansRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (step !== 3 || plans.length === 0) return;
    if (!window.matchMedia("(max-width: 768px)").matches) return;
    /* …and the card it settles on is the MOST-PICKED one, centred (owner,
       2026-09-04), not Starter: the same three passes, aimed at the hero. */
    const settle = () => {
      const rail = plansRef.current;
      if (!rail) return;
      const hero = rail.querySelector<HTMLElement>(".pw-plan--hero");
      rail.scrollLeft = hero ? Math.max(0, hero.offsetLeft - (rail.clientWidth - hero.offsetWidth) / 2) : 0;
    };
    settle();
    const t1 = window.setTimeout(settle, 120);
    const t2 = window.setTimeout(settle, 520);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [step, plans.length]);
  /* Feature lists a phone shows in full — the rest are cut at ~9 rows with a
     "Show all" toggle, so a card is never a scroll container of its own. */
  const [openFeats, setOpenFeats] = React.useState<Set<string>>(() => new Set());
  const isClient = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const toggleFeats = (slug: string) =>
    setOpenFeats((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  const [planSlug, setPlanSlug] = React.useState<string | null>(null);
  /* MONTHLY ONLY for now (owner, 2026-09-04): the yearly tier is unreviewed,
     so the billing switch is gone from every plan surface. The type is kept
     wide so the price math below stays ready for the day it comes back. */
  const interval = "MONTH" as "MONTH" | "YEAR"; // cast, not annotation: TS narrows an annotated const to its literal
  const [plansErr, setPlansErr] = React.useState<string | null>(
    ret?.cancelled ? "Checkout was cancelled — your account has not been created yet." : null,
  );
  const [checkoutReady, setCheckoutReady] = React.useState(true);
  const [promo, setPromo] = React.useState<SignupPromo | null>(null);
  const [promoText, setPromoText] = React.useState("");
  const [promoBusy, setPromoBusy] = React.useState(false);
  const [promoErr, setPromoErr] = React.useState<string | null>(null);
  /* THE FIRST CHARGE'S DATE (owner, 2026-10-10): "Free until Oct 13, then
     $95/mo" beside every price — the server's today plus the saved offer's
     days, the same days Stripe is given. The cards arrive with it. */
  const [firstChargeAt, setFirstChargeAt] = React.useState<number | null>(null);
  const freeUntil = firstChargeAt ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(firstChargeAt)) : null;
  /** "Free until Oct 13, then $95/mo" — the price after a code's discount, to
   *  the cent as Stripe charges it; without a card, "… No card needed." */
  const freeUntilLine = (cents: number, per: string) => {
    if (!freeUntil) return null;
    if (!requiresCard) return `Free until ${freeUntil}. No card needed.`;
    const v = Math.round(cents * (1 - (promo?.percentOff ?? 0) / 100)) / 100;
    return `Free until ${freeUntil}, then $${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}${per}`;
  };
  /* True from the first frame when Stripe has just sent them back: the account
     is being created before anything else can be clicked. Initial state rather
     than a setState inside the effect below. */
  const [payBusy, setPayBusy] = React.useState(Boolean(ret?.sessionId && !ret.cancelled));
  /* THE CARD WHOSE START BUTTON WAS PRESSED (owner, 2026-09-26: the active
     state landed on another card, not the one clicked). That button — and
     only that one — wears the pressed, busy state while checkout opens; the
     other start buttons dim behind it. Kept apart from `planSlug` so "Skip for
     now", which is busy too, never labels a card "Opening checkout…". */
  const [startingSlug, setStartingSlug] = React.useState<string | null>(null);
  /* Set once the browser has been handed Stripe's URL. The busy state then
     stays up until checkout's page replaces this one — resetting it straight
     away put every button back to idle (and clickable) for the second the
     browser spends loading Stripe. A page brought back by the Back button
     from the back/forward cache returns idle. */
  const leavingRef = React.useRef(false);
  React.useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !leavingRef.current) return;
      leavingRef.current = false;
      setPayBusy(false);
      setStartingSlug(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  /* THE CUSTOM PLAN. Not a catalog row — a base price plus the add-on pages
     the shop picks, so it is held here and priced by lib/customPlan (the same
     module the checkout route re-prices with, because a client number is never
     what gets charged). */
  const [customPages, setCustomPages] = React.useState<string[]>([]);
  /* THE PICKER OPENS AND CLOSES ON A CURVE, which takes two flags because it
     is mounted and unmounted rather than hidden: `pickerOpen` decides whether
     the dialog is in the tree at all, `pickerOn` is added one frame later so
     the enter transition has a start state to leave from, and dropped FIRST on
     the way out so the exit can play before the node goes. Same arrangement as
     the support composer — a dialog that pops in and vanishes reads as a
     glitch, and this one is opened by a card the shop is mid-comparison on. */
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerOn, setPickerOn] = React.useState(false);
  const pickerExit = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /* FOCUS GOES INTO THE PICKER AND COMES BACK OUT. The dialog is portalled to
     <body>, so with focus left on the card that opened it, Escape (heard on
     the dialog) did nothing and Tab walked the page behind the scrim. */
  const pickerBoxRef = React.useRef<HTMLDivElement>(null);
  const pickerReturn = React.useRef<HTMLElement | null>(null);

  const openPicker = React.useCallback(() => {
    if (pickerExit.current) {
      clearTimeout(pickerExit.current);
      pickerExit.current = null;
    }
    pickerReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPickerOpen(true);
  }, []);

  const closePicker = React.useCallback(() => {
    setPickerOn(false);
    pickerExit.current = setTimeout(() => {
      setPickerOpen(false);
      pickerExit.current = null;
      pickerReturn.current?.focus({ preventScroll: true });
      pickerReturn.current = null;
    }, PICKER_EXIT_MS);
  }, []);

  // One frame after the node exists, not in the same commit: a class set in the
  // render that mounts it is the element's FIRST style, and there is nothing to
  // transition from.
  React.useEffect(() => {
    if (!pickerOpen) return;
    const id = requestAnimationFrame(() => {
      setPickerOn(true);
      pickerBoxRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [pickerOpen]);

  React.useEffect(
    () => () => {
      if (pickerExit.current) clearTimeout(pickerExit.current);
    },
    [],
  );

  /* THE YEARLY SAVING, read off the catalog rather than written into the
     label. It is taken from the RECOMMENDED plan (the one the switch is most
     likely to be pressed against) and not from the biggest number in the list:
     a seeded $1 tier whose annual price is two dollars discounts by 83%, and
     advertising that against a $79 plan that saves 17% is a promise the
     checkout will not keep. Null when nothing in the catalog prices a year. */

  /** The pending signup this plan step belongs to. Parked by step 2, or carried
   *  back from Stripe on the return URL. */
  const [token, setToken] = React.useState<string | null>(ret?.token ?? otpRestore?.signupToken ?? null);

  /* META EVENT IDS (2026-09-09). One id for the browser's CompleteRegistration
     and the server's Conversions API copy, one for InitiateCheckout. The
     registration id is minted here and kept in sessionStorage under the
     intent token, so the return from Stripe (a fresh page) fires the browser
     event with the same id the server used. The pixel itself only runs after
     marketing consent; metaTrack is a no-op otherwise. */
  const metaIds = React.useRef<{ registration: string; checkout: string }>({ registration: newEventId(), checkout: newEventId() });
  React.useEffect(() => {
    if (!ret?.token) return;
    try {
      const saved = sessionStorage.getItem("jf_meta_reg:" + ret.token);
      if (saved) metaIds.current.registration = saved;
    } catch {
      /* storage blocked — a fresh id, the server's copy is not deduplicated */
    }
  }, [ret?.token]);
  /* Meta InitiateCheckout fires as a start button opens Stripe Checkout
     (onStartTrial, owner 2026-10-06), not on reaching the plan step; the
     server's copy (/api/checkout/signup) carries the same event_id. */
  const initiateSent = React.useRef(false);
  const leadSent = React.useRef(false);
  const registrationSent = React.useRef(false);
  /** Step 1's outcome for the analyst: passed, or refused and why. */
  const step1Outcome = (outcome: "continue" | "error", reason = "") => trackTraffic(TRAFFIC_EVENTS.signupStep1, { outcome, reason, variant: "e", steps: twoStep ? 2 : 3, mode: signupMode });
  /* CompleteRegistration, the browser's copy. On the return from Checkout
     the page mounts straight on step 4 — before the consent provider has
     loaded the pixel, so an effect keyed on the step fired into nothing
     (found 2026-10-06). That return sends it once the account exists
     (fireRegistration below); this effect covers the skip path. */
  const fireRegistration = React.useCallback(() => {
    if (registrationSent.current) return;
    registrationSent.current = true;
    metaTrack("CompleteRegistration", { content_name: industry ?? "default", status: "true", signup_mode: modeLabel }, metaIds.current.registration);
  }, [industry, modeLabel]);
  React.useEffect(() => {
    if (step === 4 && !ret?.sessionId) fireRegistration();
  }, [step, ret?.sessionId, fireRegistration]);
  const trialDays =
    planSlug === CUSTOM_PLAN_SLUG
      ? customTrialDays
      : plans.find((p) => p.slug === planSlug)?.trialDays || offer.days;
  const customCents = customPriceCents(customPages, interval);
  /* Every feature any plan lists, in the order the catalog gives them, and
     de-duplicated case-insensitively ("Everything in Starter" is a plan's own
     roll-up line and is dropped — it describes the column, not a feature). */
  const featureRows = React.useMemo(() => {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const p of plans) {
      for (const f of p.features) {
        const key = f.trim().toLowerCase();
        if (!key || key.startsWith("everything in") || seen.has(key)) continue;
        seen.add(key);
        rows.push(f.trim());
      }
    }
    return rows;
  }, [plans]);

  /* WHAT EACH PLAN ACTUALLY INCLUDES. The catalog writes the inheritance as a
     line of prose — "Everything in Starter" — so a naive per-plan lookup marked
     the cheaper plans' features as MISSING from the dearer ones, which read as
     Professional being worse than Starter. A plan carrying that roll-up
     inherits every feature of the plans before it, in catalog order. */
  const includedBySlug = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    let inherited = new Set<string>();
    for (const p of plans) {
      const own = p.features.map((f) => f.trim().toLowerCase());
      const rollsUp = own.some((f) => f.startsWith("everything in"));
      const set = new Set<string>(rollsUp ? inherited : []);
      for (const f of own) {
        if (!f || f.startsWith("everything in")) continue;
        set.add(f);
      }
      map.set(p.slug, set);
      inherited = set;
    }
    return map;
  }, [plans]);

  /* THE FADE IS A CLAIM — "there is more below" — so it must come OFF when
     there is not: a list short enough to fit, or one scrolled to its end,
     otherwise the LAST benefit prints permanently greyed-out as if disabled
     (owner's screenshot, 2026-08-31). CSS cannot know scroll position, so
     each card's list reports it via data-cut; the stylesheet only draws the
     mask while data-cut is not "0". */
  React.useEffect(() => {
    if (step !== 3) return;
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".pw-feats"));
    if (!els.length) return;
    const update = (el: HTMLElement) => {
      el.dataset.cut = el.scrollHeight - el.clientHeight - el.scrollTop > 4 ? "1" : "0";
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) update(e.target as HTMLElement);
    });
    const handlers = els.map((el) => {
      const h = () => update(el);
      el.addEventListener("scroll", h, { passive: true });
      ro.observe(el);
      update(el);
      return h;
    });
    return () => {
      els.forEach((el, i) => el.removeEventListener("scroll", handlers[i]));
      ro.disconnect();
    };
  }, [step, plans, customPages, interval]);

  const [name, setName] = React.useState(setup?.name ?? googlePrefill?.name ?? "");
  const [biz, setBiz] = React.useState(setup?.businessName ?? "");
  const [email, setEmail] = React.useState(setup?.email ?? googlePrefill?.email ?? "");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  /* THE CONFIRMATION (owner, 2026-09-26). Checked here in the browser only —
     the server still receives the one password. Its error belongs to the
     field and prints under it: shown once the visitor leaves the field having
     typed something, or presses Continue, and gone the moment the two match. */
  const [password2, setPassword2] = React.useState("");
  const [showPw2, setShowPw2] = React.useState(false);
  const [pw2Checked, setPw2Checked] = React.useState(false);
  const pw2Ref = React.useRef<HTMLInputElement>(null);
  const pw2Err = !pw2Checked
    ? null
    : !password2
      ? "Type your password again to confirm it."
      : password2 !== password
        ? "Passwords do not match."
        : null;
  // Step 1 is now gated on a server answer (is this email free?), so it has a
  // pending state the Continue button reads.
  const [checking, setChecking] = React.useState(false);
  /* THE FORM BEFORE THE JAVASCRIPT (2026-10-04; the inline prelude in
     app/(auth)/auth/register/page.tsx). On a phone the fields are drawn ~3 s
     before this script takes them over. Whatever was typed in that window is
     put back (React's hydration had reset the fields), a Continue pressed
     then is noted, and the analyst hears once per form load how long the
     form took to be usable and whether the visitor was ahead of it. */
  const step1Live = React.useRef(false);
  React.useEffect(() => {
    if (step1Live.current || setupMode || googlePrefill) return;
    step1Live.current = true;
    const w = window as Window & { __jfStep1?: { typedAt: number; submitAt: number; values: Record<string, string>; ready: boolean } };
    const pre = w.__jfStep1;
    if (pre) {
      pre.ready = true;
      const v = { ...pre.values };
      pre.values = {};
      // On the next tick, not in the effect itself: the fields are restored once the form is live.
      window.setTimeout(() => {
        if (v.name) setName(v.name);
        if (v.email) setEmail(v.email);
        if (v.password) setPassword(v.password);
        if (v.password2) setPassword2(v.password2);
      }, 0);
    }
    trackTraffic(TRAFFIC_EVENTS.signupStep1, {
      outcome: "ready", ready_ms: Math.round(performance.now()),
      typed_before_ready: !!pre?.typedAt, typed_ms: pre?.typedAt || -1,
      early_submit: !!pre?.submitAt, submit_ms: pre?.submitAt || -1,
      variant: "e", mode: signupMode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the form becomes live
  }, []);

  const [addr, setAddr] = React.useState("");
  const [phone, setPhone] = React.useState(setup?.companyPhone || setup?.phone || "");
  const [trades, setTrades] = React.useState<TradeType[]>(industry ? [industry] : []);
  /* The two-step sign-up's trades fold: open until something is picked (a
     landing's ?industry= pre-picks one, so that visitor sees it folded). */
  const [foldOpen, setFoldOpen] = React.useState(!industry);
  // "Other" is the one chip that cannot say what it means on its own. Picking it
  // opens a free-text line so the trade the taxonomy has no word for still
  // reaches the company record instead of being flattened into a shrug.
  const [otherTrade, setOtherTrade] = React.useState("");
  const otherRef = React.useRef<HTMLInputElement>(null);

  // The success panel holds for five seconds before it hands over to the
  // dashboard — long enough to read that the shop is live, short enough that
  // nobody has to hunt for the button. The button is still there for anyone who
  // does not want to wait.
  const [countdown, setCountdown] = React.useState(REDIRECT_SECONDS);

  const [attribution, setAttribution] = React.useState<RegisterAttribution | null>(null);
  const [err1, setErr1] = React.useState<string | null>(initialError);
  const [err2, setErr2] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [doneNote, setDoneNote] = React.useState("");
  /* The first name on the done panel. Typed on step 1, or given by Google;
     absent on a Stripe return (a fresh load) so the heading drops the comma. */
  const doneName = name.trim().split(/\s+/)[0] || "";
  const [googleBusy, setGoogleBusy] = React.useState(false);

  React.useEffect(() => {
    /* Already resolved on the server (the normal path) — nothing to fetch, and
       nothing to move: the page opened on step 2. This effect is only the
       fallback for a client-side arrival at `?gsu=`, where no server render
       ran for this URL. */
    if (!gsu || googlePrefill || initialError) return;
    let live = true;
    void googleSignupIdentity(gsu).then(async (g) => {
      if (!live) return;
      if (!g) {
        setErr1("Your Google sign-in expired. Continue with Google again.");
        return;
      }
      setGoogle({ handle: gsu, email: g.email });
      setEmail(g.email);
      if (g.name) setName(g.name);
      /* STRAIGHT TO STEP 2 (owner's report, 2026-09-03). Coming back from
         Google used to land on step 1 with the fields filled in, which reads
         as being sent back to the start — the visitor has just told us who
         they are. Google supplies everything step 1 asks for EXCEPT the
         business name, so that one field is drawn on step 2 instead (the same
         `biz2` field the setup mode already uses) and step 1 is skipped.
         The email-availability check step 1 would have run happens here; a
         taken address stops on step 1 with the reason, which is the one case
         where the visitor still has something to do there. */
      try {
        const res = await checkEmailAvailable(g.email);
        if (!live) return;
        if (!res.available) {
          setErr1(res.message || "That email is already registered. Try signing in instead.");
          return;
        }
      } catch {
        /* The check is a courtesy — startPendingSignup re-checks server-side
           before anything is created, so a failed lookup must not strand a
           verified visitor on a step they cannot complete. */
      }
      if (live) setStep(twoStep || otp ? 1 : 2);
    });
    return () => {
      live = false;
    };
  }, [gsu, googlePrefill, initialError, twoStep, otp]);

  /* ADDRESS SUGGESTIONS on the company address (owner, 2026-09-02). The same
     Google Places attach every blueprint page uses; the list is appended to
     <body>, so it carries its own class and its own styles (auth-register
     .module.css, `.jf-reg-sug`) — the shell's `.bp-sug` sheet is not loaded
     here. Free typing is left alone (`typed` picks are ignored); a chosen
     suggestion writes the formatted address into the field. */
  React.useEffect(() => {
    if (step !== 2) return;
    const el = addrRef.current;
    if (!el) return;
    return attachPlacesSuggest(el, {
      className: "jf-reg-sug",
      onPick: (p) => {
        if (p.typed) return;
        setAddr(p.formatted);
      },
    });
  }, [step]);

  /* The catalog is read when the plan step opens, not on mount: before the
     account exists there is no owner to read it as. */
  React.useEffect(() => {
    if (step !== 3) return;
    let live = true;
    void signupPlans(token ?? undefined)
      .then((res) => {
        if (!live) return;
        setPlans(res.plans);
        setCustomTrialDays(res.customTrialDays);
        setFirstChargeAt(res.firstChargeAt);
        setCheckoutReady(res.checkoutReady);
        if (res.promo) setPromo(res.promo);
        // Pre-select what the catalog marks as the one to pick, else the first
        // — on every width now (owner, 2026-09-04: "arrive already looking at
        // the most-picked plan"). On a phone the carousel is also scrolled so
        // that card is the one in view.
        const pick = (res.plans.find((p) => p.highlight) ?? res.plans[0])?.slug ?? null;
        setPlanSlug((cur) => cur ?? pick);
      })
      .catch(() => {
        if (live) setPlansErr("Couldn't load the plans. You can pick one later in Subscription.");
      });
    return () => {
      live = false;
    };
  }, [step, token]);

  async function onApplyPromo() {
    if (promoBusy) return;
    setPromoBusy(true);
    setPromoErr(null);
    try {
      const res = await applySignupPromo(promoText);
      if (res.ok) {
        setPromo(res.promo);
        // Carried into account creation as the signup's attribution — there is
        // no organization to stamp until checkout returns.
        setAttribution({ kind: res.promo.kind, code: res.promo.code });
      } else setPromoErr(res.error);
    } catch {
      setPromoErr("Couldn't check that code.");
    } finally {
      setPromoBusy(false);
    }
  }

  /* The trial starts at Stripe: the existing subscription checkout route takes
     the plan and interval and auto-applies whatever promo is stamped on the org
     — which is what `applySignupPromo` above writes. Nothing about discounts is
     re-implemented here. */
  async function onStartTrial(slug: string | null = planSlug) {
    if (payBusy || !slug) return;
    // The clicked card can differ from the selection until React commits it.
    const clickedTrialDays = slug === CUSTOM_PLAN_SLUG
      ? customTrialDays
      : plans.find((p) => p.slug === slug)?.trialDays ?? 0;
    trackTraffic(TRAFFIC_EVENTS.attempt, { plan: slug, interval, intent: clickedTrialDays > 0 ? "trial" : "purchase", flow: trafficFlow });
    if (!initiateSent.current) {
      initiateSent.current = true;
      const plan = plans.find((p) => p.slug === slug);
      const cents = slug === CUSTOM_PLAN_SLUG ? customPriceCents(customPages, interval) : interval === "YEAR" ? (plan?.yearlyPriceCents ?? 0) : (plan?.priceCents ?? 0);
      metaTrack("InitiateCheckout", { content_category: industry ?? "default", plan: slug, value: cents / 100, currency: "USD" }, metaIds.current.checkout);
    }
    setPayBusy(true);
    setStartingSlug(slug);
    setPlansErr(null);
    try {
      /* THE INTENT IS RE-STAMPED WITH THE PAGES FIRST. It was parked at the
         end of step 2, before any page was ticked, and the checkout route
         prices ONLY from the intent — so without this the custom plan always
         charged the bare $20 base whatever was selected. */
      if (slug === CUSTOM_PLAN_SLUG && token) {
        const upd = await updatePendingSignupPages(token, customPages);
        if (!upd.ok) {
          setPlansErr(upd.error);
          return;
        }
      }
      /* THE CODE GOES WITH IT. Typed on this step, after the intent was
         parked — the checkout route prices from the intent alone. */
      if (token) {
        const stamped = await updatePendingSignupAttribution(token, attribution);
        if (!stamped.ok) {
          setPlansErr(stamped.error);
          return;
        }
      }
      const res = await fetch("/api/checkout/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, planSlug: slug, interval, customPages }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && body.url) {
        trackTraffic(TRAFFIC_EVENTS.opened, { plan: slug, interval, flow: trafficFlow });
        leavingRef.current = true;
        window.location.href = body.url;
        /* A hand-off that never happens (blocked, cancelled) must not leave
           the page stuck on "Opening checkout…" with every button off. */
        window.setTimeout(() => {
          if (!leavingRef.current) return;
          leavingRef.current = false;
          setPayBusy(false);
          setStartingSlug(null);
        }, 15000);
        return;
      }
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "checkout_rejected" });
      setPlansErr(body.error || "Couldn't open checkout — your account has not been created.");
    } catch {
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "checkout_unavailable" });
      setPlansErr("Couldn't reach checkout — your account has not been created.");
    } finally {
      if (!leavingRef.current) {
        setPayBusy(false);
        setStartingSlug(null);
      }
    }
  }

  /* TESTING EXIT (owner's call, while the product is in testing). It creates
     the workspace WITHOUT a subscription — the only path that does. Everything
     else about it is the same as the paid return: the pending intent is spent,
     the account is created, the session is established here. */
  async function onSkipPlan() {
    if (payBusy || !token) return;
    setPayBusy(true);
    setPlansErr(null);
    try {
      const res = await completePendingSignup(token, null);
      if (!res.ok) {
        setPlansErr(res.error);
        return;
      }
      const auth = res.ticket
        ? await signIn("signup-ticket", { ticket: res.ticket, redirect: false })
        : null;
      setSignedIn(Boolean(auth && !auth.error));
      setDoneNote("Your workspace is ready to send its first proposal.");
      toast.success("Welcome to JobFlex", "Your workspace is ready.");
      setStep(4);
    } catch {
      setPlansErr("Couldn't finish the signup. Try again.");
    } finally {
      setPayBusy(false);
    }
  }

  /* THE CARD-LESS TRIAL (TRIAL_REQUIRES_CARD off). The same two re-stamps
     the checkout needs, then a confirmation link is emailed
     (requestCardlessTrial): the account and its assigned trial are created when
     the link is opened (/auth/register/confirm), not here — the owner's rule,
     2026-10-01: the address is confirmed before the dashboard opens. The plan
     step then says where the link went, with a way to send it again. */
  const [confirmSentTo, setConfirmSentTo] = React.useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = React.useState<string | null>(null);
  const [resent, setResent] = React.useState(false);
  /* The resend brake, shown: the server allows a link a minute (and three
     an hour); the button counts the minute down instead of failing. */
  const [resendAt, setResendAt] = React.useState(0);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!confirmSentTo || resendAt <= Date.now()) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [confirmSentTo, resendAt, nowTick]);
  const resendIn = Math.max(0, Math.ceil((resendAt - nowTick) / 1000));
  async function onStartCardless(slug: string | null = planSlug) {
    if (payBusy || !slug || !token) return;
    trackTraffic(TRAFFIC_EVENTS.attempt, { plan: slug, interval, intent: "trial", flow: trafficFlow, card: false });
    setPayBusy(true);
    setStartingSlug(slug);
    setPlansErr(null);
    try {
      if (slug === CUSTOM_PLAN_SLUG) {
        const upd = await updatePendingSignupPages(token, customPages);
        if (!upd.ok) {
          setPlansErr(upd.error);
          return;
        }
      }
      const stamped = await updatePendingSignupAttribution(token, attribution);
      if (!stamped.ok) {
        setPlansErr(stamped.error);
        return;
      }
      const res = await requestCardlessTrial(token, slug);
      if (!res.ok) {
        trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: res.requiresCard ? "trial_needs_card" : "trial_rejected" });
        // The day's card-less trials are taken: the same plan step now opens
        // Stripe Checkout, and the line under it says why.
        if (res.requiresCard) setRequiresCard(true);
        if (res.resendAt) {
          setResendAt(res.resendAt);
          setNowTick(Date.now());
        }
        setPlansErr(res.error);
        return;
      }
      setResendAt(res.resendAt);
      setNowTick(Date.now());
      // The link's own page signs the shop in; keep the registration event
      // id under the token so that page's browser event pairs with the
      // server's copy (same as the Stripe return).
      try {
        sessionStorage.setItem("jf_meta_reg:" + token, metaIds.current.registration);
      } catch {
        /* storage blocked — the server's copy stands alone */
      }
      setResent(confirmSentTo !== null);
      setConfirmSlug(slug);
      setConfirmSentTo(res.email);
    } catch {
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "trial_unavailable" });
      setPlansErr("Couldn't start the trial. Try again.");
    } finally {
      setPayBusy(false);
      setStartingSlug(null);
    }
  }
  const onStartPlan = (slug: string) =>
    void (requiresCard ? onStartTrial(slug) : otp ? onStartCardlessVerified(slug) : onStartCardless(slug));
  const busyLabel = requiresCard ? "Opening checkout…" : "Starting your trial…";

  /* ONCE. The intent is spent by its first completion, and React's development
     StrictMode mounts effects twice — the second call came back "That signup
     expired" and threw the plan sheet over a shop that had just been created
     and signed in. A ref survives the simulated remount; a `live` flag would
     not. */
  const completedRef = React.useRef(false);
  React.useEffect(() => {
    if (!ret?.sessionId || ret.cancelled) return;
    if (completedRef.current) return;
    completedRef.current = true;
    void completePendingSignup(ret.token, ret.sessionId)
      .then(async (res) => {
        if (!res.ok) {
          /* A RELOAD after completion (see completePendingSignup): the shop
             exists. If the browser still holds its session, carry on to the
             dashboard; otherwise say so and point at sign-in. Never back to
             the plan page — nothing is left to buy. */
          if (res.done) {
            const s = await getSession().catch(() => null);
            const ok = Boolean(
              s?.user?.email && res.email && s.user.email.toLowerCase() === res.email.toLowerCase(),
            );
            setSignedIn(ok);
            setDoneNote(
              ok
                ? `Your subscription is active and your workspace is ready for ${res.email}.`
                : `Your shop is already set up for ${res.email}. Sign in to open it.`,
            );
            return;
          }
          // Back to the plan page, with the reason on it.
          setPlansErr(res.error);
          setStep(3);
          return;
        }
        fireRegistration();
        if (!res.ticket) {
          setSignedIn(false);
          setDoneNote(`Your workspace is ready for ${res.email}. Sign in to open it.`);
          return;
        }
        /* THE SESSION IS ESTABLISHED HERE. The password typed on step 1 is
           gone on this fresh load, so the account is signed in with the
           single-use ticket the server minted alongside it (lib/signinTicket).
           Being sent to the login wall after paying read as the signup
           FAILING (owner's reports, 2026-08-31 and 2026-09-02). */
        const auth = await signIn("signup-ticket", { ticket: res.ticket, redirect: false });
        const ok = Boolean(auth && !auth.error);
        setSignedIn(ok);
        setDoneNote(
          ok
            ? `Your subscription is active and your workspace is ready for ${res.email}.`
            : `Your subscription is active and your workspace is ready for ${res.email}. Sign in to open it.`,
        );
      })
      .catch(() => {
        setPlansErr("Couldn't finish the signup. Try again.");
        setStep(3);
      })
      .finally(() => setPayBusy(false));
  }, [ret, router, fireRegistration]);

  // Tick the countdown down on the success step, then leave — TO SIGN-IN. In
  // the pay-first flow nobody at step 4 holds a session (the account was
  // created seconds ago and no credentials were ever posted to NextAuth), so
  // the old /dashboard target only bounced through the middleware to a bare
  // login wall, which read as the signup failing. `next` carries them on to
  // the dashboard the moment they sign in. Gated on `step` so the clock cannot
  // start before the account exists, and cleared on unmount so a person who
  // clicks the button first is not navigated a second time.
  const doneHref = (signedIn ? "/dashboard" : "/auth/login?next=%2Fdashboard") as Route;
  React.useEffect(() => {
    if (step !== 4 || payBusy) return;
    if (countdown <= 0) {
      router.push(doneHref);
      return;
    }
    const t = window.setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [step, payBusy, countdown, router, doneHref]);

  function toggleTrade(t: TradeType) {
    setTrades((prev) => {
      const on = prev.includes(t);
      // Turning "Other" back off throws away whatever was typed under it, so a
      // stale label cannot be submitted for a chip that is no longer selected.
      if (t === "Other" && on) setOtherTrade("");
      // Focus the revealed input on the way in — the whole point of the chip is
      // that there is something else to say.
      if (t === "Other" && !on) window.setTimeout(() => otherRef.current?.focus(), 0);
      return on ? prev.filter((x) => x !== t) : [...prev, t];
    });
  }

  // Donor `#step1Form` submit. The donor's checks were client-side only, which
  // meant the one failure a person cannot fix by looking at the form — an email
  // that is already registered — was not reported until AFTER they had filled in
  // step 2 and pressed Create account, by which point the message pointed at a
  // field two screens back. Step 1 now also asks the server whether the address
  // is free, and only advances on a clean answer.
  async function onStep1(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    const n = name.trim();
    const em = email.trim();
    if (!n || !em) {
      setErr1("Name and email are required.");
      step1Outcome("error", "missing");
      return;
    }
    if (em.indexOf("@") === -1) {
      setErr1("Enter a valid email address.");
      step1Outcome("error", "email_invalid");
      return;
    }
    if (!google) {
      if (password.length < 8) {
        setErr1("Password must be at least 8 characters.");
        step1Outcome("error", "password_short");
        return;
      }
      /* The two must match before anything is asked of the server. The
         message is the confirmation field's own (pw2Err), so the general
         error block is cleared rather than saying it twice. */
      if (password2 !== password) {
        setPw2Checked(true);
        setErr1(null);
        pw2Ref.current?.focus();
        step1Outcome("error", "password_mismatch");
        return;
      }
    }
    setErr1(null);
    setChecking(true);
    try {
      const res = await checkEmailAvailable(em);
      if (!res.available) {
        const msg = res.message || "That email is already registered. Try signing in instead.";
        // The Google button that message points at is not on this screen in
        // an in-app browser.
        setErr1(
          inApp && /Continue with Google/.test(msg)
            ? "That email signs in with Google. Open this page in your browser (below) to continue with Google."
            : msg,
        );
        step1Outcome("error", /Google/.test(msg) ? "email_google" : /temporary|throwaway|disposable/i.test(msg) ? "email_disposable" : /Too many/.test(msg) ? "rate_limited" : /valid email/.test(msg) ? "email_invalid" : "email_taken");
        return;
      }
    } catch {
      setErr1(SERVER_TROUBLE);
      step1Outcome("error", "check_failed");
      return;
    } finally {
      setChecking(false);
    }
    step1Outcome("continue");
    /* Meta Lead (2026-10-01): step 1 sent with a free address — browser and
       server, one event_id, marketing consent only (lib/metaEvents). Once per
       page: going back to step 1 and on again is the same lead. */
    if (!leadSent.current) {
      leadSent.current = metaTrackWithServer("Lead", { content_name: industry ?? "default" }, { email: em });
    }
    if (twoStep) {
      /* The company's part of the one step: the business name and the
         trades are checked and the pending signup starts right here. */
      await finish(setErr1);
      return;
    }
    setStep(2);
  }

  /* Donor `finish(withCompany)` — but NOTHING IS CREATED HERE any more.
     Until 2026-08-28 this wrote the Organization, the owner User and the
     Membership, signed them in, and only then showed the plan: a visitor who
     never subscribed still ended up with a workspace. The details are parked as
     a PENDING INTENT instead (actions/signupCheckout), and the account is
     created when checkout comes back — or when the testing skip is used. */
  /* STEP 2 IS REQUIRED (owner's call, 2026-09-02): the address and at least
     one trade are what the Lead Center matches on, so a shop without them is a
     shop that never receives the free leads the step promises. The
     "Skip — set this up later" exit is gone with it. */
  async function finish(report: (message: string | null) => void = setErr2) {
    if (creating) return;
    /* The business name is asked for on this step, so it is validated here. */
    if (!biz.trim()) {
      report("Enter your business name.");
      return;
    }
    /* The two-step sign-up asks for the address later, in Settings. */
    if (!twoStep && !addr.trim()) {
      report("Enter your company address — leads are matched by distance.");
      return;
    }
    if (trades.length === 0) {
      report(twoStep ? "Pick at least one trade — what you do." : "Pick at least one trade — leads are matched to it.");
      setFoldOpen(true);
      return;
    }
    setCreating(true);
    report(null);
    try {
      if (setupMode) {
        await completeCompanySetup({
          businessName: biz.trim(),
          companyAddress: addr.trim(),
          companyPhone: phone.trim() || undefined,
          phone: phone.trim() || undefined,
          tradeTypes: trades,
          otherTrade:
            trades.includes("Other") && otherTrade.trim() ? otherTrade.trim() : undefined,
        });
        toast.success("Welcome to JobFlex", "Your company is set up. Pick a plan to go live.");
        router.push("/dashboard/upgrade" as Route);
        return;
      }
      setDoneNote(biz.trim() + " is ready to send its first proposal.");
      const res = await startPendingSignup({
        analytics: trafficIdentity(),
        displayedTrialDays: offer.days,
        name: name.trim(),
        businessName: biz.trim(),
        email: email.trim(),
        ...(google ? { googleToken: google.handle } : { password }),
        companyAddress: addr.trim() || undefined,
        companyPhone: phone.trim() || undefined,
        tradeTypes: trades,
        otherTrade:
          trades.includes("Other") && otherTrade.trim() ? otherTrade.trim() : undefined,
        attribution: attribution ?? undefined,
        landingIndustry: industry ?? undefined,
        utm: utm ?? undefined,
        signupVariant: "e",
        signupMode: twoStep ? "2-step" : "3-step",
        meta: {
          consent: effectiveConsent().marketing,
          registrationEventId: metaIds.current.registration,
          // No checkout on the card-less trial: InitiateCheckout belongs to
          // adding the card later (/api/billing/trial-card), not to this step.
          checkoutEventId: requiresCard ? metaIds.current.checkout : undefined,
          ...readMetaCookies(),
          // Meta's click id, carried here from the ad's landing link; the
          // server builds an fbc from it when _fbc is missing (with consent).
          fbclid: searchParams?.get("fbclid") || undefined,
          sourceUrl: typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined,
        },
      });
      if (!res.ok) {
        report(res.error);
        toast.error("Couldn't continue", res.error);
        return;
      }
      try {
        sessionStorage.setItem("jf_meta_reg:" + res.token, metaIds.current.registration);
      } catch {
        /* storage blocked */
      }
      setToken(res.token);
      setStep(3);
    } catch {
      report(SERVER_TROUBLE);
      toast.error("Couldn't continue", SERVER_TROUBLE);
    } finally {
      setCreating(false);
    }
  }


  // Donor `#googleBtn`: swaps its label for 1600ms. Here the swap accompanies
  // the real next-auth redirect instead of standing in for it.
  function onGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    window.setTimeout(() => setGoogleBusy(false), 1600);
    // A new address comes back here with ?gsu= (auth callback); an address
    // that already has an account signs in and lands on the dashboard. The
    // ad's click id rides to that return in a cookie (2026-10-01).
    rememberFbclidForGoogle(searchParams?.get("fbclid"));
    if (otp) {
      // The return of a new address is built from cookies (lib/googleSignup):
      // the trade and the campaign this page came in on, and the mode — a
      // page handed over from an in-app browser has none of the landing's.
      writeLandingCookies(industry ? resolveLandingVariant(industry) : undefined, utm ?? undefined);
      rememberSignupMode(searchParams?.get("flow") ?? null);
    }
    void signIn("google", { callbackUrl: "/auth/register" });
  }

  /* THE PASSWORDLESS PATH'S PLAN STEP WITHOUT A CARD: the address is already
     proven (the code, the link or Google), so the trial and the account are
     created at once — no "Check your email" here (actions/signupCheckout
     startVerifiedCardlessTrial). The browser's CompleteRegistration and
     StartTrial carry the ids the server's copies used. */
  async function onStartCardlessVerified(slug: string | null = planSlug) {
    if (payBusy || !slug || !token) return;
    trackTraffic(TRAFFIC_EVENTS.attempt, { plan: slug, interval, intent: "trial", flow: trafficFlow, card: false, mode: signupMode });
    setPayBusy(true);
    setStartingSlug(slug);
    setPlansErr(null);
    try {
      if (slug === CUSTOM_PLAN_SLUG) {
        const upd = await updatePendingSignupPages(token, customPages);
        if (!upd.ok) {
          setPlansErr(upd.error);
          return;
        }
      }
      const stamped = await updatePendingSignupAttribution(token, attribution);
      if (!stamped.ok) {
        setPlansErr(stamped.error);
        return;
      }
      const res = await startVerifiedCardlessTrial(token, slug);
      if (!res.ok) {
        trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: res.requiresCard ? "trial_needs_card" : "trial_rejected", mode: signupMode });
        if (res.requiresCard) setRequiresCard(true);
        if (res.done && res.email) {
          router.replace(`/auth/login?${new URLSearchParams({ next: "/dashboard", email: res.email }).toString()}` as Route);
          return;
        }
        setPlansErr(res.error);
        return;
      }
      if (res.registrationEventId) metaIds.current.registration = res.registrationEventId;
      fireRegistration();
      if (res.subscriptionId) metaTrack("StartTrial", { value: 0, currency: "USD", signup_mode: modeLabel }, `${res.subscriptionId}:trial`);
      const auth = res.ticket ? await signIn("signup-ticket", { ticket: res.ticket, redirect: false }) : null;
      const ok = Boolean(auth && !auth.error);
      setSignedIn(ok);
      setDoneNote(`Your ${trialDays}-day free trial is on for ${res.email}. No card needed.`);
      setStep(4);
    } catch {
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "trial_unavailable", mode: signupMode });
      setPlansErr("Couldn't start the trial. Try again.");
    } finally {
      setPayBusy(false);
      setStartingSlug(null);
    }
  }

  /* The address is proven (code, link or Google) and the pending signup
     exists: the plan step, with the intent's token in the address so a
     reload opens it again. */
  function onOtpVerified(signupToken: string) {
    try {
      sessionStorage.setItem("jf_meta_reg:" + signupToken, metaIds.current.registration);
    } catch {
      /* storage blocked */
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("d");
      url.searchParams.delete("gsu");
      url.searchParams.set("signup", signupToken);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* the plan step works without it */
    }
    setToken(signupToken);
    setStep(3);
  }

  const brand = (
    <Link className="brand" href={"/" as Route}>
      <span className="brand-mark">J</span>
      <span className="brand-name">JobFlex</span>
    </Link>
  );

  /* The step indicator. Drawn twice — in the form column and on the plan
     sheet — because the two are separate layers that slide past each other;
     only one is ever visible. */
  /* The trade chips, the same on the company screen and inside step 1's
     fold — with their own note: the company screen's promises lead matching,
     the fold's says what you do and sends lead matching to Settings
     (owner, 2026-10-07). */
  const tradeChips = (note: string) => (
    <>
      <div className="chips" role="group" aria-label="Your trades">
        {TRADE_TYPES.map((t) => (
          <button
            key={t}
            className={trades.includes(t) ? "chip on" : "chip"}
            type="button"
            aria-pressed={trades.includes(t)}
            onClick={() => toggleTrade(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {trades.includes("Other") && (
        <input
          ref={otherRef}
          className="fld-in fld-in--other"
          type="text"
          maxLength={80}
          placeholder="Name the trade — e.g. epoxy & garage floor coatings"
          aria-label="Your other trade"
          value={otherTrade}
          onChange={(e) => setOtherTrade(e.target.value)}
        />
      )}
      <span className="fld-note" id="tradeNote">
        {note}
      </span>
    </>
  );

  const stepper = twoStep || otp ? (
    <div className="stepper" id="stepper" data-steps="2">
      <div className={stItem(0, step)} data-step="1">
        <span className="st-n">1</span>
        <span className="st-txt">
          <span className="st-t">Account</span>
          <span className="st-h">Required</span>
        </span>
      </div>
      <span className="st-line"></span>
      <div className={stItem(2, step)} data-step="3">
        <span className="st-n">2</span>
        <span className="st-txt">
          <span className="st-t">Plan</span>
          <span className="st-h">Free trial</span>
        </span>
      </div>
    </div>
  ) : (
    <div className="stepper" id="stepper" data-steps="3">
      <div className={stItem(0, step)} data-step="1">
        <span className="st-n">1</span>
        <span className="st-txt">
          <span className="st-t">Account</span>
          <span className="st-h">Required</span>
        </span>
      </div>
      <span className="st-line"></span>
      <div className={stItem(1, step)} data-step="2">
        <span className="st-n">2</span>
        <span className="st-txt">
          <span className="st-t">Company</span>
          <span className="st-h">Required</span>
        </span>
      </div>
      {/* All three steps from the first screen (pass A). The sub-line names
          no number: the trial's length is set per plan in /admin/plans (7
          days as of 2026-09-26), and "14 days free" had gone stale. */}
      <span className="st-line"></span>
      <div className={stItem(2, step)} data-step="3">
        <span className="st-n">3</span>
        <span className="st-txt">
          <span className="st-t">Plan</span>
          <span className="st-h">Free trial</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.bp} ref={rootRef}>
      <RegisterSprite />

      {/* TWO LAYERS, ONE MOTION. The account/company/done column and its art
          panel are `.auth`; the plan is its own full-width sheet. Entering the
          plan slides the whole screen off to the left while the sheet follows
          it in from the right — one strip, one curve, one duration — instead
          of the old arrangement where the art panel slid out on its own and
          the grid collapsed under it on a second timer. */}
      <main className={step === 3 ? "auth is-gone" : "auth"} aria-hidden={step === 3}>
        <section className="auth-form">
          {brand}

          <div className="auth-body">
          {/* A code carried in by the link (or the 30-day cookie) prices the
              Plan step too — the same `promo` a typed code sets in
              onApplyPromo, so the cards show "20% off · $63.20" rather than
              list price under a "code applied" banner two steps back. */}
          <ReferralBanner onChange={setAttribution} onResolved={setPromo} />

          {stepper}

          {/* ───── ШАГ 1 ───── */}
          {/* The donor's "Get started" kicker is gone (owner's call) — the
              stepper above already says which step this is, so the badge only
              repeated it. Same for step 2's "Almost there". */}
          <div className={step === 1 ? "step" : "step is-hidden"} id="step1">
            {otp ? (
              <>
                <PasswordlessStep
                  name={name}
                  setName={setName}
                  email={email}
                  setEmail={setEmail}
                  restore={otpRestore}
                  google={google}
                  inApp={inApp}
                  requiresCard={requiresCard}
                  trialDays={offer.days}
                  industry={industry}
                  utm={utm}
                  attribution={attribution}
                  analytics={trafficIdentity}
                  meta={() => ({
                    consent: effectiveConsent().marketing,
                    registrationEventId: metaIds.current.registration,
                    checkoutEventId: requiresCard ? metaIds.current.checkout : undefined,
                    ...readMetaCookies(),
                    fbclid: searchParams?.get("fbclid") || undefined,
                    sourceUrl: window.location.origin + window.location.pathname,
                  })}
                  initialError={err1}
                  onGoogle={onGoogle}
                  onVerified={onOtpVerified}
                  onLead={(em) => {
                    if (!leadSent.current) leadSent.current = metaTrackWithServer("Lead", { content_name: industry ?? "default" }, { email: em });
                  }}
                />
                {step === 1 && !google && !inApp ? <GoogleOneTap /> : null}
              </>
            ) : (
            <>
            <h1 className="auth-h1">Register.</h1>

            <form id="step1Form" noValidate onSubmit={(e) => void onStep1(e)}>
              {/* The business name is asked for on step 2, so the name
                  stands alone here, full width. */}
              <div>
                <label className="fld">
                  <span className="fld-lbl">Your name</span>
                  <input
                    className="fld-in"
                    id="name"
                    placeholder="First and last"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>
              <label className="fld">
                <span className="fld-lbl">Email</span>
                <input
                  className="fld-in"
                  type="email"
                  id="email"
                  placeholder="you@yourshop.com"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  readOnly={Boolean(google)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {google ? (
                <div className="gsu-note" role="status">
                  <svg className="ic ic--brand">
                    <use href="#i-google" />
                  </svg>
                  <span>
                    Verified by Google as <b>{google.email}</b>. No password needed — you&apos;ll
                    sign in with Google.
                  </span>
                </div>
              ) : null}
              {!google ? (
              <>
              <label className="fld">
                <span className="fld-lbl">Password</span>
                <span className="pw-wrap">
                  <input
                    className="fld-in"
                    type={showPw ? "text" : "password"}
                    id="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    className="pw-toggle"
                    type="button"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    aria-pressed={showPw}
                    onClick={() => setShowPw((v) => !v)}
                  >
                    <svg className="ic" aria-hidden="true">
                      <use href={showPw ? "#i-eye-off" : "#i-eye"} />
                    </svg>
                  </button>
                </span>
                <span className="fld-note">At least 8 characters.</span>
              </label>
              {/* CONFIRM PASSWORD (owner, 2026-09-26): the same field, the
                  same eye, and its own error line under it. */}
              <label className="fld">
                <span className="fld-lbl">Confirm password</span>
                <span className="pw-wrap">
                  <input
                    ref={pw2Ref}
                    className="fld-in"
                    type={showPw2 ? "text" : "password"}
                    id="password2"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password2}
                    aria-invalid={pw2Err ? true : undefined}
                    aria-describedby="password2Note"
                    onChange={(e) => setPassword2(e.target.value)}
                    onBlur={() => {
                      if (password2) setPw2Checked(true);
                    }}
                  />
                  <button
                    className="pw-toggle"
                    type="button"
                    aria-label={showPw2 ? "Hide confirmation password" : "Show confirmation password"}
                    aria-pressed={showPw2}
                    onClick={() => setShowPw2((v) => !v)}
                  >
                    <svg className="ic" aria-hidden="true">
                      <use href={showPw2 ? "#i-eye-off" : "#i-eye"} />
                    </svg>
                  </button>
                </span>
                <span
                  className={pw2Err ? "fld-note fld-note--err" : "fld-note"}
                  id="password2Note"
                  aria-live="polite"
                >
                  {pw2Err ?? "Type it again to confirm."}
                </span>
              </label>
              </>
              ) : null}

              {twoStep ? (
                <>
                  <label className="fld">
                    <span className="fld-lbl">Business name</span>
                    <input
                      className="fld-in"
                      id="biz1"
                      placeholder="Company name"
                      autoComplete="organization"
                      value={biz}
                      onChange={(e) => setBiz(e.target.value)}
                    />
                  </label>
                  <details
                    className="fold"
                    id="tradesFold"
                    open={foldOpen}
                    onToggle={(e) => setFoldOpen((e.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="fold-sum">
                      <span className="fld-lbl">What you do</span>
                      <span className="fold-val">{trades.length ? trades.join(", ") : "Pick your trades"}</span>
                      <svg className="ic fold-ic" aria-hidden="true">
                        <use href="#i-arrow-r" />
                      </svg>
                    </summary>
                    {tradeChips("What you do — your estimators and proposals follow it. To receive leads, set your specialties and address in Settings after you sign in.")}
                  </details>
                </>
              ) : null}

              <button className="btn" type="submit" id="nextBtn" disabled={checking || creating}>
                {checking ? "Checking…" : creating ? "Creating…" : "Continue"}
                <svg className="ic">
                  <use href="#i-arrow-r" />
                </svg>
              </button>
              {/* The "Step 1 of 3 · 14 days free · card at step 3" line that
                  sat here is gone (owner, 2026-09-26). The trial terms are
                  stated on the plan step, beside the cards they apply to. */}
              <div className={err1 ? "err" : "err is-hidden"} id="err1">
                {err1}
              </div>
            </form>

            {inApp ? (
              <OpenInBrowser app={inApp} />
            ) : (
            <>
            <div className="divider">
              <span className="kpi-lbl">or</span>
            </div>
            <button className="btn btn--ghost" type="button" id="googleBtn" onClick={onGoogle}>
              {googleBusy ? (
                <>
                  <svg className="ic">
                    <use href="#i-check" />
                  </svg>
                  Redirecting to Google…
                </>
              ) : (
                <>
                  <svg className="ic ic--brand">
                    <use href="#i-google" />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
            </>
            )}

            <div className="foot">
              Already have an account?{" "}
              <Link className="link-ink" href={"/auth/login" as Route}>
                Sign in
              </Link>
            </div>
            {/* Google One Tap (pass A): step 1 only, and only with
                NEXT_PUBLIC_GOOGLE_CLIENT_ID set. */}
            {step === 1 && !google && !setupMode && !inApp ? <GoogleOneTap /> : null}
            </>
            )}
          </div>

          {/* ───── ШАГ 2 ───── */}
          <div className={step === 2 ? "step" : "step is-hidden"} id="step2">
            <h1 className="auth-h1">
              {setupMode || google
                ? `Welcome${name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}. Tell us about your company.`
                : "Tell us what you do."}
            </h1>
            {setupMode ? (
              <p className="auth-lede">{`Signed in with Google as ${email}. One more step and your shop is live.`}</p>
            ) : google ? (
              /* The account does NOT exist yet on this path — it is created
                 when checkout returns — so this says verified, not signed in. */
              <p className="auth-lede">{`Verified by Google as ${email}. No password needed.`}</p>
            ) : null}

            <form
              id="step2Form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void finish();
              }}
            >
              <label className="fld">
                <span className="fld-lbl">Business name</span>
                <input
                  className="fld-in"
                  id="biz2"
                  placeholder="Company name"
                  autoComplete="organization"
                  value={biz}
                  onChange={(e) => setBiz(e.target.value)}
                />
              </label>
              <div className="grid2">
                <label className="fld">
                  <span className="fld-lbl">Company address</span>
                  <input
                    ref={addrRef}
                    className="fld-in"
                    id="addr"
                    placeholder="Street, city, state, ZIP"
                    autoComplete="off"
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                  />
                </label>
                <label className="fld">
                  <span className="fld-lbl">Company phone</span>
                  <input
                    className="fld-in"
                    type="tel"
                    id="phone"
                    placeholder="Phone number"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
              </div>

              <div className="fld">
                <span className="fld-lbl">Trades you take</span>
                {tradeChips(tradeNote(trades.length))}
              </div>

              <div className="btn-pair">
                {setupMode ? null : (
                  <button
                    className="btn btn--ghost"
                    type="button"
                    id="backBtn"
                    onClick={() => setStep(1)}
                  >
                    <svg className="ic">
                      <use href="#i-back" />
                    </svg>
                    Back
                  </button>
                )}
                <button className="btn" type="submit" id="createBtn" disabled={creating}>
                  {creating ? (setupMode ? "Saving…" : "Creating…") : setupMode ? "Continue" : "Create account"}
                </button>
              </div>
              <div className={err2 ? "err" : "err is-hidden"} id="err2">
                {err2}
              </div>
              <p className="step-note">
                By creating an account, you agree to our{" "}
                <Link href="/terms" target="_blank" rel="noopener noreferrer"><u>Terms of service</u></Link>
                {" "}and acknowledge our{" "}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer"><u>Privacy policy</u></Link>.
              </p>
            </form>

          </div>

          <div className={step === 4 ? "step" : "step is-hidden"} id="stepDone">
            {/* The plan turning on, once, when the workspace has settled —
                the same side-cannon confetti as the upgrade page's return leg. */}
            <PlanConfetti active={step === 4 && !payBusy} />
            <div className={payBusy ? "done-mark is-busy" : "done-mark"}>
              <svg className="ic">
                <use href="#i-check" />
              </svg>
            </div>
            {payBusy ? (
              <>
                <h1 className="auth-h1">Setting up your shop…</h1>
                <p className="auth-lede">Payment confirmed. Building your workspace.</p>
              </>
            ) : (
              <>
                <h1 className="auth-h1">{doneName ? `You're all set, ${doneName}.` : "You're all set."}</h1>
                <p className="auth-lede" id="doneNote">
                  {doneNote}
                </p>
                <div className="btn-pair">
                  <Link className="btn" href={doneHref}>
                    {signedIn ? "Open your dashboard" : "Sign in to your dashboard"}
                  </Link>
                </div>
                <p className="fld-note" role="status" id="doneCountdown">
                  {signedIn
                    ? countdown > 0
                      ? `Opening your dashboard in ${countdown}…`
                      : "Opening your dashboard…"
                    : countdown > 0
                      ? `Taking you to sign-in in ${countdown}…`
                      : "Taking you to sign-in…"}
                </p>
              </>
            )}
          </div>
          </div>
        </section>

        <aside className="auth-side">
          <div className="side-wash"></div>
          {/* THE PROMISE. One paper card on the ink field, top right, three
              lines long: what you get, why this step. It enters with step 2
              and leaves with it. */}
          <div className={step === 2 ? "side-perk is-on" : "side-perk"} id="sidePerk" aria-hidden={step !== 2}>
            <div className="pk">
              <span className="pk-eyebrow">
                <svg className="ic">
                  <use href="#i-gift" />
                </svg>
                Free leads
              </span>
              <h2 className="pk-h">Fill this out and you get free leads.</h2>
              <p className="pk-p">
                Homeowner jobs near you, matched to your trades and address. No cost, no cap.
              </p>
            </div>
          </div>

          {/* THE ART PANEL — see the note in the login page: a picture in the
              product's own drawing language instead of an invented quote. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="side-art"
            id="sideCard"
            src="/auth/side-site-2.png"
            alt=""
            aria-hidden="true"
          />
        </aside>
      </main>

      <section className={step === 3 ? "plan-sheet is-in" : "plan-sheet"} aria-hidden={step !== 3}>
        <div className="plan-sheet-in">
          {brand}
          {stepper}

          {/* ───── ШАГ 3 · THE PLAN ─────
              INDUSTRIAL DRAFTING BRUTALISM, the page's own language, pushed
              harder because this is the one screen that has to sell:
                · FULL BLEED. The art panel slides out and the comparison takes
                  the screen — three plans read as a table, and half a screen is
                  where that goes wrong.
                · ONE SHARED FEATURE LIST. Every plan prints the SAME rows: the
                  ones it includes in ink with a tick, the ones it does not in
                  grey with a dash. The gap between the columns is the argument
                  for the bigger plan, and it is visible without reading.
                · LESS TEXT, LOUDER TYPE. The per-plan paragraphs are gone; the
                  price is 44px, the plan name is the mono annotation layer, and
                  nothing on the card is a sentence.
                · The promo field carries its own APPLY inside the frame, so the
                  row is one object instead of a field and a stray button. */}
          <div className={step === 3 ? "step" : "step is-hidden"} id="stepPlan">
            {/* Title and the billing switch on ONE line: the switch is the
                control that rewrites every price under it, so it belongs beside
                the question, not stacked under it where it read as a third
                heading. The trial sentence moved to the fine print above the
                CTA, where the rest of the terms are. */}
            {/* THE HEADING SITS ON THE CARDS (owner, 2026-09-26): "Pick a
                plan." stands clear of the stepper and directly over the cards
                it asks about. The terms paragraph that used to sit between
                the two moved under the cards, beside the start buttons it
                speaks for. */}
            <div className="pw-head">
              <h1 className="auth-h1">Pick a plan.</h1>
              {/* The trial's promise, its own line under the heading (owner,
                  2026-10-01) — the stamp the landing carries, in the words
                  of signupTrialMode (lib/trialPolicyServer; words: lib/trialPolicy trialLine). */}
              <p className="pw-trial">
                <svg className="ic" aria-hidden>
                  <use href="#i-check" />
                </svg>
                {trialLine(requiresCard, trialDays)}
              </p>
            </div>

            {plansErr ? (
              <div className="err" role="alert">
                {plansErr}
              </div>
            ) : null}

            {confirmSentTo ? (
              <div className="pw-confirm" role="status">
                <span className="pw-confirm-k">Check your email</span>
                <p className="pw-confirm-h">
                  We sent a link to <b>{confirmSentTo}</b>.
                </p>
                <p className="pw-confirm-p">
                  Open it to create your shop and start the {trialDays}-day free trial — no card needed. The link works for 24 hours{resent ? "; the one sent before it no longer does" : ""}.
                </p>
                <div className="pw-confirm-row">
                  <button
                    type="button"
                    className="btn pw-go"
                    onClick={() => void onStartCardless(confirmSlug)}
                    disabled={payBusy || resendIn > 0}
                    aria-busy={payBusy || undefined}
                  >
                    {payBusy ? "Sending…" : resendIn > 0 ? `Resend in ${resendIn} s` : "Resend the link"}
                  </button>
                  <button type="button" className="pw-confirm-back" onClick={() => setConfirmSentTo(null)} disabled={payBusy}>
                    Pick another plan
                  </button>
                </div>
              </div>
            ) : null}

            <div className={"pw-plans" + (confirmSentTo ? " is-hidden" : "")} ref={plansRef}>
              {plans.map((p) => {
                const yearly = interval === "YEAR" ? p.yearlyPriceCents : null;
                const cents = yearly ?? p.priceCents;
                const per = yearly ? "/yr" : "/mo";
                /* What twelve months at the monthly rate would have cost, and
                   the saving against it. Only drawn when the annual price is
                   genuinely cheaper — a struck price that is not a discount is
                   a lie, not a decoration. */
                const listCents = yearly ? p.priceCents * 12 : 0;
                const savePct =
                  yearly && listCents > yearly
                    ? Math.round((1 - yearly / listCents) * 100)
                    : 0;
                const on = planSlug === p.slug;
                const has = includedBySlug.get(p.slug) ?? new Set<string>();
                return (
                  <div
                    key={p.slug}
                    role="button"
                    tabIndex={0}
                    className={"pw-plan" + (on ? " on" : "") + (p.highlight ? " pw-plan--hero" : "")}
                    aria-pressed={on}
                    onClick={() => setPlanSlug(p.slug)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPlanSlug(p.slug);
                      }
                    }}
                  >
                    {p.highlight ? <span className="pw-tag">Most picked</span> : null}
                    <span className="pw-plan-n">{p.name}</span>
                    <span className="pw-price">
                      ${(cents / 100).toFixed(0)}
                      <i>{per}</i>
                    </span>
                    {freeUntil ? <span className="pw-when">{freeUntilLine(cents, per)}</span> : null}
                    {savePct > 0 ? (
                      <span className="pw-save">
                        <s>${(listCents / 100).toFixed(0)}</s> Save {savePct}% · $
                        {((listCents - cents) / 100).toFixed(0)}
                      </span>
                    ) : null}
                    {/* THE CODE'S EFFECT ON THIS PRICE. "Code applied" over an
                        unchanged number read as nothing happening (owner,
                        2026-09-02); the same percent checkout applies is
                        shown here, against the price it applies to. */}
                    {promo?.percentOff ? (
                      <span className="pw-save pw-save--code">
                        <s>${(cents / 100).toFixed(0)}</s> {promo.percentOff}% off · $
                        {(() => {
                          // Stripe's own number, to the cent: $22.50, not $23.
                          const v = Math.round(cents * (1 - promo.percentOff / 100)) / 100;
                          return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
                        })()}
                        {per}
                      </span>
                    ) : null}
                    <span
                      className={"pw-feats" + (openFeats.has(p.slug) ? " is-open" : "")}
                      data-cut={openFeats.has(p.slug) ? "0" : undefined}
                    >
                      {featureRows.map((f) => {
                        const included = has.has(f.toLowerCase());
                        return (
                          <span key={f} className={included ? "pw-f" : "pw-f pw-f--no"}>
                            <svg className="ic">
                              <use href={included ? "#i-check" : "#i-minus"} />
                            </svg>
                            {f}
                          </span>
                        );
                      })}
                    </span>
                    {featureRows.length > 9 ? (
                      <span
                        className="pw-more"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFeats(p.slug);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleFeats(p.slug);
                          }
                        }}
                      >
                        {openFeats.has(p.slug) ? "Show less" : `Show all ${featureRows.length}`}
                      </span>
                    ) : null}
                    {/* No Choose / Selected plate (owner, 2026-09-05): the
                        frame and shadow say which card is picked; the button
                        below is the card's only control. */}
                    {/* THE START BUTTON LIVES IN THE CARD (owner, 2026-09-05):
                        directly under the card's own state plate, so choosing
                        and committing are one reach. Starting from a card that
                        is not yet the selection selects it first. The card is a
                        div-as-button for this reason — a button cannot hold
                        a button. */}
                    <button
                      type="button"
                      className={"btn pw-go" + (startingSlug === p.slug ? " is-busy" : "")}
                      aria-busy={startingSlug === p.slug || undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlanSlug(p.slug);
                        onStartPlan(p.slug);
                      }}
                      disabled={payBusy || !checkoutReady}
                    >
                      {startingSlug === p.slug
                        ? busyLabel
                        : !checkoutReady
                          ? "Checkout is not configured"
                          : `Start ${trialDays}-day free trial`}
                    </button>
                  </div>
                );
              })}
              {/* THE CUSTOM PLAN — the same card shape, priced by what is
                  ticked rather than by a tier somebody else drew. Drawn only
                  when offerCustom says so (see the flag), and only
                  once the catalogue has answered: drawn alone before it, it
                  was the card the phone carousel snapped to, and on a desk it
                  jumped from the first column to the last when the rest
                  arrived. */}
              {offerCustom && plans.length > 0 ? (
              <div
                role="button"
                tabIndex={0}
                className={
                  "pw-plan pw-plan--custom" + (planSlug === CUSTOM_PLAN_SLUG ? " on" : "")
                }
                aria-pressed={planSlug === CUSTOM_PLAN_SLUG}
                onClick={() => {
                  setPlanSlug(CUSTOM_PLAN_SLUG);
                  openPicker();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPlanSlug(CUSTOM_PLAN_SLUG);
                    openPicker();
                  }
                }}
              >
                <span className="pw-plan-n">Custom</span>
                <span className="pw-price">
                  ${(customCents / 100).toFixed(0)}
                  <i>{interval === "YEAR" ? "/yr" : "/mo"}</i>
                </span>
                {freeUntil ? <span className="pw-when">{freeUntilLine(customCents, interval === "YEAR" ? "/yr" : "/mo")}</span> : null}
                {/* The same saving the catalog plans show, off the same
                    arithmetic: a year here is CUSTOM_YEAR_MULTIPLIER months. */}
                {interval === "YEAR" ? (
                  <span className="pw-save">
                    <s>${((customPriceCents(customPages) * 12) / 100).toFixed(0)}</s> Save{" "}
                    {Math.round((1 - CUSTOM_YEAR_MULTIPLIER / 12) * 100)}% · $
                    {((customPriceCents(customPages) * 12 - customCents) / 100).toFixed(0)}
                  </span>
                ) : null}
                <span
                  className={"pw-feats" + (openFeats.has(CUSTOM_PLAN_SLUG) ? " is-open" : "")}
                  data-cut={openFeats.has(CUSTOM_PLAN_SLUG) ? "0" : undefined}
                >
                  {CUSTOM_BASE_FEATURES.map((f) => (
                    <span key={f} className="pw-f">
                      <svg className="ic">
                        <use href="#i-check" />
                      </svg>
                      {f}
                    </span>
                  ))}
                  <span className="pw-f pw-f--add">
                    <svg className="ic">
                      <use href="#i-plus" />
                    </svg>
                    {customPages.length === 0
                      ? `Add pages · $${(CUSTOM_PAGE_CENTS / 100).toFixed(0)} each`
                      : `${customPages.length} page${customPages.length === 1 ? "" : "s"} added`}
                  </span>
                  {customPages.map((id) => {
                    const page = CUSTOM_PAGES.find((x) => x.id === id);
                    return page ? (
                      <span key={id} className="pw-f">
                        <svg className="ic">
                          <use href="#i-check" />
                        </svg>
                        {page.label}
                      </span>
                    ) : null;
                  })}
                </span>
                {/* A phone cuts every list at six whole rows; the custom list
                    grows with each page ticked, so it gets the same "Show all"
                    as the catalogue cards once it passes six. */}
                {CUSTOM_BASE_FEATURES.length + 1 + customPages.length > 6 ? (
                  <span
                    className="pw-more"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFeats(CUSTOM_PLAN_SLUG);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFeats(CUSTOM_PLAN_SLUG);
                      }
                    }}
                  >
                    {openFeats.has(CUSTOM_PLAN_SLUG)
                      ? "Show less"
                      : `Show all ${CUSTOM_BASE_FEATURES.length + 1 + customPages.length}`}
                  </span>
                ) : null}
                {/* TWO CONTROLS, two looks (owner, 2026-09-04): the page
                    picker is the ghost, the plan's state label is the blue
                    plate every other card ends on. */}
                <span
                  className="pw-edit"
                  role="presentation"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlanSlug(CUSTOM_PLAN_SLUG);
                    openPicker();
                  }}
                >
                  Select pages
                </span>
                <button
                  type="button"
                  className={"btn pw-go" + (startingSlug === CUSTOM_PLAN_SLUG ? " is-busy" : "")}
                  aria-busy={startingSlug === CUSTOM_PLAN_SLUG || undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlanSlug(CUSTOM_PLAN_SLUG);
                    onStartPlan(CUSTOM_PLAN_SLUG);
                  }}
                  disabled={payBusy || !checkoutReady}
                >
                  {startingSlug === CUSTOM_PLAN_SLUG
                    ? busyLabel
                    : !checkoutReady
                      ? "Checkout is not configured"
                      : `Start ${trialDays}-day free trial`}
                </button>
              </div>
              ) : null}

              {plans.length === 0 && !plansErr ? (
                <div className="fld-note">Loading plans…</div>
              ) : null}
            </div>

            <div className={"pw-foot" + (planSlug ? " is-armed" : "")}>
              {/* PROMO — the same codes the ?promo / ?ref links carry. Applying
                  one stamps it on the shop and checkout picks it up there. */}
              <div className={"pw-promo" + (promo ? " is-on" : "")}>
                <input
                  className="pw-promo-in"
                  value={promo ? promo.code : promoText}
                  onChange={(e) => setPromoText(e.target.value.toUpperCase())}
                  placeholder="Promo or referral code"
                  aria-label="Promo or referral code"
                  disabled={promoBusy || Boolean(promo)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onApplyPromo();
                    }
                  }}
                />
                <button
                  className="pw-promo-b"
                  type="button"
                  onClick={() => void onApplyPromo()}
                  disabled={promoBusy || Boolean(promo) || promoText.trim().length === 0}
                >
                  {promoBusy ? "…" : promo ? "✓" : "Apply"}
                </button>
              </div>
            </div>

            {promo ? (
              <p className="pw-promo-ok" role="status">
                <b>{promo.code}</b>
                {promo.percentOff ? ` · ${promo.percentOff}% off` : ""} · {promo.displayName}
              </p>
            ) : promoErr ? (
              <p className="err" role="alert">
                {promoErr}
              </p>
            ) : null}

            {/* One disclosure below the promo field, matching the saved offer. */}
            <p className="pw-terms" id="pwTerms">
              {requiresCard
                ? `Your ${trialDays}-day free trial renews automatically at the selected plan price and billing interval shown above, unless you cancel before it ends. No charge today. Cancel from Subscription.`
                : `No card needed: the trial is ${trialDays} days, and you add a card only if you keep the plan.`}
              {" "}By starting a trial, you agree to our{" "}
              <Link href="/terms" target="_blank" rel="noopener noreferrer"><u>Terms of service</u></Link>
              {" "}and acknowledge our{" "}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer"><u>Privacy policy</u></Link>.
            </p>

            {/* The testing exit. Small, quiet, cornered — an escape, not an
                offer. Development builds only: the server refuses the
                no-subscription path in production regardless (see
                completePendingSignup), so the button is not drawn there. */}
            {process.env.NODE_ENV !== "production" ? (
              <button className="pw-skip" type="button" onClick={() => void onSkipPlan()} disabled={payBusy}>
                Skip for now
              </button>
            ) : null}

            {/* THE PAGE PICKER. Hand-rolled (no Radix here, same as every other
                dialog in this fleet): a scrim, one panel, Escape closes it. The
                price in its foot is the same function the server charges by. */}
            {offerCustom && pickerOpen && isClient ? createPortal(
              <div className={styles.bp + " pwp-host"}>
              <div
                className={"pwp" + (pickerOn ? " is-on" : "")}
                role="dialog"
                aria-modal="true"
                aria-label="Choose the pages in your plan"
                onKeyDown={(e) => {
                  if (e.key === "Escape") closePicker();
                }}
              >
                <div className="pwp-scrim" onClick={() => closePicker()} />
                <div className="pwp-box" ref={pickerBoxRef} tabIndex={-1}>
                  <div className="pwp-head">
                    <div>
                      <div className="pwp-kick">Custom plan</div>
                      <h2 className="pwp-h">Pick the pages you want.</h2>
                    </div>
                    <button
                      className="pwp-x"
                      type="button"
                      aria-label="Close"
                      onClick={() => closePicker()}
                    >
                      ×
                    </button>
                  </div>

                  <p className="pwp-lede">
                    ${(CUSTOM_BASE_CENTS / 100).toFixed(0)}/mo covers the everyday workspace —
                    proposals, clients, projects, jobs, invoices. Everything below is $
                    {(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo each.
                  </p>

                  <div className="pwp-list">
                    {CUSTOM_PAGES.map((page) => {
                      const on = customPages.includes(page.id);
                      return (
                        <button
                          key={page.id}
                          type="button"
                          className={"pwp-row" + (on ? " on" : "")}
                          aria-pressed={on}
                          onClick={() =>
                            setCustomPages((cur) =>
                              cur.includes(page.id)
                                ? cur.filter((x) => x !== page.id)
                                : [...cur, page.id],
                            )
                          }
                        >
                          <span className="pwp-box-t" aria-hidden="true">
                            {on ? (
                              <svg className="ic">
                                <use href="#i-check" />
                              </svg>
                            ) : null}
                          </span>
                          <span className="pwp-txt">
                            <span className="pwp-n">{page.label}</span>
                            <span className="pwp-note">{page.note}</span>
                          </span>
                          <span className="pwp-p">
                            +${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pwp-foot">
                    <span className="pwp-total">
                      ${(customCents / 100).toFixed(0)}
                      <i>{interval === "YEAR" ? "/yr" : "/mo"}</i>
                    </span>
                    <button
                      className="btn pwp-done"
                      type="button"
                      onClick={() => closePicker()}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
              </div>,
              document.body,
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
