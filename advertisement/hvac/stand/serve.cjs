// next start -p 3488 over .cache/hvac-ad/hvac-ad.db (a copy of dev.db), own distDir .next-hvacad-prod.
// The lookups' keys come from .env.local as usual; Stripe, mail, SMS, Meta, PostHog are blanked.
const ROOT = "C:/Projects/JobFlex-v3-copy";
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const env = { ...process.env };
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) { const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/); if (m) delete env[m[1]]; }
Object.assign(env, {
  NODE_ENV: "production", JOBFLEX_DIST_DIR: ".next-hvacad-prod", AUTH_TRUST_HOST: "true", DATABASE_URL: `file:${ROOT}/.cache/hvac-ad/hvac-ad.db`,
  NEXTAUTH_URL: "http://localhost:3488", NEXT_PUBLIC_APP_URL: "http://localhost:3488",
  STRIPE_SECRET_KEY: "", STRIPE_SECRET_KEY_TEST: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_PASSWORD: "",
  META_CAPI_ACCESS_TOKEN: "", TWILIO_AUTH_TOKEN: "", TWILIO_ACCOUNT_SID: "", NEXT_PUBLIC_POSTHOG_KEY: "",
  // the local ReportAll key is expired (401): blank, the parcel step reads the county assessor and the footprints come from OSM/Regrid
  REPORTALL_CLIENT_KEY: "",
});
const out = fs.openSync(path.join(ROOT, ".cache/hvac-ad/server.log"), "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3488"], { cwd: ROOT, env, stdio: ["ignore", out, out], detached: true });
child.unref();
console.log("pid", child.pid);
