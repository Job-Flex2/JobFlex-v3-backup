// DOES THE CONTRACTOR'S NUMBER REALLY FORWARD TO THE DESK? (owner, 2026-10-14: "mention to the contractor that if
// they want to forward their number they need to turn on forwarding — make it smart"). Pure, browser-safe.
//
// JobFlex can't forward anyone's calls — their carrier does, once they dial its code. So the desk checks:
//   · the test call — JobFlex calls the business phone FROM the desk's number. Forwarding on, the carrier sends that
//     call straight back to the desk's number, where the inbound webhook recognises it (isForwardTestCall) and marks
//     it working; forwarding off, the business phone rings — whoever answers hears so, and it is marked "rang";
//     nobody answering at all is "noanswer".
//   · a real call — a customer's call that the carrier marks as forwarded from the business phone (Twilio's
//     ForwardedFrom, when the carrier passes it) confirms it on its own.
//   · the owner's word — "I called it, the desk answered".
// A result counts only for the forwarding it was checked for, the same business phone and the same desk number.
import type { DeskForwarding } from "./shared";

export type ForwardStatus = "calling" | "works" | "rang" | "noanswer" | "failed";
export type ForwardHow = "test" | "call" | "manual";

export type ForwardCheck = {
  id: string;
  status: ForwardStatus;
  how: ForwardHow;
  /** The forwarding it was checked for. */
  kind: "all" | "missed";
  /** The business phone and the desk's number, E.164. */
  phone: string;
  desk: string;
  startedAt: number;
  at: number;
  error?: string;
};

/** How long a test call may take: a phone forwarding every call sends it on at once; a missed-call one after ~30 s of ringing. */
export const TEST_WINDOW_MS = { all: 60_000, missed: 100_000 } as const;
export const TEST_RING_SECONDS = { all: 25, missed: 50 } as const;

const digits = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export const samePhone = (a: string | null | undefined, b: string | null | undefined) => digits(a).length === 10 && digits(a) === digits(b);

/** The check as the page shows it: null when there is none for this forwarding, this phone and this desk number. */
export function forwardCheckView(c: ForwardCheck | null, now: { forwarding: DeskForwarding; phone: string | null; desk: string | null; at?: number }): ForwardCheck | null {
  if (!c || now.forwarding === "none" || c.kind !== now.forwarding) return null;
  if (!samePhone(c.phone, now.phone) || !samePhone(c.desk, now.desk)) return null;
  // A test that never came back is over.
  if (c.status === "calling" && (now.at ?? Date.now()) - c.startedAt > TEST_WINDOW_MS[c.kind] + 20_000) return { ...c, status: "noanswer" };
  return c;
}

/**
 * An inbound call to the desk's number that is our own test coming back: a test is running, it is young enough, and the
 * call is from the desk's number (the carrier kept our caller ID), from the business phone (it put its own), or marked
 * forwarded from the business phone.
 */
export function isForwardTestCall(c: ForwardCheck | null, call: { from: string; to: string; forwardedFrom?: string | null; at: number }): boolean {
  if (!c || c.status !== "calling" || c.how !== "test") return false;
  if (call.at - c.startedAt > TEST_WINDOW_MS[c.kind] + 20_000) return false;
  if (!samePhone(call.to, c.desk)) return false;
  return samePhone(call.from, c.desk) || samePhone(call.from, c.phone) || samePhone(call.forwardedFrom, c.phone);
}

/** A real call the carrier marked as forwarded from the business phone, to the desk's number. */
export function isForwardedCustomerCall(call: { to: string; forwardedFrom?: string | null }, phone: string | null, desk: string | null): boolean {
  return !!call.forwardedFrom && samePhone(call.forwardedFrom, phone) && samePhone(call.to, desk);
}

const say = (text: string) => `<Say voice="alice">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Say>`;

/** What the desk's number answers when the test call arrives back: it worked, and nothing more. */
export function testArrivedTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${say("JobFlex forwarding test. Forwarding works.")}<Hangup/></Response>`;
}

/** What the test call says when it is answered: back at the desk → it works; at the business phone → it does not, yet. */
export function testAnsweredTwiml(reachedDesk: boolean, kind: "all" | "missed"): string {
  if (reachedDesk) return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${say("JobFlex forwarding test. Forwarding works. Goodbye.")}<Hangup/></Response>`;
  const why =
    kind === "all"
      ? "This is JobFlex, testing your call forwarding. Your phone rang, so it is not forwarding calls to your AI desk yet. Dial your carrier's forwarding code from this phone, then test again. Goodbye."
      : "This is JobFlex, testing your call forwarding. This call was answered here, so missed calls are not forwarding to your AI desk yet. Turn on forwarding of missed calls with your carrier's code, and next time let the test call ring without answering. Goodbye.";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Pause length="1"/>${say(why)}<Hangup/></Response>`;
}

/** Twilio's final status for a test call that nobody answered and that never came back to the desk. */
export function statusAfterCall(callStatus: string): ForwardStatus | null {
  if (["no-answer", "busy", "canceled"].includes(callStatus)) return "noanswer";
  if (callStatus === "failed") return "failed";
  return null;
}
