// The rehearsal's audio: μ-law both ways, WAV both ways, the resampler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulawDecode, mulawDecodeSample, mulawEncode, mulawEncodeSample, readWav, resample, rms, wavToFrames, writeWav } from "./audio.mjs";

test("μ-law: silence is 0xff, a round trip stays within the codec's step, the sign survives", () => {
  assert.equal(mulawEncodeSample(0), 0xff);
  for (const v of [-32000, -8000, -1000, -50, 0, 50, 1000, 8000, 32000]) {
    const back = mulawDecodeSample(mulawEncodeSample(v));
    assert.ok(Math.abs(back - v) <= Math.max(32, Math.abs(v) * 0.07), `${v} → ${back}`);
    assert.equal(Math.sign(back), Math.sign(v));
  }
  const pcm = new Int16Array([0, 1000, -1000, 20000]);
  assert.deepEqual(Array.from(mulawDecode(mulawEncode(pcm))).map(Math.sign), [0, 1, -1, 1]);
});

test("WAV: written and read back, mono 16-bit; a stereo file is mixed down", () => {
  const pcm = new Int16Array(800).map((_, i) => Math.round(Math.sin(i / 10) * 10000));
  const { rate, pcm: back } = readWav(writeWav(pcm, 8000));
  assert.equal(rate, 8000);
  assert.equal(back.length, 800);
  assert.equal(back[7], pcm[7]);
  // Stereo by hand: the same samples on both channels.
  const stereo = Buffer.alloc(44 + 800 * 4);
  writeWav(pcm, 24000).copy(stereo, 0, 0, 44);
  stereo.writeUInt16LE(2, 22);
  stereo.writeUInt32LE(24000 * 4, 28);
  stereo.writeUInt16LE(4, 32);
  stereo.writeUInt32LE(800 * 4, 40);
  for (let i = 0; i < 800; i++) {
    stereo.writeInt16LE(pcm[i], 44 + i * 4);
    stereo.writeInt16LE(pcm[i], 46 + i * 4);
  }
  const mixed = readWav(stereo);
  assert.equal(mixed.rate, 24000);
  assert.equal(mixed.pcm.length, 800);
  assert.equal(mixed.pcm[7], pcm[7]);
});

test("resample 24 kHz → 8 kHz: a third as many samples, the tone kept; a WAV becomes 20 ms frames", () => {
  const pcm = new Int16Array(2400).map((_, i) => Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000));
  const down = resample(pcm, 24000, 8000);
  assert.equal(down.length, 800);
  assert.ok(Math.abs(rms(down) - rms(pcm)) < 0.02, `${rms(down)} vs ${rms(pcm)}`);
  const frames = wavToFrames(writeWav(pcm, 24000));
  assert.equal(frames.length, 5); // 100 ms of 8 kHz audio
  assert.equal(Buffer.from(frames[0], "base64").length, 160);
});
