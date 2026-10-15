"use client";

// Press-and-speak for a text field (owner, 2026-09-18: "add the voice, so
// that I can press and speak the prompt and it would type in by itself").
//
// The browser's own speech recognition (Web Speech API: Chrome, Edge, Safari
// on Mac and iOS; Firefox has none) — no audio leaves through our servers and
// no key is spent. Words land in the field as they are recognised: the
// interim guess is shown and replaced until the phrase is final, then the
// next phrase starts after it. `supported` is false where the API is
// missing, so the caller hides the button rather than showing one that
// cannot work.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};
type RecEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type RecCtor = new () => Rec;

function recognitionCtor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribeNever = () => () => {};
const hasRecognition = () => recognitionCtor() !== null;
const hasNoRecognition = () => false;

/** "the brief so far" + " " + "what was just said", with tidy spacing. */
function join(base: string, spoken: string): string {
  const b = base.replace(/\s+$/, "");
  const s = spoken.trim();
  if (!s) return b;
  return b ? `${b} ${s}` : s;
}

export type Dictation = {
  /** The browser can listen at all. False on the server and in Firefox. */
  supported: boolean;
  listening: boolean;
  /** One plain sentence when the microphone could not be used, else null. */
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

/**
 * @param value    the field's current text
 * @param onChange sets the field's text
 */
export function useDictation(value: string, onChange: (next: string) => void): Dictation {
  // False on the server and on the first client paint (so the markup
  // matches), true once the client is in charge and the API exists.
  const supported = useSyncExternalStore(subscribeNever, hasRecognition, hasNoRecognition);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Rec | null>(null);
  // The text before this session of speaking, and the phrases committed
  // since: the field shows base + finals + the interim guess.
  const baseRef = useRef("");
  const finalsRef = useRef("");
  // What this session last put in the field: if the field holds something else when the session ends (it was sent
  // and cleared, or edited), the end leaves it alone instead of writing the words back (2026-10-15).
  const wroteRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = valueRef.current;
    finalsRef.current = "";
    wroteRef.current = null;
    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) finalsRef.current = join(finalsRef.current, text);
        else interim = join(interim, text);
      }
      const next = join(join(baseRef.current, finalsRef.current), interim);
      wroteRef.current = next;
      onChangeRef.current(next);
    };
    rec.onerror = (e) => {
      const code = e.error ?? "";
      if (code === "aborted") return;
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "The microphone is blocked — allow it for this site in the browser's address bar and try again."
          : code === "no-speech"
            ? "Nothing was heard — press the microphone and speak."
            : code === "audio-capture"
              ? "No microphone was found."
              : code === "network"
                ? "Speech recognition needs a connection — check the network and try again."
                : "The microphone stopped — press it to try again.",
      );
    };
    rec.onend = () => {
      // The interim guess is gone with the session; the field keeps what was final — unless it changed meanwhile.
      if (wroteRef.current !== null && valueRef.current === wroteRef.current) onChangeRef.current(join(baseRef.current, finalsRef.current));
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setError("The microphone could not start — try again.");
    }
  }, []);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else start();
  }, [start, stop]);

  // Leaving the page while listening: let the session go.
  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop, toggle };
}
