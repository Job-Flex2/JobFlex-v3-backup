"use server";

// THE JOB FOLDER'S DOORS (2026-10-03, lib/home/files). The homeowner's side is
// public like the dashboard — the key and the request's token are the
// authorization; the shop's side is the session. Each carries its own brake.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { isBlobEnabled, uploadBlob } from "@/lib/sdk/blob";
import { findClientForLead } from "@/lib/leadClient";
import { parseProposalPhotos } from "@/components/v3/proposals-c/types";
import { MAX_INLINE_PHOTO_BYTES, fileSize, isImageType } from "@/lib/jobMediaShared";
import { isPrivateFileUnder, kindOfUrl, readStoredAsDataUrl, storageMode } from "@/lib/media/privateStore";
import { deleteStoredUnlessReferenced } from "@/lib/media/ownedFiles";
import { IMAGE_DATA_URL } from "@/lib/safeHref";
import { FOLDER_MAX_FILES, FOLDER_TYPES, contractorFolder, homeownerFolder, mediaOfType, orgMayReadFolder, tellHomeownerFilesAsked, tellShopFilesAdded } from "@/lib/home/files";

export type HomeFilesResult = { ok: true; note: string; id?: string } | { ok: false; error: string };

async function brake(k: string, max: number, what: string): Promise<string | null> {
  try {
    await enforceRateLimit(k, max, HOUR, what);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return err.message;
    throw err;
  }
}

const registerInput = z.object({
  key: z.string().min(8).max(200),
  token: z.string().min(8).max(200),
  /** The stored URL the upload came back with (private blob or local:). */
  url: z.string().min(8).max(2000),
  name: z.string().trim().min(1).max(160),
  contentType: z.string().trim().min(3).max(100),
  bytes: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
  /** Set with the last file of a batch: how many arrived, so the shop hears once. */
  notify: z.object({ count: z.number().int().positive() }).optional(),
});

/** A file the browser put in the store itself is recorded on the request. */
export async function registerHomeFile(raw: unknown): Promise<HomeFilesResult> {
  const data = registerInput.parse(raw);
  const door = await homeownerFolder(data.key, data.token);
  if (!door) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-file:${door.home.id}`, 120, "files");
  if (braked) return { ok: false, error: braked };
  const type = data.contentType.toLowerCase();
  if (!FOLDER_TYPES.includes(type)) return { ok: false, error: "Pictures, videos and PDFs only." };
  // Only a file under this request's own folder in the store is accepted —
  // the browser names what it uploaded, never what it would like to claim.
  if (!isPrivateFileUnder(data.url, `home/${door.home.id}/${door.lead.id}/`)) return { ok: false, error: "That file isn't in this project's folder." };
  return record(door, { url: data.url, name: data.name, contentType: type, bytes: data.bytes, note: data.note ?? null }, data.notify ?? null);
}

const inlineInput = z.object({
  key: z.string().min(8).max(200),
  token: z.string().min(8).max(200),
  dataUrl: z.string().min(32).max(6 * 1024 * 1024),
  name: z.string().trim().min(1).max(160),
  note: z.string().trim().max(500).optional(),
  notify: z.object({ count: z.number().int().positive() }).optional(),
});

/** Production before the file store exists: a small picture rides as a data URL. */
export async function uploadHomeFileInline(raw: unknown): Promise<HomeFilesResult> {
  const data = inlineInput.parse(raw);
  const door = await homeownerFolder(data.key, data.token);
  if (!door) return { ok: false, error: "This link is not valid." };
  const braked = await brake(`home-file:${door.home.id}`, 120, "files");
  if (braked) return { ok: false, error: braked };
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(data.dataUrl);
  if (!m || !isImageType(m[1].toLowerCase())) return { ok: false, error: "Without file storage only pictures go through — the office can switch storage on." };
  const bytes = Math.floor((m[2].length * 3) / 4);
  if (bytes > MAX_INLINE_PHOTO_BYTES) return { ok: false, error: `That picture is ${fileSize(bytes)} — the limit without file storage is ${fileSize(MAX_INLINE_PHOTO_BYTES)}.` };
  return record(door, { url: data.dataUrl, name: data.name, contentType: m[1].toLowerCase(), bytes, note: data.note ?? null }, data.notify ?? null);
}

async function record(door: NonNullable<Awaited<ReturnType<typeof homeownerFolder>>>, f: { url: string; name: string; contentType: string; bytes: number; note: string | null }, notify: { count: number } | null): Promise<HomeFilesResult> {
  const count = await db.homeFile.count({ where: { platformLeadId: door.lead.id, deletedAt: null } });
  if (count >= FOLDER_MAX_FILES) return { ok: false, error: `This project's folder holds ${FOLDER_MAX_FILES} files — remove one first.` };
  const media = mediaOfType(f.contentType);
  const row = await db.homeFile.create({
    data: { homeId: door.home.id, platformLeadId: door.lead.id, organizationId: door.lead.matchedOrgId, url: f.url, name: f.name, contentType: f.contentType, bytes: f.bytes, media, note: f.note, uploadedBy: "HOMEOWNER" },
  });
  // The shop's open ask is answered by what just arrived.
  await db.homeFileRequest.updateMany({ where: { platformLeadId: door.lead.id, fulfilledAt: null }, data: { fulfilledAt: new Date() } }).catch(() => null);
  if (notify) await tellShopFilesAdded(door.lead, door.home, notify.count, media, f.note);
  return { ok: true, id: row.id, note: door.lead.matchedOrgId ? "Added — your contractor can see it." : "Added — it's in the folder for whoever takes the project." };
}

/** The homeowner removes a file of theirs. */
export async function deleteHomeFile(raw: unknown): Promise<HomeFilesResult> {
  const data = z.object({ key: z.string().min(8).max(200), id: z.string().min(1).max(60) }).parse(raw);
  const home = await db.home.findUnique({ where: { accessToken: data.key }, select: { id: true } });
  if (!home) return { ok: false, error: "This link is not valid." };
  const file = await db.homeFile.findFirst({ where: { id: data.id, homeId: home.id, deletedAt: null } });
  if (!file) return { ok: true, note: "Already gone." };
  await db.homeFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
  await deleteStoredUnlessReferenced(file.url).catch(() => null);
  return { ok: true, note: "Removed." };
}

// ── the shop's side ─────────────────────────────────────────────────────

/** "Could you send pictures of …" — asked from the lead; the homeowner gets an email and a row on their dashboard. */
export async function requestHomeFiles(raw: unknown): Promise<HomeFilesResult> {
  const data = z.object({ leadId: z.string().min(1).max(60), note: z.string().trim().max(500).optional() }).parse(raw);
  const { organizationId, user } = await requireOrg();
  const door = await contractorFolder(organizationId, data.leadId);
  if (!door) return { ok: false, error: "This lead has no homeowner dashboard to ask on." };
  const braked = await brake(`home-ask:${door.pl.id}`, 6, "requests");
  if (braked) return { ok: false, error: braked };
  await db.homeFileRequest.create({ data: { homeId: door.home.id, platformLeadId: door.pl.id, organizationId, note: data.note || null, requestedById: user.id } });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const project = `${door.pl.detectedTrade ?? door.pl.projectType ?? "project"}${door.pl.city ? ` in ${door.pl.city}` : ""}`;
  await tellHomeownerFilesAsked(door.home, org?.name ?? "Your contractor", project, data.note || null, door.pl.accessToken ?? "");
  revalidatePath(`/dashboard/leads/${data.leadId}`);
  return { ok: true, note: `Asked — ${door.home.name.split(" ")[0]} gets an email and a note on their dashboard.` };
}

/** A picture from the folder goes on a proposal as a "before" photo — copied,
 *  the folder keeps the original. The public store when the server has it,
 *  else inline (small pictures only). */
export async function attachHomeFileToProposal(raw: unknown): Promise<HomeFilesResult> {
  const data = z.object({ fileId: z.string().min(1).max(60), proposalId: z.string().min(1).max(60) }).parse(raw);
  const { organizationId } = await requireOrg();
  const file = await db.homeFile.findFirst({ where: { id: data.fileId, deletedAt: null } });
  if (!file) return { ok: false, error: "That file is gone." };
  if (!(await orgMayReadFolder(organizationId, file.platformLeadId))) return { ok: false, error: "Not your folder." };
  if (file.media !== "photo") return { ok: false, error: "Only pictures go on a proposal — download the video or the PDF instead." };
  // The picture is read from the store only when it lives in this request's
  // own folder (or rides inline) — the same rule the homeowner's upload met
  // (security audit 1.1, 2026-10-12).
  if (!IMAGE_DATA_URL.test(file.url) && !isPrivateFileUnder(file.url, `home/${file.homeId}/${file.platformLeadId}/`)) return { ok: false, error: "That file isn't in this project's folder." };
  const proposal = await db.proposal.findFirst({ where: { id: data.proposalId, organizationId }, select: { id: true, beforePhotos: true } });
  if (!proposal) return { ok: false, error: "That proposal isn't yours." };
  const dataUrl = kindOfUrl(file.url) === "data" ? file.url : await readStoredAsDataUrl(file.url, 8 * 1024 * 1024);
  if (!dataUrl) return { ok: false, error: "Couldn't read the picture from the store." };
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return { ok: false, error: "Couldn't read the picture." };
  let url = dataUrl;
  if (isBlobEnabled()) {
    const res = await uploadBlob(`proposals/${proposal.id}/before/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80)}`, Buffer.from(m[2], "base64"), { contentType: m[1] });
    url = res.url;
  } else if (Buffer.byteLength(m[2], "base64") > MAX_INLINE_PHOTO_BYTES) {
    return { ok: false, error: `Without the public file store a proposal picture must be under ${fileSize(MAX_INLINE_PHOTO_BYTES)} — download it and shrink it first.` };
  }
  const next = [...parseProposalPhotos(proposal.beforePhotos), { id: randomUUID(), url, caption: file.note ?? undefined }];
  await db.proposal.update({ where: { id: proposal.id }, data: { beforePhotos: JSON.stringify(next) } });
  const mode = storageMode();
  void mode;
  revalidatePath("/dashboard/proposals");
  return { ok: true, note: "On the proposal as a before photo." };
}

/** The proposals a shop could put a picture on: this client's, newest first. */
export async function proposalsForLeadFolder(leadId: string): Promise<Array<{ id: string; title: string; status: string }>> {
  const { organizationId } = await requireOrg();
  const door = await contractorFolder(organizationId, leadId);
  if (!door) return [];
  const client = await findClientForLead(organizationId, { email: door.lead.email, phone: door.lead.phone });
  if (!client) return [];
  const rows = await db.proposal.findMany({ where: { organizationId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, status: true } });
  return rows;
}
