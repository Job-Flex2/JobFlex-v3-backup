// The company behind a booking page, for its public texting pages (2026-10-12): the terms, the privacy policy and the
// opt-in picture Twilio is given when JobFlex registers the company's own texting number (lib/sms/registrationShared).
import { db } from "@/lib/db";
import { parseRegistration } from "@/lib/sms/registrationShared";

export type SmsCompany = { name: string; phone: string | null; slug: string; email: string | null };

/** The email the company chose to list on its booking page with its texting registration (showEmail), or null. */
export async function listedEmail(organizationId: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key: `smsreg:${organizationId}` }, select: { cursor: true } }).catch(() => null);
  const d = parseRegistration(row?.cursor).details;
  return d?.showEmail && d.contactEmail ? d.contactEmail : null;
}

export async function smsCompany(slug: string): Promise<SmsCompany | null> {
  const org = await db.organization
    .findFirst({ where: { slug, deletedAt: null }, select: { id: true, name: true, phone: true, slug: true } })
    .catch(() => null);
  if (!org) return null;
  // No street address on these public pages: a contractor working from home may not want it shown, and Twilio checks
  // the address against the EIN and state records, not against the website.
  return { name: org.name?.trim() || "This company", phone: org.phone?.trim() || null, slug: org.slug, email: await listedEmail(org.id) };
}

/** "(425) 555-0177" from whatever was stored. */
export function phoneWords(phone: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

export const SMS_PAGES_UPDATED = "October 12, 2026";
