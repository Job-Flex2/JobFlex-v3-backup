// AUDIO FOR THE REHEARSAL — pure: μ-law (G.711) in and out, 16-bit PCM, a WAV reader and
// writer, a resampler. Twilio's stream is μ-law at 8 kHz; OpenAI's speech comes as 24 kHz
// 16-bit WAV. No dependencies, so the rehearsal runs on any machine with Node.

const BIAS = 0x84;
const CLIP = 32635;

/** One 16-bit sample → one μ-law byte (G.711). */
export function mulawEncodeSample(sample) {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    /* find the segment */
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** One μ-law byte → one 16-bit sample. */
export function mulawDecodeSample(byte) {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let s = ((mantissa << 3) + BIAS) << exponent;
  s -= BIAS;
  return sign ? -s : s;
}

export function mulawEncode(pcm /* Int16Array */) {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = mulawEncodeSample(pcm[i]);
  return out;
}

export function mulawDecode(bytes /* Buffer */) {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = mulawDecodeSample(bytes[i]);
  return out;
}

/** Linear resample of 16-bit mono PCM (good enough for speech to a phone line). */
export function resample(pcm, fromRate, toRate) {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const n = Math.floor(pcm.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, pcm.length - 1);
    const t = pos - a;
    out[i] = Math.round(pcm[a] * (1 - t) + pcm[b] * t);
  }
  return out;
}

/** A WAV file (PCM 16-bit, any channel count — mixed to mono) → { rate, pcm }. */
export function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let pos = 12;
  let rate = 0;
  let channels = 1;
  let bits = 16;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2);
  }
  if (!data || !rate) throw new Error("WAV without fmt/data");
  if (bits !== 16) throw new Error(`WAV with ${bits}-bit samples (16 expected)`);
  const frames = Math.floor(data.length / 2 / channels);
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2);
    pcm[i] = Math.round(sum / channels);
  }
  return { rate, pcm };
}

/** 16-bit mono PCM → a WAV file. */
export function writeWav(pcm, rate) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Loudness of a stretch of PCM, 0–1 (RMS over full scale). */
export function rms(pcm) {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) / 32768;
}

/** A WAV (any rate) → base64 μ-law frames of 20 ms (160 bytes), Twilio's cadence. */
export function wavToFrames(buf) {
  const { rate, pcm } = readWav(buf);
  const mu = mulawEncode(resample(pcm, rate, 8000));
  const frames = [];
  for (let i = 0; i < mu.length; i += 160) {
    const chunk = Buffer.alloc(160, 0xff);
    mu.copy(chunk, 0, i, Math.min(i + 160, mu.length));
    frames.push(chunk.toString("base64"));
  }
  return frames;
}

/** 20 ms of μ-law silence, base64. */
export const SILENCE_FRAME = Buffer.alloc(160, 0xff).toString("base64");
