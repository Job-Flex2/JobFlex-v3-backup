"use client";

// The video walk, for the HVAC estimator: the same browser-side reading the
// video estimator does (probe → stills → audio → transcript → the model's
// reading), without the pricing steps — here the reading feeds the building
// model and the engine prices deterministically. video-ingest.ts is reused
// as is; only the ticket text differs, so the reader knows what to look for.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { analyzeWalkthrough } from "@/actions/videoEstimator";
import type { WalkthroughAnalysis } from "@/lib/estimate/video-schema";
import { ensureWithinLimit, reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import {
  TranscribeError,
  extractAudioChunks,
  frameCountFor,
  frameFailureReason,
  openClip,
  pullNeedsTap,
  transcribeChunks,
  transcriptText,
  type ClipReader,
  type VideoFrame,
  type VideoProbe,
} from "@/components/v3/video-estimator-blueprint/video-ingest";

export type WalkStage = "frames" | "audio" | "read";

/** What the reader is told to pull out of an HVAC walk. The labels are the
 *  ones intake.ts matches, so a reading lands on the right fields. */
export const HVAC_WALK_NOTES = [
  "HVAC replacement survey. Read every nameplate and panel you can see and report each figure as its own measurement with these labels:",
  "Square footage · Storeys · Ceiling height · Year built · Bedrooms · Main breaker (amps) · Free breaker slots · Outdoor unit brand · Outdoor unit model · Outdoor unit serial · Outdoor unit tons or BTU · Refrigerant · Furnace brand · Furnace model · Furnace BTU input · AFUE · SEER · Return grille size · Gas pipe size · Static pressure.",
  "Copy model and serial numbers character for character. In observations, say where the ducts run (attic, crawlspace, basement, none) and their condition (good, fair, poor, uninsulated), the foundation (slab, crawlspace, basement), the window type (single-pane, double-pane, low-E), the roof colour and shading, what runs on gas versus electric (furnace, water heater, range, dryer, EV charger), and anything the owner said about keeping gas, going all-electric, noise or comfort complaints.",
].join(" ");

export function useHvacWalk(aiEnabled: boolean) {
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

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      readerRef.current?.close();
    };
  }, []);

  const removeFile = useCallback(() => {
    pickSeq.current += 1;
    readerRef.current?.close();
    readerRef.current = null;
    setFramesDeferred(false);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setFile(null);
    setProbe(null);
    setFrames([]);
    setStage(null);
    setStageNote("");
    setError("");
    setAudioState("pending");
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
      const msg = err instanceof Error ? err.message : "Could not read that file.";
      setError(msg);
      toast.error("Can't use that video", msg);
      return;
    }
    if (pickSeq.current !== token) {
      reader.close();
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(f);
    setProbe(p);
    setFrames([]);
    setAudioState("pending");
    setStage("frames");
    setStageNote(`0 / ${frameCountFor(p.duration)}`);
    try {
      const { frames: out, report } = await reader.frames((done, total) => {
        if (pickSeq.current === token) setStageNote(`${done} / ${total}`);
      });
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
      if (pickSeq.current === token) {
        setStage(null);
        setStageNote("");
      }
    }
  }, []);

  const framesReady = frames.length > 0 && stage !== "frames";
  const canRead = !!file && !!probe && (framesReady || (framesDeferred && stage !== "frames")) && !busy;

  /** Transcribe and read the clip. Resolves to the reading, or null when it
   *  failed (the error is already on screen). */
  const read = useCallback(
    async (address: string): Promise<WalkthroughAnalysis | null> => {
      if (!canRead || !file || !probe) return null;
      if (!aiEnabled) {
        const msg = "Video reading needs OPENAI_API_KEY — type the facts below instead.";
        setError(msg);
        toast.error("Estimator not configured", msg);
        return null;
      }
      // Stills deferred to this tap (iOS reads a clip from a gesture only): the
      // clip is opened HERE, before the first await, so the tap still covers it.
      let deferredClip: ClipReader | null = null;
      if (frames.length === 0 && framesDeferred) {
        readerRef.current?.close();
        deferredClip = openClip(file);
        readerRef.current = deferredClip;
      }
      if (!(await ensureWithinLimit("hvacEstimates")) || !(await ensureWithinLimit("estimatorUses"))) {
        deferredClip?.close();
        return null;
      }
      setError("");
      setBusy(true);
      setStage("audio");
      setStageNote("");
      try {
        let stills = frames;
        if (deferredClip) {
          setStage("frames");
          setStageNote(`0 / ${frameCountFor(probe.duration)}`);
          try {
            await deferredClip.ready;
            const pulled = await deferredClip.frames((d, t) => setStageNote(`${d} / ${t}`));
            stills = pulled.frames;
            if (!stills.length) {
              const msg = pullNeedsTap(pulled.report)
                ? "Couldn't pull any frames — the browser refused to play this clip even from a tap (NotAllowedError). Export it as MP4 (1080p) and add that."
                : `Couldn't pull any frames — ${frameFailureReason(pulled.report)}. Add it again, or export the clip as MP4 (1080p) and add that.`;
              setError(msg);
              toast.error("Can't read the video", msg);
              return null;
            }
            setFrames(stills);
            setFramesDeferred(false);
          } finally {
            deferredClip.close();
            if (readerRef.current === deferredClip) readerRef.current = null;
          }
          setStage("audio");
          setStageNote("");
        }
        let transcript = "";
        let audio: "ok" | "none" | "failed" = "none";
        let partial = false;
        const chunks = await extractAudioChunks(file, (d, t) => setStageNote(`decoding ${d} / ${t}`));
        if (chunks) {
          try {
            const { segments, failed } = await transcribeChunks(chunks, (d, t) => setStageNote(`${d} / ${t}`));
            if (segments.length) {
              transcript = transcriptText(segments);
              audio = "ok";
              partial = failed > 0;
            } else audio = failed > 0 ? "failed" : "none";
          } catch (err) {
            if (err instanceof TranscribeError && err.code === "PLAN_LIMIT_REACHED") {
              reportPlanLimitResult({ ok: false, error: err.message, code: err.code, resource: err.resource, trialCap: err.trialCap });
              setError(err.message);
              return null;
            }
            audio = "failed";
          }
        }
        setAudioState(partial ? "partial" : audio);
        setStage("read");
        setStageNote("");
        const res = await analyzeWalkthrough({
          frames: stills,
          transcript,
          audioState: audio,
          duration: probe.duration,
          project: "HVAC replacement survey",
          address,
          notes: HVAC_WALK_NOTES,
        });
        if (!res.ok) {
          if (!reportPlanLimitResult(res)) toast.error("Couldn't read the walk", res.error);
          setError(res.error);
          return null;
        }
        return res.data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "The reading failed.";
        setError(msg);
        toast.error("Couldn't read the walk", msg);
        return null;
      } finally {
        setBusy(false);
        setStage(null);
        setStageNote("");
      }
    },
    [aiEnabled, canRead, file, frames, framesDeferred, probe],
  );

  const stageText = stage
    ? `${stage === "frames" ? "Pulling stills" : stage === "audio" ? "Transcribing the audio" : "Reading the walk"}${stageNote ? ` · ${stageNote}` : ""}`
    : "";
  const stagePct = stage === "frames" ? 20 : stage === "audio" ? 55 : stage === "read" ? 85 : 0;

  return { file, probe, frames, framesDeferred, previewUrl, stage, stageText, stagePct, busy, error, audioState, canRead, pickFile, removeFile, read };
}
