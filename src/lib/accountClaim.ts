// AN ADDRESS NOBODY PROVED YET (2026-10-15, lib/signupAutoPlan). The short sign-up with a card skips the email code
// — the card at Stripe is the proof a real person is signing up — so the account's address is unproven, marked
// `quickUnclaimed:<userId>`. The first sign-in that DOES prove the address (Google vouching for it, a code from that
// inbox) claims the account: every other session ends (credentialVersion, as a password reset does) and the address
// is marked confirmed. Someone who signed up with another person's address keeps nothing once the owner arrives.
import { db } from "@/lib/db";

export const quickUnclaimedKey = (userId: string) => `quickUnclaimed:${userId}`;

/** Mark a new account whose address was not proven at sign-up. */
export async function markUnclaimed(client: Pick<typeof db, "syncState">, userId: string): Promise<void> {
  await client.syncState.upsert({ where: { key: quickUnclaimedKey(userId) }, create: { key: quickUnclaimedKey(userId), cursor: new Date().toISOString() }, update: {} });
}

/** A sign-in proved the address: claim the account if it was waiting for that. True when it was. Never throws. */
export async function claimIfUnclaimed(userId: string): Promise<boolean> {
  try {
    const { count } = await db.syncState.deleteMany({ where: { key: quickUnclaimedKey(userId) } });
    if (!count) return false;
    await db.user.update({ where: { id: userId }, data: { emailVerified: new Date(), credentialVersion: { increment: 1 } } });
    return true;
  } catch (err) {
    console.warn("[accountClaim] claim failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Still waiting for its address to be proven. */
export async function isUnclaimed(userId: string): Promise<boolean> {
  return Boolean(await db.syncState.findUnique({ where: { key: quickUnclaimedKey(userId) }, select: { key: true } }).catch(() => null));
}
