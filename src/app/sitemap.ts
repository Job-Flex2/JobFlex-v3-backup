import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";
import { VARIANT_KEYS } from "@/components/v3/landing-e/landing-variants";

// sitemap.xml (2026-10-01): the public pages and the 20 trade landings. A trade
// landing is the root with ?industry=<key> (the variant is read from the query
// only; /hvac is a 308 to /?industry=hvac, so the target is listed, not the
// shortcut). lastModified is the day each page's content last changed — move
// it with the content.
const LANDING = new Date("2026-09-30");
const UPDATED: Array<[string, Date, number]> = [
  ["/", LANDING, 1],
  ["/pricing", LANDING, 0.9],
  // The one homeowner page since 2026-10-02 (intake, status link, ?ref).
  ["/homeowner", new Date("2026-10-02"), 0.7],
  ["/about", new Date("2026-04-20"), 0.5],
  ["/privacy", new Date("2026-09-22"), 0.3],
  ["/terms", new Date("2026-09-22"), 0.3],
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...UPDATED.map(([path, lastModified, priority]) => ({ url: `${SITE_URL}${path}`, lastModified, changeFrequency: "monthly" as const, priority })),
    ...VARIANT_KEYS.map((key) => ({ url: `${SITE_URL}/?industry=${key}`, lastModified: LANDING, changeFrequency: "monthly" as const, priority: 0.8 })),
  ];
}
