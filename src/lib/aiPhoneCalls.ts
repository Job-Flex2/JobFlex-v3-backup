// Plain server module (NOT "use server") for the Twilio-webhook side of the AI
// phone system. These take a caller-supplied organizationId / callSid and write
// leads + call records, so they must NEVER be exposed as invokable server
// actions — the only legitimate caller is a Twilio webhook route that has first
// verified the X-Twilio-Signature. The session-guarded action createLeadFromCall
// stays in src/actions/aiPhoneCalls.ts.
import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, samplingOptions, resolveOpenAIModel } from "@/lib/sdk/openai";

export async function startInboundCall(
  callSid: string,
  from: string,
  to: string,
  organizationId: string,
) {
  const existing = await db.aiPhoneCall.findUnique({ where: { callSid } });
  if (existing) return existing;
  return db.aiPhoneCall.create({
    data: {
      organizationId,
      direction: "INBOUND",
      fromNumber: from,
      toNumber: to,
      status: "IN_PROGRESS",
      callSid,
    },
  });
}

export async function attachRecording(callSid: string, url: string, durationSeconds: number) {
  const call = await db.aiPhoneCall.findUnique({ where: { callSid } });
  if (!call) return null;
  return db.aiPhoneCall.update({
    where: { callSid },
    data: {
      recordingUrl: url,
      durationSeconds,
      status: "COMPLETED",
      endedAt: new Date(),
    },
  });
}

export async function attachTranscript(callSid: string, transcript: string, opts: { lead?: boolean } = {}) {
  const call = await db.aiPhoneCall.findUnique({ where: { callSid } });
  if (!call) return null;
  const updated = await db.aiPhoneCall.update({
    where: { callSid },
    data: { transcript },
  });
  // Kick off summarization in-line (best-effort). The live desk (lib/aiDesk) passes
  // lead:false when it already booked a visit or took a message for this call.
  try {
    await summarizeAndMaybeCreateLead(updated.id, opts.lead !== false);
  } catch (err) {
    console.warn("[attachTranscript] summarize failed:", err);
  }
  return updated;
}

async function summarizeAndMaybeCreateLead(callId: string, mayCreateLead = true) {
  const call = await db.aiPhoneCall.findUnique({ where: { id: callId } });
  if (!call || !call.transcript) return;
  if (!isOpenAIEnabled()) {
    // Fallback: first 120 chars as summary
    await db.aiPhoneCall.update({
      where: { id: callId },
      data: { summary: call.transcript.slice(0, 140) + (call.transcript.length > 140 ? "…" : "") },
    });
    return;
  }

  // The model this process can actually call, asked once per process and
  // remembered (lib/sdk/openai). OPENAI_MODEL's import-time snapshot answers
  // with whatever string the environment holds, and a string is not an
  // entitlement: a model the key's project has no access to fails every call
  // with 403 model_not_found. Resolved here instead, so one check covers the
  // process and the fallback is a working model rather than a dead one.
  const model = await resolveOpenAIModel();
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model,
    ...(await samplingOptions(0.2)),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You summarize contractor phone-call transcripts. Return JSON: {summary: string (one sentence), shouldCreateLead: boolean, leadData: {name?: string, email?: string, phone?: string, projectType?: string, description?: string}}. shouldCreateLead = true when the caller describes a project and provides enough context to contact them back.',
      },
      { role: "user", content: call.transcript.slice(0, 4000) },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(text) as {
      summary?: string;
      shouldCreateLead?: boolean;
      leadData?: {
        name?: string;
        email?: string;
        phone?: string;
        projectType?: string;
        description?: string;
      };
    };
    await db.aiPhoneCall.update({
      where: { id: callId },
      data: { summary: parsed.summary ?? null },
    });
    if (mayCreateLead && parsed.shouldCreateLead && parsed.leadData) {
      // Quota: intentionally ALLOW-BUT-COUNT — automatic lead capture from a
      // completed call is never blocked (the call itself was already gated at
      // the voice webhook); the Lead row still counts toward "leads" usage.
      const lead = await db.lead.create({
        data: {
          organizationId: call.organizationId,
          name: parsed.leadData.name ?? call.fromNumber,
          email: parsed.leadData.email ?? null,
          phone: parsed.leadData.phone ?? call.fromNumber,
          projectType: parsed.leadData.projectType ?? null,
          description: parsed.leadData.description ?? null,
          source: "phone",
          aiCategory: parsed.leadData.projectType ?? null,
        },
      });
      await db.aiPhoneCall.update({
        where: { id: callId },
        data: { leadId: lead.id },
      });
      await db.activityEvent.create({
        data: {
          organizationId: call.organizationId,
          leadId: lead.id,
          kind: "CALL",
          summary: `Auto-created lead from inbound call ${call.fromNumber}`,
        },
      });
    }
  } catch (err) {
    console.warn("[summarize] parse failed:", err);
  }
}
