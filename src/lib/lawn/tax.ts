// SALES TAX ON LAWN WORK, BY STATE (2026-10-18, from each state's own guidance — see the research note in the plan).
// Some states tax mowing and lawn care as a service (TX, NY, CT, PA, OH, IA, WI, WA, KY, DC, MN, NJ, SD, HI's general
// excise, NM's gross receipts); most don't. Installing — mulch, plants, sod — is taxed apart: NY treats it as a capital
// improvement (exempt with the form), PA leaves new lawns, trees and shrubs untaxed, MN calls it construction (the
// contractor pays tax on the materials), AZ taxes installation (prime contracting) though not mowing. Where a state
// doesn't tax the work, the contractor pays tax on the materials it buys, so nothing is added for the client. Pure.

export const SERVICE_TAXED = new Set(["TX", "NY", "CT", "PA", "OH", "IA", "WI", "WA", "KY", "DC", "MN", "NJ", "SD", "HI", "NM"]);
export const INSTALL_TAXED = new Set(["TX", "CT", "OH", "IA", "WI", "WA", "KY", "DC", "NJ", "AZ", "HI", "NM", "SD"]);

export function lawnTaxed(state: string | null | undefined, cls: "service" | "install"): boolean {
  if (!state) return false;
  const s = state.toUpperCase();
  return cls === "service" ? SERVICE_TAXED.has(s) : INSTALL_TAXED.has(s);
}

export function taxWords(state: string | null | undefined): string {
  if (!state) return "Sales tax: not added — the state isn't known.";
  const s = state.toUpperCase();
  const svc = SERVICE_TAXED.has(s);
  const ins = INSTALL_TAXED.has(s);
  if (svc && ins) return `${s} taxes lawn care and landscape installation alike.`;
  if (svc) return `${s} taxes lawn care; installation (mulch, plants, sod) is not taxed to the client${s === "NY" ? " as a capital improvement (keep form ST-124)" : ""}.`;
  if (ins) return `${s} doesn't tax lawn care; installation (mulch, plants, sod) is taxed.`;
  return `${s} doesn't tax lawn care or landscape installation to the client — the company pays tax on what it buys.`;
}
