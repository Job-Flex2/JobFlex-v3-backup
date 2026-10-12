import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logoVersion } from "@/lib/orgLogo";
import { decodeLogo } from "@/lib/orgLogoServer";

export const runtime = "nodejs";

// The shop's logo for a client's proposal page (lib/orgLogo explains why the
// page links here instead of printing the stored data URL). The publicId is
// the same key the client already holds for the proposal itself and its PDF.
export async function GET(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  const proposal = await db.proposal
    .findUnique({ where: { publicId }, select: { organization: { select: { logoUrl: true, deletedAt: true } } } })
    .catch(() => null);
  const org = proposal?.organization;
  if (!org || org.deletedAt || !org.logoUrl) return new NextResponse(null, { status: 404 });

  const logo = decodeLogo(org.logoUrl);
  if (!logo) return new NextResponse(null, { status: 404 });
  if (logo.kind === "remote") return NextResponse.redirect(logo.url, 302);

  // The page asks with ?v=<fingerprint of the stored logo>. While that matches,
  // the bytes behind this URL can never change, so the browser keeps them; a
  // new logo gets a new fingerprint and therefore a new URL.
  const asked = new URL(req.url).searchParams.get("v");
  const current = asked !== null && asked === logoVersion(org.logoUrl.trim());

  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.bytes.length),
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      // An SVG logo opened on its own must not run anything on jobflex.app.
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
