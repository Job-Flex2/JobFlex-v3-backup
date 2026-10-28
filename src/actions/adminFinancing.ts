"use server";
// JobFlex's financing switch (/admin/financing) — platform admins only.
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { saveSwitch } from "@/lib/financing/admin";
import type { FinancingSwitch } from "@/lib/financing/state";

export async function setFinancingSwitch(mode: FinancingSwitch["mode"], pilotText: string): Promise<{ ok: true; sw: FinancingSwitch; missing: string[] }> {
  await requirePlatformAdmin();
  const r = await saveSwitch(mode, String(pilotText ?? ""));
  revalidatePath("/admin/financing");
  return { ok: true, ...r };
}
