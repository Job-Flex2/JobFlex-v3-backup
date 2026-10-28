// WISETACK FINANCING — the AI desk's financing answer (owner, 2026-10-28): a company approved for Wisetack (and let
// in by JobFlex's switch) says yes to "Do you offer financing?" — lib/aiDesk/profile withFinancingAnswer decides where
// it goes, and never writes over the owner's own words. Server only.

import { readDeskSettings, saveDeskSettings } from "@/lib/aiDesk/numbers";
import { financingAnswerOf, withFinancingAnswer, type DeskFaq } from "@/lib/aiDesk/profile";
import { getProvider } from "./provider";
import { orgFinancingView } from "./service";
import { FIN } from "./words";

/** The Wisetack answer when this company may give it, else null. */
export async function deskFinancingAnswer(orgId: string): Promise<DeskFaq | null> {
  if (!getProvider()) return null;
  const view = await orgFinancingView(orgId);
  return view.letIn && view.rec.state === "approved" ? { q: FIN.deskQ, a: FIN.deskA } : null;
}

/** For Settings → Financing: what the desk will say — the Wisetack line, the owner's own answer, or no desk yet. */
export async function deskAnswerState(orgId: string): Promise<"ours" | "theirs" | "none"> {
  const settings = await readDeskSettings(orgId).catch(() => null);
  if (!settings?.profile) return "none";
  return financingAnswerOf(settings.profile, FIN.deskA);
}

/** The one-tap fix: the owner's financing answer becomes the Wisetack line. */
export async function applyWisetackAnswer(orgId: string): Promise<boolean> {
  const settings = await readDeskSettings(orgId);
  if (!settings.profile) return false;
  const p = settings.profile;
  const i = p.faqs.findIndex((f) => /financ|monthly payment|payment plan|pay over time/i.test(f.q));
  const faqs = i < 0 ? p.faqs : p.faqs.map((f, j) => (j === i ? { q: f.q, a: FIN.deskA } : f));
  const profile = i < 0 ? withFinancingAnswer(p, { q: FIN.deskQ, a: FIN.deskA }) : { ...p, faqs };
  await saveDeskSettings(orgId, { ...settings, profile, profileUpdatedAt: new Date().toISOString() });
  return true;
}
