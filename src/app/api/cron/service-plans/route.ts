import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runServicePlans } from "@/lib/servicePlanBook";
import { runBookingReminders } from "@/lib/bookingBook";
import { runServiceDeskReminders } from "@/lib/serviceDeskBook";

export const runtime = "nodejs";
export const maxDuration = 120;

// THE PLANS' OWN DAY (2026-09-22): bills that are due go out, visits two
// weeks out are announced to the office and the client, plans ending
// within 30 days get one warning, and at the end they renew on their own
// or expire. Fail-closed cron auth like the other cron routes; one bad
// plan is logged and the rest still run (lib/servicePlanBook).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const report = await runServicePlans(new Date());
  // Online bookings (2026-09-23): the day-before reminder rides the same run.
  const bookings = await runBookingReminders(new Date()).catch((err) => {
    console.error(`[booking] reminders: ${err instanceof Error ? err.message : String(err)}`);
    return { reminded: 0 };
  });
  // The HVAC services desk (2026-10-18): the contractor's own reminders on their day, the heads-up before
  // plan visits, and one digest a day by bell and text (lib/serviceDeskBook).
  const desk = await runServiceDeskReminders(new Date()).catch((err) => {
    console.error(`[serviceDesk] run: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  return NextResponse.json({ ok: true, ...report, bookingsReminded: bookings.reminded, desk });
}
