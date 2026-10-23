// The live view's two sounds (2026-10-23), made in the browser — no audio files: a soft two-note rise when a visitor
// reaches the checkout, a bright four-note "ka-ching" when someone signs up. A browser plays nothing until the page
// has been touched, so `armSound()` runs from the Sound switch and from the first tap or key on the page.
// The switch is remembered per browser (useSyncExternalStore over localStorage, like the map view).

const KEY = "jf.traffic.sound";
const EVENT = "jf-traffic-sound";
let ctx: AudioContext | null = null;

export function readSoundOn(): boolean {
  try { return window.localStorage.getItem(KEY) === "on"; } catch { return false; }
}
export const serverSoundOn = () => false;
export function subscribeSoundOn(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}
export function writeSoundOn(on: boolean): void {
  try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private browsing: on for this page only */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Make the audio playable — call from a tap, a click or a key. */
export function armSound(): void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
}

function note(at: number, freq: number, length: number, type: OscillatorType, peak: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

export function playChime(kind: "card" | "signup"): void {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + 0.02;
  if (kind === "card") {
    // E5 → A5: someone is close.
    note(t, 659.25, 0.22, "sine", 0.2);
    note(t + 0.16, 880, 0.32, "sine", 0.2);
    return;
  }
  // C5 E5 G5 C6 with a high sparkle: someone signed up.
  [523.25, 659.25, 783.99].forEach((f, i) => note(t + i * 0.09, f, 0.2, "triangle", 0.22));
  note(t + 0.27, 1046.5, 0.7, "triangle", 0.26);
  note(t + 0.3, 2093, 0.45, "sine", 0.06);
}
