import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getTrafficSnapshot } from "@/lib/posthog";
import { checkStripeReachable, isStripeWebhookConfigured } from "@/lib/sdk/integrations";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { isLiveStripeKey, isStripeWriteAllowed } from "@/lib/stripeSafety";
import { isResendEnabled } from "@/lib/sdk/resend";
import { isSmtpEnabled } from "@/lib/sdk/smtp";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { isBlobEnabled } from "@/lib/sdk/blob";
import { deskReadiness } from "@/lib/aiDesk/readiness";
import { WebhookEventStatus } from "@/lib/prismaEnums";
import { readSupportMailStatus } from "@/lib/supportMail/run";
import { supportMailConfig } from "@/lib/supportMail/config";
import {
  AdminHealthContent,
  type HealthData,
  type ProbeState,
  type WebhookSnapshot,
} from "@/components/v3/admin-health/health-content";

/** A real round trip to the database — the cheapest statement that proves it. */
async function probeDatabase(): Promise<{ state: ProbeState; message: string | null }> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { state: "ok", message: null };
  } catch (err) {
    return {
      state: "error",
      message: err instanceof Error ? err.message : "The database did not answer.",
    };
  }
}

/** Rows the Stripe webhook route and the reconcile cron wrote. Nothing derived. */
async function readWebhooks(since: Date): Promise<WebhookSnapshot> {
  const [last, received24h, processed24h, failed24h, lastFailure] = await Promise.all([
    db.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.webhookEvent.count({ where: { receivedAt: { gte: since } } }),
    db.webhookEvent.count({
      where: { receivedAt: { gte: since }, status: WebhookEventStatus.PROCESSED },
    }),
    db.webhookEvent.count({
      where: { receivedAt: { gte: since }, status: WebhookEventStatus.FAILED },
    }),
    db.webhookEvent.findFirst({
      where: { status: WebhookEventStatus.FAILED },
      orderBy: { receivedAt: "desc" },
      select: { type: true, receivedAt: true, error: true },
    }),
  ]);

  return {
    lastAt: last ? last.receivedAt.toISOString() : null,
    received24h,
    processed24h,
    failed24h,
    lastFailure: lastFailure
      ? {
          type: lastFailure.type,
          at: lastFailure.receivedAt.toISOString(),
          error: lastFailure.error,
        }
      : null,
  };
}

export default async function AdminHealthPage() {
  const admin = await requirePlatformAdmin();

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [database, stripe, traffic, desk] = await Promise.all([
    probeDatabase(),
    checkStripeReachable(),
    getTrafficSnapshot(),
    // The AI desk's go-live lights (lib/aiDesk/readiness): never fails the page.
    deskReadiness(admin.id).catch((err) => {
      console.warn("[health] desk readiness failed:", err);
      return null;
    }),
  ]);

  // Everything below reads the database, so it only runs once the probe above
  // says there is one to read. A failed probe leaves these null and the card
  // says so rather than showing zeros.
  let webhooks: WebhookSnapshot | null = null;
  let reconcileAt: string | null = null;
  // The support inbox (lib/supportMail): what the cron last managed, and why it stopped if it did.
  const mailCfg = supportMailConfig();
  const mailStatus = database.state === "ok" ? await readSupportMailStatus().catch(() => null) : null;
  if (database.state === "ok") {
    try {
      const [snapshot, sync] = await Promise.all([
        readWebhooks(since),
        db.syncState.findUnique({ where: { key: "reconcile-stripe" } }),
      ]);
      webhooks = snapshot;
      reconcileAt = sync ? sync.updatedAt.toISOString() : null;
    } catch {
      webhooks = null;
    }
  }

  const stripeEnabled = isStripeEnabled();
  const data: HealthData = {
    generatedAt: now.toISOString(),
    database,
    stripeApi: {
      state: stripe.state,
      message: stripe.state === "error" ? stripe.message : null,
    },
    analytics: {
      state: traffic.status === "ok" ? "ok" : traffic.status === "error" ? "error" : "off",
      message: traffic.status === "error" ? traffic.message : null,
    },
    emailTransport: isResendEnabled() ? "resend" : isSmtpEnabled() ? "smtp" : "none",
    smsConfigured: await isTwilioEnabled(),
    blobConfigured: isBlobEnabled(),
    stripeConfigured: stripeEnabled,
    stripeWebhookSecret: isStripeWebhookConfigured(),
    stripeKeyMode: !stripeEnabled ? "none" : isLiveStripeKey() ? "live" : "test",
    stripeWritesAllowed: isStripeWriteAllowed(),
    cronSecret: Boolean(process.env.CRON_SECRET),
    adminDoor: Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD),
    webhooks,
    reconcileAt,
    desk,
    supportInbox: {
      on: mailCfg.ok,
      why: mailCfg.ok ? null : mailCfg.why,
      checkedAt: mailStatus?.checkedAt ?? null,
      lastError: mailStatus?.lastError ?? null,
      lastErrorAt: mailStatus?.lastErrorAt ?? null,
    },
  };

  return <AdminHealthContent data={data} />;
}
