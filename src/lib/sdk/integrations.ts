// Platform integrations — the ONE list /admin/integrations and /admin/health
// read from.
//
// `enabled` means exactly one thing: the env keys listed on the entry are
// present in this environment. It is NOT a reachability claim — nothing in
// getIntegrationStatuses() opens a socket. Two services can be verified for
// real, and only those two: Stripe through checkStripeReachable() below, and
// PostHog through getTrafficSnapshot() in lib/posthog (a real HogQL POST).
// Live metadata checks do not prove feature or quota health.


import { isOpenAIEnabled } from "./openai";
import { getStripe, isStripeEnabled } from "./stripe";
import { isSquareEnabled, isSquareWebhookConfigured } from "./square";
import { isResendEnabled } from "./resend";
import { isSmtpEnabled } from "./smtp";
import { isTwilioEnabled } from "./twilio";
import { isGmailOAuthConfigured } from "./gmail";
import { isFalEnabled } from "./falAi";
import { isBlobEnabled } from "./blob";
import { isRegridEnabled } from "../parcel";
import { isReportAllEnabled } from "../reportall";
import { isEagleViewEnabled } from "../eagleview";
import { isMapsEnabled } from "../maps";
import { isPostHogEnabled } from "../posthog";

export type IntegrationGroup = "payments" | "messaging" | "property" | "platform";

/** The services a live check exists for. Anything else can only be "configured". */
export type LiveProbe = "stripe" | "posthog";

export interface IntegrationStatus {
  key: string;
  name: string;
  group: IntegrationGroup;
  /** The env keys on this entry are all present. Never a reachability claim. */
  enabled: boolean;
  envKeys: string[];
  probe?: LiveProbe;
  /** An admin page that sets this one up for everyone (2026-09-24: Twilio). */
  setupHref?: string;
}

export function isSerpApiEnabled(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY);
}

export function isStripeConnectConfigured(): boolean {
  return Boolean(
    (process.env.STRIPE_CONNECT_CLIENT_ID || process.env.STRIPE_CONNECT_CLIENT_ID_TEST) &&
      (process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST),
  );
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

export function isMapsBrowserKeySet(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY);
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  return [
    ...([
      ["coolcalc", "CoolCalc", "property", ["COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID"]],
      ["google-auth", "Google sign-in", "platform", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
      ["stax", "Stax (per-organization credentials)", "payments", []],
      ["paypal", "PayPal", "payments", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]],
      ["meta", "Meta lead import", "messaging", ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY"]],
      ["meta-ads", "Meta ad spend", "platform", ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]],
      ["solar", "Google Solar", "property", ["GOOGLE_MAPS_API_KEY"]],
      ["census", "US Census geocoder", "property", []],
      ["fcc", "FCC geography", "property", []],
      ["nominatim", "Nominatim geocoder", "property", []],
      ["assessor", "County assessor / ArcGIS sources", "property", []],
      ["naip", "NAIP / Planetary Computer imagery", "property", []],
      ["usa-structures", "USA Structures / ArcGIS", "property", []],
      ["overpass", "Overpass / OpenStreetMap", "property", []],
      ["elevation", "USGS 3DEP elevation", "property", []],
    ] as [string, string, IntegrationGroup, string[]][]).map(([key, name, group, envKeys]) => ({
      key, name, group, envKeys, enabled: envKeys.every(k => Boolean(process.env[k])),
    })),
    // ── Payments ──────────────────────────────────────────────────────────
    {
      key: "stripe",
      name: "Stripe",
      group: "payments",
      enabled: isStripeEnabled(),
      envKeys: ["STRIPE_SECRET_KEY"],
      probe: "stripe",
    },
    {
      key: "stripe-webhook",
      name: "Stripe webhooks",
      group: "payments",
      enabled: isStripeWebhookConfigured(),
      envKeys: ["STRIPE_WEBHOOK_SECRET"],
    },
    {
      key: "stripe-connect",
      name: "Stripe Connect (contractor payments)",
      group: "payments",
      enabled: isStripeConnectConfigured(),
      envKeys: ["STRIPE_CONNECT_CLIENT_ID", "STRIPE_CONNECT_WEBHOOK_SECRET"],
    },
    {
      key: "square",
      name: "Square (OAuth app)",
      group: "payments",
      enabled: isSquareEnabled(),
      envKeys: ["SQUARE_APPLICATION_ID", "SQUARE_APPLICATION_SECRET"],
    },
    {
      key: "square-webhook",
      name: "Square webhooks",
      group: "payments",
      enabled: isSquareWebhookConfigured(),
      envKeys: ["SQUARE_WEBHOOK_SIGNATURE_KEY"],
    },

    // ── Email & SMS ───────────────────────────────────────────────────────
    {
      key: "resend",
      name: "Resend",
      group: "messaging",
      enabled: isResendEnabled(),
      envKeys: ["RESEND_API_KEY"],
    },
    {
      key: "smtp",
      name: "SMTP",
      group: "messaging",
      enabled: isSmtpEnabled(),
      envKeys: ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"],
    },
    {
      key: "twilio",
      name: "Twilio",
      group: "messaging",
      enabled: await isTwilioEnabled(),
      envKeys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"],
      setupHref: "/admin/integrations/twilio",
    },
    {
      key: "gmail",
      name: "Gmail OAuth",
      group: "messaging",
      enabled: isGmailOAuthConfigured(),
      envKeys: ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REDIRECT_URI"],
    },

    // ── Property data ─────────────────────────────────────────────────────
    {
      key: "maps",
      name: "Google Maps",
      group: "property",
      enabled: isMapsEnabled(),
      envKeys: ["GOOGLE_MAPS_API_KEY"],
    },
    {
      key: "maps-browser",
      name: "Google Maps · browser",
      group: "property",
      enabled: isMapsBrowserKeySet(),
      envKeys: ["NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY"],
    },
    {
      key: "regrid",
      name: "Regrid",
      group: "property",
      enabled: isRegridEnabled(),
      envKeys: ["REGRID_API_KEY"],
    },
    {
      key: "reportall",
      name: "ReportAll USA",
      group: "property",
      enabled: isReportAllEnabled(),
      envKeys: ["REPORTALL_CLIENT_KEY"],
    },
    {
      key: "eagleview",
      name: "Aerial data",
      group: "property",
      enabled: isEagleViewEnabled(),
      envKeys: ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET"],
    },

    // ── Platform ──────────────────────────────────────────────────────────
    {
      key: "openai",
      name: "OpenAI",
      group: "platform",
      enabled: isOpenAIEnabled(),
      envKeys: ["OPENAI_API_KEY"],
    },
    {
      key: "serpapi",
      name: "SerpAPI",
      group: "platform",
      enabled: isSerpApiEnabled(),
      envKeys: ["SERPAPI_API_KEY"],
    },
    {
      key: "fal",
      name: "FAL.ai",
      group: "platform",
      enabled: isFalEnabled(),
      envKeys: ["FAL_KEY"],
    },
    {
      key: "blob",
      name: "Vercel Blob",
      group: "platform",
      enabled: isBlobEnabled(),
      envKeys: ["BLOB_READ_WRITE_TOKEN"],
    },
    {
      key: "posthog",
      name: "PostHog",
      group: "platform",
      enabled: isPostHogEnabled(),
      envKeys: ["POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID"],
      probe: "posthog",
    },
  ];
}

export type LiveCheck =
  | { state: "off" }
  | { state: "ok" }
  | { state: "error"; message: string };

/**
 * A real authenticated round trip to Stripe. `balance.retrieve` is a READ, so
 * it is safe against a live key (stripeSafety only gates writes), and it is the
 * cheapest call that proves the secret key is accepted. No retries: this is a
 * health probe, and a retry would report a reachability the first attempt did
 * not have.
 */
export async function checkStripeReachable(): Promise<LiveCheck> {
  if (!isStripeEnabled()) return { state: "off" };
  try {
    await getStripe().balance.retrieve(undefined, { timeout: 6000, maxNetworkRetries: 0 });
    return { state: "ok" };
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : "Stripe did not answer" };
  }
}
