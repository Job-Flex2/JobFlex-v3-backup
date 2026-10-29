// WISETACK FINANCING — the application arrives filled in with what JobFlex already knows about the business (the
// owner: "make it super smart where they can set it up and get the approval"). Pure: the service and the check share
// it. The private parts — owner identity, tax id, bank — are typed on Wisetack's secure page, never here.

import type { MerchantPrefill } from "./provider";
import type { OrgFinancing } from "./state";

export type PrefillOrg = {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  billingEmail: string | null;
  tradeTypesJson: string | null;
};
export type PrefillOwner = { name: string | null; email: string | null } | null;

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** "12 Main St, Provo, UT 84601" → its parts; anything else stays whole in line1. */
export function parseAddress(raw: string | null): MerchantPrefill["address"] {
  const s = clean(raw);
  if (!s) return { line1: null, city: null, state: null, zip: null };
  const m = s.match(/^(.*?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return { line1: s, city: null, state: null, zip: null };
  return { line1: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] };
}

function website(raw: string | null): string | null {
  const s = clean(raw);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function firstTrade(json: string | null): string | null {
  if (!json) return null;
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) && typeof list[0] === "string" && list[0].trim() ? list[0].trim() : null;
  } catch {
    return null;
  }
}

export function merchantPrefill(org: PrefillOrg, owner: PrefillOwner, rec: OrgFinancing, returnUrl: string): MerchantPrefill {
  return {
    reference: org.id,
    businessName: org.name,
    phone: clean(org.phone),
    email: clean(org.billingEmail) ?? clean(owner?.email),
    website: website(org.website),
    address: parseAddress(org.address),
    trade: firstTrade(org.tradeTypesJson),
    ownerName: clean(owner?.name),
    ownerEmail: clean(owner?.email),
    yearStarted: rec.yearStarted,
    returnUrl,
  };
}

/** The readiness list's facts (lib/financing/state readiness). */
export function readinessFacts(org: PrefillOrg, owner: PrefillOwner, rec: OrgFinancing) {
  return {
    name: clean(org.name),
    phone: clean(org.phone),
    email: clean(org.billingEmail) ?? clean(owner?.email),
    address: clean(org.address),
    website: website(org.website),
    trade: firstTrade(org.tradeTypesJson),
    yearStarted: rec.yearStarted,
  };
}
