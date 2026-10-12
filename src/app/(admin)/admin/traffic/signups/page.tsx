// ADMIN · SIGNUPS & TRIALS — /admin/traffic/signups (owner, 2026-10-12): the signups section of the traffic page, on a
// page of its own under Traffic — who is on a trial with a card and without, the trials in the order they end, the
// seven-day calendar of signup days and what became of each, who started paying and how, who left, what each trial did,
// and the full signups list. Read-only; lib/trialBoardRead reads, lib/trialBoard reckons.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { getSignupLedger } from "@/actions/trafficDashboard";
import { readTrialBoard } from "@/lib/trialBoardRead";
import { TrialBoardContent } from "@/components/v3/admin-signups/trial-board";

export default async function AdminSignupsPage() {
  await requirePlatformAdmin();
  // The list below the board keeps its own read and its own failure: without it the board still stands.
  const [board, ledger] = await Promise.all([readTrialBoard(), getSignupLedger().catch(() => null)]);
  return <TrialBoardContent initial={board} ledger={ledger} />;
}
