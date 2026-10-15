// VIDEO ESTIMATOR — the sound of a QuickTime movie, as a stream Safari decodes.
//
// WHY THIS EXISTS (2026-10-15)
// An iPhone films a .MOV, and Safari's decodeAudioData refuses the QuickTime
// container outright ("EncodingError: Decoding failed") — while it decodes the
// very same AAC out of an .mp4, an .m4a or a raw ADTS stream. Chrome decodes
// all of them, which is how it went unseen: on an iPhone the walkthrough's
// voice never reached the transcription, and the reading ran on the pictures
// alone. Patching the file's brand does not help (the movie's sound
// description is QuickTime's, not MP4's); lifting the frames out does.
//
// WHAT IT DOES
// Walks the movie's box tree for the first AAC sound track, reads the codec
// setup from its `esds`, and builds an ADTS stream: every access unit read
// straight from the file and given its 7-byte header. Only the movie's index
// (`moov`) and the audio itself are read, through a ranged reader — an iPhone
// original runs to hundreds of MB and is never loaded whole for this.
//
// Pure: no DOM. video-ingest.ts hands it a reader over the picked File; the QA
// script (scripts/qa/video-estimator.check.ts) hands it a synthetic movie.

/** Reads `length` bytes at `offset` of the file. */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

/** The ADTS header's three codec fields. */
export type AdtsFields = {
  /** ADTS profile = MPEG-4 audio object type − 1 (1 → AAC LC). */
  profile: number;
  /** Sampling-frequency index (3 → 48 kHz, 4 → 44.1 kHz). */
  sfi: number;
  /** Channel configuration (1 mono, 2 stereo, …). */
  channels: number;
};

/** The first AAC sound track of a movie: codec fields, where each access unit
 *  sits in the file, and the track's own length. */
export type AacTrack = AdtsFields & { offsets: number[]; sizes: number[]; seconds: number };

/** A movie index bigger than this is not a phone's walkthrough. */
const MOOV_MAX = 64 * 1024 * 1024;
/** Five minutes of AAC at 48 kHz is ~14,000 access units. */
const SAMPLES_MAX = 200_000;
/** An ADTS frame's 13-bit length covers the header too. */
const FRAME_MAX = 8191 - 7;
/** One ranged read covers at most this many bytes… */
const READ_MAX = 4 * 1024 * 1024;
/** …and reads through up to this much picture between two runs of sound
 *  rather than paying for another round trip. */
const GAP_MAX = 256 * 1024;
/** Top-level boxes walked before giving up on finding the index. */
const TOP_BOXES_MAX = 256;

const FREQS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 0x100000000 + u32(b, o + 4);
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

type Box = { type: string; start: number; size: number; header: number };

/** The boxes laid end to end in [start, end) of `b`. Stops at the first one
 *  that does not fit — a damaged tail never reads past its parent. */
function boxesIn(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = u64(b, o + 8);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) break;
    out.push({ type: fourcc(b, o + 4), start: o, size, header });
    o += size;
  }
  return out;
}

const childrenOf = (b: Uint8Array, box: Box) => boxesIn(b, box.start + box.header, box.start + box.size);
const childOf = (b: Uint8Array, box: Box, type: string) => childrenOf(b, box).find((x) => x.type === type);

/** True when the first bytes are a QuickTime movie's (`ftyp` brand `qt  `). */
export function isQuickTimeHead(head: Uint8Array): boolean {
  return head.length >= 12 && fourcc(head, 4) === "ftyp" && fourcc(head, 8) === "qt  ";
}

/** The ADTS fields an AudioSpecificConfig describes, or null when ADTS cannot
 *  carry it (not AAC Main/LC/SSR/LTP, a frequency off the table, a channel
 *  layout only a program config element can describe). Explicitly signalled
 *  SBR and PS carry the core AAC underneath — ADTS signals those implicitly. */
export function adtsFieldsOf(asc: Uint8Array): AdtsFields | null {
  let pos = 0;
  const bits = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) {
      if (pos >> 3 >= asc.length) return -1;
      v = (v << 1) | ((asc[pos >> 3] >> (7 - (pos & 7))) & 1);
    }
    return v;
  };
  const objectType = () => {
    const a = bits(5);
    return a === 31 ? 32 + bits(6) : a;
  };
  const frequencyIndex = () => {
    const i = bits(4);
    return i === 15 ? FREQS.indexOf(bits(24)) : i;
  };
  let aot = objectType();
  const sfi = frequencyIndex();
  const channels = bits(4);
  if (aot === 5 || aot === 29) {
    frequencyIndex(); // the extension's output rate — implicit in ADTS
    aot = objectType();
  }
  if (aot < 1 || aot > 4 || sfi < 0 || sfi > 12 || channels < 1 || channels > 7) return null;
  return { profile: aot - 1, sfi, channels };
}

/** Writes one 7-byte ADTS header (MPEG-4, no CRC) at `o`. `frameLength`
 *  counts the header itself. */
export function writeAdtsHeader(out: Uint8Array, o: number, f: AdtsFields, frameLength: number): void {
  out[o] = 0xff;
  out[o + 1] = 0xf1;
  out[o + 2] = ((f.profile & 3) << 6) | ((f.sfi & 15) << 2) | ((f.channels >> 2) & 1);
  out[o + 3] = ((f.channels & 3) << 6) | ((frameLength >> 11) & 3);
  out[o + 4] = (frameLength >> 3) & 0xff;
  out[o + 5] = ((frameLength & 7) << 5) | 0x1f;
  out[o + 6] = 0xfc;
}

/** A descriptor's length: 1–4 bytes, seven bits each, high bit = more. */
function descriptorLength(b: Uint8Array, o: number): [number, number] {
  let len = 0;
  for (let i = 0; i < 4; i++) {
    const x = b[o + i];
    len = (len << 7) | (x & 0x7f);
    if (!(x & 0x80)) return [len, o + i + 1];
  }
  return [len, o + 4];
}

/** The AudioSpecificConfig inside an `esds` box's payload [o, end), when the
 *  stream is AAC (MPEG-4 audio, or MPEG-2 AAC Main/LC/SSR). */
function ascFromEsds(b: Uint8Array, o: number, end: number): Uint8Array | null {
  if (b[o] !== 0x03) return null;
  let [, p] = descriptorLength(b, o + 1);
  const flags = b[p + 2];
  p += 3; // ES_ID + flags
  if (flags & 0x80) p += 2; // dependsOn_ES_ID
  if (flags & 0x40) p += 1 + b[p]; // URL
  if (flags & 0x20) p += 2; // OCR_ES_Id
  if (p >= end || b[p] !== 0x04) return null;
  [, p] = descriptorLength(b, p + 1);
  const objectTypeIndication = b[p];
  if (![0x40, 0x66, 0x67, 0x68].includes(objectTypeIndication)) return null;
  p += 13; // objectTypeIndication, streamType, bufferSizeDB, maxBitrate, avgBitrate
  if (p >= end || b[p] !== 0x05) return null;
  const [len, at] = descriptorLength(b, p + 1);
  if (len < 2 || at + len > end) return null;
  return b.subarray(at, at + len);
}

/** The `esds` under a sound sample entry: after its fixed fields (QuickTime
 *  sound description v0, v1 or v2), directly or inside a `wave` atom. When the
 *  layout is not the one the version promised, a scan for the box finds it. */
function esdsOf(b: Uint8Array, entry: Box): Box | null {
  const base = entry.start + entry.header;
  const end = entry.start + entry.size;
  const version = u16(b, base + 8);
  const fixed = 8 + 20 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  const find = (start: number, stop: number): Box | null => {
    for (const box of boxesIn(b, start, stop)) {
      if (box.type === "esds") return box;
      if (box.type === "wave") {
        const inner = find(box.start + box.header, box.start + box.size);
        if (inner) return inner;
      }
    }
    return null;
  };
  const found = find(base + fixed, end);
  if (found) return found;
  for (let o = base + 8; o + 8 <= end; o++) {
    if (b[o + 4] === 0x65 && fourcc(b, o + 4) === "esds") {
      const size = u32(b, o);
      if (size >= 12 && o + size <= end) return { type: "esds", start: o, size, header: 8 };
    }
  }
  return null;
}

/** Where every access unit of the track sits, from stsz / stsc / stco|co64. */
function sampleTableOf(b: Uint8Array, stbl: Box): { offsets: number[]; sizes: number[] } | null {
  const stsz = childOf(b, stbl, "stsz");
  const stsc = childOf(b, stbl, "stsc");
  const chunkBox = childOf(b, stbl, "co64") ?? childOf(b, stbl, "stco");
  if (!stsz || !stsc || !chunkBox) return null;
  const fits = (box: Box, p: number, n: number) => p + n <= box.start + box.size;

  let p = stsz.start + stsz.header + 4;
  if (!fits(stsz, p, 8)) return null;
  const fixedSize = u32(b, p);
  const count = u32(b, p + 4);
  p += 8;
  if (count === 0 || count > SAMPLES_MAX || (!fixedSize && !fits(stsz, p, count * 4))) return null;
  const sizes = new Array<number>(count);
  for (let i = 0; i < count; i++) sizes[i] = fixedSize || u32(b, p + i * 4);

  const wide = chunkBox.type === "co64";
  p = chunkBox.start + chunkBox.header + 4;
  if (!fits(chunkBox, p, 4)) return null;
  const chunkCount = u32(b, p);
  p += 4;
  if (!fits(chunkBox, p, chunkCount * (wide ? 8 : 4))) return null;
  const chunkOffsets = new Array<number>(chunkCount);
  for (let i = 0; i < chunkCount; i++) chunkOffsets[i] = wide ? u64(b, p + i * 8) : u32(b, p + i * 4);

  p = stsc.start + stsc.header + 4;
  if (!fits(stsc, p, 4)) return null;
  const runs = u32(b, p);
  p += 4;
  if (!runs || !fits(stsc, p, runs * 12)) return null;

  const offsets = new Array<number>(count);
  let s = 0;
  for (let r = 0; r < runs && s < count; r++) {
    const from = u32(b, p + r * 12) - 1;
    const to = r + 1 < runs ? u32(b, p + (r + 1) * 12) - 1 : chunkCount;
    const perChunk = u32(b, p + r * 12 + 4);
    for (let c = Math.max(0, from); c < Math.min(to, chunkCount) && s < count; c++) {
      let at = chunkOffsets[c];
      for (let k = 0; k < perChunk && s < count; k++, s++) {
        offsets[s] = at;
        at += sizes[s];
      }
    }
  }
  return s === count ? { offsets, sizes } : null;
}

/** The media header's length in seconds (0 when it does not say). */
function secondsOf(b: Uint8Array, mdhd: Box): number {
  const p = mdhd.start + mdhd.header;
  const v1 = b[p] === 1;
  const timescale = v1 ? u32(b, p + 20) : u32(b, p + 12);
  const duration = v1 ? u64(b, p + 24) : u32(b, p + 16);
  return timescale ? duration / timescale : 0;
}

/** The first AAC sound track in a `moov` box (the bytes start at its header).
 *  Tracks of another codec — an iPhone's spatial-audio track, PCM — are passed
 *  over for the next. */
export function aacTrackOf(moov: Uint8Array): AacTrack | null {
  if (moov.length < 8 || fourcc(moov, 4) !== "moov") return null;
  const header = u32(moov, 0) === 1 ? 16 : 8;
  for (const trak of boxesIn(moov, header, moov.length)) {
    if (trak.type !== "trak") continue;
    const mdia = childOf(moov, trak, "mdia");
    const hdlr = mdia && childOf(moov, mdia, "hdlr");
    if (!mdia || !hdlr || fourcc(moov, hdlr.start + hdlr.header + 8) !== "soun") continue;
    const minf = childOf(moov, mdia, "minf");
    const stbl = minf && childOf(moov, minf, "stbl");
    const stsd = stbl && childOf(moov, stbl, "stsd");
    if (!stbl || !stsd) continue;
    const entry = boxesIn(moov, stsd.start + stsd.header + 8, stsd.start + stsd.size)[0];
    if (!entry || entry.type !== "mp4a") continue;
    const esds = esdsOf(moov, entry);
    const asc = esds && ascFromEsds(moov, esds.start + esds.header + 4, esds.start + esds.size);
    const fields = asc && adtsFieldsOf(asc);
    const table = fields && sampleTableOf(moov, stbl);
    if (!fields || !table) continue;
    const mdhd = childOf(moov, mdia, "mdhd");
    return { ...fields, ...table, seconds: mdhd ? secondsOf(moov, mdhd) : 0 };
  }
  return null;
}

/** The movie's `moov` box, wherever it sits — an iPhone writes it after the
 *  media, a web export before. Null when there is none or it is not sane. */
async function moovOf(read: ByteReader, size: number): Promise<Uint8Array | null> {
  let o = 0;
  for (let n = 0; n < TOP_BOXES_MAX && o + 8 <= size; n++) {
    const h = await read(o, Math.min(16, size - o));
    if (h.length < 8) return null;
    let len = u32(h, 0);
    let header = 8;
    if (len === 1) {
      if (h.length < 16) return null;
      len = u64(h, 8);
      header = 16;
    } else if (len === 0) {
      len = size - o;
    }
    if (len < header) return null;
    if (fourcc(h, 4) === "moov") {
      if (len > MOOV_MAX || o + len > size) return null;
      return read(o, len);
    }
    o += len;
  }
  return null;
}

/**
 * The movie's first AAC track as one ADTS stream, with the track's own length
 * in seconds — or null when the file is not an ISO/QuickTime movie, has no AAC
 * sound track, or its index points outside the file.
 */
export async function aacAsAdts(
  read: ByteReader,
  size: number,
): Promise<{ bytes: Uint8Array; seconds: number } | null> {
  const moov = await moovOf(read, size);
  const track = moov && aacTrackOf(moov);
  if (!track) return null;
  const { offsets, sizes } = track;
  let total = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i] < 1 || sizes[i] > FRAME_MAX || offsets[i] + sizes[i] > size) return null;
    total += sizes[i] + 7;
  }
  const out = new Uint8Array(total);
  let o = 0;
  let i = 0;
  while (i < sizes.length) {
    // One read per stretch of the file that holds a run of access units, back
    // to back or with a little picture between them.
    const from = offsets[i];
    let end = from + sizes[i];
    let j = i + 1;
    while (
      j < sizes.length &&
      offsets[j] >= end &&
      offsets[j] - end <= GAP_MAX &&
      offsets[j] + sizes[j] - from <= READ_MAX
    ) {
      end = offsets[j] + sizes[j];
      j += 1;
    }
    const bytes = await read(from, end - from);
    if (bytes.length < end - from) return null;
    for (let k = i; k < j; k++) {
      writeAdtsHeader(out, o, track, sizes[k] + 7);
      out.set(bytes.subarray(offsets[k] - from, offsets[k] - from + sizes[k]), o + 7);
      o += sizes[k] + 7;
    }
    i = j;
  }
  return { bytes: out, seconds: track.seconds };
}
