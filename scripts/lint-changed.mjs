// npm run lint:changed — eslint over the .ts / .tsx files this branch changed, not the whole tree.
// The repository still carries a few hundred old lint errors (2026-10-22); CI fails only on errors
// in files that are new or changed relative to origin/main (LINT_BASE overrides the base).
//
// Changed = the branch's commits since it left the base (git diff --name-only --diff-filter=ACMR
// origin/main... -- '*.ts' '*.tsx'), plus — on a working copy — files edited but not committed
// yet and new untracked ones. In CI only the first set exists. Errors fail; warnings are printed.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.LINT_BASE || "origin/main";
const PATHS = ["*.ts", "*.tsx"];

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).split(/\r?\n/).filter(Boolean);

try {
  git("rev-parse", "--verify", "--quiet", BASE);
} catch {
  console.error(`lint:changed — ${BASE} is not known here. Fetch it first (git fetch origin main), or check out with full history (fetch-depth: 0).`);
  process.exit(2);
}

const files = new Set([
  ...git("diff", "--name-only", "--diff-filter=ACMR", `${BASE}...`, "--", ...PATHS),
  ...git("diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--", ...PATHS),
  ...git("ls-files", "--others", "--exclude-standard", "--", ...PATHS),
]);
const list = [...files].filter((f) => fs.existsSync(f)).sort();

if (!list.length) {
  console.log(`lint:changed — no .ts / .tsx file changed against ${BASE}.`);
  process.exit(0);
}
console.log(`lint:changed — ${list.length} file(s) changed against ${BASE}:`);
for (const f of list) console.log(`  ${f}`);

// In slices: a long branch would pass the Windows command-line limit in one call.
const eslint = require_eslint();
let failed = false;
for (let i = 0; i < list.length; i += 100) {
  const r = spawnSync(process.execPath, [eslint, "--no-warn-ignored", ...list.slice(i, i + 100)], { stdio: "inherit" });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);

function require_eslint() {
  const bin = "node_modules/eslint/bin/eslint.js";
  if (!fs.existsSync(bin)) {
    console.error("lint:changed — node_modules/eslint is missing; run npm ci.");
    process.exit(2);
  }
  return bin;
}
