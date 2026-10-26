// What the intake wizard is handed when a homeowner starts a project from
// their home dashboard (2026-10-03): the contact fields already filled, the
// dashboard's key so the request joins it, and the plan it fulfils. Plain
// types — read by the client wizards and written by lib/home/portal.
export type WizardPrefill = {
  name: string;
  email: string;
  phone: string;
  address: string;
  zip: string;
  homeKey: string;
  planId: string | null;
  /** The plan's title and notes, as the first words of the description. */
  description: string;
  /** Where the request was started, when a page says ("seo:<work>:<city>" from a cost guide) — kept with the lead. */
  source?: string;
};

/** The browser's zone, for a new home's reminders; "" when it cannot say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
