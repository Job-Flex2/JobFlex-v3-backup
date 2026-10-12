"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireRouteAccess } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { relative } from "@/lib/format";
import { ApplicantStatus } from "@/lib/prismaEnums";

// The pipeline's row shape used to live in the blueprint hire page's data
// module; that page was rebuilt as the Hire & Work marketplace (2026-09-03) and
// no longer renders applicants, so the shape lives with the actions that own it.
export type HireColumnKey = "APPLIED" | "INTERVIEWING" | "HIRED" | "REJECTED";

export type Applicant = {
  /** The real `Applicant.id` (cuid). */
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: HireColumnKey;
  source: string | null;
  /** Relative "applied" plate — `relative(createdAt)` from @/lib/format. */
  age: string;
  notes: string;
  resumeUrl?: string | null;
};

const applicantInput = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  role: z.string().min(1),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  resumeUrl: z.string().optional().nullable(),
  status: z.enum([
    ApplicantStatus.APPLIED,
    ApplicantStatus.INTERVIEWING,
    ApplicantStatus.HIRED,
    ApplicantStatus.REJECTED,
  ]).default(ApplicantStatus.APPLIED),
});

export async function createApplicant(raw: unknown) {
  const { organizationId } = await requireManager();
  const data = applicantInput.parse(raw);
  const a = await db.applicant.create({
    data: {
      organizationId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
      role: data.role,
      source: data.source ?? null,
      notes: data.notes ?? null,
      resumeUrl: data.resumeUrl ?? null,
      status: data.status,
    },
  });
  revalidatePath("/dashboard/hire");
  return { id: a.id };
}

const statusSchema = z.enum([
  ApplicantStatus.APPLIED,
  ApplicantStatus.INTERVIEWING,
  ApplicantStatus.HIRED,
  ApplicantStatus.REJECTED,
]);

export async function updateApplicantStatus(id: string, next: string) {
  const { organizationId } = await requireManager();
  const status = statusSchema.parse(next);
  const a = await db.applicant.findUnique({ where: { id } });
  if (!a || a.organizationId !== organizationId) throw new Error("Not found");
  if (a.status === status) return { ok: true, unchanged: true };
  await db.applicant.update({ where: { id }, data: { status } });
  revalidatePath("/dashboard/hire");
  revalidatePath(`/dashboard/hire/${id}`);
  return { ok: true };
}

export async function appendApplicantNote(id: string, text: string) {
  const { organizationId } = await requireManager();
  const a = await db.applicant.findUnique({ where: { id } });
  if (!a || a.organizationId !== organizationId) throw new Error("Not found");
  const stamped = `${new Date().toISOString().slice(0, 16).replace("T", " ")} — ${text}`;
  const next = a.notes ? `${a.notes}\n\n${stamped}` : stamped;
  await db.applicant.update({ where: { id }, data: { notes: next } });
  revalidatePath(`/dashboard/hire/${id}`);
}

export async function convertApplicantToWorker(id: string) {
  const { organizationId } = await requireManager();
  const a = await db.applicant.findUnique({ where: { id } });
  if (!a || a.organizationId !== organizationId) throw new Error("Not found");
  const { createWorkerInvite } = await import("./workers");
  const invited = await createWorkerInvite({
    name: a.fullName,
    email: a.email,
    phone: a.phone,
    specialties: a.role ? [a.role] : [],
  });
  if (!invited.ok) return { ok: false, error: invited.error };
  await db.applicant.update({ where: { id }, data: { status: ApplicantStatus.HIRED } });
  revalidatePath("/dashboard/hire");
  revalidatePath("/dashboard/workers");
  return { ok: true };
}

/** `Applicant.status` is a plain String column; anything unrecognised lands in
 *  the first column rather than vanishing off the board. */
const COLUMN_KEYS = ["APPLIED", "INTERVIEWING", "HIRED", "REJECTED"] as const;
function asColumn(v: string): HireColumnKey {
  return (COLUMN_KEYS as readonly string[]).includes(v) ? (v as HireColumnKey) : "APPLIED";
}

/** Read-only: the org's applicant pipeline in the exact shape the hire
 *  surfaces render — the desktop /dashboard/hire page and the mobile twin both
 *  seed their boards from this one query. */
export async function getHireSeed(): Promise<Applicant[]> {
  // Applicants' names, emails and phones: the Hire page's people only.
  const { organizationId } = await requireRouteAccess("/dashboard/hire");
  const rows = await db.applicant.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.fullName,
    email: a.email,
    phone: a.phone,
    role: a.role,
    status: asColumn(a.status),
    source: a.source,
    age: relative(a.createdAt),
    notes: a.notes ?? "",
    resumeUrl: a.resumeUrl,
  }));
}

export async function deleteApplicant(id: string) {
  const { organizationId } = await requireManager();
  const a = await db.applicant.findUnique({ where: { id } });
  if (!a || a.organizationId !== organizationId) throw new Error("Not found");
  await db.applicant.delete({ where: { id } });
  revalidatePath("/dashboard/hire");
}
