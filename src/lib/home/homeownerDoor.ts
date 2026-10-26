// THE HOMEOWNER'S DOOR ON A CONTRACTOR PAGE (owner, 2026-10-16). A trade ad is for contractors, but homeowners click
// it too — a Facebook fence ad's visitor pressed "Start my free fence takeoff", met the contractor sign-up, and went
// looking for the homeowner page. One quiet line on the trade's landing and its sign-up sends them to /homeowner,
// where their project is already started in their words ("I'm looking for a fence."), and becomes a request the Lead
// Center routes to a local pro.
//
// Pure: the landing (client), the sign-up form and the homeowner page (server) read it.

/** What a homeowner looks for, per trade — the words after "Homeowner looking for". */
const THINGS: Record<string, string> = {
  fencing: "a fence",
  roofing: "a new roof or a roof repair",
  decking: "a deck",
  painting: "painters",
  siding: "new siding",
  concrete: "concrete work",
  landscaping: "landscaping",
  flooring: "new floors",
  tile: "tile work",
  plumbing: "a plumber",
  electrical: "an electrician",
  hvac: "heating or cooling work",
  drywall: "drywall work",
  windows: "new windows or doors",
  countertops: "new countertops",
  carpentry: "a carpenter",
  insulation: "insulation",
  demolition: "demolition",
  "kitchen-bath": "a kitchen or bath remodel",
  "general-contractor": "a contractor",
};

/** "Fencing", "fencing", "Kitchen & Bath", "kitchen-bath", "General Contractor", "HVAC" → the key, or null. */
export function homeTradeKey(trade: string | null | undefined): string | null {
  const k = String(trade ?? "")
    .toLowerCase()
    .replace(/&/g, " ")
    .trim()
    .replace(/[^a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return k && THINGS[k] ? k : null;
}

/** The line's words and where it leads, for a trade — null for a page with no trade (it stays as it was). */
export function homeownerDoorFor(trade: string | null | undefined): { key: string; thing: string; href: string } | null {
  const key = homeTradeKey(trade);
  return key ? { key, thing: THINGS[key], href: `/homeowner?project=${encodeURIComponent(key)}` } : null;
}

/** The first words of the homeowner's request when they came through the door: "I'm looking for a fence. " —
 *  "… a fence in Dallas, TX. " when a cost guide names the city (the caller checks the place). */
export function projectStarter(project: string | null | undefined, place?: string | null): string {
  const key = homeTradeKey(project);
  return key ? `I'm looking for ${THINGS[key]}${place ? ` in ${place}` : ""}. ` : "";
}
