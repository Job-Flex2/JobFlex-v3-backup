// What JobFlex has on file about a company, for the desk — server only.
import { db } from "@/lib/db";
import { settingsOf } from "@/lib/bookingBook";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { factsFor, type CompanyFacts } from "./profile";

function prettyPhone(raw: string | null): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw?.trim() || null;
}

export async function companyFacts(organizationId: string): Promise<CompanyFacts | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, phone: true, address: true, website: true, timezone: true, slug: true, tradeTypesJson: true, bookingSettingsJson: true },
  });
  if (!org) return null;
  const booking = settingsOf(org);
  return factsFor({
    name: org.name,
    phone: prettyPhone(org.phone),
    address: org.address,
    website: org.website,
    trades: parseTradeTypes(org.tradeTypesJson),
    hours: booking.hours,
    services: booking.services.map((s) => ({ label: s.label, priceText: s.priceText })),
    bookingUrl: booking.enabled ? `https://www.jobflex.app/book/${org.slug}` : null,
    timezone: org.timezone,
  });
}
