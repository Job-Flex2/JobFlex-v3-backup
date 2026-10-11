"use server";
// THE COMPANY NAME, ASKED ON THE SPOT (2026-10-10; lib/orgName). A shop that
// signed up without a password carries its owner's name until it names the
// business; before the first proposal, email or text goes to a client the
// send asks for it in one field (components/company-name/company-name-gate),
// and the company page's "Keep this name" confirms the stand-in.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManager, requireOrg } from "@/lib/orgContext";
import { clearOrgNameUnset, isOrgNameUnset } from "@/lib/orgName";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

/** Is the name still the stand-in, and may this person set it? Never throws:
 *  a failed read answers "set" — a send is never blocked by this check. */
export async function companyNameStatus(): Promise<{ unset: boolean; name: string; canEdit: boolean }> {
  try {
    const { organizationId, role } = await requireOrg();
    if (!(await isOrgNameUnset(organizationId))) return { unset: false, name: "", canEdit: false };
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    return { unset: true, name: org?.name ?? "", canEdit: role === "OWNER" || role === "ADMIN" || role === "MANAGER" };
  } catch {
    return { unset: false, name: "", canEdit: false };
  }
}

/** Name the business (or keep the name it has). Clears the "not set" mark. */
export async function setCompanyName(raw: unknown): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const parsed = z.string().trim().min(1, "Type your company name.").max(120, "That name is too long.").safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Type your company name." };
  try {
    const { organizationId, user } = await requireManager();
    await db.organization.update({ where: { id: organizationId }, data: { name: parsed.data } });
    await clearOrgNameUnset(organizationId);
    revalidatePath("/dashboard/company");
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.SETTINGS,
      summary: `Named the company — ${parsed.data}`,
      meta: { area: "company", fields: ["name"] },
    }).catch(() => {});
    return { ok: true, name: parsed.data };
  } catch {
    return { ok: false, error: "Couldn't save the name. Try again." };
  }
}
