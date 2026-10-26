// THE RAISE'S WORDS, SHARED (2026-10-25): the owner's first draft of the ask (dictated: "$1.5M for contractors joining
// JobFlex, $2.5M for the homeowners portal — advertising, projects sold to the contractors, lead generation") and the
// reading of the saved box. No "server-only" here: the admin panel (a client component) and the link's pages (server)
// both read it. The link shows the saved words, else this draft — the owner asked for the raise on top of the link,
// visible (2026-10-25).
export const RAISE_DRAFT = [
  "Raising $4M seed to grow both sides of JobFlex",
  "$1.5M — contractors: ads in the trades that convert best, AI-desk outreach and onboarding, to put more shops on JobFlex every month",
  "$2.5M — homeowners: advertising that brings homeowners to the JobFlex portal with real projects — roofing, fencing, decks, HVAC, remodeling",
  "Every homeowner project becomes a lead we sell to the contractors on JobFlex — a second revenue line on top of subscriptions",
  "Each request arrives with the job's details and opens straight in our estimators — the contractor prices it and sends a proposal without retyping a thing",
  "The two sides feed each other: more projects make JobFlex worth more to contractors; more contractors answer every homeowner faster",
].join("\n");

/** A box's lines, blank ones dropped. */
export const splitLines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** The raise as the link says it: the saved words, else the owner's draft. The first line is the headline. */
export const askLines = (saved: string): string[] => splitLines(saved.trim() ? saved : RAISE_DRAFT);
