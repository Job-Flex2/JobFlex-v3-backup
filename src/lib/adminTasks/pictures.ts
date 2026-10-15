import "server-only";
// A TASK'S PICTURES (owner, 2026-10-15: "upload the pictures") — server only.
//
// The bytes go to the private store (lib/media/privateStore: the private Blob store when it is set up, this
// machine's disk in development, an inline image until then) under admintasks/<taskId>/; the list is one SyncState
// row per task (no schema change): { id, url, name, by, byName, at }. A page shows a picture only through a
// short signed link (lib/media/signedLink), minted when the task is read. Adding or removing one writes the task's
// journal and moves its updatedAt, so every admin's open list and sheet pick it up through the live poll.
import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deleteStored, putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import type { PictureDTO } from "./model";

type Client = Prisma.TransactionClient | typeof db;

export const PICTURES_PER_TASK = 24;
export const PICTURE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

type Stored = { id: string; url: string; name: string; by: string | null; byName: string; at: string };

const keyOf = (taskId: string) => `admintask:pics:${taskId}`;

function parse(cursor: string | null | undefined): Stored[] {
  if (!cursor) return [];
  try {
    const v = JSON.parse(cursor) as unknown;
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object" && typeof (x as Stored).url === "string" && typeof (x as Stored).id === "string") as Stored[]) : [];
  } catch {
    return [];
  }
}

async function readStored(taskId: string, client: Client = db): Promise<Stored[]> {
  const row = await client.syncState.findUnique({ where: { key: keyOf(taskId) }, select: { cursor: true } }).catch(() => null);
  return parse(row?.cursor);
}

async function writeStored(taskId: string, list: Stored[], client: Client = db): Promise<void> {
  const key = keyOf(taskId);
  if (!list.length) {
    await client.syncState.delete({ where: { key } }).catch(() => null);
    return;
  }
  const cursor = JSON.stringify(list);
  await client.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** The pictures as a page shows them: fresh signed links, oldest first. */
export async function taskPictures(taskId: string, client: Client = db): Promise<PictureDTO[]> {
  return (await readStored(taskId, client)).map((p) => ({ id: p.id, href: mediaHref(p.url) ?? "", name: p.name, by: p.by, byName: p.byName, at: p.at }));
}

/** How many pictures each task has — one read for the whole list. */
export async function pictureCounts(taskIds: readonly string[], client: Client = db): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!taskIds.length) return out;
  const rows = await client.syncState
    .findMany({ where: { key: { in: taskIds.map(keyOf) } }, select: { key: true, cursor: true } })
    .catch(() => [] as Array<{ key: string; cursor: string }>);
  for (const r of rows) out.set(r.key.slice("admintask:pics:".length), parse(r.cursor).length);
  return out;
}

export class PictureError extends Error {}

/** One picture onto a task: stored, listed, journaled, the task touched. */
export async function addTaskPicture(actor: { id: string; name: string }, taskId: string, file: { bytes: Buffer; type: string; name: string }): Promise<void> {
  const task = await db.adminTask.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw new PictureError("This task no longer exists.");
  const type = (file.type || "").toLowerCase();
  if (!IMAGE_TYPES.has(type)) throw new PictureError("Only pictures — JPEG, PNG, WebP, GIF or HEIC.");
  if (!file.bytes.byteLength) throw new PictureError("That file is empty.");
  if (file.bytes.byteLength > PICTURE_MAX_BYTES) throw new PictureError("That picture is too big (8 MB at most).");
  const list = await readStored(taskId);
  if (list.length >= PICTURES_PER_TASK) throw new PictureError(`A task holds ${PICTURES_PER_TASK} pictures at most — remove one first.`);
  const id = randomBytes(6).toString("hex");
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : type.startsWith("image/hei") ? "heic" : "jpg";
  const { url } = await putPrivate(`admintasks/${taskId}/${id}.${ext}`, file.bytes, type);
  const name = (file.name || "picture").replace(/[^\w .()-]/g, "").slice(0, 80) || "picture";
  await db.$transaction(async (tx) => {
    const now = await readStored(taskId, tx);
    await writeStored(taskId, [...now, { id, url, name, by: actor.id, byName: actor.name, at: new Date().toISOString() }], tx);
    await tx.adminTaskEvent.create({ data: { taskId, actorId: actor.id, kind: "PICTURE_ADDED", to: name } });
    await tx.adminTask.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
  });
}

/** A picture off a task: unlisted, its file deleted, journaled, the task touched. */
export async function removeTaskPicture(actor: { id: string }, taskId: string, pictureId: string): Promise<void> {
  const list = await readStored(taskId);
  const pic = list.find((p) => p.id === pictureId);
  if (!pic) throw new PictureError("That picture is already gone.");
  await db.$transaction(async (tx) => {
    await writeStored(taskId, list.filter((p) => p.id !== pictureId), tx);
    await tx.adminTaskEvent.create({ data: { taskId, actorId: actor.id, kind: "PICTURE_REMOVED", from: pic.name } });
    await tx.adminTask.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
  });
  await deleteStored(pic.url).catch(() => null);
}
