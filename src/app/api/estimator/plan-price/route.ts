// BLUEPRINT ESTIMATOR — one trade priced (owner, 2026-10-17: "it takes 5 minutes").
//
// The same work as the `pricePlanTrade` server action, behind a route handler.
// A page's server actions are sent one at a time, so the estimator's "three
// trades at once" ran one after another and a whole house (up to 18 trades)
// waited on every one in turn. fetch() calls run side by side, so the trades
// really are priced in parallel now.
//
// It carries its own auth — the middleware matches /dashboard and /admin only:
// `pricePlanTrade` checks the session, the role, the page and the plan, the
// blueprint session's token and its rate limit, exactly as before.

import { NextResponse } from "next/server";
import { pricePlanTrade } from "@/actions/advancedEstimator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One trade can take minutes (a reasoning model, a re-ask after the validation pass).
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "This trade's takeoff could not be read — open the plans again." }, { status: 400 });
  }
  return NextResponse.json(await pricePlanTrade(body));
}
