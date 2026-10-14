// THE PHONE PAGE'S DESK LINE — server only: the company's number, who answers it, the
// voice, and the month's minutes (lib/aiDesk/usage). Read by app/dashboard/phone/load-phone.
import { db } from "@/lib/db";
import { isPageLocked } from "@/lib/customPageAccess";
import { readRegistration } from "@/lib/sms/registration";
import type { PhoneDeskStrip } from "@/components/v3/phone-blueprint/phone-data";
import { readDeskSettings } from "./numbers";
import { readDeskUse } from "./usage";
import { deskBalanceFor } from "./minutes";
import { voiceServerConfigured } from "./voiceToken";
import { callsGo, minutesLeftWords, minutesOf, prettyPhone } from "./shared";

export async function deskStripFor(organizationId: string): Promise<PhoneDeskStrip> {
  const [org, reg, settings, locked, use, balance] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { phone: true } }),
    readRegistration(organizationId).catch(() => null),
    readDeskSettings(organizationId),
    isPageLocked(organizationId, "phone").catch(() => true),
    readDeskUse(organizationId),
    deskBalanceFor(organizationId),
  ]);
  const companyPhone = org?.phone?.trim() || null;
  return {
    number: reg?.number ? prettyPhone(reg.number) : null,
    on: Boolean(reg?.number && reg.voiceOnAt),
    left: minutesLeftWords(balance),
    out: balance.out,
    low: balance.low,
    go: callsGo({ mode: settings.mode, assistantOnPlan: !locked, companyPhone }),
    mode: settings.mode,
    companyPhone,
    voice: settings.voice,
    minutes: minutesOf(use.callSeconds + use.testSeconds),
    calls: use.calls,
    tests: use.tests,
    live: voiceServerConfigured(),
  };
}
