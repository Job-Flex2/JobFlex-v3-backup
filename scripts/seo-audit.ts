// The cost guides' audit (2026-10-26): reads every /cost page a production
// build rendered and reports, per page and in total —
//   · words of visible text in <main> (rule: at least 600);
//   · the share of it that differs from the same work's page for the
//     neighbouring city of the same state (rule: at least 25%), two ways:
//     word-level LCS ("unique") and 3-word shingles (Jaccard distance);
//   · internal links (<a href="/...">) that point at no page of the build
//     and are not a known app route;
//   · pages without a price ($ amount in the answer card).
//
//   npx tsx scripts/seo-audit.ts [distDir]       (default .next; JOBFLEX_DIST_DIR is read too)
//   npx tsx scripts/seo-audit.ts .next --csv out.csv
//
// Reads files only — no server, no database.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SEO_TRADES } from "../src/lib/seo/trades";
import { SEO_CITIES, sameStateCities } from "../src/lib/seo/cities";

const args = process.argv.slice(2);
const csvAt = args.indexOf("--csv");
const csvPath = csvAt >= 0 ? args[csvAt + 1] : null;
const dist = args.find((a, i) => !a.startsWith("--") && (csvAt < 0 || i !== csvAt + 1)) ?? process.env.JOBFLEX_DIST_DIR ?? ".next";
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

type Row = { path: string; words: number; neighbour: string; unique: number; shingle: number; broken: string[]; price: boolean; links: number };
const rows: Row[] = [];
const cache = new Map<string, { html: string; words: string[] }>();
function page(path: string) {
  const hit = cache.get(path);
  if (hit) return hit;
  const file = join(appDir, ...path.slice(1).split("/")) + ".html";
  if (!existsSync(file)) return null;
  const html = readFileSync(file, "utf8");
  const v = { html, words: words(mainText(html)) };
  cache.set(path, v);
  return v;
}

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
      return !built.has(bare);
    });
    const price = /class="[^"]*answerAvg[^"]*"[^>]*>\$[\d,]+/.test(p.html);
    rows.push({ path, words: p.words.length, neighbour: n?.slug ?? "", unique, shingle, broken, price, links: hrefs.length });
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
console.log(`pages expected ${SEO_TRADES.length * SEO_CITIES.length}, rendered ${rows.length}, missing ${missing.length}`);
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

const low = [...withN].sort((a, b) => a.unique - b.unique).slice(0, 15);
console.log(`\nLeast distinct pairs (word LCS):`);
for (const r of low) console.log(`  ${pctS(r.unique)}  ${r.path}  vs ${r.neighbour}`);

for (const t of SEO_TRADES) {
  const tr = withN.filter((r) => r.path.startsWith(`/cost/${t.slug}/`));
  console.log(`  ${t.slug.padEnd(22)} median words ${q(tr.map((r) => r.words), 0.5)}, median unique ${pctS(q(tr.map((r) => r.unique), 0.5))}, under 25% ${tr.filter((r) => r.unique < 0.25).length}/${tr.length}`);
}

if (csvPath) {
  writeFileSync(csvPath, ["path,words,neighbour,unique_lcs,unique_shingles,broken_links,has_price", ...rows.map((r) => [r.path, r.words, r.neighbour, r.unique.toFixed(4), r.shingle.toFixed(4), r.broken.length, r.price].join(","))].join("\n"));
  console.log(`\nwrote ${csvPath}`);
}
