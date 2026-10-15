// Real values for dynamic routes, from QA Co's own records (never another organisation's).
// A route whose value cannot be found is opened with a made-up one: it must then answer
// "not found" in words or a 404 — never a 500.
import { prisma, QA_ORG_SLUG } from "./db";
import type { AppRoute } from "./routes";
import { targetKind } from "./target";

export const MISSING = "qa-missing-0000";

type Resolver = () => Promise<string | null | undefined>;
let org: { id: string; slug: string } | null | undefined;

async function qaOrg() {
  if (org === undefined) org = await prisma().organization.findUnique({ where: { slug: QA_ORG_SLUG }, select: { id: true, slug: true } }).catch(() => null);
  return org;
}

/** pattern → value of its (single) dynamic segment */
function resolvers(): Record<string, Resolver> {
  const db = prisma() as unknown as Record<string, { findFirst: (a: unknown) => Promise<Record<string, string> | null> }>;
  const first = (model: string, field = "id", extra: Record<string, unknown> = {}) => async () => {
    const o = await qaOrg();
    if (!o) return null;
    const row = await db[model]?.findFirst({ where: { organizationId: o.id, ...extra }, select: { [field]: true }, orderBy: { createdAt: "desc" } }).catch(() => null);
    return row?.[field] ?? null;
  };
  return {
    "/dashboard/clients/[id]": first("client"),
    "/dashboard/jobs/[id]": first("job"),
    "/dashboard/leads/[id]": first("lead"),
    "/dashboard/proposals/[id]": first("proposal"),
    "/dashboard/projects/[id]": first("project"),
    "/dashboard/trade/[id]": first("tradePost"),
    "/dashboard/workers/[id]": first("workerProfile"),
    "/mobile-job-detail-v1/[id]": first("job"),
    "/mobile-project-detail-v2/[id]": first("project"),
    "/mobile-proposal-client-v2/[publicId]": first("proposal", "publicId"),
    "/portal/q/[publicId]": first("proposal", "publicId"),
    "/home/[key]": first("home", "accessToken"),
    "/w/[token]": first("workerProfile", "token"),
    "/book/[slug]": async () => (await qaOrg())?.slug,
    "/book/[slug]/privacy": async () => (await qaOrg())?.slug,
    "/book/[slug]/texting": async () => (await qaOrg())?.slug,
  };
}

const cache = new Map<string, { path: string; real: boolean }>();

/** A concrete path for the route: real values where QA Co has them, MISSING elsewhere. */
export async function concretePath(route: AppRoute, opts: { real?: boolean } = {}): Promise<{ path: string; real: boolean }> {
  if (!route.params.length) return { path: route.pattern, real: true };
  // A remote server's database is not this machine's: no real values there.
  if (opts.real === false || targetKind() !== "local") return { path: route.pattern.replace(/\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g, MISSING), real: false };
  const hit = cache.get(route.pattern);
  if (hit) return hit;
  let value: string | null | undefined = null;
  const r = resolvers()[route.pattern];
  if (r) value = await r().catch(() => null);
  const real = !!value && route.params.length === 1;
  const filled = route.pattern.replace(/\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g, () => encodeURIComponent(real ? String(value) : MISSING));
  const out = { path: filled, real };
  cache.set(route.pattern, out);
  return out;
}
