import "server-only";
// WHO MAY USE THE DECK STUDIO (owner-locked 2026-10-20, CLAUDE.md; the rule is lib/editions hasEdition): the free
// trial, the $45/month add-on, a complimentary grant and a platform admin (hasFullAccess) get the whole studio;
// every other account previews it. The page, the print sheets and every server action ask this one function.
import { hasFullAccess } from "@/lib/fullAccess";
import { editionFacts } from "@/lib/editionAccess";
import { editionLevel, type EditionLevel } from "@/lib/editions";

/**
 * HOW FAR THE STUDIO OPENS TO THIS USER: "full" — saving, sending and printing included; "preview" — the studio
 * designs and saves nothing, and a saved deck opens to look at and print; "none" — the studio is coming soon. The
 * design-time actions ask for "preview" or better, every save for "full".
 */
export async function deckStudioAccess(user: { id: string; email?: string | null }, organizationId?: string | null): Promise<EditionLevel> {
  if (!organizationId) return "none";
  try {
    return editionLevel(await editionFacts(organizationId, user.id), "deck");
  } catch {
    // The plan could not be read: the admin's rule still answers; everyone else waits for the next read.
    return (await hasFullAccess(organizationId, user.id).catch(() => false)) ? "full" : "none";
  }
}

/** The whole studio — saving, sending and printing included (deckStudioAccess "full"). */
export async function canUseDeckEstimator(user: { id: string; email?: string | null }, organizationId?: string | null): Promise<boolean> {
  return (await deckStudioAccess(user, organizationId)) === "full";
}

/** The studio to design in: the whole of it, or its preview. */
export async function canDesignDeck(user: { id: string; email?: string | null }, organizationId?: string | null): Promise<boolean> {
  return (await deckStudioAccess(user, organizationId)) !== "none";
}
