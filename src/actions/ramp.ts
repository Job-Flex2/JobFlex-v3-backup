"use server";
// RAMP CARDS — the shop's door (2026-10-29): disconnect, sync now, the switches, the office placing a swipe on a job.
import { requireManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { clearRampConnection, patchRampConnection, rampConnectionView, readRampConnection, type RampView } from "@/lib/ramp/connection";
import { assignRampTransaction, ensureRampField, rampCardSpend, syncRamp, type RampTxRecord } from "@/lib/ramp/sync";

export async function disconnectRamp(): Promise<{ ok: true }> {
  const { organizationId, user } = await requireManager();
  const conn = await readRampConnection(organizationId);
  await clearRampConnection(organizationId);
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Disconnected Ramp${conn?.businessName ? ` (${conn.businessName})` : ""}`, meta: { area: "ramp" } });
  return { ok: true };
}

export async function syncRampNow(): Promise<{ ok: true; booked: number; needsJob: number; updated: number; read: number; view: RampView } | { ok: false; error: string }> {
  const { organizationId } = await requireManager();
  const r = await syncRamp(organizationId);
  if (!r.ok) return r;
  return { ...r, view: await rampConnectionView(organizationId) };
}

export async function setRampSwitches(input: { askByText?: boolean; requireJob?: boolean }): Promise<{ ok: true; view: RampView } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const conn = await patchRampConnection(organizationId, { ...(typeof input.askByText === "boolean" ? { askByText: input.askByText } : {}), ...(typeof input.requireJob === "boolean" ? { requireJob: input.requireJob } : {}) });
  if (!conn) return { ok: false, error: "Ramp is not connected." };
  if (typeof input.requireJob === "boolean") await ensureRampField(organizationId).catch(() => null);
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Ramp: ${[typeof input.askByText === "boolean" ? `ask the job by text ${input.askByText ? "on" : "off"}` : "", typeof input.requireJob === "boolean" ? `the job required on every swipe ${input.requireJob ? "on" : "off"}` : ""].filter(Boolean).join(", ")}`, meta: { area: "ramp" } });
  return { ok: true, view: await rampConnectionView(organizationId) };
}

export async function placeRampTransaction(input: { txId: string; jobId: string | null; stock?: boolean; none?: boolean }): Promise<{ ok: true; where: string } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const txId = (input.txId ?? "").trim().slice(0, 80);
  if (!txId) return { ok: false, error: "No transaction." };
  const to = input.none ? ({ kind: "none" } as const) : input.stock ? ({ kind: "stock" } as const) : input.jobId ? ({ kind: "job", jobId: input.jobId.trim().slice(0, 60) } as const) : null;
  if (!to) return { ok: false, error: "Pick a job, stock, or leave it." };
  return assignRampTransaction(organizationId, txId, to, { userId: user.id, name: user.name?.trim() || user.email || "" });
}

export async function readRampCardSpend(): Promise<{ connected: boolean; needsJob: RampTxRecord[]; recent: RampTxRecord[] }> {
  const { organizationId } = await requireManager();
  const conn = await readRampConnection(organizationId);
  if (!conn) return { connected: false, needsJob: [], recent: [] };
  const spend = await rampCardSpend(organizationId);
  return { connected: true, ...spend };
}
