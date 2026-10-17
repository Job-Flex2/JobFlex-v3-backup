"use server";
// THE INVESTOR PAGE'S ACTIONS (2026-10-06) — platform admin only. The
// reading itself is lib/investors (shared with the public link and the PDF);
// these are the days booked by hand, the start day, Meta's read and the link.
// No assumptions to set any more (owner, 2026-10-17: facts only).
import { requirePlatformAdmin } from "@/lib/orgContext";
import { addAdSpend, deleteAdSpend, investorReport, PLATFORMS, readInvestorSettings, rotateInvestorLink, saveInvestorSettings, type InvestorReport, type InvestorSettings, type SpendPlatform } from "@/lib/investors";

type Result = { ok: true; report: InvestorReport } | { ok: false; error: string };

async function fresh(): Promise<Result> {
  try {
    return { ok: true, report: await investorReport({ refreshMeta: "admin" }) };
  } catch {
    return { ok: false, error: "The figures could not be read. Try again in a moment." };
  }
}

export async function getInvestorReport(): Promise<InvestorReport> {
  await requirePlatformAdmin();
  return investorReport({ refreshMeta: "admin" });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Spend booked by hand over a span of days — a platform Meta does not report, or a day to correct. */
export async function addAdSpendAction(input: Record<string, unknown> = {}): Promise<Result> {
  const admin = await requirePlatformAdmin();
  const from = typeof input.from === "string" && DATE.test(input.from) ? input.from : "";
  const to = typeof input.to === "string" && DATE.test(input.to) ? input.to : from;
  const perDay = Number(input.perDayDollars);
  const platform = (PLATFORMS as readonly string[]).includes(String(input.platform)) ? (input.platform as SpendPlatform) : "meta";
  if (!from) return { ok: false, error: "Give the first day." };
  if (to < from) return { ok: false, error: "The last day is before the first." };
  if (!Number.isFinite(perDay) || perDay < 0 || perDay > 100000) return { ok: false, error: "Give the spend per day in dollars." };
  try {
    await addAdSpend({ from, to, perDayCents: Math.round(perDay * 100), platform, note: typeof input.note === "string" ? input.note : undefined }, admin.email ?? null);
  } catch {
    return { ok: false, error: "The spend could not be saved. Try again." };
  }
  return fresh();
}

export async function deleteAdSpendAction(input: Record<string, unknown> = {}): Promise<Result> {
  await requirePlatformAdmin();
  const id = typeof input.id === "string" ? input.id : "";
  if (!id) return { ok: false, error: "No entry given." };
  try {
    await deleteAdSpend(id);
  } catch {
    return { ok: false, error: "The entry could not be removed. Try again." };
  }
  return fresh();
}

/** The start day — the day the first campaign went live. */
export async function saveInvestorSettingsAction(input: Record<string, unknown> = {}): Promise<Result> {
  await requirePlatformAdmin();
  const patch: Partial<InvestorSettings> = {};
  if (input.sinceDate === null) patch.sinceDate = null;
  else if (typeof input.sinceDate === "string" && DATE.test(input.sinceDate)) patch.sinceDate = input.sinceDate;
  try {
    await saveInvestorSettings(patch);
  } catch {
    return { ok: false, error: "The settings could not be saved. Try again." };
  }
  return fresh();
}

/** Meta's own spend per day, the last 30 days, now (lib/metaAdSpend). */
export async function pullMetaSpendAction(): Promise<Result> {
  await requirePlatformAdmin();
  const { pullMetaSpend } = await import("@/lib/metaAdSpend");
  const pulled = await pullMetaSpend(30);
  if (!pulled.ok) return { ok: false, error: pulled.error ?? "Meta did not answer." };
  return fresh();
}

/** Make a shared link (a new one each time; the old one stops), or switch the current one on or off. */
export async function investorLinkAction(input: Record<string, unknown> = {}): Promise<Result> {
  await requirePlatformAdmin();
  try {
    if (input.rotate === true) await rotateInvestorLink();
    else if (typeof input.enabled === "boolean") {
      const s = await readInvestorSettings();
      if (!s.linkToken && input.enabled) await rotateInvestorLink();
      else await saveInvestorSettings({ linkEnabled: input.enabled });
    }
  } catch {
    return { ok: false, error: "The link could not be changed. Try again." };
  }
  return fresh();
}
