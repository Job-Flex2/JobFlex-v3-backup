"use client";

// VIDEO ESTIMATOR — reading the clip IN THE BROWSER.
//
// Three things happen to a walkthrough before any model sees it, and all three
// happen on the device that picked the file:
//
//   openClip           — ONE <video> on the file. Its `ready` is the probe: is
//                        it a video, how long, what size (rejects > 5 minutes).
//   reader.frames      — seeks the same element through the clip and paints up
//                        to 14 evenly spaced stills onto a canvas → JPEG data
//                        URLs (~100–200KB each at 960px); plays the clip through
//                        for whatever a seek would not give.
//   extractAudioChunks — decodes the audio track with Web Audio, renders it to
//                        16kHz mono PCM through an OfflineAudioContext, and cuts
//                        it into ≤100s WAV chunks for the transcribe route.
//
// WHY HERE AND NOT ON A SERVER
// The server has no ffmpeg (Vercel functions) and a 4.5MB request cap; the
// browser has a hardware decoder for exactly this file already. Pulling stills
// and audio locally means the 200MB clip never leaves the phone — roughly 2MB of
// JPEG and a few MB of speech do. It is also what lets the page work with no
// storage bucket configured.
//
// WHY THE <video> IS IN THE PAGE, AND PLAYING BEFORE ANYTHING IS AWAITED
// (2026-10-14: a 35-second iPhone clip came back "Couldn't pull any frames".)
// Desktop engines decode a detached, paused <video> on every seek. iOS Safari
// promises none of that: it loads nothing past the metadata until the element
// plays, it refuses scripted playback for an element that is not rendered
// inside the viewport, and a seek on a clip that never loaded never lands —
// four six-second timeouts and no frames, which is what the phone showed. So:
//   · the element is mounted — a 4px box in the bottom-left corner, all but
//     transparent — not display:none and not off-screen, both of which iOS
//     counts as "not visible";
//   · play() is called in openClip itself, synchronously, before the first
//     await, so the user gesture that picked the file still covers it;
//   · the still pass has a second way through: when seeks do not land, the
//     clip is played at 2× and the stills are taken as the playhead crosses
//     each target time (`requestVideoFrameCallback`, `timeupdate` elsewhere).
//
// AND WHEN THE KICK IS REFUSED (2026-10-15: the owner's iPhone, in Low Power
// Mode, answered play() with NotAllowedError and no seek ever landed). iOS in
// Low Power Mode lets a video play from a user gesture only — and the file
// picker's `change` event is not one. So a refused kick is answered fast
// (one short seek, no play-through, ~4 s instead of 12) and reported as
// `pullNeedsTap`: the caller then pulls the stills from the next TAP it gets
// (Analyze), opening the clip synchronously inside that gesture.
//
// Every function here is best-effort in the same direction: a frame that will
// not seek is skipped, an audio track that will not decode returns null, and
// the caller decides whether to carry on with what it has. The pull's `report`
// says what happened in numbers, so an empty result can say WHY on the error
// line instead of "try a different export".

export const MAX_DURATION_S = 300;
export const MAX_FRAMES = 14;
export const MIN_FRAMES = 4;
/** Longest side of a rendered still. */
const FRAME_MAX_W = 960;
const JPEG_Q = 0.72;
const AUDIO_RATE = 16_000;
/** 100s × 16kHz × 16-bit mono = 3.2MB, under the transcribe route's 4MB cap. */
const AUDIO_CHUNK_S = 100;
/** A seek that has not landed in this long is not going to. */
const SEEK_TIMEOUT_MS = 5_000;
/** This many seeks in a row that never land, with none landed yet, and the
 *  pass stops seeking and plays the clip through — fourteen timeouts would be
 *  seventy seconds of a contractor watching a counter. */
const SEEK_GIVE_UP_AFTER = 2;
/** The play-through pass's speed: 2× is honoured for a muted track by WebKit,
 *  Blink and Gecko; faster drops frames on phones. */
const PLAY_RATE = 2;
/** The play-through pass never runs longer than this, whatever the clip. */
const PLAY_BUDGET_MAX_MS = 240_000;
/** Brightest pixel below this (0–255) and the still is a decoder that painted
 *  nothing, not a picture. */
const BLANK_LUMA = 10;

// ONE token, deliberately. The Windows file dialog resolves every MIME type and
// extension in `accept` against the registry BEFORE it paints, so a list of
// eight made "Add video" feel like it hung for a second or two. `video/*` is one
// lookup, and `isVideoFile` below is the real guard anyway — the dialog filter
// is a convenience, not a check.
export const VIDEO_ACCEPT = "video/*";

export type VideoProbe = { duration: number; width: number; height: number };
export type VideoFrame = { t: number; dataUrl: string };
export type AudioChunk = { offset: number; blob: Blob };

/** What the still pass did, in numbers — the error line reads it. */
export type FrameReport = {
  /** Which pass delivered the stills. */
  strategy: "seek" | "play" | "seek+play" | "none";
  wanted: number;
  seekOk: number;
  seekTimeouts: number;
  seekErrors: number;
  playOk: number;
  /** Stills the decoder painted black, twice over. */
  blank: number;
  /** Error names the canvas threw (a tainted canvas is a SecurityError). */
  thrown: string[];
  /** Why playback did not help, when it did not. */
  playNote: string;
  ms: number;
};
export type FramePull = { frames: VideoFrame[]; report: FrameReport };

export type ClipReader = {
  /** The probe: resolves once the metadata is in, rejects with why the file is unusable. */
  ready: Promise<VideoProbe>;
  frames(onProgress?: (done: number, total: number) => void): Promise<FramePull>;
  /** Stops any pass in flight and releases the element and the object URL. */
  close(): void;
};

export function isVideoFile(file: File): boolean {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm)$/i.test(file.name);
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** "1080p" / "720p" / "4K" from the frame height — the file line's third fact. */
export function fmtRes(p: VideoProbe): string {
  const h = Math.min(p.width, p.height);
  if (h >= 2000) return "4K";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  return h ? `${h}p` : "";
}

// ── Waiting on a <video> ────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errName(err: unknown): string {
  return err instanceof Error ? err.name || "Error" : String(err);
}

class MediaTimeout extends Error {
  constructor(what: string) {
    super(`Timed out ${what}.`);
    this.name = "MediaTimeout";
  }
}

class MediaDecodeError extends Error {
  constructor(el: HTMLVideoElement) {
    const e = el.error;
    super(
      e
        ? `The browser could not decode this video (code ${e.code}${e.message ? `: ${e.message}` : ""}).`
        : "The browser could not decode this video.",
    );
    this.name = "MediaDecodeError";
  }
}

/**
 * Resolves on the first of `events` for which `settled()` holds (any of them,
 * when there is no check); rejects on the element's `error` or after `ms`.
 */
function waitFor(
  el: HTMLVideoElement,
  events: string[],
  ms: number,
  what: string,
  settled?: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      for (const ev of events) el.removeEventListener(ev, onEvent);
      el.removeEventListener("error", onBad);
      clearTimeout(timer);
      fn();
    };
    const onEvent = () => {
      if (!settled || settled()) finish(resolve);
    };
    const onBad = () => finish(() => reject(new MediaDecodeError(el)));
    const timer = setTimeout(() => finish(() => reject(new MediaTimeout(what))), ms);
    if (el.error) {
      onBad();
      return;
    }
    if (settled?.()) {
      finish(resolve);
      return;
    }
    for (const ev of events) el.addEventListener(ev, onEvent);
    el.addEventListener("error", onBad);
  });
}

/** Move the playhead and wait for it to land — `seeked`, or a `timeupdate`
 *  that shows it there, within `ms`. */
async function seekTo(el: HTMLVideoElement, t: number, ms = SEEK_TIMEOUT_MS): Promise<void> {
  const target = Math.min(t, Math.max(0, el.duration - 0.05));
  // Already there: no engine fires `seeked` for a seek to the current time.
  if (!el.seeking && Math.abs(el.currentTime - target) < 0.05) return;
  el.currentTime = target;
  await waitFor(
    el,
    ["seeked", "timeupdate"],
    ms,
    "seeking the video",
    () => !el.seeking && Math.abs(el.currentTime - target) < 0.35,
  );
}

/** Wait until the frame at the new time has actually been painted — `seeked`
 *  can fire before the decoder delivers it on some engines. */
function painted(el: HTMLVideoElement, ms = 350): Promise<void> {
  return new Promise((resolve) => {
    const v = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      v.requestVideoFrameCallback(done);
      setTimeout(done, ms);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}

/** True when the brightest pixel is near black — a decoder that painted
 *  nothing, not a picture. `data` is RGBA, as getImageData hands it over. */
export function isBlankPixels(data: ArrayLike<number>): boolean {
  for (let i = 0; i + 2 < data.length; i += 4) {
    const y = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    if (y >= BLANK_LUMA) return false;
  }
  return true;
}

// ── The clip ────────────────────────────────────────────────────────────────

export function openClip(file: File): ClipReader {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("x-webkit-airplay", "deny");
  video.disablePictureInPicture = true;
  (video as HTMLVideoElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
  video.style.cssText = "display:block;width:4px;height:4px;";
  // Rendered, inside the viewport, all but invisible — see the header.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:0;bottom:0;width:4px;height:4px;overflow:hidden;opacity:.02;pointer-events:none;";
  host.appendChild(video);
  document.body.appendChild(host);
  video.src = url;

  // THE KICK — synchronous, before any await, so the gesture that picked the
  // file still covers it. Refused is noted, not fatal: the seeks may still land.
  let kickNote = "";
  let kick: Promise<void> = Promise.resolve();
  try {
    const p = video.play();
    if (p && typeof p.then === "function") {
      kick = p.then(
        () => undefined,
        (err: unknown) => {
          kickNote = errName(err);
        },
      );
    }
  } catch (err) {
    kickNote = errName(err);
  }

  let closed = false;
  const ready: Promise<VideoProbe> = (async () => {
    if (!isVideoFile(file)) throw new Error("That is not a video file — MP4, MOV or WebM.");
    await waitFor(video, ["loadedmetadata"], 20_000, "reading the video");
    // MediaRecorder-made WebM carries no duration header; seeking past the end
    // makes the browser scan for it and report the real figure.
    if (!Number.isFinite(video.duration) || video.duration === 0) {
      video.currentTime = 1e7;
      try {
        await waitFor(video, ["durationchange"], 10_000, "reading the video's length");
      } catch {
        /* fall through — the check below rejects it */
      }
      video.currentTime = 0;
    }
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("The browser could not read this video's length.");
    }
    if (duration > MAX_DURATION_S) {
      throw new Error(`Walkthroughs are capped at 5 minutes — this one is ${fmtClock(duration)}.`);
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("This file has no video track the browser can decode.");
    }
    return { duration, width: video.videoWidth, height: video.videoHeight };
  })();
  // A superseded pick never awaits `ready`; its rejection must not surface as unhandled.
  ready.catch(() => {});

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      video.pause();
    } catch {
      /* never started */
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* released */
    }
    host.remove();
    URL.revokeObjectURL(url);
  };

  return {
    ready,
    frames: (onProgress) =>
      pullFrames({ video, ready, kick, kickNote: () => kickNote, isClosed: () => closed }, onProgress),
    close,
  };
}

/** The probe alone — open, read the metadata, release. */
export async function probeVideo(file: File): Promise<VideoProbe> {
  const clip = openClip(file);
  try {
    return await clip.ready;
  } finally {
    clip.close();
  }
}

// ── Frames ──────────────────────────────────────────────────────────────────

/** One frame per ~12s of clip, never fewer than 4 nor more than 14. */
export function frameCountFor(duration: number): number {
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(duration / 12)));
}

export function frameTimes(duration: number, n: number): number[] {
  // Keep off the very first and last instants — they are often black or a
  // thumb over the lens.
  const pad = Math.min(0.4, duration / 10);
  if (n <= 1) return [Math.min(duration / 2, pad)];
  const span = duration - 2 * pad;
  return Array.from({ length: n }, (_, i) => pad + (span * i) / (n - 1));
}

type Clip = {
  video: HTMLVideoElement;
  ready: Promise<VideoProbe>;
  kick: Promise<void>;
  kickNote: () => string;
  isClosed: () => boolean;
};

async function pullFrames(
  clip: Clip,
  onProgress?: (done: number, total: number) => void,
): Promise<FramePull> {
  const { video, isClosed } = clip;
  const probe = await clip.ready;
  const t0 = performance.now();
  const report: FrameReport = {
    strategy: "none",
    wanted: 0,
    seekOk: 0,
    seekTimeouts: 0,
    seekErrors: 0,
    playOk: 0,
    blank: 0,
    thrown: [],
    playNote: "",
    ms: 0,
  };
  const got = new Map<number, VideoFrame>();
  const finish = (): FramePull => {
    report.ms = Math.round(performance.now() - t0);
    report.strategy =
      report.seekOk && report.playOk ? "seek+play" : report.playOk ? "play" : report.seekOk ? "seek" : "none";
    return { frames: [...got.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f), report };
  };
  const n = frameCountFor(probe.duration);
  const times = frameTimes(probe.duration, n);
  report.wanted = n;

  // Let the kick settle (bounded), then hold the clip still for the seeks.
  await Promise.race([clip.kick, sleep(4_000)]);
  if (isClosed()) return finish();
  video.pause();
  // A refused kick (iOS wanting a gesture) is answered fast: the engine that
  // refused to play will not load data for a seek either, so one short try
  // and no play-through — the caller asks for a tap instead.
  const refused = clip.kickNote() !== "";
  if (refused) report.playNote = `refused: ${clip.kickNote()}`;
  if (video.readyState < 2) {
    try {
      await waitFor(video, ["loadeddata", "canplay", "canplaythrough"], refused ? 1_500 : 8_000, "loading the video", () => video.readyState >= 2);
    } catch {
      /* the seeks will say */
    }
  }
  if (isClosed()) return finish();

  const scale = Math.min(1, FRAME_MAX_W / Math.max(probe.width, probe.height));
  const w = Math.max(1, Math.round(probe.width * scale));
  const h = Math.max(1, Math.round(probe.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  // A 24×24 copy is what the blank check reads — not 2MB of pixels per still.
  const peek = document.createElement("canvas");
  peek.width = 24;
  peek.height = 24;
  const pctx = peek.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx || !pctx) throw new Error("Canvas is unavailable in this browser.");

  /** Paint the current frame; false when the decoder painted black. Throws
   *  what the canvas throws — a tainted canvas is a SecurityError on toDataURL. */
  const grab = (i: number, t: number): boolean => {
    ctx.drawImage(video, 0, 0, w, h);
    pctx.drawImage(canvas, 0, 0, 24, 24);
    if (isBlankPixels(pctx.getImageData(0, 0, 24, 24).data)) return false;
    got.set(i, { t, dataUrl: canvas.toDataURL("image/jpeg", JPEG_Q) });
    return true;
  };
  const tick = () => onProgress?.(got.size, n);
  tick();

  // ── Pass 1 · seek to each time ────────────────────────────────────────
  let misses = 0;
  for (let i = 0; i < times.length && !isClosed(); i++) {
    const t = times[i];
    try {
      await seekTo(video, t, refused ? 2_500 : SEEK_TIMEOUT_MS);
      await painted(video);
      let ok = grab(i, t);
      if (!ok) {
        // The first paint after a seek can be the frame before it on WebKit —
        // one more beat, then it is a black still.
        await painted(video, 300);
        ok = grab(i, t);
      }
      if (ok) report.seekOk += 1;
      else report.blank += 1;
      misses = 0;
    } catch (err) {
      const name = errName(err);
      if (name === "MediaTimeout") report.seekTimeouts += 1;
      else if (name === "MediaDecodeError") report.seekErrors += 1;
      else report.thrown.push(name);
      misses += 1;
      // A track the browser cannot decode will not decode on playback either,
      // and a canvas it will not read never will.
      if (name === "MediaDecodeError" || name === "SecurityError") break;
      if (misses >= (refused ? 1 : SEEK_GIVE_UP_AFTER) && got.size === 0) break;
      if (misses >= 4) break;
    }
    tick();
  }

  // ── Pass 2 · play the clip through for whatever is missing ────────────
  const missing = times.map((_, i) => i).filter((i) => !got.has(i));
  const hopeless = report.seekErrors > 0 || report.thrown.includes("SecurityError") || refused;
  if (missing.length && !isClosed() && !hopeless) {
    await playThrough(video, missing, times, grab, tick, report, isClosed);
  }
  if (!video.paused) video.pause();
  return finish();
}

/**
 * The second way through: play the clip (muted, at 2×) and take each missing
 * still as the playhead crosses its time. At most one still per callback, so
 * a stall never hands the same picture to two targets.
 */
async function playThrough(
  video: HTMLVideoElement,
  missing: number[],
  times: number[],
  grab: (i: number, t: number) => boolean,
  tick: () => void,
  report: FrameReport,
  isClosed: () => boolean,
): Promise<void> {
  // Back to the start when the engine lets us; when seeks do not land the clip
  // plays from where it stands and the targets behind the playhead are lost.
  try {
    video.currentTime = 0;
    await waitFor(video, ["seeked", "timeupdate"], 1_500, "rewinding", () => !video.seeking && video.currentTime < 0.5);
  } catch {
    /* plays from here */
  }
  try {
    video.playbackRate = PLAY_RATE;
  } catch {
    /* 1× then */
  }
  try {
    await Promise.race([
      video.play(),
      sleep(4_000).then(() => {
        throw new MediaTimeout("starting playback");
      }),
    ]);
  } catch (err) {
    report.playNote = `refused: ${errName(err)}`;
    return;
  }
  if (video.paused) {
    report.playNote = "did not start";
    return;
  }
  const rate = video.playbackRate || 1;
  const budget = Math.min(PLAY_BUDGET_MAX_MS, ((video.duration - video.currentTime) / rate) * 1000 + 10_000);
  const t0 = performance.now();
  let k = 0;
  while (k < missing.length && times[missing[k]] < video.currentTime - 0.25) k += 1;
  const lost = k;

  await new Promise<void>((resolve) => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const rvfc = typeof v.requestVideoFrameCallback === "function" ? v.requestVideoFrameCallback.bind(v) : null;
    let done = false;
    let pending = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("timeupdate", onFrame);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", finish);
      clearInterval(guard);
      resolve();
    };
    const take = (now: number) => {
      const i = missing[k];
      k += 1;
      try {
        if (grab(i, now)) report.playOk += 1;
        else report.blank += 1;
      } catch (err) {
        report.thrown.push(errName(err));
      }
      tick();
    };
    // The last target sits a few hundred ms before the end — at 2× that is one
    // callback, which `ended` can beat. The final frame is still on screen.
    const onEnded = () => {
      if (!done && k < missing.length && video.currentTime >= times[missing[k]] - 0.05) take(video.currentTime);
      finish();
    };
    const onFrame = () => {
      pending = false;
      if (done) return;
      const now = video.currentTime;
      if (k < missing.length && now >= times[missing[k]] - 0.05) take(now);
      if (k >= missing.length || video.ended || isClosed() || performance.now() - t0 > budget) {
        finish();
        return;
      }
      if (rvfc && !pending) {
        pending = true;
        rvfc(onFrame);
      }
    };
    video.addEventListener("timeupdate", onFrame);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", finish);
    // Engines without requestVideoFrameCallback are driven by timeupdate; the
    // guard keeps the budget honest on all of them.
    const guard = setInterval(onFrame, 500);
    onFrame();
  });
  video.pause();
  if (lost && !report.playNote) report.playNote = `${lost} target${lost === 1 ? "" : "s"} behind the playhead`;
}

/** An empty pull whose only fault was a refused play(): the engine wants a user
 *  gesture (iOS in Low Power Mode). Everything else about the clip was fine, so
 *  the caller should pull again from the next tap it gets rather than fail. */
export function pullNeedsTap(r: FrameReport): boolean {
  return (
    r.seekOk === 0 &&
    r.playOk === 0 &&
    r.seekErrors === 0 &&
    r.blank === 0 &&
    r.thrown.length === 0 &&
    r.playNote === "refused: NotAllowedError"
  );
}

/** One clause for the error line when a pull came back empty — what the numbers say went wrong. */
export function frameFailureReason(r: FrameReport): string {
  if (r.thrown.includes("SecurityError")) return "the browser refused to copy pictures out of this clip";
  if (r.seekErrors > 0) return "the browser could not decode this clip's video track";
  const refused = r.playNote.startsWith("refused: ") ? r.playNote.slice("refused: ".length) : "";
  if (r.seekTimeouts > 0 && refused) {
    return `the browser never finished seeking through this clip and refused to play it (${refused})`;
  }
  if (r.seekTimeouts > 0 && r.playNote) return `the browser never finished seeking through this clip and playback ${r.playNote}`;
  if (r.seekTimeouts > 0) return "the browser never finished seeking through this clip";
  if (r.blank > 0) return "every frame came back black";
  if (refused) return `the browser refused to play this clip (${refused})`;
  return "no frame could be decoded";
}

/** The handful of stills the intake strip shows: evenly spread across the set. */
export function stripFrames(frames: VideoFrame[], n = 4): VideoFrame[] {
  if (frames.length <= n) return frames;
  return Array.from({ length: n }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (n - 1))]);
}
// ── Audio ───────────────────────────────────────────────────────────────────

function wavFromPcm(samples: Float32Array, rate: number): Blob {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + bytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * The clip's audio as 16kHz mono WAV chunks, or null when there is nothing
 * usable — no Web Audio, a container the browser cannot demux, no audio track,
 * or a track that is silent end to end.
 */
export async function extractAudioChunks(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<AudioChunk[] | null> {
  const AC: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC || typeof OfflineAudioContext === "undefined") return null;

  onProgress?.(0, 3);
  let decoded: AudioBuffer;
  const ctx = new AC();
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
  onProgress?.(1, 3);
  if (!decoded.numberOfChannels || decoded.duration < 0.5) return null;

  // Down-mix and resample in one pass: a mono destination sums the channels.
  const length = Math.ceil(decoded.duration * AUDIO_RATE);
  const off = new OfflineAudioContext(1, length, AUDIO_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const mono = (await off.startRendering()).getChannelData(0);
  onProgress?.(2, 3);

  // A silent track (screen recording, muted camera) is "no audio", not a
  // transcript of nothing.
  let peak = 0;
  for (let i = 0; i < mono.length; i += 16) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    if (peak > 0.01) break;
  }
  if (peak <= 0.004) return null;

  const chunks: AudioChunk[] = [];
  const step = AUDIO_CHUNK_S * AUDIO_RATE;
  for (let s = 0; s < mono.length; s += step) {
    chunks.push({ offset: s / AUDIO_RATE, blob: wavFromPcm(mono.subarray(s, s + step), AUDIO_RATE) });
  }
  onProgress?.(3, 3);
  return chunks;
}

// ── Transcription (the route round-trip) ────────────────────────────────────

export type TranscriptSegment = { start: number; end: number; text: string };

export class TranscribeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public resource?: string,
    /** The card-less trial's ceiling, when that is what refused it (lib/trialCaps). */
    public trialCap?: string,
  ) {
    super(message);
    this.name = "TranscribeError";
  }
}

async function transcribeChunk(chunk: AudioChunk): Promise<TranscriptSegment[]> {
  const form = new FormData();
  form.append("audio", chunk.blob, "walkthrough.wav");
  form.append("offset", String(chunk.offset));
  const res = await fetch("/api/estimator/video/transcribe", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    resource?: string;
    trialCap?: string;
    segments?: TranscriptSegment[];
  };
  if (!res.ok) {
    throw new TranscribeError(body.error ?? `Transcription failed (${res.status})`, res.status, body.code, body.resource, body.trialCap);
  }
  return body.segments ?? [];
}

/**
 * Every chunk through the route, two at a time, re-joined in clip order.
 * A chunk that fails for a transient reason is dropped and the rest continue;
 * a plan-limit or auth refusal is rethrown so the caller can stop everything.
 */
export async function transcribeChunks(
  chunks: AudioChunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ segments: TranscriptSegment[]; failed: number }> {
  const results: TranscriptSegment[][] = new Array(chunks.length);
  let failed = 0;
  let done = 0;
  let next = 0;
  onProgress?.(0, chunks.length);
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      try {
        results[i] = await transcribeChunk(chunks[i]);
      } catch (err) {
        if (err instanceof TranscribeError && (err.status === 402 || err.status === 403 || err.status === 503)) {
          throw err;
        }
        results[i] = [];
        failed += 1;
      }
      done += 1;
      onProgress?.(done, chunks.length);
    }
  };
  await Promise.all([worker(), worker()]);
  const segments = results.flat().sort((a, b) => a.start - b.start);
  return { segments, failed };
}

/** `[mm:ss] text` per segment — the shape the reader prompt expects. */
export function transcriptText(segments: TranscriptSegment[]): string {
  return segments
    .filter((s) => s.text)
    .map((s) => `[${fmtClock(s.start)}] ${s.text}`)
    .join("\n");
}
