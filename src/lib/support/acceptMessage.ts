import "server-only";
// SUPPORT · A MESSAGE ARRIVES IN A TICKET — the one path for every door
// (2026-10-18). The customer's reply in the app (actions/support
// postSupportReply), a reply by email read from the Gmail box
// (lib/supportMail, /api/cron/support-mail) and the parked Resend webhook
// (/api/support/inbound) all land here, so they do exactly the same things:
//
//   · the message is kept and the other side is emailed (lib/supportThread
//     postSupportMessage — a customer's message makes the ticket unread for
//     the admins and lifts it to the top; a team message counts as read);
//   · a customer's message also texts the team's "Support" alert
//     (lib/adminAlerts drops repeats within ten minutes) and lets the support
//     AI answer it, after the response, while no person leads the ticket;
//   · the support pages are re-read.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { supportTicketRef } from "@/lib/notify";
import { admin as adminLink, fireAdminAlert, short } from "@/lib/adminAlerts";
import { answerTicketWithAi } from "@/lib/support/aiSupport";
import { postSupportMessage, type PostMessageInput, type PostMessageResult } from "@/lib/supportThread";

export async function acceptSupportMessage(input: PostMessageInput & { from: "customer" | "team" }): Promise<PostMessageResult | null> {
  const r = await postSupportMessage(input);
  if (!r) return null;
  if (input.from === "customer") {
    const ref = supportTicketRef(input.ticketId);
    const t = await db.supportTicket
      .findUnique({ where: { id: input.ticketId }, select: { organization: { select: { name: true } } } })
      .catch(() => null);
    await fireAdminAlert(
      "support",
      `JobFlex: ${short(t?.organization.name ?? "A customer")} replied on support ${ref}${input.channel === "email" ? " by email" : ""} — “${short(input.body, 60)}”. ${await adminLink(`/admin/support?ticket=${input.ticketId}`)}`,
    );
    after(() =>
      answerTicketWithAi(input.ticketId, { trigger: "follow-up" }).then(
        () => undefined,
        (err) => console.error(`[support-ai] ${ref}: the follow-up was not answered:`, err instanceof Error ? err.message : err),
      ),
    );
  }
  try {
    revalidatePath("/dashboard/support");
    revalidatePath("/admin/support");
    revalidatePath("/admin");
  } catch {
    /* outside a request (a script): nothing to re-read */
  }
  return r;
}
