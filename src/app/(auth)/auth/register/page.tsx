// Create account — Blueprint edition. Pixel-identical port of the donor
// `jobflex-auth-register-blueprint.html`.
//
// REPLACED IN PLACE, not forked. /auth/register is the live registration
// surface and now serves the blueprint build directly; there is deliberately no
// parallel /auth/register-blueprint route. This REVERSES the earlier
// side-by-side convention recorded in the header of
// /dashboard/subscription-blueprint/page.tsx ("a donor surface is never
// overwritten by its successor") — replacement is the instruction now.
//
// Public route: registration necessarily runs before a session exists, so there
// is no auth check here, exactly as before.
//
// All registration logic is unchanged — registerAccount (server action) +
// next-auth signIn + the promo/referral attribution capture. No server action,
// API route or Prisma model was added or altered by the restyle.

// VIEWPORT SWITCH: this route now serves the handheld rebuild at ≤768px and the
// blueprint desktop build above it, from this one URL — see
// ./register-responsive.tsx for the mechanism and why it is a sibling file
// rather than inline. /mobile-v1/auth/register remains as a direct preview URL.

import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlaceholderOrgName, needsCompanySetup } from "@/lib/orgSetup";
import { readGoogleSignup } from "@/lib/googleSignup";
import { detectInAppBrowser } from "@/lib/inAppBrowser";
import { signupTrialOffer } from "@/lib/trialOfferServer";
import { readPendingSignup } from "@/actions/signupCheckout";
import { TrialOfferProvider } from "@/components/providers/trial-offer";
import { readSignupFlow, signupTrialMode } from "@/lib/trialPolicyServer";
import { SIGNUP_MODE_COOKIE, resolveSignupMode } from "@/lib/signupMode";
import { OTP_DRAFT_COOKIE, draftRestore } from "@/lib/signupOtp";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { customPlanOffered } from "@/lib/customPlanFlag";
import { RegisterResponsive, type GooglePrefill, type SetupPrefill } from "./register-responsive";
import {
  INDUSTRY_COOKIE,
  UTM_COOKIE,
  hasUtm,
  parseUtmCookie,
  pickUtm,
  resolveLandingVariant,
  variantTrade,
} from "@/components/v3/landing-e/landing-variants";

// Title is the donor's <head> verbatim. The mockup ships no <meta
// name="description">; the line below is this repo's own convention.
/* STEP 1 BEFORE THE JAVASCRIPT (2026-10-04). On a phone the fields are drawn
   about three seconds before the page's script takes them over, and until
   then a Continue press was a plain browser submit — the page reloaded empty,
   the ad's tags gone — and anything typed was wiped the moment React took
   over. This runs as the HTML streams in, ahead of the form: it holds an
   early Continue, keeps what was typed and notes both moments;
   register-content restores the fields when it is live and reports them to
   the analyst as `signup_step1`. Plain script on purpose: it has to run
   before any bundle has arrived. */
const STEP1_PRELUDE = `(function(){var s={typedAt:0,submitAt:0,values:{},ready:false};window.__jfStep1=s;
document.addEventListener("input",function(e){var el=e.target;if(s.ready||!el||!el.form||el.form.id!=="step1Form"||!el.id)return;if(!s.typedAt)s.typedAt=Math.round(performance.now());s.values[el.id]=el.value;},true);
document.addEventListener("submit",function(e){var f=e.target;if(s.ready||!f||f.id!=="step1Form")return;e.preventDefault();if(!s.submitAt)s.submitAt=Math.round(performance.now());},true);})();`;

export const metadata: Metadata = {
  title: "JobFlex · Create account",
  description: "Set up your shop — your organization, your login, your first quote.",
};

// GOOGLE SIGNUPS finish here. The auth callback provisions the account + a
// placeholder org and signs the person in; the dashboard layout sends an
// owner whose org still has no address/trades to this URL, and this page
// opens straight on step 2 with what Google gave us (name, email) filled in.
// A signed-in owner whose org IS set up, arriving here without a Stripe
// return token, belongs in the app.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  /* THE TRADE THE VISITOR CAME IN ON. A landing opened with `?industry=fencing`
     carries it into every register link; a visitor who lands here later with
     no parameter still has the landing's 30-day memory cookie. Resolved here
     so step 2's chips are right on the first paint. Advisory only: it
     pre-selects a chip the visitor can un-pick. */
  const jar = await cookies();
  const industryParam = sp.industry ?? sp.trade;
  const industry = variantTrade(
    industryParam !== undefined
      ? resolveLandingVariant(industryParam)
      : resolveLandingVariant(jar.get(INDUSTRY_COOKIE)?.value),
  );
  /* THE CAMPAIGN THE VISITOR CAME IN ON: utm_* from the register link, else
     the landing's memory cookie (the Google return and the gold pill carry
     no query). Stamped on the organization at creation (CRO stage 1). */
  const utmFromQuery = pickUtm(sp);
  const utm = hasUtm(utmFromQuery) ? utmFromQuery : parseUtmCookie(jar.get(UTM_COOKIE)?.value);
  /* THE RETURN FROM GOOGLE, resolved HERE rather than in the browser. The
     client used to fetch the parked identity after mount, so the first frame
     was step 1 and the jump to step 2 happened a beat later — it read as
     being bounced back to the start (owner's report, 2026-09-03). Reading it
     on the server means the first paint IS step 2, with the name and address
     Google gave us already in place. An expired or unknown handle simply
     yields null and the normal signup renders. */
  const gsuParam = typeof sp.gsu === "string" ? sp.gsu : null;
  let google: GooglePrefill | null = null;
  /* A Google address on a throwaway-mail domain comes back as ?gerr=disposable
     (lib/auth, One Tap): step 1 opens with the reason instead of step 2. */
  let googleError: string | null = sp.gerr === "disposable" ? DISPOSABLE_EMAIL_MESSAGE : null;
  if (gsuParam) {
    const identity = await readGoogleSignup(gsuParam);
    if (identity && isDisposableEmail(identity.email)) {
      googleError = DISPOSABLE_EMAIL_MESSAGE;
    } else if (identity) {
      google = { handle: gsuParam, email: identity.email, name: identity.name ?? "" };
    }
  }

  let setup: SetupPrefill | null = null;
  let sendToApp = false;
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (userId && session.user.principal !== "INFLUENCER") {
      const m = await db.membership.findFirst({
        where: { userId, role: "OWNER", organization: { deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: {
          user: { select: { name: true, email: true, phone: true } },
          organization: { select: { name: true, address: true, phone: true, tradeTypesJson: true } },
        },
      });
      if (m && needsCompanySetup(m.organization)) {
        setup = {
          name: m.user.name ?? "",
          email: m.user.email ?? "",
          phone: m.user.phone ?? "",
          businessName: isPlaceholderOrgName(m.organization.name) ? "" : m.organization.name,
          companyPhone: m.organization.phone ?? "",
        };
      } else if (m && !sp.signup && !google) {
        /* A signed-in owner arriving with a FRESH Google identity (a Google
           account JobFlex has never seen) is here to start a second shop with
           it, not to be bounced into the app they are already in — the Google
           return wins over the "you belong in the app" rule (owner, 2026-09-04). */
        sendToApp = true;
      }
    }
  } catch {
    // Session read hiccup: render the normal signup.
  }
  if (sendToApp) redirect("/dashboard");
  /* Instagram / Facebook / LINE / TikTok webview: read here (the page is
     dynamic already, for the cookies above) so step 1 is drawn without the
     Google button from the first paint (lib/inAppBrowser). */
  const inAppBrowser = detectInAppBrowser((await headers()).get("user-agent"));
  /* THE MODE (2026-10-10, lib/signupMode): the owner's switch, or ?flow=otp
     in this browser. The passwordless sign-up reopens where it was left
     (lib/signupOtp): the draft named by ?d= or this browser's cookie. */
  const signupFlow = await readSignupFlow();
  const mode = resolveSignupMode(sp.flow, jar.get(SIGNUP_MODE_COOKIE)?.value, signupFlow.passwordless);
  const otpRestore =
    mode === "otp" && !setup && !google && typeof sp.signup !== "string"
      ? await draftRestore(typeof sp.d === "string" ? sp.d : null, jar.get(OTP_DRAFT_COOKIE)?.value ?? null).catch(() => null)
      : null;
  const pendingToken = typeof sp.signup === "string" ? sp.signup : (otpRestore?.signupToken ?? null);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: STEP1_PRELUDE }} />
      <TrialOfferProvider trackExposure={false} offer={(pendingToken ? (await readPendingSignup(pendingToken))?.trialOffer : null) ?? await signupTrialOffer()}>
      <RegisterResponsive
        requiresCard={(await signupTrialMode()) === "card"}
        steps={signupFlow.steps}
        mode={mode}
        otpRestore={otpRestore}
        offerCustom={customPlanOffered()}
        initialError={googleError}
        setup={setup}
        google={google}
        industry={industry}
        edition={sp.edition === "deck" ? "deck" : null}
        utm={hasUtm(utm) ? utm : null}
        inAppBrowser={inAppBrowser}
      />
      </TrialOfferProvider>
    </>
  );
}
