// next start -p $PORT over $STAND/$DBNAME (a copy of dev.db), own distDir $DIST
// (defaults: 3511, .cache/roof-rec/rec.db, .next-roofrec-prod).
// The lookups' keys come from .env.local as usual; Stripe, mail, SMS, Meta, PostHog are blanked;
// EagleView goes through ev-guard.cjs (no new, billed order can leave the stand).
const ROOT = "C:/Projects/JobFlex-v3-copy";
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const PORT = process.env.PORT || "3511", DIST = process.env.DIST || ".next-roofrec-prod", STAND = process.env.STAND || ".cache/roof-rec", DBNAME = process.env.DBNAME || "rec.db";
const env = { ...process.env };
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) { const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/); if (m) delete env[m[1]]; }
Object.assign(env, {
  NODE_ENV: "production", JOBFLEX_DIST_DIR: DIST, AUTH_TRUST_HOST: "true", DATABASE_URL: `file:${ROOT}/${STAND}/${DBNAME}`,
  NEXTAUTH_URL: `http://localhost:${PORT}`, NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
  STRIPE_SECRET_KEY: "", STRIPE_SECRET_KEY_TEST: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_PASSWORD: "",
  META_CAPI_ACCESS_TOKEN: "", TWILIO_AUTH_TOKEN: "", TWILIO_ACCOUNT_SID: "", NEXT_PUBLIC_POSTHOG_KEY: "",
  // the local ReportAll key is expired (401)
  REPORTALL_CLIENT_KEY: "",
  // EagleView Property Data through the stand's guard (ev-guard.cjs): a stored order is read, a new one can't be placed
  EAGLEVIEW_PROPERTY_API_BASE_URL: `http://127.0.0.1:${process.env.EV_GUARD_PORT || 3512}`,
});
const out = fs.openSync(path.join(ROOT, STAND, "server.log"), "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", PORT], { cwd: ROOT, env, stdio: ["ignore", out, out], detached: true });
child.unref();
// the guard runs beside the server
const g = spawn(process.execPath, [path.join(__dirname, "ev-guard.cjs")], { cwd: ROOT, env: { ...process.env, STAND }, stdio: "ignore", detached: true });
g.unref();
console.log("pid", child.pid);
