"use server";
// THE TRIAL CARD SWITCH (2026-10-07) — platform admin only; lib/trialPolicyServer.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { resetTrialPolicy, setSignupSteps, setTrialRequiresCard, signupTrialState, type SignupFlow, type SignupTrialState } from "@/lib/trialPolicyServer";

type Result = { ok: true; policy: SignupTrialState } | { ok: false; error: string };

export async function setTrialCardPolicyAction(input: Record<string, unknown> = {}): Promise<Result> {
  const admin = await requirePlatformAdmin();
  if (typeof input.requiresCard !== "boolean") return { ok: false, error: "Say whether a card is required." };
  try {
    return { ok: true, policy: await setTrialRequiresCard(input.requiresCard, admin.name || admin.email || null) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

/** Reset to default (env): the row goes and TRIAL_REQUIRES_CARD decides again. */
export async function resetTrialCardPolicyAction(): Promise<Result> {
  await requirePlatformAdmin();
  try {
    return { ok: true, policy: await resetTrialPolicy() };
  } catch {
    return { ok: false, error: "The reset could not be saved. Try again." };
  }
}

/** The sign-up's steps, 2 or 3, or the passwordless sign-up (lib/trialPolicyServer). */
export async function setSignupStepsAction(input: Record<string, unknown> = {}): Promise<{ ok: true; signup: SignupFlow } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  if (input.steps !== 2 && input.steps !== 3) return { ok: false, error: "Pick 2 or 3 steps." };
  try {
    return { ok: true, signup: await setSignupSteps(input.steps, admin.name || admin.email || null, input.passwordless === true) };
  } catch {
    return { ok: false, error: "The switch could not be saved. Try again." };
  }
}

export async function readTrialCardPolicyAction(): Promise<SignupTrialState> {
  await requirePlatformAdmin();
  return signupTrialState({ fresh: true });
}
