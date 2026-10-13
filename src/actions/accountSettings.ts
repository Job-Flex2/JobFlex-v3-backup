"use server";

// Personal + business account settings behind the blueprint Settings page
// (/dashboard/settings). Three writes and nothing else:
//
//   updateProfile           → the CURRENT user's own row (name, phone)
//   updateBusiness          → the org row (manager-gated)
//   updateNotificationPrefs → the CURRENT user's own notification blob
//
// Every other value the page saves already had an action: payment settings,
// Gmail and Meta go through src/actions/settings.ts, and the plan goes through
// checkout. Deliberately NO read helper is exported here — an exported async
// function in a "use server" module is a public RPC endpoint, so a read keyed
// by a caller-supplied id would be a data leak. The Settings page does its
// reads in the server component.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireManager, requireOwner, requireUser } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { signOutEverywhereFor } from "@/lib/sessions";
import { mergeMatrixSave, parseNotificationPrefs } from "@/lib/notificationPrefsShared";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { releaseAttachedSchedule } from "@/lib/scheduleRelease";
import { markSubscriptionCanceled } from "@/lib/stripeSync";
import { disconnectSquareFor, disconnectStripeConnectFor } from "@/lib/payments/connections";
import { ActivityKind } from "@/lib/prismaEnums";

const SETTINGS_PATH = "/dashboard/settings";

/** "" from an emptied text input means "clear the column", not "store empty". */
function orNull(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

/* ─────────────────────────────── profile ─────────────────────────────── */

const profileSchema = z.object({
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
});

/**
 * The signed-in user's own profile. Scoped to `session.user.id` — there is no
 * id parameter, so this can only ever write the caller's row.
 */
export async function updateProfile(raw: unknown) {
  const user = await requireUser();
  const data = profileSchema.parse(raw);
  await db.user.update({
    where: { id: user.id },
    data: { name: orNull(data.name), phone: orNull(data.phone) },
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/* ────────────────────────────── business ─────────────────────────────── */

// Every field optional so one card can save its own slice: the Account pane's
// Business card sends name/address/website/phone, the Billing pane's Billing
// contact card sends billingEmail alone. An absent key is left untouched
// rather than blanked.
const businessSchema = z.object({
  name: z.string().trim().min(1, "Business name is required.").max(160).optional(),
  address: z.string().trim().max(300).optional(),
  website: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  billingEmail: z
    .union([z.literal(""), z.string().trim().email("Enter a valid billing email.").max(200)])
    .optional(),
});

/** Org identity. Manager-gated: a limited role may read the page, never edit it. */
export async function updateBusiness(raw: unknown) {
  const { organizationId } = await requireManager();
  const data = businessSchema.parse(raw);

  const patch: {
    name?: string;
    address?: string | null;
    website?: string | null;
    phone?: string | null;
    billingEmail?: string | null;
  } = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.address !== undefined) patch.address = orNull(data.address) ?? null;
  if (data.website !== undefined) patch.website = orNull(data.website) ?? null;
  if (data.phone !== undefined) patch.phone = orNull(data.phone) ?? null;
  if (data.billingEmail !== undefined) patch.billingEmail = orNull(data.billingEmail) ?? null;

  if (Object.keys(patch).length === 0) return { ok: true };

  await db.organization.update({ where: { id: organizationId }, data: patch });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/* ──────────────────────────── notifications ──────────────────────────── */

// One JSON-as-String column on User. `matrix` is keyed by event with an
// [in-app, email] pair; only keys the app actually produces are kept
// (src/lib/notificationPrefs.ts is the list). Read by the bell feed and by
// every office email sender.
const cellsSchema = z.union([z.tuple([z.boolean(), z.boolean()]), z.tuple([z.boolean(), z.boolean(), z.boolean()])]);
const notificationSchema = z.object({
  // [in-app, email] from the handheld page, [in-app, email, text] from the
  // desk page (2026-09-24). A pair keeps the stored Text cell.
  matrix: z.record(z.string(), cellsSchema),
  // Delivery rules are gone from the page (2026-09-03); the fields stay
  // optional so the stored blob keeps its shape for older readers.
  quietFrom: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
  quietTo: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
  muteWeekends: z.boolean().default(false),
});

/** The signed-in user's own notification matrix. */
export async function updateNotificationPrefs(raw: unknown) {
  const user = await requireUser();
  const data = notificationSchema.parse(raw);
  const stored = await db.user.findUnique({ where: { id: user.id }, select: { notificationPrefsJson: true } });
  const kept = parseNotificationPrefs(stored?.notificationPrefsJson);
  const matrix = mergeMatrixSave(data.matrix, kept);
  // What this page does not show stays as stored: who typed the mobile in, and whether texts are switched off.
  await db.user.update({
    where: { id: user.id },
    data: { notificationPrefsJson: JSON.stringify({ ...data, matrix, smsAddedBy: kept.smsAddedBy ?? null, smsPaused: kept.smsPaused === true }) },
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/* ─────────────────────────────── sessions ────────────────────────────── */

/**
 * "Sign out everywhere": bump the credential epoch. requireUser() compares
 * the JWT's credentialVersion with the row on every request, so every other
 * device's token dies at its next request. The caller then signs THIS browser
 * out through next-auth as usual.
 */
export async function signOutEverywhere() {
  const user = await requireUser();
  await signOutEverywhereFor(user.id);
  return { ok: true };
}

/* ─────────────────────────── delete organization ─────────────────────── */

const deleteOrgSchema = z.object({ confirmName: z.string().max(200) });

/**
 * SOFT delete. Owner-only, and the owner has to type the company name
 * exactly. Order matters: the org is marked deleted FIRST — from that
 * instant requireOrg() and every public surface treat it as gone — then the
 * external side is unwound best-effort (Stripe subscription, Stripe Connect,
 * Square, Gmail). A failure there never resurrects the org; the purge cron
 * (30 days) refuses to hard-delete while a subscription is still live and
 * logs it. Members keep their rows so an admin restore is possible.
 */
export async function deleteOrganization(raw: unknown) {
  const ctx = await requireOwner();
  const { confirmName } = deleteOrgSchema.parse(raw);
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { id: true, name: true, deletedAt: true, subscription: { select: { externalSubId: true } } },
  });
  if (!org) throw new Error("Not found");
  if (org.deletedAt) return { ok: true as const, already: true as const, warnings: [] as string[] };
  if (confirmName.trim() !== org.name) throw new Error("That name doesn't match your company name.");

  await db.organization.update({
    where: { id: org.id },
    data: { deletedAt: new Date(), deletedById: ctx.user.id },
  });

  const warnings: string[] = [];
  if (org.subscription?.externalSubId && isStripeEnabled()) {
    try {
      await releaseAttachedSchedule(getStripe(), org.subscription.externalSubId).catch(() => null);
      const canceled = await getStripe().subscriptions.cancel(org.subscription.externalSubId);
      await markSubscriptionCanceled(canceled);
    } catch (err) {
      console.error("[deleteOrganization] stripe cancel failed", org.id, err);
      warnings.push("stripe-subscription");
    }
  }
  try {
    await disconnectStripeConnectFor(org.id);
  } catch (err) {
    console.error("[deleteOrganization] stripe connect", org.id, err);
    warnings.push("stripe-connect");
  }
  try {
    await disconnectSquareFor(org.id);
  } catch (err) {
    console.error("[deleteOrganization] square", org.id, err);
    warnings.push("square");
  }
  await db.organization.update({ where: { id: org.id }, data: { gmailTokensJson: null } });
  // Every member's next request falls through to another org (or NoOrg).
  await db.user.updateMany({ where: { activeOrgId: org.id }, data: { activeOrgId: null } });
  await db.activityEvent.create({
    data: {
      organizationId: org.id,
      actorId: ctx.user.id,
      kind: ActivityKind.UPDATED,
      summary: `Organization "${org.name}" scheduled for deletion`,
    },
  });
  return { ok: true as const, already: false as const, warnings };
}

/* ───────────────────────────── delete account ────────────────────────── */

const deleteAccountSchema = z.object({ confirmEmail: z.string().trim().max(200) });

/**
 * HARD delete of the signed-in user — a launch-time debugging aid (owner's
 * call, 2026-09-03: create an account, delete it, create the same address
 * again). Nothing is kept and there is no grace period, unlike the org's soft
 * delete above.
 *
 * Order: every organization where this user is the ONLY member is hard-
 * deleted (subscription cancelled and processors disconnected best-effort
 * first; `organization.delete` cascades the rest). In an org that has other
 * members only the membership goes — their data stays, and every optional
 * pointer at this user (proposal owner, lead assignee, message author, …) is
 * nulled so the rows survive. Cross-org trade-network rows that REQUIRE the
 * user are deleted. Then the User row goes; Account / Session / Membership /
 * profile rows cascade.
 */
export async function deleteMyAccount(raw: unknown) {
  const user = await requireUser();
  const { confirmEmail } = deleteAccountSchema.parse(raw);
  if (confirmEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    throw new Error("That doesn't match your email address.");
  }
  const uid = user.id;

  const memberships = await db.membership.findMany({
    where: { userId: uid },
    select: {
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          _count: { select: { memberships: true } },
          subscription: { select: { externalSubId: true } },
        },
      },
    },
  });

  for (const m of memberships) {
    const org = m.organization;
    if (org._count.memberships > 1) continue; // others remain — membership cascades with the user
    if (org.subscription?.externalSubId && isStripeEnabled()) {
      try {
        await releaseAttachedSchedule(getStripe(), org.subscription.externalSubId).catch(() => null);
        const canceled = await getStripe().subscriptions.cancel(org.subscription.externalSubId);
        await markSubscriptionCanceled(canceled);
      } catch (err) {
        console.error("[deleteMyAccount] stripe cancel failed", org.id, err);
      }
    }
    try {
      await disconnectStripeConnectFor(org.id);
    } catch (err) {
      console.error("[deleteMyAccount] stripe connect", org.id, err);
    }
    try {
      await disconnectSquareFor(org.id);
    } catch (err) {
      console.error("[deleteMyAccount] square", org.id, err);
    }
    await db.organization.delete({ where: { id: org.id } });
  }

  // Optional pointers at this user in whatever survived: null them.
  await db.$transaction([
    db.proposal.updateMany({ where: { ownerId: uid }, data: { ownerId: null } }),
    db.lead.updateMany({ where: { assignedToId: uid }, data: { assignedToId: null } }),
    db.lead.updateMany({ where: { claimedById: uid }, data: { claimedById: null } }),
    db.invite.updateMany({ where: { invitedById: uid }, data: { invitedById: null } }),
    db.jobEvent.updateMany({ where: { createdById: uid }, data: { createdById: null } }),
    db.message.updateMany({ where: { authorId: uid }, data: { authorId: null } }),
    db.activityEvent.updateMany({ where: { actorId: uid }, data: { actorId: null } }),
    db.appointment.updateMany({ where: { createdById: uid }, data: { createdById: null } }),
    db.blockedTime.updateMany({ where: { ownerId: uid }, data: { ownerId: null } }),
    // Required pointers (trade network) — the rows go with the user.
    db.tradeJobMessage.deleteMany({ where: { authorId: uid } }),
    db.tradeJobConversation.deleteMany({ where: { OR: [{ authorId: uid }, { recipientId: uid }] } }),
    db.tradeJobRecipient.deleteMany({ where: { recipientId: uid } }),
    db.tradeJob.deleteMany({ where: { authorId: uid } }),
    db.tradeReply.deleteMany({ where: { authorId: uid } }),
    db.tradePost.deleteMany({ where: { authorId: uid } }),
    db.user.delete({ where: { id: uid } }),
  ]);
  return { ok: true as const };
}
