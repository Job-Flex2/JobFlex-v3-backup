// ADD A CARD TO A CARD-LESS TRIAL (lib/cardlessTrial). Owner only — the card
// is the shop's money. Answers the Stripe Checkout URL: setup mode while the
// trial runs, the same plan with no new trial once it has ended. A route, not
// a server action, so it stays open while the workspace is read-only after
// the trial (lib/trialLock locks server-action writes only).
import { NextResponse } from "next/server";
import { requireOwner, UnauthorizedError, NoOrgError } from "@/lib/orgContext";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { openCardCheckout } from "@/lib/cardlessTrial";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let organizationId: string;
  try {
    ({ organizationId } = await requireOwner());
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) {
      return NextResponse.json({ error: "Only the owner can add the card." }, { status: 403 });
    }
    throw err;
  }
  if (!isStripeEnabled()) return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  try {
    const opened = await openCardCheckout(organizationId, new URL(req.url).origin);
    if (!opened) return NextResponse.json({ error: "There is no trial to add a card to." }, { status: 409 });
    return NextResponse.json({ url: opened.url, purpose: opened.purpose });
  } catch (err) {
    console.error("[trial-card] checkout failed:", err);
    return NextResponse.json({ error: "Couldn't open the card form. Try again." }, { status: 502 });
  }
}
