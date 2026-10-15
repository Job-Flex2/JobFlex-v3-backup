"use client";

// DEMO stand-in for hvac-estimator-blueprint/use-hvac-walk.ts (2026-10-01):
// the same return shape, so the form's walk markup renders as it does on the
// real page. A clip picked here is probed and its stills pulled in the
// browser (video-ingest, no upload); the READING is the example house's
// walk, answered from a fixture after the pause a model run takes — the
// staged "Transcribing the audio" / "Reading the walk" the real page shows.

import { useCallback, useEffect, useRef, useState } from "react";
import type { WalkthroughAnalysis } from "@/lib/estimate/video-schema";
import {
  frameCountFor,
  frameFailureReason,
  openClip,
  pullNeedsTap,
  type ClipReader,
  type VideoFrame,
  type VideoProbe,
} from "@/components/v3/video-estimator-blueprint/video-ingest";

export type WalkStage = "frames" | "audio" | "read";

/** The example house's walk, as the reader would return it: the labels are
 *  the ones intake.ts matches, so the reading lands on the model's fields.
 *  No maker's name — the plates carry the model numbers. */
export const DEMO_WALK: WalkthroughAnalysis = {
  projectType: "other",
  title: "HVAC replacement survey — 4418 NE 97th St",
  location: "Kirkland, WA",
  work: [],
  behind: [],
  steps: [],
  permits: [],
  scope: "Two-storey 1978 house on a vented crawlspace, 1,980 sq ft conditioned. A 3-ton split AC on an 80% gas furnace, ducts in the crawl in fair shape, one undersized return in the hall. 200 A panel with four free slots. The owner wants the AC and furnace replaced together and asked about a heat pump.",
  measurements: [
    { label: "Square footage", value: "1,980", unit: "sq ft", confidence: "high", source: "spoken" },
    { label: "Storeys", value: "2", confidence: "high", source: "visual" },
    { label: "Year built", value: "1978", confidence: "medium", source: "spoken" },
    { label: "Outdoor unit model", value: "AC13-036", confidence: "high", source: "visual" },
    { label: "Outdoor unit tons", value: "3", unit: "ton", confidence: "high", source: "visual" },
    { label: "Refrigerant", value: "R-410A", confidence: "high", source: "visual" },
    { label: "SEER", value: "13", confidence: "medium", source: "visual" },
    { label: "Furnace model", value: "G80-080", confidence: "high", source: "visual" },
    { label: "Furnace BTU input", value: "80,000", unit: "BTU/h", confidence: "high", source: "visual" },
    { label: "AFUE", value: "80", unit: "%", confidence: "medium", source: "visual" },
    { label: "Main breaker", value: "200", unit: "A", confidence: "high", source: "visual" },
    { label: "Free breaker slots", value: "4", confidence: "high", source: "visual" },
    { label: "Return grille size", value: "20x20", unit: "in", confidence: "medium", source: "visual" },
    { label: "Gas pipe size", value: "3/4", unit: "in", confidence: "medium", source: "visual" },
  ],
  observations: [
    "Ducts run in the crawlspace; flex runs sagging in places, fair condition, uninsulated in part.",
    "Vented crawlspace foundation; double-pane windows throughout.",
    "Gas furnace, gas water heater and gas range; electric dryer.",
    "The owner said they are considering a heat pump and want it quiet — the bedroom is over the outdoor unit.",
  ],
  frames: [],
  enoughDetail: true,
  questions: [],
  confidence: 82,
  transcriptHighlights: ["\"It's about nineteen-eighty square feet, built in seventy-eight.\"", "\"We'd go heat pump if it makes sense.\""],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useHvacWalk(_aiEnabled: boolean) {
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [frames, setFrames] = useState<VideoFrame[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<WalkStage | null>(null);
  const [stageNote, setStageNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audioState, setAudioState] = useState<"pending" | "ok" | "partial" | "none" | "failed">("pending");
  const pickSeq = useRef(0);
  const previewRef = useRef<string | null>(null);
  /** The clip open for the still pass; closed on a new pick, on remove and on unmount. */
  const readerRef = useRef<ClipReader | null>(null);
  /** The browser wants a tap before it reads the clip (iOS, Low Power Mode): the stills are pulled inside the Read tap instead. */
  const [framesDeferred, setFramesDeferred] = useState(false);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      readerRef.current?.close();
    },
    [],
  );

  const removeFile = useCallback(() => {
    pickSeq.current += 1;
    readerRef.current?.close();
    readerRef.current = null;
    setFramesDeferred(false);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null); setFile(null); setProbe(null); setFrames([]); setStage(null); setStageNote(""); setError(""); setAudioState("pending");
  }, []);

  const pickFile = useCallback(async (f: File) => {
    setError("");
    // One open for the probe and the stills, started inside the gesture that
    // picked the file — see video-ingest's header on iOS.
    readerRef.current?.close();
    const reader = openClip(f);
    readerRef.current = reader;
    const token = ++pickSeq.current;
    let p: VideoProbe;
    try {
      p = await reader.ready;
    } catch (err) {
      reader.close();
      if (readerRef.current === reader) readerRef.current = null;
      if (pickSeq.current !== token) return;
      setError(err instanceof Error ? err.message : "Could not read that file.");
      return;
    }
    if (pickSeq.current !== token) {
      reader.close();
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setPreviewUrl(url); setFile(f); setProbe(p); setFrames([]);
    setStage("frames"); setStageNote(`0 / ${frameCountFor(p.duration)}`);
    try {
      const { frames: out, report } = await reader.frames((done, total) => { if (pickSeq.current === token) setStageNote(`${done} / ${total}`); });
      if (pickSeq.current !== token) return;
      // A refusal for want of a gesture alone is not an error: the stills come from the Read tap.
      if (out.length === 0 && pullNeedsTap(report)) setFramesDeferred(true);
      else if (out.length === 0) setError(`Couldn't pull any frames — ${frameFailureReason(report)}. Add it again, or export the clip as MP4 (1080p) and add that.`);
      setFrames(out);
    } catch (err) {
      if (pickSeq.current !== token) return;
      setError(err instanceof Error ? err.message : "Could not read the video.");
    } finally {
      reader.close();
      if (readerRef.current === reader) readerRef.current = null;
      if (pickSeq.current === token) { setStage(null); setStageNote(""); }
    }
  }, []);

  const framesReady = frames.length > 0 && stage !== "frames";
  const canRead = !!file && !!probe && (framesReady || (framesDeferred && stage !== "frames")) && !busy;

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const read = useCallback(async (_address: string): Promise<WalkthroughAnalysis | null> => {
    if (!canRead || !file || !probe) return null;
    // Stills deferred to this tap (iOS reads a clip from a gesture only): the
    // clip is opened HERE, before the first await, so the tap still covers it.
    let deferredClip: ClipReader | null = null;
    if (frames.length === 0 && framesDeferred) { readerRef.current?.close(); deferredClip = openClip(file); readerRef.current = deferredClip; }
    setError("");
    setBusy(true);
    try {
      if (deferredClip) {
        setStage("frames"); setStageNote(`0 / ${frameCountFor(probe.duration)}`);
        try {
          await deferredClip.ready;
          const pulled = await deferredClip.frames((d, t) => setStageNote(`${d} / ${t}`));
          if (!pulled.frames.length) {
            setError(pullNeedsTap(pulled.report) ? "Couldn't pull any frames — the browser refused to play this clip even from a tap (NotAllowedError). Export it as MP4 (1080p) and add that." : `Couldn't pull any frames — ${frameFailureReason(pulled.report)}. Add it again, or export the clip as MP4 (1080p) and add that.`);
            return null;
          }
          setFrames(pulled.frames);
          setFramesDeferred(false);
        } finally {
          deferredClip.close();
          if (readerRef.current === deferredClip) readerRef.current = null;
        }
      }
      setStage("audio"); setStageNote("1 / 1");
      await wait(1400);
      setAudioState("ok");
      setStage("read"); setStageNote("");
      await wait(1800);
      return structuredClone(DEMO_WALK);
    } finally {
      setBusy(false); setStage(null); setStageNote("");
    }
  }, [canRead, file, probe, frames, framesDeferred]);

  const stageText = stage
    ? `${stage === "frames" ? "Pulling stills" : stage === "audio" ? "Transcribing the audio" : "Reading the walk"}${stageNote ? ` · ${stageNote}` : ""}`
    : "";
  const stagePct = stage === "frames" ? 20 : stage === "audio" ? 55 : stage === "read" ? 85 : 0;

  return { file, probe, frames, framesDeferred, previewUrl, stage, stageText, stagePct, busy, error, audioState, canRead, pickFile, removeFile, read };
}
