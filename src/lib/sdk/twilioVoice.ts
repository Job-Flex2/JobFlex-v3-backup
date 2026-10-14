// Tiny string-based TwiML generators + signature verifier. No SDK dependency at runtime.

interface RecordOpts {
  baseUrl: string; // absolute origin for webhook callbacks
  greeting: string;
  maxLengthSec?: number;
}

export function recordingTwiml(opts: RecordOpts): string {
  const max = opts.maxLengthSec ?? 120;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(opts.greeting)}</Say>
  <Record
    action="${opts.baseUrl}/api/twilio/recording-complete"
    method="POST"
    transcribe="true"
    transcribeCallback="${opts.baseUrl}/api/twilio/transcription-complete"
    maxLength="${max}"
    playBeep="true"
    trim="trim-silence"/>
  <Say voice="alice">Thanks. We'll be in touch shortly.</Say>
  <Hangup/>
</Response>`;
}

export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`;
}

// Played when the org is over its AI-phone-call quota: a polite decline, no
// recording started, so no AiPhoneCall row is created.
export function unavailableTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thanks for calling. We can't take your call right now — please try again later or reach us through our website.</Say>
  <Hangup/>
</Response>`;
}

/**
 * The company's own phone rings first (lib/aiDesk: FORWARD, or a plan without the
 * assistant). The caller's number is the caller ID, as on a forwarded line. Whether
 * anyone picked up comes back to the action URL (DialCallStatus), which hangs up after
 * a conversation and takes a message after no answer.
 */
export function forwardTwiml(opts: { baseUrl: string; number: string; timeoutSec?: number }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${opts.baseUrl}/api/twilio/voice/dial" method="POST" timeout="${opts.timeoutSec ?? 25}">${escapeXml(opts.number)}</Dial>
</Response>`;
}

/**
 * The live desk takes the call: Twilio streams the audio to the voice server with the
 * call's signed token; when the stream ends — the desk said goodbye, a transfer, or it
 * never got going — Twilio asks /api/twilio/voice/after what to do next.
 */
export function streamTwiml(opts: { baseUrl: string; wsUrl: string; token: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(opts.wsUrl)}">
      <Parameter name="token" value="${escapeXml(opts.token)}"/>
    </Stream>
  </Connect>
  <Redirect method="POST">${opts.baseUrl}/api/twilio/voice/after</Redirect>
</Response>`;
}

/**
 * A Twilio webhook's form, once its signature checks out — null when it does not.
 * `path` is the route Twilio signed ("/api/twilio/voice"); TWILIO_APP_URL names the
 * public origin behind a proxy.
 */
export async function readTwilioForm(req: Request, path: string): Promise<Record<string, string> | null> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  const fullUrl = process.env.TWILIO_APP_URL ? `${process.env.TWILIO_APP_URL}${path}` : new URL(req.url).toString();
  const ok = await verifyTwilioSignature(fullUrl, params, req.headers.get("x-twilio-signature"));
  return ok ? params : null;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// HMAC-SHA1 signature verifier per Twilio spec.
// Twilio signs the concatenation of the full URL + sorted form params.
// We don't install crypto-js; Node has crypto built in.
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  // The token the admin saved (/admin/integrations/twilio), else the env.
  const { twilioAuthToken } = await import("./twilio");
  const token = (await twilioAuthToken()) ?? process.env.TWILIO_AUTH_TOKEN;
  // Fail-closed in production: a missing auth token must not turn these webhooks
  // into unauthenticated write endpoints. Outside prod, allow (local dev without
  // Twilio configured).
  if (!token) return process.env.NODE_ENV !== "production";
  if (!signature) return false;
  const keys = Object.keys(params).sort();
  const data = url + keys.map((k) => k + params[k]).join("");
  const { createHmac } = await import("node:crypto");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  return expected === signature;
}
