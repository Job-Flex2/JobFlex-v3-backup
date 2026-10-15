// npm run qa:accept -- <id> [<id> …]      make the latest run's "after" picture the new baseline
// npm run qa:accept -- --intended         accept every pair the analysis judged an intended change
// npm run qa:accept -- --run <folder> …   take the pictures from another run
// The ids are printed in the report next to each visual difference (390--owner--dashboard-jobs).
import fs from "node:fs";
import path from "node:path";
import { ROOT, RUNS_DIR, latestRunDir } from "../lib/env";
import { baselinePath } from "../lib/visual";

const argv = process.argv.slice(2);
const runArg = argv.indexOf("--run");
const dir = runArg >= 0 ? path.resolve(RUNS_DIR, argv[runArg + 1]) : latestRunDir();
if (!dir || !fs.existsSync(dir)) {
  console.error("no run folder with raw.json under qa/runs — run npm run qa first");
  process.exit(1);
}
let ids = argv.filter((a, i) => !a.startsWith("--") && !(runArg >= 0 && i === runArg + 1));
if (argv.includes("--intended")) {
  const file = path.join(dir, "analysis.json");
  if (!fs.existsSync(file)) {
    console.error("no analysis.json in the run — npm run qa:analyze first");
    process.exit(1);
  }
  const a = JSON.parse(fs.readFileSync(file, "utf8")) as { visual?: { id: string; verdict: string }[] };
  ids = [...ids, ...(a.visual ?? []).filter((v) => v.verdict === "intended").map((v) => v.id)];
}
if (!ids.length) {
  console.error("usage: npm run qa:accept -- <id> [<id> …] | --intended   (ids are in the report's visual section)");
  process.exit(1);
}
let done = 0;
for (const id of [...new Set(ids)]) {
  if (!/^\d+--[a-z]+--[a-z0-9-]+$/.test(id)) {
    console.error(`skipped "${id}": not a visual id`);
    continue;
  }
  const after = path.join(dir, "baselines-diff", id, "after.png");
  if (!fs.existsSync(after)) {
    console.error(`skipped ${id}: no after.png in ${path.relative(ROOT, dir)}`);
    continue;
  }
  const base = baselinePath(id);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.copyFileSync(after, base);
  console.log(`accepted ${id} → ${path.relative(ROOT, base)}`);
  done++;
}
process.exit(done ? 0 : 1);
