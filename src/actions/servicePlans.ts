"use server";

// SERVICE PLANS — THE ACTIONS (2026-09-22). What the plans page, the client
// page and the public accept page call. Owner, manager or estimator for the
// shop's side; the accept action is public and keyed by the plan's token.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager, requireRouteAccess } from "@/lib/orgContext";
import { activatePlan, cancelPlan, markPlanInvoicePaid, markVisitDone, renewPlan, sendPlan } from "@/lib/servicePlanBook";
import { STARTER_PLANS, type Billing } from "@/lib/servicePlans";
import { enforceRateLimit, clientIp, MINUTE } from "@/lib/rateLimit";

const PAGE = "/dashboard/service-plans";
function refresh(clientId?: string | null) {
  revalidatePath(PAGE);
  revalidatePath("/dashboard/calendar");
  if (clientId) revalidatePath("/dashboard/client-detail");
}

const templateInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(600).optional().nullable(),
  visitsPerYear: z.coerce.number().int().min(0).max(12),
  termMonths: z.coerce.number().int().min(1).max(60),
  priceDollars: z.coerce.number().min(0).max(100000),
  billing: z.enum(["MONTHLY", "YEARLY"]),
  discountPct: z.coerce.number().int().min(0).max(100),
  benefits: z.string().max(2000).optional().nullable(),
  priorityScheduling: z.coerce.boolean().optional(),
  waivedDiagnostic: z.coerce.boolean().optional(),
});

function fromForm(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string") o[k] = v;
  });
  return o;
}

/** A plan the shop sells, new or edited. Form-driven. */
export async function saveServicePlanTemplate(fd: FormData): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/service-plans");
  const raw = fromForm(fd);
  const data = templateInput.parse({ ...raw, priorityScheduling: raw.priorityScheduling === "on", waivedDiagnostic: raw.waivedDiagnostic === "on", description: raw.description || null });
  const benefits = (data.benefits ?? "").split("\n").map((s) => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 12);
  const values = {
    name: data.name,
    description: data.description ?? null,
    visitsPerYear: data.visitsPerYear,
    termMonths: data.termMonths,
    priceCents: Math.round(data.priceDollars * 100),
    billing: data.billing,
    discountPct: data.discountPct,
    benefitsJson: JSON.stringify(benefits),
    priorityScheduling: !!data.priorityScheduling,
    waivedDiagnostic: !!data.waivedDiagnostic,
  };
  if (data.id) {
    await db.servicePlanTemplate.updateMany({ where: { id: data.id, organizationId }, data: values });
  } else {
    const n = await db.servicePlanTemplate.count({ where: { organizationId } });
    await db.servicePlanTemplate.create({ data: { ...values, organizationId, sortOrder: n + 1 } });
  }
  refresh();
}

export async function archiveServicePlanTemplate(id: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/service-plans");
  await db.servicePlanTemplate.updateMany({ where: { id, organizationId }, data: { active: false } });
  refresh();
}

/** The three starter plans, once. */
export async function seedStarterPlans(): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/service-plans");
  const have = await db.servicePlanTemplate.count({ where: { organizationId } });
  if (!have) {
    await db.servicePlanTemplate.createMany({
      data: STARTER_PLANS.map((p) => ({ organizationId, name: p.name, description: p.description ?? null, trade: p.trade, visitsPerYear: p.visitsPerYear, termMonths: p.termMonths, priceCents: p.priceCents, billing: p.billing, discountPct: p.discountPct, benefitsJson: JSON.stringify(p.benefits), priorityScheduling: p.priorityScheduling, waivedDiagnostic: p.waivedDiagnostic, sortOrder: p.sortOrder })),
    });
  }
  refresh();
}

/**
 * A client is enrolled: the plan is a snapshot of the template's terms,
 * DRAFT until it is sent or activated. From the plans page (a form with
 * clientId + templateId) or the client page (bound).
 */
export async function enrollClientInPlan(input: { clientId: string; templateId: string; send?: boolean; activate?: boolean } | FormData): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail", "/dashboard/service-plans");
  const raw = input instanceof FormData ? { clientId: String(input.get("clientId") ?? ""), templateId: String(input.get("templateId") ?? ""), send: input.get("then") === "send", activate: input.get("then") === "activate" } : input;
  const data = z.object({ clientId: z.string().min(1), templateId: z.string().min(1), send: z.boolean().optional(), activate: z.boolean().optional() }).parse(raw);
  const [client, t] = await Promise.all([
    db.client.findFirst({ where: { id: data.clientId, organizationId, deletedAt: null }, select: { id: true, address: true, city: true, state: true, zip: true } }),
    db.servicePlanTemplate.findFirst({ where: { id: data.templateId, organizationId } }),
  ]);
  if (!client || !t) return;
  const open = await db.servicePlan.findFirst({ where: { organizationId, clientId: client.id, status: { in: ["DRAFT", "SENT", "ACTIVE"] } }, select: { id: true } });
  if (open) {
    refresh(client.id);
    return;
  }
  const plan = await db.servicePlan.create({
    data: {
      organizationId,
      templateId: t.id,
      clientId: client.id,
      name: t.name,
      description: t.description,
      trade: t.trade,
      visitsPerYear: t.visitsPerYear,
      termMonths: t.termMonths,
      priceCents: t.priceCents,
      billing: t.billing as Billing,
      discountPct: t.discountPct,
      benefitsJson: t.benefitsJson,
      priorityScheduling: t.priorityScheduling,
      waivedDiagnostic: t.waivedDiagnostic,
      propertyAddress: [client.address, client.city, [client.state, client.zip].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(", ") || null,
    },
    select: { id: true },
  });
  if (data.activate) await activatePlan(plan.id, { actorId: user.id });
  else if (data.send) await sendPlan(plan.id, user.id);
  refresh(client.id);
}

export async function sendServicePlan(planId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail", "/dashboard/service-plans");
  const plan = await db.servicePlan.findFirst({ where: { id: planId, organizationId }, select: { clientId: true } });
  if (!plan) return;
  await sendPlan(planId, user.id);
  refresh(plan.clientId);
}

/** Signed on paper or by phone: the plan starts today. */
export async function activateServicePlan(planId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail", "/dashboard/service-plans");
  const plan = await db.servicePlan.findFirst({ where: { id: planId, organizationId }, select: { clientId: true } });
  if (!plan) return;
  await activatePlan(planId, { acceptedName: "Signed with the office", actorId: user.id });
  refresh(plan.clientId);
}

export async function renewServicePlan(planId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail", "/dashboard/service-plans");
  const plan = await db.servicePlan.findFirst({ where: { id: planId, organizationId }, select: { clientId: true } });
  if (!plan) return;
  await renewPlan(planId, user.id);
  refresh(plan.clientId);
}

export async function cancelServicePlan(planId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/client-detail", "/dashboard/service-plans");
  const plan = await db.servicePlan.findFirst({ where: { id: planId, organizationId }, select: { clientId: true } });
  if (!plan) return;
  await cancelPlan(planId, user.id);
  refresh(plan.clientId);
}

export async function setPlanAutoRenew(planId: string, autoRenew: boolean): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/service-plans");
  await db.servicePlan.updateMany({ where: { id: planId, organizationId }, data: { autoRenew } });
  refresh();
}

export async function completePlanVisit(visitId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/service-plans");
  await markVisitDone(visitId, organizationId, user.id);
  refresh();
}

export async function markServicePlanInvoicePaid(invoiceId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/service-plans");
  await markPlanInvoicePaid(invoiceId, organizationId, "CHECK", user.id);
  refresh();
  revalidatePath("/dashboard/financials");
}

/**
 * PUBLIC. The client accepts on /plan/[token]: the typed name is the
 * signature; the plan starts today. Rate-limited per address like the
 * homeowner form. Lands back on the same page, which now shows the membership.
 */
export async function acceptServicePlanPublic(token: string, fd: FormData): Promise<void> {
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
  const t = String(token ?? "").trim();
  if (!t || name.length < 2) redirect(`/plan/${encodeURIComponent(t)}?err=name` as Route);
  await enforceRateLimit(`plan-accept:${await clientIp()}`, 10, 10 * MINUTE, "accepts");
  const plan = await db.servicePlan.findUnique({ where: { acceptToken: t }, select: { id: true, status: true, clientId: true } });
  if (!plan) redirect("/plan/missing" as Route);
  if (plan.status === "DRAFT" || plan.status === "SENT") {
    await activatePlan(plan.id, { acceptedName: name });
    refresh(plan.clientId);
  }
  redirect(`/plan/${encodeURIComponent(t)}?accepted=1` as Route);
}
