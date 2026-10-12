// E.164 for Twilio. Client.phone is free text ("(555) 123-4567"); sendSMS
// refuses anything but +1XXXXXXXXXX. US/Canada only: ten digits, or eleven
// starting with 1. Anything else → null, and the caller skips the text.
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

// The +1 area codes that are NOT the United States or Canada (2026-10-12):
// the Caribbean and Atlantic members of the North American plan, billed by
// Twilio as international, plus 900 premium-rate. US territories (Puerto
// Rico, the Virgin Islands, Guam …) stay: they are the United States.
const NON_US_CA_AREA_CODES = new Set([
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721",
  "758", "767", "784", "809", "829", "849", "868", "869", "876", "900",
]);

/** True for a US or Canadian number in E.164 (+1, a real area code and exchange). */
export function isUsCanadaNumber(e164: string | null | undefined): boolean {
  const m = /^\+1([2-9]\d{2})([2-9]\d{2})\d{4}$/.exec(e164 ?? "");
  return !!m && !NON_US_CA_AREA_CODES.has(m[1]);
}
