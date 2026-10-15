// GET /api/qa/otp?email=<address>@qa.jobflex.test — the one-time code the
// QA Lab's sign-up and sign-in checks would have read in the email
// (lib/qaTestMode; qa/README.md).
//
// THE GATE IS THE FIRST LINE. Without QA_TEST_MODE=1 and a QA_SECRET, or on
// Vercel production whatever the flags say, this route does not exist as far
// as any caller can tell: a plain 404 before anything is read — and a missing
// or wrong x-qa-secret gets that same 404. With the gate open and the secret
// right it answers only for @qa.jobflex.test addresses, and only while the code
// is fresh (ten minutes).

import { NextResponse } from "next/server";
import { tokensEqual } from "@/lib/tokens";
import { isQaEmail, qaTestModeOn, readQaCode } from "@/lib/qaTestMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  // Off, or the wrong secret: the same plain 404 as a route that does not exist.
  if (!qaTestModeOn() || !tokensEqual(req.headers.get("x-qa-secret"), process.env.QA_SECRET)) {
    return new NextResponse(null, { status: 404 });
  }
  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!isQaEmail(email)) {
    return NextResponse.json({ error: "only @qa.jobflex.test addresses" }, { status: 400, headers: NO_STORE });
  }
  const entry = await readQaCode(email);
  if (!entry) return NextResponse.json({ found: false }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    { found: true, email: entry.email, kind: entry.kind, code: entry.code, link: entry.link, at: entry.at },
    { headers: NO_STORE },
  );
}
