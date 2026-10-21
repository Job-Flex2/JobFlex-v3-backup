"use client";
// TALK TO DECK STUDIO (2026-10-21).
//
// Owner: "add as much as possible commands that could exist to work in Deck Studio as a human being … make it super
// smart" and "when I speak to design my deck it would show in a live 3D, and everywhere switching numbers, design,
// sizes in a live mode." A panel over the 3D: the mic (hands-free by default — it keeps listening), the words as
// they are said, and the studio's answer, spoken and written. What is said changes the design the studio already
// shows — the 3D, the form's numbers, the price change at once, through the same engine as a click — and the panel
// lights the part, flies the camera, flashes the fields that changed. "Undo" takes any of it back. What its own rules
// cannot read goes to the AI (actions/deckVoice), and the reading is kept for the shop, so it is understood offline
// the next time; what the studio cannot draw is offered as the shop's own priced item, and noted for the team.

import * as React from "react";
import { HelpCircle, Mic, MicOff, Send, Volume2, VolumeX, X } from "lucide-react";
import type { DeckDesign } from "@/lib/deck/design";
import type { FieldFocus } from "@/lib/deck/fieldParts";
import type { DeckCommand } from "@/lib/deck/voice/commands";
import { designSummary, freshVoiceState, hear, runCommands, type BrainEnv, type Reply, type VoiceState } from "@/lib/deck/voice/assistant";
import type { Flash, GoStep, ViewChange } from "@/lib/deck/voice/run";
import { normalizeSpeech, phraseKey, trimClause } from "@/lib/deck/voice/words";
import { deckVoiceInterpret, deckVoiceMemory, deckVoiceRemember, type VoiceMemoryView } from "@/actions/deckVoice";
import { useDeckSpeech } from "./use-deck-speech";
import "./deck-voice.css";

/** What the studio lends the panel: its design and the doors it changes things through. */
export interface DeckVoiceHost {
  design: DeckDesign;
  /** A saved deck opened in the preview: questions and views only. */
  readOnly: boolean;
  env: BrainEnv;
  apply: (next: DeckDesign, touched: string[]) => void;
  view: (v: ViewChange) => void;
  light: (f: FieldFocus | null, fly: boolean) => void;
  fly: (p: [number, number, number]) => void;
  flash: (fields: Flash[], priceChanged: boolean) => void;
  /** A print or list link for the design as it stands (null in the preview — the add-on's dialog opens instead). */
  link: (what: "permit" | "yard" | "installer") => string | null;
  go: (step: GoStep) => void;
  name: (title: string) => void;
  address: (text: string) => void;
  save: () => void;
  reset: () => void;
}

interface Line {
  id: number;
  who: "you" | "studio";
  text: string;
  link?: { href: string; label: string } | null;
  ask?: string | null;
  thinking?: boolean;
}

const EXAMPLES: ReadonlyArray<{ title: string; lines: string[] }> = [
  { title: "Size and shape", lines: ["Make it 20 by 14", "A little bigger", "Push it out 3 more feet", "Make it L-shaped", "Curved front", "300 square feet"] },
  { title: "Height", lines: ["Raise it 6 inches", "Second-story deck", "Ground level"] },
  { title: "Boards and rail", lines: ["Trex Transcend", "Make it dark gray", "Darker", "Picture-frame border", "Diagonal boards", "Cable railing", "42-inch railing"] },
  { title: "Stairs", lines: ["Add stairs on the left", "Make them wider", "Move them to the right side", "Handrails on both sides", "Wrap-around steps"] },
  { title: "Roof and extras", lines: ["Add a gable roof", "Steeper", "9-foot ceiling", "Screen it in", "Make it a pergola", "Add two heaters", "Add a hot tub"] },
  { title: "Ask and look", lines: ["How much concrete do I need?", "How will the boards lay down?", "Do I need a permit?", "What if it was composite?", "Show me the joists", "Show it at night", "Spin it around", "From underneath"] },
  { title: "Memory", lines: ["When I say my usual, make it 16 by 12 with Trex and aluminum railing", "Add a fire pit for 1,200 dollars", "Undo", "Forget that"] },
];

const read = (key: string, fallback: boolean) => {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const write = (key: string, on: boolean) => {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* a private window */
  }
};

/** What is read aloud: the reply's first two sentences, and its question. */
function spoken(r: { say: string; pending: { ask: string } | null }): string {
  const sentences = r.say.split(/(?<=[.!?])\s+(?=[A-Z"])/);
  const head = sentences.slice(0, 2).join(" ");
  const ask = r.pending && !head.includes(r.pending.ask) && sentences.length > 2 ? ` ${sentences[sentences.length - 1]}` : "";
  return `${head}${ask}`.trim();
}

export function DeckVoice({ host, onClose }: { host: DeckVoiceHost; onClose: () => void }) {
  const [lines, setLines] = React.useState<Line[]>([]);
  const [interim, setInterim] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [chips, setChips] = React.useState<string[]>(["Make it 20 by 14", "Add stairs", "How much concrete?", "Show me at night"]);
  const [pending, setPending] = React.useState<string | null>(null);
  const [handsFree, setHandsFree] = React.useState(() => (typeof window === "undefined" ? true : read("jf-deck-voice-hands", true)));
  const [muted, setMuted] = React.useState(() => (typeof window === "undefined" ? false : read("jf-deck-voice-muted", false)));
  const [help, setHelp] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  const idRef = React.useRef(1);
  const hostRef = React.useRef(host);
  const stateRef = React.useRef<VoiceState>(freshVoiceState());
  const past = React.useRef<DeckDesign[]>([]);
  const future = React.useRef<DeckDesign[]>([]);
  const lastMade = React.useRef<DeckDesign | null>(null);
  const memory = React.useRef<VoiceMemoryView>({ phrases: {}, taught: [], items: {} });
  const lastLearned = React.useRef<string | null>(null);
  const mutedRef = React.useRef(muted);
  React.useEffect(() => {
    hostRef.current = host;
    mutedRef.current = muted;
  });

  // The shop's memory: its taught phrases and priced items, read once.
  React.useEffect(() => {
    let live = true;
    void deckVoiceMemory().then((r) => {
      if (live && r.ok) memory.current = r.memory;
    });
    return () => {
      live = false;
    };
  }, []);

  const push = React.useCallback((line: Omit<Line, "id">) => {
    const id = idRef.current++;
    setLines((ls) => [...ls.filter((l) => !l.thinking), { ...line, id }].slice(-40));
    return id;
  }, []);

  const speech = useDeckSpeech({
    onFinal: (alts) => handleRef.current?.(alts, false),
    onInterim: (t) => setInterim(t),
    onError: (m) => push({ who: "studio", text: m }),
  });
  const speechRef = React.useRef(speech);
  React.useEffect(() => {
    speechRef.current = speech;
  });

  const env = (): BrainEnv => ({ ...hostRef.current.env, learned: memory.current.phrases, items: memory.current.items });

  /** A reply carried out: the design, the 3D, the form, the memory — then said. */
  const carry = React.useCallback(
    (r: Reply, opts: { typed: boolean }): void => {
      const h = hostRef.current;
      const m = r.meta;
      let say = r.say;
      let link: Line["link"] = null;
      if (r.design) {
        if (h.readOnly) say = "This saved deck opens to look at — start a new deck to change it. I can still answer questions and show you around.";
        else if (!m.reset) {
          past.current = [...past.current, h.design].slice(-30);
          future.current = [];
          lastMade.current = r.design;
          h.apply(r.design, r.touched);
        }
      }
      if (m.undo || m.redo) {
        const from = m.undo ? past : future;
        const to = m.undo ? future : past;
        const prev = from.current[from.current.length - 1];
        if (!prev) say = m.undo ? "Nothing to undo." : "Nothing to redo.";
        else if (h.readOnly) say = "This saved deck opens to look at.";
        else {
          const handEdited = m.undo && lastMade.current && h.design !== lastMade.current;
          from.current = from.current.slice(0, -1);
          to.current = [...to.current, h.design].slice(-30);
          lastMade.current = prev;
          h.apply(prev, []);
          say = m.undo ? `Undone.${handEdited ? " (That also took back what you changed by hand since.)" : ""}` : "Redone.";
        }
      }
      if (r.view) h.view(r.view);
      if (r.light !== undefined && r.light !== null) h.light(r.light, r.ran.some((c) => c.do === "show"));
      else if (r.ran.some((c) => c.do === "show")) h.light(null, false);
      if (r.fly) h.fly(r.fly);
      if (r.design && !h.readOnly && (r.flash.length || r.price)) h.flash(r.flash, !!r.price && r.price.before !== r.price.after);
      if (m.open) {
        const href = h.link(m.open);
        const label = m.open === "permit" ? "Open the permit set" : m.open === "yard" ? "Open the lumber yard's list" : "Open the installer's sheet";
        if (href) {
          link = { href, label };
          if (opts.typed) window.open(href, "_blank", "noopener");
        }
      }
      if (m.go) h.go(m.go);
      if (m.name) h.name(m.name);
      if (m.address) h.address(m.address);
      if (m.save) h.save();
      if (m.reset) {
        past.current = [...past.current, h.design].slice(-30);
        h.reset();
      }
      if (m.stop) speechRef.current.stop();
      if (m.mute !== undefined) {
        setMuted(m.mute);
        write("jf-deck-voice-muted", m.mute);
      }
      if (m.help) setHelp(true);
      if (m.teach?.cmds) {
        const key = phraseKey(trimClause(normalizeSpeech(m.teach.phrase)));
        memory.current = { ...memory.current, phrases: { ...memory.current.phrases, [key]: m.teach.cmds }, taught: [...memory.current.taught, key] };
        lastLearned.current = key;
        void deckVoiceRemember({ kind: "teach", phrase: key, cmds: m.teach.cmds });
      }
      if (m.forget) {
        const key = m.forget.phrase ? phraseKey(trimClause(normalizeSpeech(m.forget.phrase))) : lastLearned.current;
        if (key) {
          const phrases = { ...memory.current.phrases };
          delete phrases[key];
          memory.current = { ...memory.current, phrases };
        }
        void deckVoiceRemember({ kind: "forget", phrase: key });
      }
      if (m.wish) void deckVoiceRemember({ kind: "wish", text: m.wish.text, item: m.wish.item ?? null });
      if (m.remember) {
        memory.current = { ...memory.current, items: { ...memory.current.items, [m.remember.name.toLowerCase()]: m.remember } };
        void deckVoiceRemember({ kind: "item", name: m.remember.name, unit: m.remember.unit, price: m.remember.price });
      }
      stateRef.current = r.state;
      setPending(r.pending?.ask ?? null);
      if (r.chips.length) setChips(r.pending ? ["Yes", "No", ...r.chips.slice(0, 3)] : r.chips.slice(0, 5));
      if (say) {
        push({ who: "studio", text: say, link, ask: r.pending?.ask ?? null });
        if (!mutedRef.current) speechRef.current.say(spoken({ say, pending: r.pending }));
      }
    },
    [push],
  );

  /** One thing said or typed: the rules first, at once; what they cannot read, the AI. */
  const handle = React.useCallback(
    async (input: string[] | string, isTyped: boolean) => {
      const alts = (Array.isArray(input) ? input : [input]).map((s) => s.trim()).filter(Boolean);
      if (!alts.length) return;
      setInterim("");
      push({ who: "you", text: alts[0] });
      const h = hostRef.current;
      const r = hear(alts, h.design, stateRef.current, env());
      const known = r.ran.length > 0 || !!r.say;
      if (known) carry(r, { typed: isTyped });
      if (!r.unknown.length) {
        if (!known) carry({ ...r, say: "OK." }, { typed: isTyped });
        return;
      }
      // The rules could not read some of it: the AI reads that part, against the design as it now stands.
      const rest = r.unknown.map((u) => trimClause(normalizeSpeech(u))).join(". ");
      setThinking(true);
      const tid = push({ who: "studio", text: "…", thinking: true });
      try {
        const ai = await deckVoiceInterpret({ text: rest, summary: designSummary(hostRef.current.design) });
        setLines((ls) => ls.filter((l) => l.id !== tid));
        if (!ai.ok || !ai.cmds.length) {
          const fallback = ai.ok && ai.say ? ai.say : `I didn't catch "${rest}". Try "make it 20 by 14", "add stairs on the left", "how much concrete?" — or tap ? for more.`;
          carry({ ...runCommands([], hostRef.current.design, stateRef.current, env(), rest), say: ai.ok ? fallback : `${ai.error} ${fallback}` }, { typed: isTyped });
          return;
        }
        if (ai.learned) {
          const key = phraseKey(rest);
          memory.current = { ...memory.current, phrases: { ...memory.current.phrases, [key]: ai.cmds as DeckCommand[] } };
          lastLearned.current = key;
        }
        const r2 = runCommands(ai.cmds, hostRef.current.design, stateRef.current, env(), rest);
        carry({ ...r2, say: r2.say || ai.say || "Done." }, { typed: isTyped });
      } finally {
        setThinking(false);
      }
    },
    [carry, push],
  );
  const handleRef = React.useRef<typeof handle | null>(null);
  React.useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  const micOn = speech.mic === "listening" || speech.mic === "recording";
  const toggleMic = () => {
    if (micOn) speech.stop();
    else {
      speech.hush();
      speech.start(handsFree);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    void handle(t, true);
  };
  const tryLine = (t: string) => {
    setHelp(false);
    void handle(t, true);
  };
  const lastYou = [...lines].reverse().find((l) => l.who === "you");
  const lastStudio = [...lines].reverse().find((l) => l.who === "studio");
  const status = speech.mic === "listening" ? (speech.speaking ? "Talking…" : handsFree ? "Listening — just talk" : "Listening…") : speech.mic === "recording" ? "Recording — pause when done" : speech.mic === "sending" ? "Writing it down…" : thinking ? "Thinking…" : speech.mode === "none" ? "Type what you want" : "Tap the mic and talk, or type";

  return (
    <section className="dv-panel" aria-label="Talk to Deck Studio" data-deck-voice>
      <header className="dv-head">
        <span className="dv-title">Talk to Deck Studio</span>
        <span className="dv-status" role="status" data-deck-voice-status>{status}</span>
        <div className="dv-head-acts">
          <label className="dv-switch" title="Hands-free: keep listening after each answer">
            <input type="checkbox" checked={handsFree} onChange={(e) => { setHandsFree(e.target.checked); write("jf-deck-voice-hands", e.target.checked); if (micOn) { speech.stop(); } }} />
            <span>Hands-free</span>
          </label>
          <button type="button" className="dv-icon" aria-pressed={!muted} aria-label={muted ? "Read answers aloud" : "Stop reading answers aloud"} onClick={() => { const m = !muted; setMuted(m); write("jf-deck-voice-muted", m); if (m) speech.hush(); }} data-deck-voice-mute>
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="dv-icon" aria-expanded={help} aria-label="What can I say?" onClick={() => setHelp((v) => !v)} data-deck-voice-help>
            <HelpCircle size={16} aria-hidden="true" />
          </button>
          <button type="button" className="dv-icon" aria-label="Close" onClick={() => { speech.stop(); speech.hush(); onClose(); }} data-deck-voice-close>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {help ? (
        <div className="dv-help" data-deck-voice-examples>
          <p className="dv-help-lead">Say it the way you would to a crew lead. Tap any line to try it.</p>
          {EXAMPLES.map((g) => (
            <div key={g.title} className="dv-help-group">
              <span className="dv-help-title">{g.title}</span>
              <div className="dv-chips">
                {g.lines.map((l) => (
                  <button key={l} type="button" className="dv-chip" onClick={() => tryLine(l)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {history && lines.length > 2 ? (
        <ol className="dv-log" aria-label="What was said">
          {lines.slice(0, -2).map((l) => (
            <li key={l.id} className={l.who === "you" ? "dv-you" : "dv-studio"}>
              {l.text}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="dv-now" aria-live="polite">
        {interim ? (
          <p className="dv-you dv-interim" data-deck-voice-interim>
            “{interim}”
          </p>
        ) : lastYou ? (
          <p className="dv-you" data-deck-voice-heard>
            “{lastYou.text}”
          </p>
        ) : null}
        {lastStudio && !interim ? (
          <div className={`dv-studio${lastStudio.thinking ? " is-thinking" : ""}`} data-deck-voice-reply>
            <p>{lastStudio.thinking ? "Thinking it over…" : lastStudio.text}</p>
            {lastStudio.link ? (
              <a className="dv-link" href={lastStudio.link.href} target="_blank" rel="noopener" data-deck-voice-link>
                {lastStudio.link.label} ↗
              </a>
            ) : null}
          </div>
        ) : !lastYou ? (
          <p className="dv-hint">Say what you want — “make it 20 by 14 with composite and an aluminum railing”, “add stairs on the left”, “how much concrete do I need?”. The 3D and the numbers change as you talk; “undo” takes anything back.</p>
        ) : null}
        {lines.length > 2 ? (
          <button type="button" className="dv-more" onClick={() => setHistory((v) => !v)}>
            {history ? "Hide what was said" : `Show what was said (${lines.length - 2})`}
          </button>
        ) : null}
      </div>

      <div className="dv-chips" data-deck-voice-chips>
        {(pending ? ["Yes", "No", ...chips.filter((c) => c !== "Yes" && c !== "No").slice(0, 3)] : chips).map((c) => (
          <button key={c} type="button" className={`dv-chip${c === "Yes" ? " is-yes" : ""}`} onClick={() => void handle(c, true)}>
            {c}
          </button>
        ))}
      </div>

      <form className="dv-input" onSubmit={submit}>
        <button type="button" className={`dv-mic${micOn ? " is-on" : ""}${speech.speaking ? " is-talking" : ""}`} aria-pressed={micOn} aria-label={micOn ? "Stop listening" : "Talk"} disabled={speech.mode === "none"} onClick={toggleMic} data-deck-voice-mic>
          {speech.mode === "none" ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
        </button>
        <input className="dv-text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={micOn ? "Listening… or type here" : "Type a command or a question"} aria-label="Type to Deck Studio" enterKeyHint="send" autoComplete="off" data-deck-voice-input />
        <button type="submit" className="dv-send" aria-label="Send" disabled={!typed.trim()}>
          <Send size={16} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

