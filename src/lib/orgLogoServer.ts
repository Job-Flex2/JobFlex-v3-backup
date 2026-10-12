// Server side of the company logo: decode the stored data URL into bytes for
// the logo route, and hand the PDF a picture it can actually draw.
// (lib/orgLogo has the pure helpers and the why.)
import "server-only";

export type DecodedLogo =
  | { kind: "bytes"; mime: string; bytes: Buffer }
  | { kind: "remote"; url: string };

/** The stored value as bytes (a data URL) or as a link to follow (an older https value). */
export function decodeLogo(logoUrl: string | null | undefined): DecodedLogo | null {
  if (!logoUrl) return null;
  const v = logoUrl.trim();
  if (/^https:\/\//i.test(v)) return { kind: "remote", url: v };
  const m = /^data:(image\/[a-z0-9.+-]+)((?:;[a-z0-9-]+=[^;,]*)*)(;base64)?,(.*)$/is.exec(v);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  try {
    const bytes = m[3] ? Buffer.from(m[4], "base64") : Buffer.from(decodeURIComponent(m[4]), "utf8");
    return bytes.length ? { kind: "bytes", mime, bytes } : null;
  } catch {
    return null;
  }
}

/**
 * The logo as a data URL @react-pdf can draw, or null. It draws PNG and JPEG
 * only, so a WebP or SVG logo is turned into a PNG (sharp — already installed
 * with Next). Any failure means the PDF simply prints without the logo; a
 * missing picture must never cost the client their proposal.
 */
export async function pdfLogoSrc(logoUrl: string | null | undefined): Promise<string | null> {
  const logo = decodeLogo(logoUrl);
  if (!logo || logo.kind !== "bytes") return null; // no fetching of remote URLs from the server (SSRF)
  if (logo.mime === "image/png" || logo.mime === "image/jpeg" || logo.mime === "image/jpg") {
    return `data:${logo.mime === "image/jpg" ? "image/jpeg" : logo.mime};base64,${logo.bytes.toString("base64")}`;
  }
  if (logo.mime !== "image/webp" && logo.mime !== "image/svg+xml") return null;
  try {
    const { default: sharp } = await import("sharp");
    const png = await sharp(logo.bytes, { density: 192 })
      .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: logo.mime !== "image/svg+xml" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
