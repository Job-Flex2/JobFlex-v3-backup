import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { HOUSE_SLUG } from "@/lib/webEstimator";

// Turn a business / person name into a URL-safe org slug base.
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

// A unique Organization.slug derived from `base`, with a short random suffix on
// collision so two same-named signups don't clash. Shared by the self-serve
// register action and the Google first-login provisioning in lib/auth.ts.
export async function uniqueOrgSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 5; i++) {
    // `jobflex` is the house's own address (/estimate/jobflex/<trade>, lib/webEstimator): never a shop's.
    const exists = slug === HOUSE_SLUG || (await db.organization.findUnique({ where: { slug }, select: { id: true } }));
    if (!exists) return slug;
    slug = `${base}-${randomBytes(2).toString("hex")}`;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}
