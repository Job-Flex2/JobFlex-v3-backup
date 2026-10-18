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
import { accountDeletionPlan, removeUserRow, retireOrganization, unwindOrganization } from "@/lib/accountDeletion";
import { refusal, refused, type ActionResult } from "@/lib/actionResult";

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
// Messages are the half after "Business name: " — `refusal` adds the label.
const businessSchema = z.object({
  name: z.string().trim().min(1, "required.").max(160, "160 characters at most.").optional(),
  address: z.string().trim().max(300, "300 characters at most.").optional(),
  website: z.string().trim().max(200, "200 characters at most.").optional(),
  phone: z.string().trim().max(40, "40 characters at most.").optional(),
  billingEmail: z
    .union([z.literal(""), z.string().trim().email("enter a valid address, like name@company.com.").max(200, "200 characters at most.")])
    .optional(),
});
const BUSINESS_LABELS = { name: "Business name", address: "Address", website: "Website", phone: "Phone", billingEmail: "Billing email" };

/** Org identity. Manager-gated: a limited role may read the page, never edit it.
 *  A wrong field comes back as a refusal the card's save bar prints — thrown,
 *  the ZodError reached the page as a 500 (QA F-1f3f6da5). */
export async function updateBusiness(raw: unknown): Promise<ActionResult> {
  const { organizationId } = await requireManager();
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) return refusal(parsed.error, BUSINESS_LABELS);
  const data = parsed.data;

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
 * exactly. The rules (marked deleted first, then the subscription cancelled
 * and the processors disconnected best-effort, the purge cron 30 days on)
 * live in lib/accountDeletion retireOrganization — the admin's Delete account
 * takes a company down the same way.
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

  const warnings = await retireOrganization(
    { id: org.id, name: org.name, externalSubId: org.subscription?.externalSubId ?? null },
    ctx.user.id,
    "deleteOrganization",
  );
  return { ok: true as const, already: false as const, warnings };
}

/* ───────────────────────────── delete account ────────────────────────── */

const deleteAccountSchema = z.object({ confirmEmail: z.string().trim().max(200) });

/**
 * HARD delete of the signed-in user — a launch-time debugging aid (owner's
 * call, 2026-09-03: create an account, delete it, create the same address
 * again).
 *
 * Which companies go with the account is lib/accountDeletion's plan, the same
 * one the admin's Delete account follows: a company where nobody else would
 * be an owner goes. One where this user is the ONLY member is hard-deleted at
 * once, as before (subscription cancelled and processors disconnected first;
 * `organization.delete` cascades the rest). One that still has other members
 * is soft-deleted (retireOrganization) — until 2026-10-17 it was left behind
 * with no owner and its subscription still billing the departed owner's card.
 * Where another owner remains, only the membership goes. Then the User row
 * goes (removeUserRow).
 *
 * The mismatch comes back as a refusal: a thrown message never reaches a
 * production page.
 */
export async function deleteMyAccount(raw: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const { confirmEmail } = deleteAccountSchema.parse(raw);
  if (confirmEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return refused("That doesn't match your email address.");
  }
  const uid = user.id;

  for (const fate of await accountDeletionPlan(uid)) {
    if (!fate.deletesOrg) continue; // others remain — the membership cascades with the user
    const externalSubId = fate.subscription?.externalSubId ?? null;
    if (fate.memberCount > 1) {
      await retireOrganization({ id: fate.orgId, name: fate.orgName, externalSubId }, uid, "deleteMyAccount");
      continue;
    }
    await unwindOrganization(fate.orgId, externalSubId, "deleteMyAccount");
    await db.organization.delete({ where: { id: fate.orgId } });
  }

  await removeUserRow(uid);
  return { ok: true };
}
