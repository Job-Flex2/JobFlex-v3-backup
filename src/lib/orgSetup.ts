// "Has this workspace been set up?" — the one rule behind the Google-signup
// company step. A password signup cannot reach the app without step 2 (address
// + at least one trade — what the Lead Center matches on). A Google signup is
// provisioned in the auth callback with a placeholder org, so the same two
// facts decide whether it still owes that step.
//
// 2026-10-10: only a PLACEHOLDER-named org ("Jamie's workspace") owes that
// step. The passwordless sign-up creates a shop under the owner's own name
// with no address and, without a landing trade, no trades — it goes on to the
// dashboard, which asks for the rest (lib/orgName, lib/leadSetup), not back
// to a company form. Callers that pass no name keep the old rule.
export function needsCompanySetup(org: {
  address: string | null;
  tradeTypesJson: string | null;
  name?: string | null;
}): boolean {
  if (org.name !== undefined && !isPlaceholderOrgName(org.name)) return false;
  let trades: unknown = [];
  try {
    trades = JSON.parse(org.tradeTypesJson ?? "[]");
  } catch {
    trades = [];
  }
  const hasTrade = Array.isArray(trades) && trades.length > 0;
  return !org.address?.trim() && !hasTrade;
}

/** The placeholder name the Google provisioning writes ("Jamie's workspace"). */
export function isPlaceholderOrgName(name: string | null | undefined): boolean {
  return !name || /['’]s workspace$/i.test(name.trim()) || name.trim() === "My workspace";
}

export const SETUP_PATH = "/auth/register?setup=1";
