// PHOTOS AND VIDEOS OF THE WORK (2026-09-27) — server. Both doors, one record.
//
// A file reaches a job through the worker portal (a token) or the dashboard
// (a session). `authorizeJobMedia` answers "may this caller add to this job"
// for either; `recordJobMedia` writes the row, the trail and — after the
// response — the office's text and bell note. The file itself either came
// straight from the phone to the store (api/jobs/media/token) or, without a
// store, as a data URL (the older routes), which these helpers do not care
// about: they take a URL.
//
// Stage A (2026-09-30): the row also carries who uploaded it, the day on site
// it belongs to (the day open on the job today), and the media / type / size
// as columns; the analysis JSON marker stays for the older readers. A worker
// may edit the caption of, or delete, their own file (an edit leaves the
// "edited" mark); the office any file.

import { db } from "@/lib/db";
import { afterResponse } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { isJobBlobUrl, mediaMetaJson, type MediaKind, type MediaMeta } from "@/lib/jobMediaShared";
import { openDayOf } from "@/lib/workDays";
import { isPrivateJobFile } from "@/lib/media/privateStore";
import { deleteStoredUnlessReferenced } from "@/lib/media/ownedFiles";
import { IMAGE_DATA_URL } from "@/lib/safeHref";

/** A file a client names for this job: one in the job's own folder in the
 *  store (private, or the older public one), or an inline picture — never
 *  another company's stored file (security audit 1.1, 2026-10-12). */
export function isJobMediaFile(url: string, jobId: string): boolean {
  return isPrivateJobFile(url, "jobs", jobId) || isJobBlobUrl(url, jobId) || IMAGE_DATA_URL.test(url);
}

export interface MediaCaller {
  organizationId: string;
  userId: string;
  workerId: string | null;
  name: string;
  job: { id: string; title: string; proposalId: string | null; clientId: string | null };
}

/**
 * Who is adding to this job. A worker token names a worker profile, which
 * must hold a live assignment; a session names a member — a manager may add
 * to any job of the company, a limited role only to a job they are on.
 */
export async function authorizeJobMedia(jobId: string, token: string | null | undefined): Promise<MediaCaller | null> {
  if (token) {
    const worker = await db.workerProfile.findUnique({ where: { token }, select: { id: true, userId: true, organizationId: true, displayName: true } });
    if (!worker) return null;
    const assigned = await db.jobAssignment.findFirst({
      where: { jobId, workerId: worker.id, job: { organizationId: worker.organizationId }, status: { not: "DECLINED" } },
      select: { job: { select: { id: true, title: true, proposalId: true, clientId: true } } },
    });
    if (!assigned) return null;
    return { organizationId: worker.organizationId, userId: worker.userId, workerId: worker.id, name: worker.displayName, job: assigned.job };
  }
  let ctx: { organizationId: string; user: { id: string; name?: string | null; email?: string | null }; role: string };
  try {
    ctx = (await requireOrg()) as typeof ctx;
  } catch {
    return null;
  }
  return authorizeJobMediaFor({ organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role, name: ctx.user.name?.trim() || ctx.user.email || null }, jobId);
}

/** The session door, with the member given (the dashboard's actions and the QA). */
export async function authorizeJobMediaFor(actor: { organizationId: string; userId: string; role: string; name?: string | null }, jobId: string): Promise<MediaCaller | null> {
  const job = await db.job.findFirst({ where: { id: jobId, organizationId: actor.organizationId }, select: { id: true, title: true, proposalId: true, clientId: true } });
  if (!job) return null;
  const wp = await db.workerProfile.findUnique({ where: { userId: actor.userId }, select: { id: true, displayName: true } });
  if (isLimitedRole(actor.role)) {
    if (!wp) return null;
    const assigned = await db.jobAssignment.findFirst({ where: { jobId, workerId: wp.id, status: { not: "DECLINED" } }, select: { id: true } });
    if (!assigned) return null;
  }
  const name = wp?.displayName || actor.name || "A member";
  return { organizationId: actor.organizationId, userId: actor.userId, workerId: wp?.id ?? null, name, job };
}

/** The row, the trail row that names it, and the office's note. */
export async function recordJobMedia(input: {
  caller: MediaCaller;
  url: string;
  kind: MediaKind;
  meta: MediaMeta;
  caption?: string | null;
  via: "worker-portal" | "dashboard";
  /** A day being closed late ("2026-09-29"): the file hangs on that day, if it is not closed yet. */
  workDate?: string | null;
}): Promise<{ id: string; workDayId: string | null }> {
  const { caller, url, kind, meta, via } = input;
  // The day on site the file belongs to: the one named (a day being closed
  // late), else the one open on the job today.
  const day = input.workDate
    ? await db.workDay
        .findFirst({ where: { organizationId: caller.organizationId, jobId: caller.job.id, date: input.workDate, status: { not: "CLOSED" } }, select: { id: true, date: true, dayNumber: true } })
        .catch(() => null)
    : await openDayOf(caller.organizationId, caller.job.id).catch(() => null);
  const row = await db.jobPhoto.create({
    data: {
      jobId: caller.job.id,
      url,
      kind,
      caption: input.caption?.trim() || null,
      analysis: mediaMetaJson(meta),
      uploadedById: caller.userId,
      workDayId: day?.id ?? null,
      media: meta.media,
      contentType: meta.contentType ?? null,
      bytes: typeof meta.bytes === "number" ? Math.round(meta.bytes) : null,
    },
  });
  const what = meta.media === "video" ? "video" : "photo";
  const tag = kind.toLowerCase();
  await logActivity({
    organizationId: caller.organizationId,
    actorId: caller.userId,
    kind: TRAIL_KINDS.PHOTO,
    summary: `Uploaded ${/^[aeiou]/.test(tag) ? "an" : "a"} ${tag} ${what} to ${caller.job.title}`,
    proposalId: caller.job.proposalId,
    clientId: caller.job.clientId,
    meta: { jobId: caller.job.id, photoId: row.id, kind, media: meta.media, via, ...(day ? { workDayId: day.id, day: day.dayNumber } : {}) },
  });
  afterResponse(async () => {
    const { notifyJobMedia } = await import("@/lib/notify");
    await notifyJobMedia(caller.job.id, { userId: caller.userId, name: caller.name }, meta.media);
  });
  return { id: row.id, workDayId: day?.id ?? null };
}

export interface MediaActor {
  organizationId: string;
  userId: string;
  /** The membership role, or "WORKER_TOKEN" through the portal. */
  role: string;
}

async function ownedOrOffice(actor: MediaActor, photoId: string) {
  const p = await db.jobPhoto.findFirst({
    where: { id: photoId, job: { organizationId: actor.organizationId } },
    include: { job: { select: { title: true, proposalId: true, clientId: true } }, workDay: { select: { id: true, status: true, note: true, _count: { select: { photos: true } } } } },
  });
  if (!p) throw new Error("Not found");
  const office = !isLimitedRole(actor.role) && actor.role !== "WORKER_TOKEN";
  if (!office && p.uploadedById !== actor.userId) throw new Error("You can only change your own photos and videos");
  return p;
}

/** A new caption on a file — the office's, or the uploader's own. Leaves the "edited" mark. */
export async function editJobMediaCaption(actor: MediaActor, photoId: string, caption: string | null) {
  const p = await ownedOrOffice(actor, photoId);
  const row = await db.jobPhoto.update({ where: { id: photoId }, data: { caption: caption?.trim().slice(0, 500) || null, editedAt: new Date() } });
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.PHOTO,
    summary: `Edited the caption of a ${p.kind.toLowerCase()} ${p.media === "video" ? "video" : "photo"} on ${p.job.title}`,
    proposalId: p.job.proposalId,
    clientId: p.job.clientId,
    meta: { jobId: p.jobId, photoId, kind: p.kind, edited: true },
  });
  return row;
}

/** Delete a file — the office's, or the uploader's own. The last file of a
 *  closed day that has no note stays: the day was closed on it. */
export async function deleteJobMediaFor(actor: MediaActor, photoId: string): Promise<{ jobId: string }> {
  const p = await ownedOrOffice(actor, photoId);
  if (p.workDay && p.workDay.status === "CLOSED" && !p.workDay.note?.trim() && p.workDay._count.photos <= 1) {
    throw new Error("This is the only file of a closed day with no note — add a note to the day first.");
  }
  await db.jobPhoto.delete({ where: { id: photoId } });
  // The file goes with its row (stage B): the private store, the local
  // fallback or the older public store — a data URL has nothing to remove.
  // Not while another row still names the same file (lib/media/ownedFiles).
  await deleteStoredUnlessReferenced(p.url);
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.PHOTO,
    summary: `Deleted a ${p.kind.toLowerCase()} ${p.media === "video" ? "video" : "photo"} from ${p.job.title}`,
    proposalId: p.job.proposalId,
    clientId: p.job.clientId,
    meta: { jobId: p.jobId, photoId, kind: p.kind, deleted: true },
  });
  return { jobId: p.jobId };
}

/** A job's files for this actor: the office any job's, a worker only a job they are on. */
export async function listJobMediaFor(actor: MediaActor & { name?: string | null }, jobId: string) {
  const caller = actor.role === "WORKER_TOKEN"
    ? await (async () => {
        const wp = await db.workerProfile.findFirst({ where: { userId: actor.userId, organizationId: actor.organizationId }, select: { id: true } });
        if (!wp) return null;
        const a = await db.jobAssignment.findFirst({ where: { jobId, workerId: wp.id, status: { not: "DECLINED" } }, select: { id: true } });
        return a ? { ok: true } : null;
      })()
    : await authorizeJobMediaFor(actor, jobId);
  if (!caller) return null;
  return db.jobPhoto.findMany({ where: { jobId }, orderBy: { createdAt: "desc" } });
}
