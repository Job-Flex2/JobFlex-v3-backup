import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";
import { openLoanForClient } from "@/lib/financing/service";

// Public (portal) — "Pay over time": opens the client's Wisetack application for what is owed on this signed
// proposal right now, or the live one they already started. The amount is never read from the body.
export const runtime = "nodejs";

const schema = z.object({ publicId: z.string().min(8).max(64) });

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const body = schema.safeParse(raw);
  if (!body.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const [ipGate, idGate] = await Promise.all([
    rateLimitShared(`pay:${ipFromRequest(req)}`, 10, HOUR),
    rateLimitShared(`pay:p:${body.data.publicId}`, 20, HOUR),
  ]);
  if (!ipGate.ok || !idGate.ok) return NextResponse.json({ error: "Too many requests — try again later." }, { status: 429 });
  const res = await openLoanForClient(body.data.publicId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ url: res.url });
}
