"use server";

// EQUIPMENT ON FILE AND VISIT REPORTS — THE ACTIONS (2026-09-23). The
// client page's equipment panel and the visit page's report form. The
// nameplate photo is read by actions/hvacEstimator readHvacNameplate.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager, requireRouteAccess } from "@/lib/orgContext";
import { EQUIPMENT_KINDS, type VisitKind } from "@/lib/equipment";
import { saveVisitReport, sendVisitReport } from "@/lib/visitBook";

const KINDS = EQUIPMENT_KINDS.map((k) => k.kind) as [string, ...string[]];
const equipmentInput = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1),
  kind: z.enum(KINDS),
  label: z.string().trim().max(80).optional().nullable(),
  brand: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  serial: z.string().trim().max(80).optional().nullable(),
  tons: z.coerce.number().min(0).max(60).optional().nullable(),
  refrigerant: z.string().trim().max(20).optional().nullable(),
  fuel: z.string().trim().max(20).optional().nullable(),
  yearMade: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  filterSize: z.string().trim().max(40).optional().nullable(),
  location: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(600).optional().nullable(),
  source: z.enum(["typed", "nameplate", "estimator", "visit"]).optional(),
});

function fromForm(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string") o[k] = v.trim() === "" ? null : v;
  });
  return o;
}

/** A unit on file, typed or read off a nameplate. Form-driven. */
export async function saveClientEquipment(fd: FormData): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail");
  const data = equipmentInput.parse(fromForm(fd));
  const client = await db.client.findFirst({ where: { id: data.clientId, organizationId, deletedAt: null }, select: { id: true } });
  if (!client) return;
  const values = { kind: data.kind, label: data.label ?? null, brand: data.brand ?? null, model: data.model ?? null, serial: data.serial ?? null, tons: data.tons ?? null, refrigerant: data.refrigerant ?? null, fuel: data.fuel ?? null, yearMade: data.yearMade ?? null, filterSize: data.filterSize ?? null, location: data.location ?? null, notes: data.notes ?? null, source: data.source ?? "typed" };
  if (data.id) await db.clientEquipment.updateMany({ where: { id: data.id, organizationId, clientId: client.id }, data: values });
  else await db.clientEquipment.create({ data: { ...values, organizationId, clientId: client.id } });
  revalidatePath("/dashboard/client-detail");
}

export async function deleteClientEquipment(id: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail");
  await db.clientEquipment.deleteMany({ where: { id, organizationId } });
  revalidatePath("/dashboard/client-detail");
}

/** The crew's report on a visit; workers write it too (their own visits). Form-driven. */
export async function saveVisitReportForm(fd: FormData): Promise<void> {
  const { organizationId, user } = await requireRouteAccess("/dashboard/visits");
  const appointmentId = String(fd.get("appointmentId") ?? "");
  const kind = String(fd.get("kind") ?? "both") as VisitKind;
  if (!appointmentId || !["cooling", "heating", "both", "other"].includes(kind)) return;
  const readings: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (k.startsWith("r_") && typeof v === "string" && v.trim()) readings[k.slice(2)] = v;
  });
  await saveVisitReport({
    appointmentId,
    organizationId,
    techName: String(fd.get("techName") ?? "") || null,
    kind,
    readings,
    techFindings: String(fd.get("findings") ?? "") || null,
    recommendations: String(fd.get("recommendations") ?? "") || null,
    summary: String(fd.get("summary") ?? "") || null,
  });
  revalidatePath(`/dashboard/visits/${appointmentId}`);
  if (fd.get("then") === "send") {
    await sendVisitReport(appointmentId, organizationId, user.id);
    revalidatePath("/dashboard/service-plans");
    revalidatePath("/dashboard/hvac-estimator/service-desk");
    revalidatePath("/dashboard/calendar");
  }
}
