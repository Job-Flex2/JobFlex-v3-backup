"use client";

// HVAC SERVICES — the pieces every tab of the desk shares (2026-10-18): the
// class mapper, the desk's context (the data, the tab switch, the one
// "act" that runs a server action and answers in words), icons, plates.

import { createContext, useContext } from "react";
import type { ServiceDeskData } from "@/lib/serviceDeskBook";
import styles from "./service-desk.module.css";

export const cx = (...names: Array<string | false | null | undefined>) =>
  names
    .filter(Boolean)
    .map((n) => styles[n as string] ?? n)
    .join(" ");

export type DeskTab = "today" | "schedule" | "clients" | "plans" | "reminders";

/** Runs a server action: busy while it runs, its words (or the failure's) in the answer line, then a fresh read. */
export type Act = (key: string, fn: () => Promise<unknown>, okNote?: string) => Promise<boolean>;

export type EnrollPreset = { clientId?: string; proposalId?: string | null; nonce: number };
export type ReminderPreset = { clientId?: string | null; planId?: string | null; note?: string; nonce: number };

export interface DeskCtx {
  data: ServiceDeskData;
  act: Act;
  busy: string | null;
  goTab: (t: DeskTab, focus?: string | null) => void;
  focus: string | null;
  enroll: (p: Omit<EnrollPreset, "nonce">) => void;
  enrollPreset: EnrollPreset | null;
  remind: (p: Omit<ReminderPreset, "nonce">) => void;
  reminderPreset: ReminderPreset | null;
}

export const DeskContext = createContext<DeskCtx | null>(null);

export function useDesk(): DeskCtx {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk outside the service desk");
  return ctx;
}

export function Ic({ id }: { id: string }) {
  return (
    <svg className={cx("ic")} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function Plate({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cx("plate", `plate--${tone}`)}>{children}</span>;
}

export const PHASE_LABEL: Record<string, string> = { draft: "Draft", sent: "Sent to sign", active: "Active", expiring: "Ending soon", lapsed: "Ran out", expired: "Ended", canceled: "Canceled" };

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const clientHref = (id: string) => `/dashboard/client-detail?client=${encodeURIComponent(id)}`;

/** "Oct 23" from an ISO instant, in the shop's zone. */
export function shortDay(isoString: string | null, tz: string): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
  } catch {
    return isoString.slice(0, 10);
  }
}

/** A "YYYY-MM-DD" day as "Thu, Oct 23". */
export function dayWords(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
