"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isLimitedRole, requireManager, requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { putPrivate } from "@/lib/media/privateStore";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { IMAGE_DATA_URL, safeFilename } from "@/lib/safeHref";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { authorizeJobMedia, deleteJobMediaFor, editJobMediaCaption, isJobMediaFile, recordJobMedia } from "@/lib/jobMedia";
import { createJobExpense, deleteJobExpense as deleteExpenseFor } from "@/lib/jobExpenses";

// The expense pair here is the older twin of src/actions/expenses.ts (no
// callers); both now go through lib/jobExpenses so nothing bypasses the
// statuses (stage A, 2026-09-30).
const expenseInput = z.object({
  category: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().optional().nullable(),
});

export async function addJobExpense(jobId: string, raw: unknown) {
  const { organizationId, user, role } = await requireManager();
  const data = expenseInput.parse(raw);
  await createJobExpense({ organizationId, userId: user.id, role }, { jobId, ...data, via: "dashboard" });
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

export async function deleteJobExpense(expenseId: string) {
  const { organizationId, user, role } = await requireManager();
  const { jobId } = await deleteExpenseFor({ organizationId, userId: user.id, role }, expenseId);
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

/**
 * Find (or lazily create) the single Conversation that backs a job's message
 * thread. Job threads are real Conversations with `jobId` set, so they appear on
 * /dashboard/messages alongside every other thread, with resolved author names.
 */
async function getOrCreateJobConversation(job: {
  id: string;
  organizationId: string;
  title: string;
}) {
  const existing = await db.conversation.findUnique({ where: { jobId: job.id } });
  if (existing) return existing;
  // JOB kind (like ensureJobConversation): auto job threads are a side effect
  // of the job, not a user-started conversation, so they don't consume the
  // conversationsStarted quota.
  return db.conversation.create({
    data: { organizationId: job.organizationId, jobId: job.id, kind: "JOB", title: job.title },
  });
}

export async function postJobMessage(jobId: string, body: string) {
  const { organizationId, user } = await requireManager();
  const trimmed = body.trim();
  if (!trimmed) return;
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.organizationId !== organizationId) throw new Error("Not found");
  await enforcePlanLimit(organizationId, "messagesSent");

  const conversation = await getOrCreateJobConversation(job);
  await db.message.create({
    data: { conversationId: conversation.id, authorId: user.id, body: trimmed },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/messages");
}

const photoInput = z.object({
  url: z.string().url(),
  kind: z.enum(["BEFORE", "PROGRESS", "AFTER"]).default("BEFORE"),
  caption: z.string().optional().nullable(),
});

// Photo writes are OPEN TO THE CREW (2026-08-21, owner request): a manager may
// photograph any org job, a limited role (installer/sales/estimator) only a
// job they are assigned to. Everything else in this file stays manager-only —
// expenses and deletes are office work.
async function requireJobPhotoAccess(jobId: string) {
  const { organizationId, user, role } = await requireOrg();
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.organizationId !== organizationId) throw new Error("Not found");
  if (isLimitedRole(role)) {
    const assigned = await db.jobAssignment.findFirst({
      where: { jobId, worker: { userId: user.id } },
      select: { id: true },
    });
    if (!assigned) throw new Error("You can only add photos to jobs assigned to you");
  }
  return { organizationId, user, job };
}

export async function createJobPhoto(jobId: string, raw: unknown) {
  const { organizationId, user, job } = await requireJobPhotoAccess(jobId);
  const data = photoInput.parse(raw);
  // Only a file in this job's own folder, or an inline picture: a stored
  // address of another company's file is not "a photo" (security audit 1.1).
  if (!isJobMediaFile(data.url, jobId)) throw new Error("That file is not in this job's folder.");
  const photo = await db.jobPhoto.create({
    data: {
      jobId,
      url: data.url,
      kind: data.kind,
      caption: data.caption ?? null,
    },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.PHOTO,
    summary: `Added a ${data.kind.toLowerCase()} photo to ${job.title}`,
    proposalId: job.proposalId,
    clientId: job.clientId,
    meta: { jobId, photoId: photo.id, kind: data.kind },
  });
}

/** Delete a file: the office any, a worker their own (stage A, 2026-09-30). */
export async function deleteJobPhoto(photoId: string) {
  const { organizationId, user, role } = await requireOrg();
  const { jobId } = await deleteJobMediaFor({ organizationId, userId: user.id, role }, photoId);
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

/** A new caption on a file: the office any, a worker their own; leaves the "edited" mark. */
export async function editJobPhotoCaption(photoId: string, caption: string | null) {
  const { organizationId, user, role } = await requireOrg();
  const row = await editJobMediaCaption({ organizationId, userId: user.id, role }, photoId, caption);
  revalidatePath(`/dashboard/jobs/${row.jobId}`);
  return { id: row.id, caption: row.caption, editedAt: row.editedAt?.toISOString() ?? null };
}

/**
 * uploadJobPhoto — called from the client with a data URL (base64).
 * If Vercel Blob is configured, push to Blob; otherwise persist the data URL inline
 * so the demo keeps working with zero external dependencies. (A video, and a
 * photo through the store, go straight from the browser: api/jobs/media.)
 */
export async function uploadJobPhoto(
  jobId: string,
  dataUrl: string,
  filename: string,
  kind: "BEFORE" | "PROGRESS" | "AFTER" = "BEFORE",
) {
  const caller = await authorizeJobMedia(jobId, null);
  if (!caller) throw new Error("You can only add photos to jobs assigned to you");

  // Inline image only — anything else would be stored verbatim as the photo
  // URL and rendered by every viewer of the job.
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match || !IMAGE_DATA_URL.test(dataUrl)) throw new Error("Photo must be an image");

  // The private store, the local fallback, or — production before the store
  // exists — the data URL on the row, as before (lib/media/privateStore).
  const buf = Buffer.from(match[2], "base64");
  const { url } = await putPrivate(`jobs/${jobId}/${Date.now()}-${safeFilename(filename, "photo")}`, buf, match[1].toLowerCase());
  // The row, the trail row that names it, and the office's note (lib/jobMedia).
  const photo = await recordJobMedia({ caller, url, kind, meta: { media: "photo", contentType: match[1].toLowerCase(), bytes: buf.byteLength, name: filename }, via: "dashboard" });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { id: photo.id, url };
}
