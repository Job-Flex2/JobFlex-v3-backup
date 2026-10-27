// The cost guides' audit (2026-10-26): reads every /cost page a production
// build rendered and reports, per page and in total —
//   · words of visible text in <main> (rule: at least 600);
//   · the share of it that differs from the same work's page for the
//     neighbouring city of the same state (rule: at least 25%), two ways:
//     word-level LCS ("unique") and 3-word shingles (Jaccard distance);
//   · internal links (<a href="/...">) that point at no page of the build
//     and are not a known app route;
//   · pages without a price ($ amount in the answer card);
//   · the canonical link: a city whose data is another's names that city
//     (lib/seo/cities canonicalCity), every other page itself;
//   · each option's average against the installed range its cited source
//     gives (lib/seo/pricing calibration), on 10 cities picked by a fixed seed
//     (rule: within 20% of the middle) — computed, no HTML needed.
//
//   npx tsx scripts/seo-audit.ts [distDir]       (default .next; JOBFLEX_DIST_DIR is read too)
//   npx tsx scripts/seo-audit.ts .next --csv out.csv
//   npx tsx scripts/seo-audit.ts .next --base http://localhost:3611
//
// Only the largest cities are prerendered (the rest render on first visit);
// with --base, a page the build did not write is fetched from that running
// server (next start on the same build). No database.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SEO_TRADES } from "../src/lib/seo/trades";
import { SEO_CITIES, sameStateCities, canonicalCity, seoCity } from "../src/lib/seo/cities";
import { calibration, quote } from "../src/lib/seo/pricing";

const args = process.argv.slice(2);
const csvAt = args.indexOf("--csv");
const csvPath = csvAt >= 0 ? args[csvAt + 1] : null;
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args[baseAt + 1].replace(/\/$/, "") : null;
const valueAt = new Set([csvAt, baseAt].filter((i) => i >= 0).map((i) => i + 1));
const dist = args.find((a, i) => !a.startsWith("--") && !valueAt.has(i)) ?? process.env.JOBFLEX_DIST_DIR ?? ".next";
const appDir = join(dist, "server", "app");
if (!existsSync(join(appDir, "cost"))) {
  console.error(`No rendered /cost pages under ${appDir} — run a production build first (next build).`);
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

// Every prerendered page of the build, as its path ("/cost/roof-replacement/dallas-tx").
const allHtml = walk(appDir);
const built = new Set(allHtml.map((f) => "/" + relative(appDir, f).split(sep).join("/").replace(/\.html$/, "").replace(/(^|\/)index$/, "")).map((p) => (p === "/" ? "/" : p.replace(/\/$/, ""))));
built.add("/");
// Routes that answer but are not prerendered HTML (dynamic, or rendered on request).
const DYNAMIC_OK = [/^\/homeowner(\?|$)/, /^\/\?/, /^\/(privacy|terms|pricing|about)$/];
// Every listed work × city answers, prerendered or not (dynamicParams) — never a broken link.
const tradeSlugs = new Set(SEO_TRADES.map((t) => t.slug));
const isGuide = (p: string) => {
  const m = p.match(/^\/cost\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  return !!m && tradeSlugs.has(m[1]) && !!seoCity(m[2]);
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
function mainText(html: string): string {
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const body = (m ? m[1] : html).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  return decode(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
const words = (t: string) => t.split(" ").filter((w) => /[\p{L}\p{N}$]/u.test(w));

function lcsLen(a: string[], b: string[]): number {
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length];
}
function shingles(w: string[], k = 3): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" "));
  return s;
}
function jaccardDistance(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return 1 - inter / (a.size + b.size - inter || 1);
}

type Page = { html: string; words: string[]; fetched: boolean };
type Row = { path: string; words: number; neighbour: string; unique: number; shingle: number; broken: string[]; price: boolean; links: number; canonicalOk: boolean; fetched: boolean };

async function main() {
  const cache = new Map<string, Page>();
  const page = (path: string): Page | null => {
    const hit = cache.get(path);
    if (hit) return hit;
    const file = join(appDir, ...path.slice(1).split("/")) + ".html";
    if (!existsSync(file)) return null;
    const html = readFileSync(file, "utf8");
    const v = { html, words: words(mainText(html)), fetched: false };
    cache.set(path, v);
    return v;
  };

  // The guides the build did not prerender, from the running server (8 at a time).
  const allPaths = SEO_TRADES.flatMap((t) => SEO_CITIES.map((c) => `/cost/${t.slug}/${c.slug}`));
  let fetchedN = 0;
  const fetchFailed: string[] = [];
  if (base) {
    const todo = allPaths.filter((p) => !page(p));
    let next = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < todo.length) {
          const path = todo[next++];
          const res = await fetch(base + path).catch(() => null);
          if (!res || res.status !== 200) {
            fetchFailed.push(`${path} → ${res ? res.status : "no answer"}`);
            continue;
          }
          const html = await res.text();
          cache.set(path, { html, words: words(mainText(html)), fetched: true });
          fetchedN++;
        }
      }),
    );
  }

  const rows: Row[] = [];
  const missing: string[] = [];
  for (const t of SEO_TRADES) {
    for (const c of SEO_CITIES) {
      const path = `/cost/${t.slug}/${c.slug}`;
      const p = page(path);
      if (!p) {
        missing.push(path);
        continue;
      }
      const n = sameStateCities(c, 1)[0];
      const np = n ? page(`/cost/${t.slug}/${n.slug}`) : null;
      let unique = NaN;
      let shingle = NaN;
      if (np) {
        unique = 1 - (2 * lcsLen(p.words, np.words)) / (p.words.length + np.words.length);
        shingle = jaccardDistance(shingles(p.words), shingles(np.words));
      }
      const hrefs = [...p.html.matchAll(/<a [^>]*href="(\/[^"#]*)/g)].map((m) => decode(m[1]));
      const broken = [...new Set(hrefs)].filter((h) => {
        const bare = h.split("?")[0].replace(/\/$/, "") || "/";
        if (DYNAMIC_OK.some((re) => re.test(h))) return false;
        return !built.has(bare) && !isGuide(bare);
      });
      const price = /class="[^"]*answerAvg[^"]*"[^>]*>\$[\d,]+/.test(p.html);
      const canonical = p.html.match(/<link rel="canonical" href="[^"]*?(\/cost\/[^"]+)"/)?.[1];
      const canonicalOk = canonical === `/cost/${t.slug}/${canonicalCity(c).slug}`;
      rows.push({ path, words: p.words.length, neighbour: n?.slug ?? "", unique, shingle, broken, price, links: hrefs.length, canonicalOk, fetched: p.fetched });
    }
  }

  const pctS = (x: number) => (Number.isNaN(x) ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`);
  const withN = rows.filter((r) => !Number.isNaN(r.unique));
  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const wordsAll = rows.map((r) => r.words);
  const uniq = withN.map((r) => r.unique);
  const shing = withN.map((r) => r.shingle);

  console.log(`\nCost guides audit — ${dist}`);
  console.log(`pages expected ${SEO_TRADES.length * SEO_CITIES.length}, read ${rows.length} (prerendered ${rows.length - fetchedN}, fetched from ${base ?? "—"} ${fetchedN}), missing ${missing.length}`);
  for (const f of fetchFailed.slice(0, 10)) console.log(`  FETCH FAILED ${f}`);
  console.log(`words in <main>: min ${Math.min(...wordsAll)}, median ${q(wordsAll, 0.5)}, max ${Math.max(...wordsAll)}; under 600: ${rows.filter((r) => r.words < 600).length}`);
  console.log(`differs from the neighbouring city (word LCS): min ${pctS(Math.min(...uniq))}, p10 ${pctS(q(uniq, 0.1))}, median ${pctS(q(uniq, 0.5))}; under 25%: ${withN.filter((r) => r.unique < 0.25).length} of ${withN.length}`);
  console.log(`differs from the neighbouring city (3-word shingles): min ${pctS(Math.min(...shing))}, median ${pctS(q(shing, 0.5))}; under 25%: ${withN.filter((r) => r.shingle < 0.25).length}`);
  const brokenAll = rows.flatMap((r) => r.broken.map((b) => `${r.path} → ${b}`));
  console.log(`internal links checked: ${rows.reduce((s, r) => s + r.links, 0)}; broken: ${brokenAll.length}`);
  for (const b of brokenAll.slice(0, 20)) console.log(`  BROKEN ${b}`);
  const noPrice = rows.filter((r) => !r.price);
  console.log(`pages without a price: ${noPrice.length}`);
  for (const r of noPrice.slice(0, 20)) console.log(`  NO PRICE ${r.path}`);
  for (const m of missing.slice(0, 20)) console.log(`  MISSING ${m}`);
  const toHead = rows.filter((r) => canonicalCity(seoCity(r.path.split("/")[3]) as NonNullable<ReturnType<typeof seoCity>>).slug !== r.path.split("/")[3]);
  console.log(`canonical: ${toHead.length} pages name their metro's head city, ${rows.length - toHead.length} name themselves; wrong or missing: ${rows.filter((r) => !r.canonicalOk).length}`);
  for (const r of rows.filter((x) => !x.canonicalOk).slice(0, 10)) console.log(`  CANONICAL ${r.path}`);

  const low = [...withN].sort((a, b) => a.unique - b.unique).slice(0, 15);
  console.log(`\nLeast distinct pairs (word LCS):`);
  for (const r of low) console.log(`  ${pctS(r.unique)}  ${r.path}  vs ${r.neighbour}`);

  for (const t of SEO_TRADES) {
    const tr = withN.filter((r) => r.path.startsWith(`/cost/${t.slug}/`));
    console.log(`  ${t.slug.padEnd(22)} median words ${q(tr.map((r) => r.words), 0.5)}, median unique ${pctS(q(tr.map((r) => r.unique), 0.5))}, under 25% ${tr.filter((r) => r.unique < 0.25).length}/${tr.length}`);
  }

  // Each option against its cited installed range, on 10 cities a fixed seed picks.
  let seed = 20261026;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const sample = [...SEO_CITIES].sort(() => rnd() - 0.5).slice(0, 10);
  console.log(`\nPrices against the cited source (10 cities: ${sample.map((c) => c.slug).join(", ")}):`);
  for (const t of SEO_TRADES) {
    for (const v of t.variants) {
      const cal = calibration(t, v.id);
      if (!cal || cal.from !== v.id) {
        console.log(`  ${t.slug.padEnd(20)} ${v.id.padEnd(15)} no source of its own${cal ? `; scaled ×${cal.k.toFixed(3)} with ${cal.from}` : ""}`);
        continue;
      }
      const per = cal.per === "unit" ? t.size.typical : 1;
      const mid = (cal.cited[0] + cal.cited[1]) / 2;
      const devs = sample.map((c) => quote(t, c, t.size.typical, v.id).avg / per / (mid * c.factor) - 1);
      const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
      console.log(
        `  ${t.slug.padEnd(20)} ${v.id.padEnd(15)} cited ${cal.cited.map((x) => x.toLocaleString("en-US")).join("–")} ${cal.per === "unit" ? t.size.per : "per job"}; book as built ${pctS(cal.book / mid - 1)}; ×${cal.k.toFixed(3)}; page ${pctS(mean)} (${pctS(Math.min(...devs))} … ${pctS(Math.max(...devs))})${Math.abs(mean) > 0.2 ? "  OVER 20%" : ""}`,
      );
    }
  }

  if (csvPath) {
    writeFileSync(csvPath, ["path,words,neighbour,unique_lcs,unique_shingles,broken_links,has_price,canonical_ok,fetched", ...rows.map((r) => [r.path, r.words, r.neighbour, r.unique.toFixed(4), r.shingle.toFixed(4), r.broken.length, r.price, r.canonicalOk, r.fetched].join(","))].join("\n"));
    console.log(`\nwrote ${csvPath}`);
  }
}

void main();
