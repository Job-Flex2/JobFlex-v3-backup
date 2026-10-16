"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { LIMIT_KEYS, serializePlanLimits } from "@/lib/planLimits";
import { revalidatePlanSurfaces } from "@/lib/planCatalogServer";
import { syncPlanPricesToStripe } from "@/lib/planStripeSync";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { isStripeWriteAllowed } from "@/lib/stripeSafety";
import { setStripeMode, getStripeMode, stripeKeyFor, type StripeMode } from "@/lib/stripeMode";
import { setCustomPlanTrialDays, MAX_TRIAL_DAYS } from "@/lib/customPlanConfig";
import { randomUUID } from "node:crypto";
import { appBaseUrl } from "@/lib/appUrl";
import { supportTicketRef } from "@/lib/notify";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { checkReply, replyLetter, statusAfterReply, type SupportReply } from "@/lib/supportReply";
import { addSupportReply, canOpenSupportPage, recipientForTicket } from "@/lib/supportReplies";

// ── Pricing plans ─────────────────────────────────────

// Limits arrive as a partial map of LimitKey → numeric cap. A negative value
// (or an omitted key) means "unlimited"; serializePlanLimits drops those.
const limitsInput = z
  .record(z.enum(LIMIT_KEYS as [string, ...string[]]), z.number())
  .optional();

const planInput = z.object({
  id: z.string().optional(),
  // Slugs are normalized lowercase at the source — mixed case previously caused
  // a fail-open limits bug (Subscription.plan joins on this string).
  slug: z.string().min(1).transform((s) => s.trim().toLowerCase()),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  priceCents: z.number().int().min(0),
  yearlyPriceCents: z.number().int().min(0).nullable().optional(),
  trialDays: z.number().int().min(0).max(365).default(0),
  interval: z.enum(["month", "year"]),
  order: z.number().default(0),
  features: z.array(z.string()).default([]),
  limits: limitsInput,
  active: z.boolean().default(true),
  highlight: z.boolean().default(false),
});

export async function upsertPricingPlan(
  raw: unknown,
): Promise<{ ok: true; id: string; syncWarning?: string }> {
  await requirePlatformAdmin();
  const data = planInput.parse(raw);

  const existing = data.id
    ? await db.pricingPlan.findUnique({ where: { id: data.id } })
    : null;
  if (data.id && !existing) throw new Error("Plan not found");
  // Slug is the join key to PlanPrice + Subscription — immutable once set.
  if (existing && existing.slug !== data.slug) {
    throw new Error("Slug can't be changed — create a new plan and deactivate this one.");
  }

  const fields = {
    slug: data.slug,
    name: data.name,
    description: data.description ?? null,
    priceCents: data.priceCents,
    yearlyPriceCents: data.yearlyPriceCents ?? null,
    trialDays: data.trialDays,
    interval: data.interval,
    order: data.order,
    features: JSON.stringify(data.features),
    limitsJson: serializePlanLimits(data.limits ?? {}),
    active: data.active,
    highlight: data.highlight,
  };
  const row = existing
    ? await db.pricingPlan.update({ where: { id: existing.id }, data: fields })
    : await db.pricingPlan.create({ data: fields });

  // Auto-sync: a new paid plan, or a changed price/name, pushes to Stripe now so
  // checkout charges what the admin sees. The DB save always wins — sync failure
  // comes back as a warning (the manual Sync button retries), never an error.
  const hasPaidPrice = row.priceCents > 0 || (row.yearlyPriceCents ?? 0) > 0;
  const priceChanged =
    !!existing &&
    (existing.priceCents !== row.priceCents ||
      (existing.yearlyPriceCents ?? 0) !== (row.yearlyPriceCents ?? 0) ||
      existing.name !== row.name); // name → Stripe Product rename
  let syncWarning: string | undefined;
  if (hasPaidPrice && (!existing || priceChanged)) {
    if (isStripeEnabled() && isStripeWriteAllowed()) {
      try {
        await syncPlanPricesToStripe(row.id);
      } catch (e) {
        syncWarning = `Saved, but Stripe sync failed: ${
          e instanceof Error ? e.message : "unknown error"
        }. Use "Sync to Stripe" to retry.`;
      }
    } else {
      syncWarning =
        "Saved, but Stripe isn't configured for writes — the plan isn't checkout-ready until synced.";
    }
  }

  revalidatePlanSurfaces();
  return { ok: true, id: row.id, syncWarning };
}

/**
 * The custom plan's trial length. It has no PricingPlan row to hold a
 * trialDays column (its price is computed from the pages a shop ticks), so the
 * value lives in SyncState — see lib/customPlanConfig. Both checkout routes
 * and the signup plan step read it back.
 */
export async function setCustomPlanTrial(days: unknown): Promise<{ ok: true; trialDays: number }> {
  await requirePlatformAdmin();
  const parsed = z.number().int().min(0).max(MAX_TRIAL_DAYS).safeParse(Number(days));
  if (!parsed.success) throw new Error(`Trial days must be between 0 and ${MAX_TRIAL_DAYS}.`);
  const trialDays = await setCustomPlanTrialDays(parsed.data);
  revalidatePlanSurfaces();
  return { ok: true, trialDays };
}

export async function deletePricingPlan(id: string) {
  await requirePlatformAdmin();
  const plan = await db.pricingPlan.findUnique({ where: { id } });
  if (!plan) return;

  // Refuse to delete a plan someone is subscribed to — deactivating keeps
  // grandfathered subscribers' entitlements intact; deleting would strand them.
  const slugLower = plan.slug.toLowerCase();
  const subPlans = await db.subscription.findMany({
    select: { plan: true },
    distinct: ["plan"],
  });
  if (subPlans.some((s) => (s.plan ?? "").toLowerCase() === slugLower)) {
    throw new Error("Subscribers are on this plan — deactivate it instead of deleting.");
  }

  // Retire the Stripe mirror: deactivate PlanPrice rows and best-effort archive
  // the Stripe prices/product so the slug can't be checked out again.
  const prices = await db.planPrice.findMany({ where: { planSlug: plan.slug } });
  if (prices.length && isStripeEnabled() && isStripeWriteAllowed()) {
    const stripe = getStripe();
    await Promise.all(
      prices
        .filter((p) => p.active)
        .map((p) => stripe.prices.update(p.stripePriceId, { active: false }).catch(() => {})),
    );
    const productId = prices[0]?.stripeProductId;
    if (productId) await stripe.products.update(productId, { active: false }).catch(() => {});
  }
  await db.planPrice.updateMany({ where: { planSlug: plan.slug }, data: { active: false } });

  await db.pricingPlan.delete({ where: { id } });
  revalidatePlanSurfaces();
}

// ── Specialties ───────────────────────────────────────

export async function upsertSpecialty(raw: {
  id?: string;
  organizationId: string;
  name: string;
  promptPreamble?: string | null;
}) {
  await requirePlatformAdmin();
  if (raw.id) {
    await db.specialty.update({
      where: { id: raw.id },
      data: { name: raw.name, promptPreamble: raw.promptPreamble ?? null },
    });
  } else {
    await db.specialty.create({
      data: {
        organizationId: raw.organizationId,
        name: raw.name,
        promptPreamble: raw.promptPreamble ?? null,
      },
    });
  }
  revalidatePath("/admin/specialties");
}

export async function deleteSpecialty(id: string) {
  await requirePlatformAdmin();
  await db.specialty.delete({ where: { id } });
  revalidatePath("/admin/specialties");
}

// ── Support tickets ───────────────────────────────────

const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

export async function updateTicketStatus(id: string, status: string) {
  await requirePlatformAdmin();
  // Whitelist the status the same way the customer-side write validates its
  // fields — the column is a free String, so this is the only guard.
  const next = z.enum(TICKET_STATUSES).parse(status);
  await db.supportTicket.update({ where: { id }, data: { status: next } });
  revalidatePath("/admin/support");
  revalidatePath("/admin");
}

export type ReplyToTicketResult = { ok: true; reply: SupportReply; status: string } | { ok: false; error: string };

/**
 * THE ANSWER, FROM THE TICKET ITSELF (owner, 2026-10-14: "respond to the
 * client from admin right away"): the admin's words go to whoever filed the
 * ticket (else the account's owner, else its billing address) as a plain
 * letter with the ticket quoted under it (lib/supportReply), are kept in the
 * ticket's thread (lib/supportReplies) — on this console and on the
 * contractor's own support page — and an Open ticket becomes In progress.
 * The reply is kept only once the email has gone: the thread never says
 * "sent" for a letter that was not.
 */
export async function replyToSupportTicket(id: string, raw: unknown): Promise<ReplyToTicketResult> {
  const admin = await requirePlatformAdmin();
  const check = checkReply(raw);
  if (!check.ok) return check;
  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { user: { select: { email: true } }, organization: { select: { billingEmail: true } } },
  });
  if (!ticket) return { ok: false, error: "That ticket is gone." };
  const to = await recipientForTicket(ticket);
  if (!to) return { ok: false, error: "This ticket has no address to answer: nobody is on it, and the account has no owner or billing email." };
  if (!isEmailEnabled()) return { ok: false, error: "Email is not set up on this server, so the reply cannot be sent." };
  const who = admin as { name?: string | null; email?: string | null };
  const sender = who.name?.trim() || "JobFlex support";
  const letter = replyLetter({ body: check.body, sender, ticket: { subject: ticket.subject, body: ticket.body, ref: supportTicketRef(ticket.id), filedAt: ticket.createdAt.toISOString() }, base: await appBaseUrl(), supportPage: await canOpenSupportPage(ticket, to) });
  try {
    await sendEmail({ to, subject: letter.subject, html: letter.html, text: letter.text, replyTo: "support@jobflex.app" });
  } catch (err) {
    console.error("[support] reply email failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "The email did not go out. Check the connection and try again." };
  }
  const reply: SupportReply = { id: randomUUID(), at: new Date().toISOString(), by: sender, to, body: check.body };
  await addSupportReply(ticket.id, reply);
  const status = statusAfterReply(ticket.status);
  await db.supportTicket.update({ where: { id }, data: { status, adminReadAt: ticket.adminReadAt ?? new Date() } });
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  revalidatePath("/dashboard/support");
  return { ok: true, reply, status };
}

// ── Platform-wide campaigns ───────────────────────────
// Reuses the existing Announcement model with `scope = "PLATFORM"`.
// Every tenant's AnnouncementBanner picks these up because the banner
// reads any Announcement targeting the org *or* the platform.
//
// NOT EMAIL. This writes a banner row and nothing else — no send, no
// recipient list, no per-recipient state. /admin/campaigns says so on the
// composer; do not let the file name imply otherwise.

const campaignInput = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  expiresInDays: z.number().min(1).max(365).optional(),
  /** Absolute expiry — the announcements board publishes with a date, not a
   *  day count. When both are sent, the absolute one wins. */
  expiresAt: z.union([z.string(), z.date()]).nullable().optional(),
  /** Banner tone: 0 normal · 1 warn · 2 high. Campaigns keeps its old 1. */
  priority: z.number().min(0).max(2).optional(),
});

export async function sendPlatformCampaign(raw: unknown) {
  const user = await requirePlatformAdmin();
  const data = campaignInput.parse(raw);

  // We need *some* organizationId for the FK; the ANNOUNCEMENT.scope=PLATFORM
  // is what actually marks it as cross-tenant. Prefer the admin's own
  // membership, but a cookie-door platform admin (ADMIN_USERNAME login) has
  // none — any organization serves as the FK anchor then, since the issuer
  // org is never used for visibility.
  const m =
    (await db.membership.findFirst({
      where: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } },
      select: { organizationId: true },
    })) ??
    (await db.organization
      .findFirst({ select: { id: true } })
      .then((o) => (o ? { organizationId: o.id } : null)));
  if (!m) throw new Error("No organization exists yet to anchor the announcement row.");

  const expiresAt = data.expiresAt
    ? data.expiresAt instanceof Date
      ? data.expiresAt
      : new Date(data.expiresAt)
    : data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const created = await db.announcement.create({
    data: {
      organizationId: m.organizationId, // issuer org for FK; not used for visibility
      title: data.title,
      body: data.body,
      scope: "PLATFORM",
      priority: data.priority ?? 1,
      expiresAt,
    },
  });

  // The reach the console reports back is counted here, at write time, rather
  // than echoed from whatever the page was rendered with.
  const organizations = await db.organization.count();

  revalidatePath("/admin/campaigns");
  revalidatePath("/admin/announcements");
  revalidatePath("/dashboard"); // banner re-renders
  return { id: created.id, organizations };
}

/**
 * Retire a platform announcement: stamp `expiresAt = now`, so it leaves every
 * tenant's banner on the next read but stays on the board's archive — the
 * announcements page's semantics, vs deletePlatformCampaign's hard delete.
 */
export async function retirePlatformCampaign(id: string) {
  await requirePlatformAdmin();
  const { count } = await db.announcement.updateMany({
    where: { id, scope: "PLATFORM" },
    data: { expiresAt: new Date() },
  });
  if (count === 0) throw new Error("That announcement no longer exists.");
  revalidatePath("/admin/campaigns");
  revalidatePath("/admin/announcements");
  revalidatePath("/dashboard");
}

export async function deletePlatformCampaign(id: string) {
  await requirePlatformAdmin();
  // Scoped to PLATFORM: this console only ever issues platform announcements,
  // and an ORG-scope id reaching an unscoped delete would take out a tenant's
  // own notice.
  const { count } = await db.announcement.deleteMany({ where: { id, scope: "PLATFORM" } });
  if (count === 0) throw new Error("That announcement no longer exists.");
  revalidatePath("/admin/campaigns");
  revalidatePath("/dashboard");
}

// ── Stripe mode switch ────────────────────────────────
// Live account vs the test sandbox — flipped from /admin/integrations. The
// checkout routes read the row per request (lib/stripeMode), so the flip takes
// effect on the next checkout without a deploy or restart.
export async function setStripeModeAction(mode: StripeMode): Promise<{ ok: true; mode: StripeMode }> {
  await requirePlatformAdmin();
  if (mode !== "live" && mode !== "test") throw new Error("mode must be live or test");
  if (!stripeKeyFor(mode)) {
    throw new Error(
      mode === "live"
        ? "No live key configured (STRIPE_SECRET_KEY)."
        : "No sandbox key configured (STRIPE_SECRET_KEY_TEST).",
    );
  }
  await setStripeMode(mode);
  revalidatePath("/admin/integrations");
  return { ok: true, mode };
}

export async function getStripeModeAction(): Promise<{
  mode: StripeMode;
  liveConfigured: boolean;
  testConfigured: boolean;
}> {
  await requirePlatformAdmin();
  return {
    mode: await getStripeMode(),
    liveConfigured: Boolean(stripeKeyFor("live")),
    testConfigured: Boolean(stripeKeyFor("test")),
  };
}
