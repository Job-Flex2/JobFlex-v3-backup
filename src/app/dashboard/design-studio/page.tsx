// THE HOME DESIGN STUDIO (owner, 2026-10-17: "the design, home design studio — upload the blueprint, pick the room,
// it comes already drawn … design it in 3D … for now only in admin, not for the users"). Admin preview: platform
// admins and the owner's early-access account (lib/design/access); everyone else gets a plain not-found, and the
// studio is in no menu. The plan is read and drawn in the browser; the server keeps the designs (actions/designStudio).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { canUseDesignStudio } from "@/lib/design/access";
import { loadDesign } from "@/actions/designStudio";
import { DesignStudio } from "@/components/v3/design-studio/design-studio";
import type { DesignDoc } from "@/lib/design/model";
import { db } from "@/lib/db";
import { locationIndex } from "@/lib/estimate/location-index";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "JobFlex · Home Design Studio",
  description: "Home design studio — read the blueprint into rooms and design them in 3D.",
};

export default async function DesignStudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let open = false;
  let orgId = "";
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseDesignStudio(ctx.user);
    orgId = ctx.organizationId;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdesign-studio");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) notFound();
  const params = await searchParams;
  const asked = Array.isArray(params.design) ? params.design[0] : params.design;
  let initial: { id: string; doc: DesignDoc } | null = null;
  const [res, org] = await Promise.all([asked ? loadDesign(asked) : null, db.organization.findUnique({ where: { id: orgId }, select: { address: true } })]);
  if (res?.ok) initial = { id: res.id, doc: res.doc };
  // The estimate is priced for the shop's own market until the job's address says otherwise.
  const shopAddress = org?.address?.trim() || null;
  const idx = locationIndex(shopAddress);
  return <DesignStudio key={initial?.id ?? "new"} initial={initial} market={{ factor: idx.factor, place: idx.place, level: idx.level }} shopAddress={shopAddress} />;
}
