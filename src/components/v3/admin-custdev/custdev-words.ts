// Customer development — the verdict words, plain (no "use client"): the page's stamps and the printed report share them.
import type { HypothesisView } from "@/lib/custDev/model";

export type StampTone = "ok" | "bad" | "bp" | "mute" | "wait";

export const SHOWN_WORDS_PLAIN: Record<HypothesisView["shown"], { label: string; tone: StampTone }> = {
  validated: { label: "Validated", tone: "ok" },
  supported: { label: "Data supports", tone: "ok" },
  invalidated: { label: "Invalidated", tone: "bad" },
  refuted: { label: "Data does not support", tone: "bad" },
  testing: { label: "Testing", tone: "bp" },
  early: { label: "Too early", tone: "mute" },
};
