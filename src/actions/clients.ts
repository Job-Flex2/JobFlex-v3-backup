"use server";
import { z } from "zod";
import { requireSalesOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

// Tight client shape returned to the v3 builder. Matches the columns the
// inline create/edit form writes; ignore notes/customFields/tags for now.
export type ClientRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

const CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zip: true,
} as const;

// Empty strings come back from form inputs; normalise to null so we don't
// store "" alongside real values.
const trimOrNull = z
  .string()
  .optional()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t.length === 0 ? null : t;
  });

// Notes is the one column that must survive a form that does not carry it.
// Every other field is written by every caller, so `undefined -> null` is a
// correct erase; notes is edited from the client record only, and the inline
// builder sheet never sends it. Returning `undefined` for an absent key makes
// Prisma SKIP the column instead of blanking what somebody typed elsewhere.
const notesInput = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v.trim() || null));

const clientInput = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: trimOrNull,
  phone: trimOrNull,
  address: trimOrNull,
  city: trimOrNull,
  state: trimOrNull,
  zip: trimOrNull,
  notes: notesInput,
});

export type ClientInput = z.infer<typeof clientInput>;

// VIP isn't a Client column — it's modeled as an org-scoped "VIP" Tag. Kept out
// of `clientInput` so it can never be spread into db.client.create.
const createClientInput = clientInput.extend({ vip: z.boolean().optional() });

export async function createClient(raw: unknown): Promise<ClientRecord> {
  const { organizationId, user } = await requireSalesOrManager();
  const { vip, ...data } = createClientInput.parse(raw);
  // Plan cap on live client records (absolute scope) — throws PLAN_LIMIT_MESSAGE
  // like every other gated create so the builder raises its limit dialog.
  await enforcePlanLimit(organizationId, "clients");
  const created = await db.client.create({
    data: { organizationId, ...data },
    select: CLIENT_SELECT,
  });
  if (vip) {
    // Upsert the org's VIP tag (unique on [organizationId, label]), then link it.
    const tag = await db.tag.upsert({
      where: { organizationId_label: { organizationId, label: "VIP" } },
      update: {},
      create: { organizationId, label: "VIP", color: "#1f7a52" },
    });
    await db.clientTag.create({ data: { clientId: created.id, tagId: tag.id } });
  }
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Added client ${created.name}${created.address ? ` at ${created.address}` : ""}${vip ? " (VIP)" : ""}`,
    clientId: created.id,
    meta: { vip: !!vip },
  });
  return created;
}

/**
 * Set a client's email and nothing else.
 *
 * The manual builder's "Save & send" needs an address on the RECORD — the
 * sheet's contact row is display state and never reaches the database, so a
 * send against a client with no stored email silently went nowhere and still
 * reported success. `updateClient` cannot serve this: it parses a COMPLETE
 * client input, and the builder only holds the street line of a client's
 * address (the loader splits it on "
"), so round-tripping the record through
 * it would truncate the rest. One column, one write.
 */
export async function setClientEmail(id: string, rawEmail: unknown) {
  const { organizationId, user } = await requireSalesOrManager();
  const email = z.string().trim().email("Enter a valid email address").parse(rawEmail);
  const existing = await db.client.findUnique({
    where: { id },
    select: { organizationId: true, deletedAt: true, name: true },
  });
  if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
    throw new Error("Client not found");
  }
  await db.client.update({ where: { id }, data: { email } });
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Set ${existing.name}'s email to ${email}`,
    clientId: id,
    meta: { field: "email" },
  });
  return { email };
}

/**
 * The email and phone typed on a proposal's client card, onto the client record
 * (owner, 2026-10-13: an email typed on a roof proposal never reached the send).
 * A blank field leaves the record's value alone — the card never erases.
 */
export async function saveClientContact(id: string, raw: unknown) {
  const { organizationId, user } = await requireSalesOrManager();
  const input = z
    .object({
      email: z.string().trim().email("Enter a valid email address").optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .parse(raw);
  const existing = await db.client.findUnique({
    where: { id },
    select: { organizationId: true, deletedAt: true, name: true, email: true, phone: true },
  });
  if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
    throw new Error("Client not found");
  }
  const data: { email?: string; phone?: string } = {};
  if (input.email && input.email.toLowerCase() !== (existing.email ?? "").trim().toLowerCase()) data.email = input.email;
  if (input.phone && input.phone !== (existing.phone ?? "").trim()) data.phone = input.phone;
  if (!data.email && !data.phone) return { email: existing.email, phone: existing.phone };
  await db.client.update({ where: { id }, data });
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Set ${existing.name}'s ${[data.email ? `email to ${data.email}` : "", data.phone ? `phone to ${data.phone}` : ""].filter(Boolean).join(" and ")} (from a proposal)`,
    clientId: id,
    meta: { fields: Object.keys(data), from: "proposal" },
  });
  return { email: data.email ?? existing.email, phone: data.phone ?? existing.phone };
}

export async function updateClient(
  id: string,
  raw: unknown,
): Promise<ClientRecord> {
  const { organizationId, user } = await requireSalesOrManager();
  const existing = await db.client.findUnique({
    where: { id },
    select: { organizationId: true, deletedAt: true, name: true },
  });
  if (
    !existing ||
    existing.organizationId !== organizationId ||
    existing.deletedAt
  ) {
    throw new Error("Client not found");
  }
  const data = clientInput.parse(raw);
  const updated = await db.client.update({
    where: { id },
    data,
    select: CLIENT_SELECT,
  });
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.CLIENT,
    summary:
      existing.name !== updated.name
        ? `Updated client ${existing.name} (now ${updated.name})`
        : `Updated client ${updated.name}`,
    clientId: id,
  });
  return updated;
}
