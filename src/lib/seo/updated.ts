// When the cost guides were rendered (2026-10-26) — the build, or the daily
// refresh — for "Updated October 2026", the title's year and the sitemap.
export const SEO_BUILT = new Date();
export const SEO_YEAR = SEO_BUILT.getUTCFullYear();
export const SEO_UPDATED = SEO_BUILT.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
