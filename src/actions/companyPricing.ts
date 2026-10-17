"use server";
// Settings → Estimating (2026-10-16): the company's own estimating method for Smart Proposal and the video estimator
// (lib/estimate/companyPricing). Anyone who estimates may read it — the screens say how an estimate was priced; an
// owner or manager sets it.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { isLimitedRole, requireManager, requireOrg } from "@/lib/orgContext";
import { cleanCompanyPricing, companyPricingKey, type CompanyPricing } from "@/lib/estimate/companyPricing";
import { readCompanyPricing } from "@/lib/estimate/companyPricingServer";

export async function loadCompanyPricing(): Promise<{ pricing: CompanyPricing; canEdit: boolean }> {
  const ctx = await requireOrg();
  return { pricing: await readCompanyPricing(ctx.organizationId), canEdit: !isLimitedRole(ctx.role) };
}

export async function saveCompanyPricing(raw: unknown): Promise<{ ok: true; pricing: CompanyPricing } | { ok: false; error: string }> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireManager());
  } catch {
    return { ok: false, error: "Only an owner or manager can change this." };
  }
  const pricing = cleanCompanyPricing(raw);
  if (pricing.on && pricing.laborRate <= 0) return { ok: false, error: "Enter your labor rate before turning this on." };
  const key = companyPricingKey(organizationId);
  const cursor = JSON.stringify(pricing);
  try {
    await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  } catch {
    return { ok: false, error: "Couldn't save just now. Try again in a moment." };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, pricing };
}
