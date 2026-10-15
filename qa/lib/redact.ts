// Nothing secret leaves a test: every string that goes into raw.json, a report, a log line or a
// model prompt passes through redact(). Passwords, tokens, cookies and one-time codes become •••.
const MASK = "•••";

/** Exact values to mask wherever they appear: the QA secrets this process knows. */
function knownSecrets(): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 6) continue;
    if (/^QA_(PASS_|SECRET$)|^ANTHROPIC_API_KEY$|_SECRET$|_TOKEN$|PASSWORD$/.test(k)) out.push(v);
  }
  return out.sort((a, b) => b.length - a.length);
}
let secrets: string[] | null = null;
const extra = new Set<string>();
/** A value a test learned at run time (a fetched code, a minted token) that must be masked too. */
export function addSecret(value: string | null | undefined): void {
  if (value && value.length >= 4) extra.add(value);
}

// query parameters that carry a capability (a link someone could open) or a credential
const SECRET_PARAMS = /([?&#](?:k|key|token|secret|signup|d|code|otp|session|session_id|sig|signature|access_token|refresh_token|id_token|auth|password|pw|state|invite)=)[^&#\s"'<>]+/gi;

const PATTERNS: [RegExp, string][] = [
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, "$1_$2_" + MASK],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, "whsec_" + MASK],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-" + MASK],
  [/\bcs_(live|test)_[A-Za-z0-9]{8,}/g, "cs_$1_" + MASK],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK], // JWT
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 " + MASK],
  [/((?:set-)?cookie["']?\s*[:=]\s*["']?)[^\n"']+/gi, "$1" + MASK],
  [/((?:authjs|next-auth|__Secure-authjs|__Host-authjs)\.[a-z-]+(?:\.\d+)?=)[^;\s"']+/gi, "$1" + MASK],
  [/(["']?(?:password|passwd|pass|hashedPassword|secret|otp|code|token|apiKey|api_key)["']?\s*[:=]\s*["']?)[^"',\s}&]{3,}/gi, "$1" + MASK],
  [/(x-qa-secret["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1" + MASK],
  [/\b(\d{3})[- ]?(\d{3})\b(?=[^\n]{0,40}\b(code|otp)\b)/gi, MASK], // a 6-digit code next to the word "code"
];

export function redact(input: string): string;
export function redact(input: string | null | undefined): string | null | undefined;
export function redact(input: string | null | undefined): string | null | undefined {
  if (input == null) return input;
  let s = String(input);
  if (!secrets) secrets = knownSecrets();
  for (const v of [...secrets, ...extra]) if (v && s.includes(v)) s = s.split(v).join(MASK);
  s = s.replace(SECRET_PARAMS, "$1" + MASK);
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s;
}

/** Deep copy of a JSON-able value with every string redacted. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /^(password|passwd|otp|code|token|secret|cookie|cookies|authorization|storageState)$/i.test(k) && typeof v === "string" ? MASK : redactDeep(v);
    }
    return out as T;
  }
  return value;
}
