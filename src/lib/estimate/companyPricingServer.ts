// The company's own estimating method, read on the server (lib/estimate/companyPricing). SyncState
// `companyPricing:<org>` — no schema change.
import { db } from "@/lib/db";
import { companyPricingKey, parseCompanyPricing, type CompanyPricing } from "./companyPricing";

export async function readCompanyPricing(organizationId: string): Promise<CompanyPricing> {
  const row = await db.syncState.findUnique({ where: { key: companyPricingKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  return parseCompanyPricing(row?.cursor);
}
