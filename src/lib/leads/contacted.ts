// A LEAD WAS REACHED (2026-10-31) — server only.
//
// `Lead.contactedAt` is what the CRM's "not called back" check reads (lib/crm/brief), and until now nothing ever
// set it, so a lead stayed "not called back" after its visit was booked. Two moments set it:
//   · a visit booked for the lead (actions/appointments createAppointment) — the lead also moves on from the
//     intake statuses to CONTACTED, and a sales rep who booked an unclaimed lead claims it, so the lead stays in
//     their slice of the Leads page (NEW is the only status the shared pool shows them);
//   · the AI desk talking with the lead on a call it placed (lib/aiDesk/leadCalls) — the time only: no person took
//     it, so its status and owner stay as the team left them.
// The first contact is kept: a later visit or call never moves the time.
import { db } from "@/lib/db";

const INTAKE = ["NEW", "ROUTED", "CLAIMED"];

export async function markLeadContacted(
  organizationId: string,
  leadId: string,
  how: { status: boolean; claimFor?: string | null; at?: Date } = { status: false },
): Promise<void> {
  const at = how.at ?? new Date();
  await db.lead.updateMany({ where: { id: leadId, organizationId, contactedAt: null }, data: { contactedAt: at } });
  if (!how.status) return;
  if (how.claimFor) {
    await db.lead.updateMany({
      where: { id: leadId, organizationId, status: { in: INTAKE }, assignedToId: null, claimedById: null },
      data: { claimedById: how.claimFor, claimedAt: at },
    });
  }
  await db.lead.updateMany({ where: { id: leadId, organizationId, status: { in: INTAKE } }, data: { status: "CONTACTED" } });
}
