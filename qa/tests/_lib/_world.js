// The records the page scripts need, made in QA Co and removed afterwards.
//   node qa/tests/_lib/_world.js up | down | status | guard      (from the project root)
// or, inside a script:   const world = require("./_world"); await world.up(); … await world.down();
//
// QA Co is a test-only organisation (CLAUDE.md, Test accounts): nothing here
// reads or writes an organisation a person works in, and `down` removes every
// row this file made — by organisation id, and the two teammates by address.
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { qaOrg, EMAIL, QA_ORG_SLUG } = require("./_qa");

// ── Safety ──────────────────────────────────────────────────────────────────
// Three things no script in this folder may ever do, enforced here rather than
// trusted to each script (settings-test once clicked "Delete account" on a page
// that had become real; it is gone from the repository).

/** 1. WHERE. Only a local development database: an SQLite file, or a server on
 *  this machine. Both the URL these scripts get (.env, or the process) and the
 *  one the dev server gets (.env.local wins there) are checked. Values are
 *  never printed — only which source failed. */
function databaseUrls() {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "..", "..", "..");
  const fromFile = (name) => {
    try {
      const m = fs.readFileSync(path.join(root, name), "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?/m);
      return m ? m[1].trim() : null;
    } catch { return null; }
  };
  return [["the process environment", process.env.DATABASE_URL || null], [".env", fromFile(".env")], [".env.local", fromFile(".env.local")]];
}
function isLocalDatabase(url) {
  if (/^file:/i.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch { return false; }
}
function assertLocalDatabase() {
  const seen = databaseUrls().filter(([, url]) => url);
  if (!seen.length) throw new Error("QA guard: no DATABASE_URL found — refusing to guess which database this is");
  for (const [where, url] of seen) {
    if (!isLocalDatabase(url)) throw new Error(`QA guard: DATABASE_URL from ${where} is not a local development database — nothing was run`);
  }
}

/** 2. WHO. The automation account, and only in QA Co or an organisation this
 *  set made for itself (the throwaway ones the data-level checks create). */
const THROWAWAY_SLUG = /^(qa-|qa_|stamp-check|gmail-fallback|refund-iso|reroute)/i;
async function assertQaIdentity(prisma) {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, include: { memberships: { include: { organization: { select: { id: true, slug: true, name: true } } } } } });
  if (!user) throw new Error(`QA guard: ${EMAIL} does not exist in this database — run the seed; nothing was run`);
  const active = user.memberships.find((m) => m.organizationId === user.activeOrgId)?.organization;
  if (!active || active.slug !== QA_ORG_SLUG) throw new Error(`QA guard: ${EMAIL} is working in "${active ? active.name : "no organisation"}", not QA Co — nothing was run`);
  const foreign = user.memberships.map((m) => m.organization).filter((o) => o.slug !== QA_ORG_SLUG && !THROWAWAY_SLUG.test(o.slug));
  if (foreign.length) throw new Error(`QA guard: ${EMAIL} has a seat in ${foreign.map((o) => '"' + o.name + '"').join(", ")} — an organisation people work in. Remove the seat; nothing was run`);
}
/** Both, in the order that writes nothing on failure. Call before anything else. */
async function assertSafe(prisma) {
  assertLocalDatabase();
  await assertQaIdentity(prisma);
}

/** 3. WHAT. Controls no script may press. `_qa.js` installs this list in every
 *  page before the first navigation: a click (or Enter/Space) on a match is
 *  swallowed in the page and the script dies on the spot, exit 1. */
const FORBIDDEN_CONTROLS = {
  selectors: [
    // deleting an account or an organisation
    '[data-act="delete-account"]', '[data-act="delete-org"]', '[data-act="delete-organization"]', "#deleteAccountBtn", "#deleteOrgBtn",
    // cancelling a subscription
    '[data-act="cancel-subscription"]', "#cancelSubBtn", '[data-mdl-ok="cancel-plan"]',
    // paid lookups: an EagleView order
    '[data-act="ev-order"]', '[data-act="order-report"]', "#orderReportBtn",
    // paid lookups: the roof page's Instant measure and its re-measure (2026-10-01)
    "#instantBtn", "#remeasureBtn",
  ],
  // matched against the control's own visible text and its aria-label, from the start, case-insensitive
  labels: [
    /^(permanently )?delete (my |this |the )?(account|organi[sz]ation|workspace|company)\b/i,
    /^(yes, )?(cancel|end) (my |the )?(subscription|plan|membership)\b/i,
    /^send (the )?(e-?mail|proposal|invoice|contract|estimate|reminder|campaign)\b/i,
    /^(e-?mail|send) (it )?to (the )?(client|customer|homeowner)\b/i,
    /^(order|buy|purchase) (a |the )?(roof |eagleview |measurement )?(report|measurement)\b/i,
    /^measure (this |the )?roof\b/i,
    /^re-?measure\b/i,
  ],
};

const TEAM = [
  { email: "qa-morgan@qa.test", name: "Morgan Lane", role: "SALES", says: "Morning — the Hartley estimate is ready for your review." },
  { email: "qa-casey@qa.test", name: "Casey Stone", role: "INSTALLER", says: "Crew is on site, starting tear-off." },
];
const JOBS = ["Roof replacement — Hartley", "Cedar fence — Okafor", "Gutter swap — Lindqvist"];
const CONVERSIONS = [
  { signupEmail: "fixture-one@qa.test", status: "PENDING" },
  { signupEmail: "fixture-two@qa.test", status: "CONVERTED", convertedAt: new Date() },
  { signupEmail: "fixture-three@qa.test", status: "PAID", convertedAt: new Date(), rewardCents: 5000 },
];
/** What the scripts may count on. */
const SHAPE = { conversations: TEAM.length, jobs: JOBS.length, conversions: CONVERSIONS.length, converted: 1, pending: 1 };

async function down(prisma = new PrismaClient()) {
  await assertSafe(prisma);
  const org = await qaOrg(prisma);
  const where = { organizationId: org.id };
  await prisma.reviewRequest.deleteMany({ where });
  await prisma.tradePost.deleteMany({ where }); // replies cascade
  await prisma.conversation.deleteMany({ where }); // participants + messages cascade
  await prisma.jobExpense.deleteMany({ where: { job: where } }).catch(() => {});
  await prisma.job.deleteMany({ where });
  await prisma.client.deleteMany({ where });
  await prisma.referralCode.deleteMany({ where }); // conversions cascade
  await prisma.membership.deleteMany({ where: { organizationId: org.id, user: { email: { in: TEAM.map((t) => t.email) } } } });
  await prisma.user.deleteMany({ where: { email: { in: TEAM.map((t) => t.email) } } });
}

async function up(prisma = new PrismaClient(), opts = {}) {
  await assertSafe(prisma);
  await down(prisma);
  const org = await qaOrg(prisma);
  const qa = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const hashedPassword = await bcrypt.hash("not-a-login-" + Date.now(), 4);
  for (const t of TEAM) {
    const user = await prisma.user.create({ data: { email: t.email, name: t.name, hashedPassword, activeOrgId: org.id } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: t.role } });
    await prisma.conversation.create({
      data: {
        organizationId: org.id,
        kind: "DIRECT",
        participants: { create: [{ userId: qa.id }, { userId: user.id }] },
        messages: { create: [{ authorId: user.id, body: t.says }] },
      },
    });
  }
  // No e-mail on the client: a review request for it is a copyable link, and nothing is ever sent.
  const client = await prisma.client.create({ data: { organizationId: org.id, name: "Fixture Homeowner", phone: "(555) 010-0142", address: "12618 NE 100th St", city: "Kirkland", state: "WA", zip: "98033" } });
  for (const title of JOBS) {
    await prisma.job.create({ data: { organizationId: org.id, clientId: client.id, title, status: "COMPLETED", startsAt: new Date(Date.now() - 9 * 864e5), endsAt: new Date(Date.now() - 7 * 864e5) } });
  }
  // Only on request: the reviews pass starts from "no reviews yet".
  if (opts.review) {
    const job = await prisma.job.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
    await prisma.reviewRequest.create({ data: { organizationId: org.id, jobId: job.id, clientId: client.id, status: "COMPLETED", rating: 5, comment: "Great crew, clean site, on schedule. (fixture)", completedAt: new Date() } });
  }
  // Only on request: the trade pass starts from an empty board; its tail wants a closed post with a reply.
  if (opts.closedTradePost) {
    await prisma.tradePost.create({ data: { organizationId: org.id, authorId: qa.id, title: "QA Trade Post — dump trailer for the week", body: "Fixture post.", category: "equipment", status: "CLOSED", replies: { create: [{ authorId: qa.id, body: "First reply from QA run." }] } } });
  }
  const code = await prisma.referralCode.create({ data: { organizationId: org.id, userId: qa.id, code: "QAF-" + Math.random().toString(36).slice(2, 7).toUpperCase() } });
  for (const c of CONVERSIONS) await prisma.referralConversion.create({ data: { codeId: code.id, ...c } });
  return { orgId: org.id, orgName: org.name, referralCode: code.code, jobTitles: JOBS, team: TEAM.map((t) => t.name), ...SHAPE };
}

async function status(prisma = new PrismaClient()) {
  await assertSafe(prisma);
  const org = await qaOrg(prisma);
  const where = { organizationId: org.id };
  return { org: org.name, conversations: await prisma.conversation.count({ where }), jobs: await prisma.job.count({ where }), clients: await prisma.client.count({ where }), referralCodes: await prisma.referralCode.count({ where }), teammates: await prisma.user.count({ where: { email: { in: TEAM.map((t) => t.email) } } }) };
}

module.exports = { up, down, status, assertSafe, assertLocalDatabase, isLocalDatabase, FORBIDDEN_CONTROLS, SHAPE, TEAM, JOBS };

if (require.main === module) {
  const prisma = new PrismaClient();
  const mode = process.argv[2];
  const run = mode === "up" ? up : mode === "down" ? down : mode === "status" ? status : mode === "guard" ? assertSafe : null;
  if (!run) { console.log("usage: up | down | status | guard"); process.exit(1); }
  run(prisma).then((r) => { console.log(mode, "→", JSON.stringify(r ?? "done")); return prisma.$disconnect(); }).catch((e) => { console.error(e.message); process.exit(1); });
}
