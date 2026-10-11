import "server-only";
// The Meta context a signup carries, built on the server from what the
// browser sent (moved out of actions/signupCheckout, 2026-10-10, so the
// passwordless sign-up — lib/signupOtp — builds it the same way).
import { clientIp } from "@/lib/rateLimit";
import { fbcFromFbclid, type MetaSignupContext } from "@/lib/metaCapi";

/** What the register form sends: the banner's marketing consent, the event
 *  ids its own pixel events carry, the pixel's cookies and the ad's click id. */
export interface BrowserMetaInput {
  consent: boolean;
  registrationEventId: string;
  checkoutEventId?: string;
  fbp?: string;
  fbc?: string;
  fbclid?: string;
  sourceUrl?: string;
}

/** The IP and user agent join the Meta context ONLY with marketing consent;
 *  without it the Conversions API gets the hashed email alone. The same goes
 *  for the click id: with consent, an fbc is built from `fbclid` when the
 *  pixel's _fbc cookie is missing (consent given after the landing, or the
 *  pixel blocked), and the fbclid is kept for the events that come later.
 *  fbp / fbc (2026-10-01): the request's own _fbp / _fbc cookies first, the
 *  values the browser put in the body when the request has none. */
export async function metaContextFor(meta: BrowserMetaInput | undefined): Promise<MetaSignupContext | undefined> {
  if (!meta) return undefined;
  const ctx: MetaSignupContext = { consent: meta.consent, registrationEventId: meta.registrationEventId, checkoutEventId: meta.checkoutEventId, sourceUrl: meta.sourceUrl };
  if (meta.consent) {
    let jarFbp: string | undefined;
    let jarFbc: string | undefined;
    try {
      const { cookies } = await import("next/headers");
      const jar = await cookies();
      jarFbp = jar.get("_fbp")?.value?.slice(0, 120) || undefined;
      jarFbc = jar.get("_fbc")?.value?.slice(0, 400) || undefined;
    } catch {
      /* no request cookies — the body's values stand */
    }
    ctx.fbp = jarFbp || meta.fbp;
    ctx.fbclid = meta.fbclid;
    ctx.fbc = jarFbc || meta.fbc || fbcFromFbclid(meta.fbclid, Date.now());
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      ctx.clientIp = await clientIp();
      ctx.userAgent = h.get("user-agent")?.slice(0, 400) ?? undefined;
    } catch {
      /* no request headers — the event goes without them */
    }
  }
  return ctx;
}
