"use server";
import { revalidatePath } from "next/cache";
import { requireEstimatorOrManager, requireRouteAccess } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { readStoredAsDataUrl } from "@/lib/media/privateStore";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";

export interface PhotoAnalysis {
  materials?: string[];
  estimatedMeasurements?: string;
  conditionNotes?: string;
  suggestedScope?: string;
}

export async function analyzeJobPhoto(photoId: string): Promise<
  | { ok: true; analysis: PhotoAnalysis; disabled?: false }
  | { ok: true; analysis: PhotoAnalysis; disabled: true }
  | { ok: false; error: string }
> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/jobs");
  await enforceRateLimit(`vision:${organizationId}`, 60, HOUR, "photo analyses");
  const photo = await db.jobPhoto.findUnique({
    where: { id: photoId },
    include: { job: { select: { organizationId: true } } },
  });
  if (!photo || photo.job.organizationId !== organizationId) {
    return { ok: false, error: "Photo not found" };
  }
  if (!isOpenAIEnabled()) {
    const stub: PhotoAnalysis = {
      materials: ["Shingles (asphalt)", "Underlayment"],
      estimatedMeasurements: "~2,400 sqft",
      conditionNotes: "Stub — add OPENAI_API_KEY for real analysis.",
      suggestedScope: "Replace aging shingles, check flashing at penetrations.",
    };
    await db.jobPhoto.update({
      where: { id: photoId },
      data: { analysis: JSON.stringify(stub) },
    });
    revalidatePath(`/dashboard/jobs/${photo.jobId}`);
    return { ok: true, analysis: stub, disabled: true };
  }
  // The card-less trial's AI ceiling (lib/trialMeter): one read, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  try {
    const result = await runVisionJson<PhotoAnalysis>({
      systemPrompt:
        'You are a senior construction estimator analyzing a job-site photo. Return JSON strictly: {materials: string[] (3-6 items), estimatedMeasurements: string (like "~2400 sqft" or "~180 linear ft"), conditionNotes: string (one sentence), suggestedScope: string (one sentence, what work would make sense).} No markdown.',
      userPrompt: "Analyze this job photo for a contractor estimate.",
      // A private photo (stage B) is not fetchable by the model: its bytes go instead.
      imageUrl: (await readStoredAsDataUrl(photo.url)) ?? photo.url,
    });
    if (!result) return { ok: false, error: "No analysis returned" };
    await db.jobPhoto.update({
      where: { id: photoId },
      data: { analysis: JSON.stringify(result) },
    });
    revalidatePath(`/dashboard/jobs/${photo.jobId}`);
    return { ok: true, analysis: result };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Vision call failed" };
  }
}
