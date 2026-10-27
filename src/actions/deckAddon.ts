"use server";
// THE DECK STUDIO ADD-ON — the buttons (owner, 2026-10-19: "option to add it to the plan"; lib/deckAddonBilling).
// Billing is the owner's, as everywhere: an estimator or a manager in the preview sees the offer and is told the
// owner adds it.

import { revalidatePath } from "next/cache";
import { isOwnerRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { addDeckAddon, deckAddonOffer, deckAddonPick, removeDeckAddon, type DeckAddonOffer, type DeckAddonPick } from "@/lib/deckAddonBilling";
import { deckAddonPriceWords, type AddonInterval } from "@/lib/deckAddon";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { logServerError } from "@/lib/server-events";

export type DeckAddonView = DeckAddonOffer & { owner: boolean };

type Who = { ok: true; organizationId: string; userId: string; owner: boolean } | { ok: false; error: string };

async function who(): Promise<Who> {
  try {
    const ctx = await requireOrg();
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, owner: isOwnerRole(ctx.role) };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Sign in first." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

function revalidateDeck() {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/deck-estimator");
  revalidatePath("/dashboard/subscription");
}

/** What adding it costs this account today, and whether this user can do it. */
export async function getDeckAddonOffer(): Promise<{ ok: true; offer: DeckAddonView } | { ok: false; error: string }> {
  const w = await who();
  if (!w.ok) return w;
  try {
    const offer = await deckAddonOffer(w.organizationId);
    if (!w.owner && offer.canAdd) return { ok: true, offer: { ...offer, owner: false, canAdd: false, reason: "The account owner adds it, from here or from Subscription." } };
    return { ok: true, offer: { ...offer, owner: w.owner } };
  } catch (err) {
    logServerError("deckAddon.offer", err, { kind: "action", organizationId: w.organizationId });
    return { ok: false, error: "Couldn't read your plan. Try again." };
  }
}

/** What the plan cards show for "Add Deck Studio" (owner, 2026-10-26): the box, or the add-on at its own price. */
export async function getDeckAddonPick(): Promise<{ ok: true; pick: DeckAddonPick } | { ok: false; error: string }> {
  const w = await who();
  if (!w.ok) return w;
  try {
    return { ok: true, pick: await deckAddonPick(w.organizationId) };
  } catch (err) {
    logServerError("deckAddon.pick", err, { kind: "action", organizationId: w.organizationId });
    return { ok: false, error: "Couldn't read your plan. Try again." };
  }
}

export type AddDeckStudioResult =
  | { ok: true; chargedCents: number; termCents: number; interval: AddonInterval; trialing: boolean }
  | { ok: false; error: string };

/** Put Deck Studio on the plan: the rest of this period is charged now. Refused in a trial ("Included in your
 *  trial") — nothing is put on the subscription. */
export async function addDeckStudio(): Promise<AddDeckStudioResult> {
  const w = await who();
  if (!w.ok) return w;
  if (!w.owner) return { ok: false, error: "Only the account owner can add to the plan." };
  try {
    const res = await addDeckAddon(w.organizationId);
    if (!res.ok) return { ok: false, error: res.error };
    revalidateDeck();
    if (!res.already) {
      await logActivity({
        organizationId: w.organizationId,
        actorId: w.userId,
        kind: TRAIL_KINDS.SETTINGS,
        summary: `Updated billing settings — Deck Studio added (${deckAddonPriceWords(res.interval)})${res.chargedCents > 0 ? `, $${(res.chargedCents / 100).toFixed(2)} charged` : ""}`,
        meta: { area: "billing", deckAddon: true, chargedCents: res.chargedCents, interval: res.interval },
      }).catch(() => undefined);
    }
    return { ok: true, chargedCents: res.chargedCents, termCents: res.termCents, interval: res.interval, trialing: res.trialing };
  } catch (err) {
    logServerError("deckAddon.add", err, { kind: "action", organizationId: w.organizationId });
    return { ok: false, error: "Couldn't add Deck Studio. Try again." };
  }
}

/** Take it off: the studio is a preview again now; the unused rest of the period is a credit on the next bill. */
export async function removeDeckStudio(): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = await who();
  if (!w.ok) return w;
  if (!w.owner) return { ok: false, error: "Only the account owner can change the plan." };
  try {
    const res = await removeDeckAddon(w.organizationId);
    if (!res.ok) return { ok: false, error: res.error };
    revalidateDeck();
    await logActivity({
      organizationId: w.organizationId,
      actorId: w.userId,
      kind: TRAIL_KINDS.SETTINGS,
      summary: "Updated billing settings — Deck Studio removed",
      meta: { area: "billing", deckAddon: false },
    }).catch(() => undefined);
    return { ok: true };
  } catch (err) {
    logServerError("deckAddon.remove", err, { kind: "action", organizationId: w.organizationId });
    return { ok: false, error: "Couldn't remove Deck Studio. Try again." };
  }
}
