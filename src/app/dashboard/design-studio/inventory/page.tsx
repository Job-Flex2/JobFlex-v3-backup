// The Home Design Studio's inventory — the shop's own products, which a piece in a design can be (2026-10-18). Under
// the studio, as each JobFlex inventory sits under its estimator; the same admin-preview gate as the studio.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { canUseDesignStudio } from "@/lib/design/access";
import { readDesignInventory } from "@/actions/designStudio";
import { DesignInventory } from "@/components/v3/design-studio/inventory-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Design Studio inventory", description: "The products you sell, for your designs and their estimates." };

export default async function DesignInventoryPage() {
  let open = false;
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseDesignStudio(ctx.user);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdesign-studio%2Finventory");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) notFound();
  const res = await readDesignInventory();
  return <DesignInventory initial={res.ok ? res.products : []} />;
}
