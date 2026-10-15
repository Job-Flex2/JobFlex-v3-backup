// The video estimator's reading (2026-10-14): the deeper schema (work, the look-ahead, the procedure, permits),
// the brief it hands the planner, the reader's instructions, the browser-side frame maths, and the sound lifted
// out of a QuickTime movie (2026-10-15). Pure — no DOM, no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/video-estimator.check.ts
import {
  BEHIND_LABEL,
  BEHIND_MAX,
  STEPS_MAX,
  WORK_MAX,
  briefFromAnalysis,
  walkthroughAnalysisSchema,
  walkthroughInputSchema,
} from "../../src/lib/estimate/video-schema";
import {
  LOOK_AHEAD_GUIDE,
  WALKTHROUGH_JSON_CONTRACT,
  WALKTHROUGH_READER_PROMPT,
} from "../../src/lib/estimate/video-prompt";
import {
  frameCountFor,
  frameFailureReason,
  frameTimes,
  isBlankPixels,
  pullNeedsTap,
  stripFrames,
  type FrameReport,
} from "../../src/components/v3/video-estimator-blueprint/video-ingest";
import {
  aacAsAdts,
  aacTrackOf,
  adtsFieldsOf,
  isQuickTimeHead,
  writeAdtsHeader,
} from "../../src/components/v3/video-estimator-blueprint/movie-audio";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── The schema: a reading in the old shape still parses ──────────────────────
const old = walkthroughAnalysisSchema.parse({
  projectType: "other",
  title: "Kitchen sink swap",
  location: null,
  scope: "Replace the kitchen sink and faucet.",
  measurements: [{ label: "Sink width", value: "33", unit: "in", confidence: "high", source: "spoken" }],
  observations: ["Old multi-turn shutoffs under the sink"],
  frames: [],
  enoughDetail: true,
  questions: [],
  confidence: 70,
  transcriptHighlights: ["replace the sink and the faucet"],
});
check("an old-shape reading parses, the new lists default to empty", old.work.length === 0 && old.behind.length === 0 && old.steps.length === 0 && old.permits.length === 0);
const oldBrief = briefFromAnalysis(old, "");
check("…and its brief carries no empty look-ahead headings", !/The work, as said|brings with it|Procedure, in build order|Permits and inspections/.test(oldBrief) && oldBrief.startsWith("Replace the kitchen sink"));

// ── The schema: the deep reading ─────────────────────────────────────────────
const rich = walkthroughAnalysisSchema.parse({
  projectType: "other",
  title: "Kitchen sink and faucet replacement",
  location: "Lehi, UT",
  scope: "S".repeat(7000),
  work: [
    { what: "Replace the kitchen sink", where: "kitchen", detail: "33 in. stainless undermount, double bowl", source: "spoken" },
    { what: "Replace the faucet", source: "spoken" },
    { what: "   ", source: "visual" },
    { what: "W".repeat(500) },
    ...Array.from({ length: WORK_MAX + 5 }, (_, i) => ({ what: `extra ${i}` })),
  ],
  behind: [
    { item: "Quarter-turn shutoff valves, hot and cold", because: "the sink swap — the old stops are multi-turn and will not reseat", handling: "include" },
    { item: "Cabinet floor repair under the sink", because: "water staining visible at 00:21", handling: "allowance" },
    { item: "Disposal circuit and switch", because: "no disposal seen; if one is wanted it needs power", handling: "verify" },
    { item: "No handling given" },
    { item: "", because: "dropped" },
    ...Array.from({ length: BEHIND_MAX + 3 }, (_, i) => ({ item: `more ${i}` })),
  ],
  steps: [
    { step: "Protect floors and counters; shut off water; disconnect supply, drain and disposal", materials: "floor protection, bucket", labor: "plumber, 0.5 h" },
    { step: "Pull the old sink, faucet and strainer; haul off", labor: "plumber, 0.5 h" },
    { step: "Set the new sink; mount the faucet; new strainer, tailpiece and P-trap", materials: "33 in. undermount sink, faucet, 1-1/2 in. P-trap kit, plumber's putty, silicone" },
    { step: "" },
    ...Array.from({ length: STEPS_MAX + 2 }, (_, i) => ({ step: `step ${i}` })),
  ],
  permits: ["", "None expected for a like-for-like fixture swap", ...Array.from({ length: 10 }, (_, i) => `p${i}`)],
  measurements: [{ label: "Sink width", value: "33", unit: "in", confidence: "high", source: "spoken" }],
  observations: ["Multi-turn shutoffs, corroded"],
  frames: [{ index: 0, label: "Existing sink" }],
  enoughDetail: true,
  questions: [],
  confidence: 82,
  transcriptHighlights: ["replace the sink and the faucet"],
});
check("blank work items are dropped, the rest capped at WORK_MAX, a long task clipped to 200", rich.work.length === WORK_MAX && !rich.work.some((w) => !w.what) && rich.work[2].what.length === 200);
check("work keeps where, detail and source", rich.work[0].where === "kitchen" && rich.work[0].detail?.startsWith("33 in.") && rich.work[0].source === "spoken" && rich.work[1].source === "spoken" && rich.work[3].source === "visual");
check("behind: blank items dropped, capped, handling defaults to include, because defaults to empty", rich.behind.length === BEHIND_MAX && rich.behind[3].handling === "include" && rich.behind[3].because === "" && !rich.behind.some((b) => !b.item));
check("behind keeps the three handlings", rich.behind[0].handling === "include" && rich.behind[1].handling === "allowance" && rich.behind[2].handling === "verify");
check("steps: blank dropped, capped at STEPS_MAX, materials and labor optional", rich.steps.length === STEPS_MAX && rich.steps[1].materials === undefined && rich.steps[1].labor === "plumber, 0.5 h");
check("permits: blanks dropped, capped at 8", rich.permits.length === 8 && rich.permits[0].startsWith("None expected"));
check("a scope the model ran long is clipped, not refused", rich.scope.length === 6000);
check("the handling labels read as a contractor would", BEHIND_LABEL.include === "Included" && BEHIND_LABEL.allowance === "Allowance" && BEHIND_LABEL.verify === "To confirm");

// ── The brief the planner prices ─────────────────────────────────────────────
const brief = briefFromAnalysis(rich, "Leave the disposal out.");
const at = (s: string) => brief.indexOf(s);
check("the brief opens with the scope", brief.startsWith("S".repeat(100)));
check("the work list follows, every item with its source", at("The work, as said or shown") > 0 && brief.includes("- Replace the kitchen sink — kitchen · 33 in. stainless undermount, double bowl (spoken)") && brief.includes("- Replace the faucet (spoken)"));
check("the look-ahead is there, each item tagged INCLUDED / ALLOWANCE / TO CONFIRM", brief.includes("- Quarter-turn shutoff valves, hot and cold — the sink swap — the old stops are multi-turn and will not reseat [INCLUDED]") && brief.includes("- Cabinet floor repair under the sink — water staining visible at 00:21 [ALLOWANCE]") && brief.includes("- Disposal circuit and switch — no disposal seen; if one is wanted it needs power [TO CONFIRM]"));
check("…and tells the planner what an allowance and a to-confirm item become", /Price each as its own line.*ALLOWANCE.*allowance line.*TO CONFIRM.*confirm on site/.test(brief));
check("the procedure is numbered, with materials and labor", brief.includes("1. Protect floors and counters; shut off water; disconnect supply, drain and disposal — materials: floor protection, bucket — labor: plumber, 0.5 h") && brief.includes("2. Pull the old sink, faucet and strainer; haul off — labor: plumber, 0.5 h"));
check("permits ride after the site observations", at("Permits and inspections:") > at("Site observations:") && brief.includes("- None expected for a like-for-like fixture swap"));
check("the order is scope → work → look-ahead → procedure → measured → observations → permits → said → notes", at("The work, as said") < at("What the work brings with it") && at("What the work brings with it") < at("Procedure, in build order") && at("Procedure, in build order") < at("Measured from the walkthrough:") && at("Measured from the walkthrough:") < at("Site observations:") && at("Permits and inspections:") < at("Said on the walkthrough:") && brief.trimEnd().endsWith("Contractor notes: Leave the disposal out."));

// ── The reader's instructions ────────────────────────────────────────────────
check("the JSON contract names the four new fields", /"work": \[/.test(WALKTHROUGH_JSON_CONTRACT) && /"behind": \[/.test(WALKTHROUGH_JSON_CONTRACT) && /"steps": \[/.test(WALKTHROUGH_JSON_CONTRACT) && /"permits": string\[\]/.test(WALKTHROUGH_JSON_CONTRACT));
check("the contract's handling words are the schema's", WALKTHROUGH_JSON_CONTRACT.includes('"handling": "include"|"allowance"|"verify"'));
check("the rules say what sits under the sink, and not to pad", LOOK_AHEAD_GUIDE.includes("Sink or faucet: shutoff valves") && LOOK_AHEAD_GUIDE.includes("P-trap") && WALKTHROUGH_READER_PROMPT.includes("Do not pad"));
check("the rules cover the look-ahead, the procedure, materials and labor, counts and permits", /THE LOOK-AHEAD/.test(WALKTHROUGH_READER_PROMPT) && /THE PROCEDURE/.test(WALKTHROUGH_READER_PROMPT) && /materials it uses/.test(WALKTHROUGH_READER_PROMPT) && /labor it takes/.test(WALKTHROUGH_READER_PROMPT) && /COUNT what you see/.test(WALKTHROUGH_READER_PROMPT) && /\(11\) permits/.test(WALKTHROUGH_READER_PROMPT));
check("spoken is still ground truth and nothing is invented", /Anything SAID is ground truth/.test(WALKTHROUGH_READER_PROMPT) && /Never invent a number/.test(WALKTHROUGH_READER_PROMPT));
check("the trade memory spans the trades the app estimates", ["Roofing:", "Siding:", "Gutters:", "Deck:", "Fence:", "HVAC:", "Water heater:", "Flooring:", "Electrical:"].every((t) => LOOK_AHEAD_GUIDE.includes(t)));
check("no store or brand prices asked of the reader", /never a store or a brand price/.test(WALKTHROUGH_READER_PROMPT));
check("the prompt is one system message of a sane size", WALKTHROUGH_READER_PROMPT.length > 4000 && WALKTHROUGH_READER_PROMPT.length < 12000, `${WALKTHROUGH_READER_PROMPT.length} chars`);

// ── The input the action takes is unchanged ──────────────────────────────────
check("the action still wants at least one frame", !walkthroughInputSchema.safeParse({ frames: [], duration: 10 }).success && walkthroughInputSchema.safeParse({ frames: [{ t: 1, dataUrl: "data:image/jpeg;base64,AAAA" }], duration: 10 }).success);

// ── The browser-side frame maths ─────────────────────────────────────────────
check("frame count: 4 for a 35-s clip, 10 for two minutes, 14 for five", frameCountFor(35) === 4 && frameCountFor(120) === 10 && frameCountFor(300) === 14 && frameCountFor(5) === 4);
const t35 = frameTimes(35, 4);
check("frame times keep off the ends and spread evenly", t35.length === 4 && Math.abs(t35[0] - 0.4) < 1e-9 && Math.abs(t35[3] - 34.6) < 1e-9 && Math.abs(t35[1] - 11.8) < 1e-9);
check("a one-frame clip takes the middle, never past the end", frameTimes(2, 1)[0] <= 1 && frameTimes(0.5, 4).every((t) => t >= 0 && t <= 0.5));
check("black is blank; a dark grey still is a picture", isBlankPixels(new Uint8ClampedArray(24 * 24 * 4)) && isBlankPixels(new Uint8ClampedArray([5, 5, 5, 255, 8, 8, 8, 255])) && !isBlankPixels(new Uint8ClampedArray([0, 0, 0, 255, 30, 30, 30, 255])));
const base: FrameReport = { strategy: "none", wanted: 4, seekOk: 0, seekTimeouts: 0, seekErrors: 0, playOk: 0, blank: 0, repeated: 0, thrown: [], playNote: "", ms: 0 };
check("the failure reason: a tainted canvas", frameFailureReason({ ...base, thrown: ["SecurityError"] }).includes("refused to copy pictures"));
check("the failure reason: a track it cannot decode", frameFailureReason({ ...base, seekErrors: 1 }).includes("could not decode"));
check("the failure reason: seeks that never land, and playback refused", frameFailureReason({ ...base, seekTimeouts: 2, playNote: "refused: NotAllowedError" }) === "the browser never finished seeking through this clip and refused to play it (NotAllowedError)");
check("the failure reason: seeks that never land, and playback that stalled", frameFailureReason({ ...base, seekTimeouts: 2, playNote: "did not start" }) === "the browser never finished seeking through this clip and playback did not start");
check("the failure reason: playback refused alone", frameFailureReason({ ...base, playNote: "refused: AbortError" }) === "the browser refused to play this clip (AbortError)");
check("the failure reason: seeks alone", frameFailureReason({ ...base, seekTimeouts: 2 }) === "the browser never finished seeking through this clip");
check("the failure reason: black frames", frameFailureReason({ ...base, blank: 4 }) === "every frame came back black");
check("the failure reason: nothing to say", frameFailureReason(base) === "no frame could be decoded");
check("a pull refused for want of a gesture, and nothing else wrong, asks for a tap", pullNeedsTap({ ...base, seekTimeouts: 1, playNote: "refused: NotAllowedError" }));
check("…but not when a still landed, the track failed, or the refusal was something else", !pullNeedsTap({ ...base, seekOk: 1, playNote: "refused: NotAllowedError" }) && !pullNeedsTap({ ...base, seekErrors: 1, playNote: "refused: NotAllowedError" }) && !pullNeedsTap({ ...base, playNote: "refused: AbortError" }) && !pullNeedsTap({ ...base, seekTimeouts: 2 }));
const ten = Array.from({ length: 10 }, (_, i) => ({ t: i, dataUrl: "d" }));
check("the strip takes the first, the last and an even spread", stripFrames(ten, 4).map((f) => f.t).join(",") === "0,3,6,9" && stripFrames(ten.slice(0, 3), 4).length === 3);

// ── The sound of a QuickTime movie (movie-audio.ts) ─────────────────────────
// Safari will not decode a .MOV's audio, so the AAC is lifted out as ADTS. A
// synthetic movie stands in for an iPhone's: the sound track after a picture
// track, a QuickTime v1 sound description with its esds inside a `wave` atom,
// two runs in the sample-to-chunk table, the index after the media.
const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => Math.floor(n / 2 ** (8 * (bytes - 1 - i))) & 255);
const cat = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const mkbox = (type: string, ...body: (number[] | Uint8Array)[]) => {
  const b = cat(...body);
  return cat(be(8 + b.length, 4), enc(type), b);
};
const full = (type: string, ...body: (number[] | Uint8Array)[]) => mkbox(type, [0, 0, 0, 0], ...body);
const ASC_LC_48K_MONO = [0x11, 0x88];
const esdsBox = (asc: number[], longLengths = false) => {
  const len = (n: number) => (longLengths ? [0x80, 0x80, 0x80, n] : [n]);
  const dsi = [0x05, ...len(asc.length), ...asc];
  const dcd = [0x04, ...len(13 + dsi.length), 0x40, 0x15, 0, 0, 0, ...be(64000, 4), ...be(64000, 4), ...dsi];
  const es = [0x03, ...len(3 + dcd.length), 0, 1, 0, ...dcd];
  return full("esds", es);
};
const soundEntry = (kind: "qt-v1" | "iso-v0", asc: number[], codec = "mp4a") => {
  const common = (version: number) => [...be(0, 6), ...be(1, 2), ...be(version, 2), ...be(0, 2), ...be(0, 4), ...be(1, 2), ...be(16, 2), ...be(version ? 0xfffe : 0, 2), ...be(0, 2), ...be(48000 * 65536, 4)];
  if (kind === "iso-v0") return mkbox(codec, common(0), esdsBox(asc));
  const v1 = [...be(1024, 4), ...be(0, 4), ...be(0, 4), ...be(2, 4)];
  const wave = mkbox("wave", mkbox("frma", enc("mp4a")), mkbox("mp4a", [0, 0, 0, 0]), esdsBox(asc, true), [0, 0, 0, 8, 0, 0, 0, 0]);
  return mkbox(codec, common(1), v1, wave);
};
type Layout = { kind: "qt-v1" | "iso-v0"; moovFirst: boolean; co64: boolean; brand: string; apacFirst?: boolean; noSound?: boolean; badOffset?: boolean };
const FRAMES = [10, 20, 15, 7, 30].map((n, i) => Uint8Array.from({ length: n }, (_, k) => (i * 37 + k * 11 + 1) & 255));
function movie(l: Layout): { file: Uint8Array; expected: Uint8Array } {
  const ftyp = mkbox("ftyp", enc(l.brand), be(0x200, 4), enc(l.brand));
  const junk = new Uint8Array(100).fill(0xee);
  const chunk1 = cat(FRAMES[0], FRAMES[1], FRAMES[2]);
  const chunk2 = cat(FRAMES[3], FRAMES[4]);
  const mdatBody = cat(junk, chunk1, junk, chunk2);
  const build = (mdatAt: number) => {
    const c1 = mdatAt + 8 + junk.length;
    const c2 = c1 + chunk1.length + junk.length;
    const offs = l.badOffset ? [c1, 10_000_000] : [c1, c2];
    const chunkTable = l.co64 ? full("co64", be(2, 4), ...offs.map((o) => be(o, 8))) : full("stco", be(2, 4), ...offs.map((o) => be(o, 4)));
    const stbl = mkbox("stbl",
      full("stsd", be(1, 4), soundEntry(l.kind, ASC_LC_48K_MONO)),
      full("stts", be(1, 4), be(5, 4), be(1024, 4)),
      full("stsc", be(2, 4), be(1, 4), be(3, 4), be(1, 4), be(2, 4), be(2, 4), be(1, 4)),
      full("stsz", be(0, 4), be(5, 4), ...FRAMES.map((f) => be(f.length, 4))),
      chunkTable);
    const soundTrak = mkbox("trak", mkbox("mdia",
      full("mdhd", be(0, 4), be(0, 4), be(48000, 4), be(5 * 1024, 4), be(0, 4)),
      full("hdlr", be(0, 4), enc("soun"), be(0, 12), [0]),
      mkbox("minf", stbl)));
    const pictureTrak = mkbox("trak", mkbox("mdia", full("hdlr", be(0, 4), enc("vide"), be(0, 12), [0])));
    const apacTrak = mkbox("trak", mkbox("mdia",
      full("hdlr", be(0, 4), enc("soun"), be(0, 12), [0]),
      mkbox("minf", mkbox("stbl", full("stsd", be(1, 4), soundEntry("iso-v0", ASC_LC_48K_MONO, "apac"))))));
    const traks = [pictureTrak, ...(l.apacFirst ? [apacTrak] : []), ...(l.noSound ? [] : [soundTrak])];
    return mkbox("moov", full("mvhd", be(0, 96)), ...traks);
  };
  const mdat = (moovLen: number) => mkbox("mdat", mdatBody).length + moovLen;
  void mdat;
  let file: Uint8Array;
  if (l.moovFirst) {
    const probe = build(0);
    const moov = build(ftyp.length + probe.length);
    file = cat(ftyp, moov, mkbox("mdat", mdatBody));
  } else {
    const wide = [0, 0, 0, 8, ...enc("wide")];
    file = cat(ftyp, wide, mkbox("mdat", mdatBody), build(ftyp.length + wide.length));
  }
  const expected = cat(...FRAMES.flatMap((f) => {
    const h = new Uint8Array(7);
    writeAdtsHeader(h, 0, { profile: 1, sfi: 3, channels: 1 }, f.length + 7);
    return [h, f];
  }));
  return { file, expected };
}
const readerOver = (file: Uint8Array) => {
  const log: [number, number][] = [];
  const read = async (o: number, n: number) => {
    log.push([o, n]);
    return file.subarray(o, Math.min(file.length, o + n));
  };
  return { read, log };
};
const same = (a: Uint8Array | undefined, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

const head = new Uint8Array(7);
writeAdtsHeader(head, 0, { profile: 1, sfi: 3, channels: 1 }, 17);
check("an ADTS header, bit for bit (AAC LC, 48 kHz, mono, 17-byte frame)", Array.from(head).map((x) => x.toString(16).padStart(2, "0")).join(" ") === "ff f1 4c 40 02 3f fc");
check("AudioSpecificConfig: LC 48k mono, LC 44.1k stereo", JSON.stringify(adtsFieldsOf(Uint8Array.from([0x11, 0x88]))) === JSON.stringify({ profile: 1, sfi: 3, channels: 1 }) && JSON.stringify(adtsFieldsOf(Uint8Array.from([0x12, 0x10]))) === JSON.stringify({ profile: 1, sfi: 4, channels: 2 }));
check("…explicit SBR (HE-AAC) is carried as its core AAC LC, at the core rate", JSON.stringify(adtsFieldsOf(Uint8Array.from([0x2b, 0x92, 0x08]))) === JSON.stringify({ profile: 1, sfi: 7, channels: 2 }));
check("…what ADTS cannot carry is refused: AAC-LD, a channel layout from a PCE, a cut-short config", adtsFieldsOf(Uint8Array.from([0xb9, 0x88])) === null && adtsFieldsOf(Uint8Array.from([0x11, 0x80])) === null && adtsFieldsOf(Uint8Array.from([0x11])) === null);
check("a QuickTime head is told from an MP4's", isQuickTimeHead(Uint8Array.from([0, 0, 0, 20, ...enc("ftypqt  ")])) && !isQuickTimeHead(Uint8Array.from([0, 0, 0, 20, ...enc("ftypisom")])) && !isQuickTimeHead(new Uint8Array(4)));

void (async () => {
  const qt = movie({ kind: "qt-v1", moovFirst: false, co64: false, brand: "qt  " });
  const r1 = readerOver(qt.file);
  const a1 = await aacAsAdts(r1.read, qt.file.length);
  check("an iPhone-style movie (index last, QuickTime v1 sound, esds in a wave atom, two chunk runs): the AAC comes out as ADTS, frame for frame", same(a1?.bytes, qt.expected), `${a1?.bytes.length ?? "null"} vs ${qt.expected.length} bytes`);
  check("…with the track's own length", !!a1 && Math.abs(a1.seconds - (5 * 1024) / 48000) < 1e-9);
  check("…reading the index and the sound, never the picture between", r1.log.every(([o, n]) => o + n <= qt.file.length) && r1.log.reduce((t, [, n]) => t + n, 0) < qt.file.length);
  const iso = movie({ kind: "iso-v0", moovFirst: true, co64: true, brand: "isom" });
  const a2 = await aacAsAdts(readerOver(iso.file).read, iso.file.length);
  check("a web-export MP4 (index first, plain sound entry, 64-bit chunk offsets): the same frames", same(a2?.bytes, iso.expected));
  const apac = movie({ kind: "qt-v1", moovFirst: false, co64: false, brand: "qt  ", apacFirst: true });
  check("a spatial-audio track ahead of the AAC one is passed over for it", same((await aacAsAdts(readerOver(apac.file).read, apac.file.length))?.bytes, apac.expected));
  const silent = movie({ kind: "qt-v1", moovFirst: false, co64: false, brand: "qt  ", noSound: true });
  check("a movie with no sound track gives nothing", (await aacAsAdts(readerOver(silent.file).read, silent.file.length)) === null);
  const broken = movie({ kind: "qt-v1", moovFirst: false, co64: false, brand: "qt  ", badOffset: true });
  check("an index pointing past the end of the file gives nothing, and reads nothing out of bounds", (await aacAsAdts(readerOver(broken.file).read, broken.file.length)) === null);
  check("not a movie at all gives nothing", (await aacAsAdts(readerOver(Uint8Array.from(enc("RIFF....WEBMjunkjunk"))).read, 20)) === null && aacTrackOf(Uint8Array.from(enc("notmoov!"))) === null);

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
