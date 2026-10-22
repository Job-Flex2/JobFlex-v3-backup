"use client";
// Customer development — the small shared pieces (owner, 2026-10-22): the verdict stamp, the source label, a
// measured bar, a figure that says "—" when no one is behind it.
import type { HypothesisView, VoiceSource } from "@/lib/custDev/model";
import { Chip, type Tone } from "@/components/v3/admin-influencers/admin-ui";
import { SHOWN_WORDS_PLAIN } from "./custdev-words";
import s from "./custdev.module.css";

export const SHOWN_WORDS: Record<HypothesisView["shown"], { label: string; tone: Tone }> = SHOWN_WORDS_PLAIN;

export function Verdict({ shown }: { shown: HypothesisView["shown"] }) {
  const w = SHOWN_WORDS[shown];
  return <Chip tone={w.tone}>{w.label}</Chip>;
}

export const SOURCE_WORDS: Record<VoiceSource, string> = { support: "Support", email: "Email", cancel: "Cancelled", trial: "Trial note" };

export function Source({ source }: { source: VoiceSource }) {
  return <span className={s.source} data-source={source}>{SOURCE_WORDS[source]}</span>;
}

/** A horizontal bar, its length a share of the largest. */
export function Bar({ value, max, tone = "bp" }: { value: number; max: number; tone?: "bp" | "ok" | "wait" | "bad" | "mute" }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className={s.bar} aria-hidden="true">
      <span className={s.barFill} data-tone={tone} style={{ width: `${w}%` }} />
    </span>
  );
}

export const hours = (h: number | null) => (h === null ? "—" : h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
export const dateWords = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const shortWords = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
