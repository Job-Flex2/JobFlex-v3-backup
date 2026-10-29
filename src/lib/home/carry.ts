// THE HOMEOWNER'S WORDS, CARRIED (2026-10-28, lib/home/portalPrice). What they wrote in the portal's box goes with
// them into the estimator they pick — the brief of "any project", the note to the pro on the others — so nothing is
// typed twice. Kept in this tab's sessionStorage for half an hour, never in the address (the address goes to the
// analytics). Read through useSyncExternalStore: the server and the first paint see nothing, the browser then fills in.
// Client components only.

import { useSyncExternalStore } from "react";

const KEY = "jf-home-words";
const FRESH_MS = 30 * 60 * 1000;
const MAX = 2000;

export function putCarriedWords(text: string): void {
  const words = String(text ?? "").trim().slice(0, MAX);
  try {
    if (words) sessionStorage.setItem(KEY, JSON.stringify({ words, at: Date.now() }));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode or storage off: they type it again, nothing breaks */
  }
}

export function clearCarriedWords(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

function read(): string {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return "";
    const v = JSON.parse(raw) as { words?: unknown; at?: unknown };
    if (typeof v.words !== "string" || typeof v.at !== "number" || Date.now() - v.at > FRESH_MS) return "";
    return v.words.slice(0, MAX);
  } catch {
    return "";
  }
}

const subscribe = () => () => {};
const none = () => "";

/** The words carried from the portal's box, or "" (none, too old, or on the server). */
export function useCarriedWords(): string {
  return useSyncExternalStore(subscribe, read, none);
}
