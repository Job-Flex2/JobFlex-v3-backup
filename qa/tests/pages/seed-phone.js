// Seeds/unseeds test aiPhoneCall rows for the phone-page functional pass.
// node seed-phone.js up | down
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
// QA Co, resolved by slug at run time — never an organisation a person works in.
let ORG = "";
const SIL_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const NUMS = ["+15550100001", "+15550100002", "+15550100003"];

const tr = (lines) => lines.join("\n");
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

(async () => {
  ORG = (await p.organization.findUniqueOrThrow({ where: { slug: "qa-co" } })).id;
  const mode = process.argv[2];
  if (mode === "up") {
    await p.aiPhoneCall.createMany({
      data: [
        {
          organizationId: ORG, callSid: "TESTCA-0001", direction: "INBOUND", status: "COMPLETED",
          fromNumber: NUMS[0], toNumber: "+15550009999", durationSeconds: 184,
          startedAt: hoursAgo(1), endedAt: hoursAgo(0.95), recordingUrl: SIL_WAV,
          summary: "Homeowner asking about a cedar fence quote for a corner lot.",
          transcript: tr([
            "Agent: Thanks for calling Acme Contracting, how can I help?",
            "Caller: Hi, I need a quote for a cedar fence on a corner lot.",
            "Agent: Happy to help — what's the approximate footage?",
            "Caller: Around a hundred and fifty feet, six feet tall.",
          ]),
        },
        {
          organizationId: ORG, callSid: "TESTCA-0002", direction: "INBOUND", status: "COMPLETED",
          fromNumber: NUMS[1], toNumber: "+15550009999", durationSeconds: 61,
          startedAt: hoursAgo(3),
          summary: "Wrong number.",
          transcript: "Caller said it was a wrong number and hung up.",
        },
        {
          organizationId: ORG, callSid: "TESTCA-0003", direction: "OUTBOUND", status: "COMPLETED",
          fromNumber: "+15550009999", toNumber: NUMS[2], durationSeconds: 322,
          startedAt: hoursAgo(30),
          summary: "Follow-up on the Patel roof proposal.",
          transcript: tr(["You: Calling to follow up on the roof proposal.", "Caller: We are still deciding, call next week."]),
        },
      ],
    });
    console.log("seeded 3 test calls");
  } else if (mode === "down") {
    const calls = await p.aiPhoneCall.findMany({ where: { callSid: { startsWith: "TESTCA-" } }, select: { id: true, leadId: true } });
    await p.aiPhoneCall.deleteMany({ where: { callSid: { startsWith: "TESTCA-" } } });
    const leadIds = calls.map((c) => c.leadId).filter(Boolean);
    if (leadIds.length) await p.lead.deleteMany({ where: { id: { in: leadIds } } });
    const stray = await p.lead.deleteMany({ where: { organizationId: ORG, source: "phone", phone: { in: NUMS } } });
    console.log("removed", calls.length, "calls,", leadIds.length + stray.count, "leads");
  } else console.log("usage: up|down");
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
