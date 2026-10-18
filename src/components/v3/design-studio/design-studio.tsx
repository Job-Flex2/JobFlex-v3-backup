"use client";
// THE HOME DESIGN STUDIO (owner, 2026-10-17: "upload the blueprint, say I want to design the kitchen, and you bring
// that room already drawn — the sizes, where the doors are, whatever is in the plan for this room — then design it in
// 3D … super smart"). Milestones 1–2, admin preview:
//   Start → upload a plan set (or draw a room) → pick the floor-plan sheet (the likeliest is first) → the plan is read
//   in this browser from the PDF's own lines (lib/design/planRead): walls, doors, windows, rooms, the plan's cabinets
//   and fixtures; room names drawn as lines are read by the vision model on a numbered picture; the scale is checked
//   against the areas the plan prints → fix anything in the plan → "Design this room" opens the room in 3D beside it.
// A photo or scan is traced: set the scale with two clicks, draw the room over it.
import * as React from "react";
import dynamic from "next/dynamic";
import s from "./design-studio.module.css";
import { PlanEditor, setWallLength, type Selection, type Tool, type Underlay } from "./plan-editor";
import { DesignPanel } from "./design-panel";
import { EstimateSheet } from "./estimate-sheet";
import { HouseChanges, WallStructure } from "./house-changes";
import { SpacesPicker, type SpaceFloor } from "./spaces-picker";
import { classifySheet, findFloorPlans, isMultiFloor, matchScore, sameRoom, type FloorPlan, type FoundRoom } from "@/lib/design/planSet";
import { flaggedItems, flaggedWalls, houseChecks, kitchenChecks } from "@/lib/design/checks";
import { openUp, readStructure, readWall } from "@/lib/design/structure";
import type { DesignLocation } from "@/actions/designStudio";
import type { DesignDoc, OpeningKind, P } from "@/lib/design/model";
import { emptyDesign, ftIn, newId, DEFAULT_CEILING } from "@/lib/design/model";
import { centroid, dist, planBounds, roomsOf, wallLen, type Room } from "@/lib/design/geometry";
import { readPlan, type PlanRead } from "@/lib/design/planRead";
import { openDesignFiles, type DesignSheet } from "@/lib/design/pdfSheets";
import { deleteDesign, listDesigns, readRoomNames, saveDesign, type DesignRow } from "@/actions/designStudio";

const Room3D = dynamic(() => import("./room-3d").then((m) => m.Room3D), { ssr: false, loading: () => <div className={s.three} /> });

type Phase = "start" | "opening" | "spaces" | "sheets" | "box" | "reading" | "plan";

/** The rooms named as the plan names them (lib/design/planSet: stacked words joined, abbreviations spelled out), the
 *  plan's printed area kept for the scale check — and a room the reader's own words missed ("LOFT") labelled too. */
function namedLabels(labels: DesignDoc["labels"], found: FoundRoom[], region: Region, k: number): DesignDoc["labels"] {
  if (!found.length) return labels;
  const toIn = (p: { x: number; y: number }): P => ({ x: (p.x - region.x) * k, y: (p.y - region.y) * k });
  const inside = (p: P) => p.x >= 0 && p.y >= 0 && p.x <= region.w * k && p.y <= region.h * k;
  const keyOf = (f: FoundRoom) => `${f.name}@${Math.round(f.at.x)},${Math.round(f.at.y)}`;
  const used = new Set<string>();
  const out: DesignDoc["labels"] = [];
  for (const l of labels) {
    const near = found
      .map((f) => ({ f, d: dist(toIn(f.at), l.at) }))
      .filter((x) => x.d <= 48)
      .sort((a, b) => a.d - b.d)[0];
    if (!near) {
      out.push(l);
      continue;
    }
    // Two words of one stacked label ("MASTER" / "BEDROOM") were two labels: one room, one name.
    if (used.has(keyOf(near.f))) continue;
    used.add(keyOf(near.f));
    out.push({ ...l, name: near.f.name, at: toIn(near.f.at), ...(near.f.sqft ? { planSqFt: near.f.sqft } : {}) });
  }
  for (const f of found) {
    const at = toIn(f.at);
    if (used.has(keyOf(f)) || !inside(at)) continue;
    out.push({ id: newId("r"), name: f.name, at, ceiling: DEFAULT_CEILING, ...(f.sqft ? { planSqFt: f.sqft } : {}) });
  }
  return out;
}

type Region = { x: number; y: number; w: number; h: number };
type ScaleNote = { tone: "good" | "warn"; text: string; fix?: number };
/** One floor plan read: the design, what to say about it, and the sheet to draw underneath. */
type FloorRead = { doc: DesignDoc; notes: string[]; scaleNote: ScaleNote | null; underlay: Underlay };

/** A read plan moved (a whole house lays its floors side by side) and its ids made its own (two reads number alike). */
function placeFloor(d: DesignDoc, dx: number, dy: number, prefix: string, floor: string): DesignDoc {
  const m = (p: P): P => ({ x: p.x + dx, y: p.y + dy });
  const wid = (id: string) => `${prefix}${id}`;
  return {
    ...d,
    walls: d.walls.map((w) => ({ ...w, id: wid(w.id), a: m(w.a), b: m(w.b), floor })),
    openings: d.openings.map((o) => ({ ...o, id: wid(o.id), wallId: wid(o.wallId) })),
    labels: d.labels.map((l) => ({ ...l, id: wid(l.id), at: m(l.at), floor })),
    marks: d.marks.map((mk) => ({ ...mk, id: wid(mk.id), lines: mk.lines.map(([a, b]) => [m(a), m(b)] as [P, P]), box: { ...mk.box, x: mk.box.x + dx, y: mk.box.y + dy } })),
  };
}

const HISTORY_MAX = 80;
const clone = (d: DesignDoc): DesignDoc => JSON.parse(JSON.stringify(d)) as DesignDoc;

/** Every length in the design times k (a scale fix, a calibration). Heights stay. */
function scaleDoc(d: DesignDoc, k: number): DesignDoc {
  const m = (p: P): P => ({ x: p.x * k, y: p.y * k });
  return {
    ...d,
    walls: d.walls.map((w) => ({ ...w, a: m(w.a), b: m(w.b) })),
    openings: d.openings.map((o) => ({ ...o, at: o.at * k, width: o.width * k })),
    labels: d.labels.map((l) => ({ ...l, at: m(l.at) })),
    marks: d.marks.map((mk) => ({ ...mk, lines: mk.lines.map(([a, b]) => [m(a), m(b)] as [P, P]), box: { x: mk.box.x * k, y: mk.box.y * k, w: mk.box.w * k, h: mk.box.h * k } })),
    // The house as it stood scales with it (else every wall would read as moved).
    ...(d.existing ? { existing: { ...d.existing, walls: d.existing.walls.map((w) => ({ ...w, a: m(w.a), b: m(w.b) })), openings: d.existing.openings.map((o) => ({ ...o, at: o.at * k, width: o.width * k })) } } : {}),
  };
}

/** The house as it stands, kept once designing starts (milestone 5): what differs from it later is a change. */
const withExisting = (d: DesignDoc): DesignDoc => (d.existing ? d : { ...d, existing: { walls: clone(d).walls, openings: clone(d).openings, at: new Date().toISOString() } });

/** Parse 12'-6", 12' 6, 150", 12.5 (feet) → inches. */
function parseLength(v: string): number | null {
  const t = v.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  let m = t.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (m) return Number(m[1]) * 12 + (m[2] ? Number(m[2]) : 0);
  m = t.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (m) return Number(m[1]);
  m = t.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 12;
  return null;
}

export function DesignStudio({ initial, market, shopAddress }: { initial: { id: string; doc: DesignDoc } | null; market: DesignLocation; shopAddress: string | null }) {
  const [phase, setPhase] = React.useState<Phase>(initial ? "plan" : "start");
  const [designs, setDesigns] = React.useState<DesignRow[] | null>(null);
  const [sheets, setSheets] = React.useState<DesignSheet[]>([]);
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ step: string; pct: number }>({ step: "", pct: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  // The design and its history.
  // A design already being designed (a room open) keeps the house as it stood from here on.
  const [doc, setDoc] = React.useState<DesignDoc>(() => (initial ? (initial.doc.focus ? withExisting(initial.doc) : initial.doc) : emptyDesign()));
  const committed = React.useRef<DesignDoc>(doc);
  const [past, setPast] = React.useState<DesignDoc[]>([]);
  const [future, setFuture] = React.useState<DesignDoc[]>([]);
  const [id, setId] = React.useState<string | null>(initial?.id ?? null);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);

  // Workspace.
  const [selected, setSelected] = React.useState<Selection>(null);
  const [tool, setTool] = React.useState<Tool>("select");
  const [focus, setFocus] = React.useState<string | null>(initial?.doc.focus ?? null);
  const [threeView, setThreeView] = React.useState<"orbit" | "walk">("orbit");
  const [frameToken, setFrameToken] = React.useState(0);
  const [fitToken, setFitToken] = React.useState(0);
  const [underlay, setUnderlay] = React.useState<Underlay | null>(null);
  const [showUnderlay, setShowUnderlay] = React.useState(true);
  const [calibrating, setCalibrating] = React.useState(false);
  const [calibLine, setCalibLine] = React.useState<{ a: P; b: P } | null>(null);
  const [calibText, setCalibText] = React.useState("");
  const [notes, setNotes] = React.useState<string[]>([]);
  const [scaleNote, setScaleNote] = React.useState<ScaleNote | null>(null);
  // What the plan set holds (2026-10-18): its floor plans and their spaces, each floor read once and kept.
  const [plans, setPlans] = React.useState<FloorPlan[]>([]);
  const [spaces, setSpaces] = React.useState<SpaceFloor[]>([]);
  const [spaceBusy, setSpaceBusy] = React.useState<string | null>(null);
  const floorReads = React.useRef(new Map<string, Promise<FloorRead | "box" | null>>());
  const [box, setBox] = React.useState<{ sheet: DesignSheet; url: string; scale: number; w: number; h: number; a: P | null; b: P | null } | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const rooms = React.useMemo(() => roomsOf(doc), [doc]);
  const focusRoom = focus ? rooms.find((r) => r.labelId === focus) ?? null : null;
  // The smart checks, the structure reading and where walls stood (milestone 5).
  const checks = React.useMemo(() => (focus ? [...kitchenChecks(doc, focus), ...houseChecks(doc)] : houseChecks(doc)), [doc, focus]);
  const flags = React.useMemo(() => new Set([...flaggedItems(checks), ...flaggedWalls(checks)]), [checks]);
  const structure = React.useMemo(() => readStructure(doc), [doc]);
  const ghosts = React.useMemo(() => {
    const now = new Set(doc.walls.map((w) => w.id));
    return (doc.existing?.walls ?? []).filter((w) => !now.has(w.id));
  }, [doc]);

  React.useEffect(() => {
    if (phase !== "start") return;
    let live = true;
    listDesigns().then((r) => {
      if (live) setDesigns(r.ok ? r.designs : []);
    });
    return () => {
      live = false;
    };
  }, [phase]);

  const change = React.useCallback((next: DesignDoc, commit = true) => {
    setDoc(next);
    if (commit) {
      const prev = committed.current;
      if (prev !== next) {
        setPast((p) => [...p.slice(-(HISTORY_MAX - 1)), prev]);
        setFuture([]);
        committed.current = next;
        setDirty(true);
      }
    }
  }, []);
  const replace = (next: DesignDoc) => {
    committed.current = next;
    setDoc(next);
    setPast([]);
    setFuture([]);
  };
  const undo = React.useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [committed.current, ...f]);
      committed.current = prev;
      setDoc(prev);
      setDirty(true);
      return p.slice(0, -1);
    });
  }, []);
  const redo = React.useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, committed.current]);
      committed.current = next;
      setDoc(next);
      setDirty(true);
      return f.slice(1);
    });
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ── Save (and keep saving once saved) ── */
  const save = React.useCallback(
    async (quiet = false): Promise<string | null> => {
      setSaving(true);
      const res = await saveDesign({ id, doc: { ...committed.current, focus } });
      setSaving(false);
      if (!res.ok) {
        if (!quiet) setError(res.error);
        return null;
      }
      setDirty(false);
      setSavedAt(res.updatedAt);
      if (res.id !== id) {
        setId(res.id);
        // The address names the design now — in place: a navigation would re-render the page and start the studio
        // over (losing the drawing underneath and the view).
        window.history.replaceState(window.history.state, "", `/dashboard/design-studio?design=${res.id}`);
      }
      return res.id;
    },
    [id, focus],
  );
  React.useEffect(() => {
    if (!id || !dirty || phase !== "plan") return;
    const t = setTimeout(() => void save(true), 2500);
    return () => clearTimeout(t);
  }, [id, dirty, doc, phase, save]);

  /* ── Open files ── */
  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setPhase("opening");
    setProgress({ step: "Opening the plan set…", pct: 5 });
    let seen = 0;
    try {
      const res = await openDesignFiles(files, () => {
        seen++;
        setProgress({ step: `Looking through sheet ${seen}…`, pct: Math.min(95, 5 + seen * 4) });
      });
      const sorted = [...res.sheets].sort((a, b) => b.score - a.score);
      setSheets(sorted);
      setSkipped(res.skipped);
      setPicked(sorted[0]?.key ?? null);
      if (!sorted.length) {
        setPhase("start");
        setError(res.skipped[0] ?? "No plan sheets were found in those files.");
        return;
      }
      // What the set holds: its floor plans and their rooms — asked first, "what do you want to design?".
      floorReads.current = new Map();
      const fps = findFloorPlans(sorted.filter((x) => x.texts).map((x) => ({ key: x.key, fileName: x.fileName, page: x.page, width: x.width, height: x.height, texts: x.texts!, cls: x.cls })));
      setPlans(fps);
      setSpaces(
        fps.map((f) => {
          const sh = sorted.find((x) => x.key === f.sheetKey);
          return { key: f.key, name: f.name, page: f.page, fileName: f.fileName, level: f.level, rooms: f.rooms.map((r) => ({ name: r.name, ...(r.size ? { size: r.size } : {}), ...(r.sqft ? { sqft: r.sqft } : {}) })), status: sh?.layered ? "reading" : "text", thumb: sh?.thumb };
        }),
      );
      setPhase(fps.length ? "spaces" : "sheets");
      if (fps.length) void readAhead(fps, sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The files could not be opened.");
      setPhase("start");
    }
  };

  /* ── Read a sheet ── */
  const numberedPicture = async (url: string, rs: Room[], toPx: number): Promise<string> => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const size = Math.max(20, Math.min(46, c.width / 45));
    rs.forEach((r, i) => {
      const p = centroid(r.poly);
      const x = p.x * toPx;
      const y = p.y * toPx;
      g.fillStyle = "rgba(220,38,38,0.92)";
      g.beginPath();
      g.arc(x, y, size * 0.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.font = `900 ${size}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(i + 1), x, y + 1);
    });
    const out = c.toDataURL("image/jpeg", 0.85);
    c.width = c.height = 0;
    return out;
  };

  /** Read one floor plan off its sheet — the walls, doors and windows, the rooms named (the sheet's own words, else the
   *  vision model on a numbered picture of the rooms it couldn't name), the scale checked against the areas printed.
   *  Changes nothing on screen: the studio opens it (applyRead), keeps it for later, or joins it into a house. */
  const readFloor = async (sheet: DesignSheet, region: Region | null, step: (text: string, pct: number) => void = () => {}): Promise<FloorRead | "box"> => {
    const { sheet: vs, texts } = await sheet.read!();
    if (!sheet.layered && !region) return "box";
    step("Finding walls, doors and windows…", 40);
    await new Promise((r) => setTimeout(r, 30));
    const title = (sheet.title || sheet.fileName.replace(/\.pdf$/i, "")).replace(/[\s|·:,-]+$/g, "").replace(/^[\s|·:,-]+/g, "").trim();
    const r: PlanRead = readPlan(vs, texts, { region, fileName: sheet.fileName, page: sheet.page, title: title || "Floor plan" });
    let d = r.doc;
    const k = r.inPerPt;
    d = { ...d, labels: namedLabels(d.labels, (sheet.cls ?? classifySheet(texts, sheet.width, sheet.height)).rooms, r.region, k) };
    step("Drawing the sheet underneath…", 55);
    const pic = await sheet.picture(r.region, 2400);
    const toPx = pic.scale / k; // plan inches → picture pixels
    const underlay: Underlay = { url: pic.url, x: 0, y: 0, w: pic.w / toPx, h: pic.h / toPx, opacity: 0.35 };
    const extra: string[] = [...r.notes];
    // The rooms the sheet's words didn't name (a CAD export draws names as lines): the vision model reads them.
    const unnamed = roomsOf(d).filter((rm) => !rm.labelId);
    if (unnamed.length) {
      step(`Reading the names of ${unnamed.length} room${unnamed.length === 1 ? "" : "s"}…`, 72);
      const numbered = await numberedPicture(pic.url, unnamed, toPx);
      const names = await readRoomNames({ image: numbered, count: unnamed.length });
      if (names.ok) {
        const labels = [...d.labels];
        for (const nr of names.rooms) {
          const room = unnamed[nr.n - 1];
          if (!room || !nr.names.length) continue;
          const c = centroid(room.poly);
          nr.names.forEach((name, i) => labels.push({ id: newId("r"), name, at: { x: c.x, y: c.y + (i - (nr.names.length - 1) / 2) * 30 }, ceiling: DEFAULT_CEILING, planSqFt: i === 0 ? nr.sqft : null }));
        }
        d = { ...d, labels };
      } else extra.push(`Room names weren't read (${names.error}) — name the rooms by clicking them.`);
    }
    // The scale, checked against the areas the plan prints. A wrong scale throws EVERY room off by the same factor;
    // one room off on its own is a wall the read missed (a hall merged into a bedroom) — said as that.
    let note: ScaleNote | null = null;
    const checks = roomsOf(d)
      .map((rm) => {
        const l = d.labels.find((x) => x.id === rm.labelId);
        return l?.planSqFt && rm.names.length === 1 && rm.sqft > 12 ? { name: rm.name, have: rm.sqft, want: l.planSqFt, k: rm.sqft / l.planSqFt } : null;
      })
      .filter((x): x is { name: string; have: number; want: number; k: number } => x != null);
    if (checks.length) {
      const good = checks.filter((c) => c.k >= 0.9 && c.k <= 1.1);
      const off = checks.filter((c) => c.k < 0.9 || c.k > 1.1);
      const ks = checks.map((c) => c.k).sort((x, y) => x - y);
      const consistent = ks[ks.length - 1] / ks[0] <= 1.12;
      if (good.length) {
        const worst = Math.max(...good.map((c) => Math.abs(c.k - 1)));
        note = { tone: "good", text: `Sizes check out: ${good.map((c) => c.name).join(", ")} ${good.length === 1 ? "measures" : "measure"} within ${Math.max(1, Math.round(worst * 100))}% of the area the plan prints.` };
        for (const c of off) extra.push(`${c.name} measures ${Math.round(c.have)} sq ft where the plan prints ${c.want} — ${c.k > 1 ? "a wall may be missing there (a hall or closet joined to it)" : "a wall may be read in the wrong place"}; check it in the plan.`);
      } else if (consistent) {
        const med = ks[Math.floor(ks.length / 2)];
        note = { tone: "warn", text: `Every room measures ${Math.round(Math.abs(med - 1) * 100)}% ${med > 1 ? "bigger" : "smaller"} than the plan prints — the scale is likely off.`, fix: Math.sqrt(1 / med) };
      } else for (const c of off) extra.push(`${c.name} measures ${Math.round(c.have)} sq ft where the plan prints ${c.want} — check its walls in the plan.`);
    }
    return { doc: d, notes: extra, scaleNote: note, underlay };
  };

  /** Open what was read. */
  const applyRead = (r: FloorRead) => {
    setError(null);
    setFocus(null);
    setSelected(null);
    setCalibrating(false);
    setUnderlay(r.underlay);
    setShowUnderlay(true);
    setNotes(r.notes);
    setScaleNote(r.scaleNote);
    replace(r.doc);
    setDirty(true);
    setPhase("plan");
  };

  const readSheet = async (sheet: DesignSheet, region: Region | null) => {
    setError(null);
    setNotes([]);
    setScaleNote(null);
    setFocus(null);
    setSelected(null);
    if (sheet.kind === "image" || !sheet.read) {
      // A photo or a scan: trace it. 1 px reads as 1 in until the scale is set.
      setPhase("reading");
      setProgress({ step: "Laying the plan out to trace…", pct: 50 });
      const pic = await sheet.picture(null, 2200);
      const d = { ...emptyDesign(sheet.title || "Traced plan"), source: { kind: "image" as const, fileName: sheet.fileName, scaleBy: "assumed" as const } };
      replace(d);
      setUnderlay({ url: pic.url, x: 0, y: 0, w: pic.w, h: pic.h, opacity: 0.6 });
      setCalibrating(true);
      setNotes(["Set the scale first: click the two ends of a wall or dimension you know, then type its length."]);
      setPhase("plan");
      return;
    }
    setPhase("reading");
    setProgress({ step: "Reading the plan's own lines…", pct: 15 });
    try {
      const r = await readFloor(sheet, region, (step, pct) => setProgress({ step, pct }));
      if (r === "box") {
        // No CAD layers: the contractor boxes the floor plan so only its lines are read.
        const pic = await sheet.picture(null, 1800);
        setBox({ sheet, url: pic.url, scale: pic.scale, w: pic.w, h: pic.h, a: null, b: null });
        setPhase("box");
        return;
      }
      setProgress({ step: "Done", pct: 100 });
      applyRead(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sheet could not be read.");
      setPhase("sheets");
    }
  };

  /* ── The plan set's spaces (2026-10-18) ── */
  const sheetOfPlan = (f: FloorPlan) => sheets.find((x) => x.key === f.sheetKey) ?? null;
  /** A floor read once: the CAD layers find the plan themselves (unless the sheet holds two); else the box its rooms make. */
  const ensureRead = (f: FloorPlan, list: DesignSheet[] = sheets): Promise<FloorRead | "box" | null> => {
    const have = floorReads.current.get(f.key);
    if (have) return have;
    const sh = list.find((x) => x.key === f.sheetKey);
    const many = (sh?.cls?.plans.length ?? 0) > 1;
    const p = sh?.read ? readFloor(sh, sh.layered && !many ? null : f.region).catch(() => null) : Promise.resolve(null);
    floorReads.current.set(f.key, p);
    return p;
  };
  /** Read ahead the floors whose sheet can be read without a box, so their rooms are listed whole and measured. */
  const readAhead = async (fps: FloorPlan[], list: DesignSheet[]) => {
    for (const f of fps) {
      const sh = list.find((x) => x.key === f.sheetKey);
      if (!sh?.layered) continue;
      const r = await ensureRead(f, list);
      setSpaces((cur) =>
        cur.map((sf) => {
          if (sf.key !== f.key) return sf;
          if (!r || r === "box") return { ...sf, status: "failed" };
          const measured = roomsOf(r.doc)
            .filter((rm) => rm.labelId)
            .map((rm) => {
              const printed = sf.rooms.find((x) => rm.names.some((n) => sameRoom(n, x.name)));
              return { name: rm.names.length > 1 ? rm.names.join(" · ") : rm.name, sqft: rm.sqft, ...(printed?.size ? { size: printed.size } : {}) };
            });
          return { ...sf, rooms: measured.length ? measured : sf.rooms, status: "read" };
        }),
      );
    }
  };
  const openSpace = async (floorKey: string, roomName: string | null) => {
    const f = plans.find((x) => x.key === floorKey);
    if (!f) return;
    setSpaceBusy(roomName ? `Opening ${roomName}…` : `Opening the ${f.name.toLowerCase()}…`);
    try {
      const r = await ensureRead(f);
      if (r === "box") {
        const sh = sheetOfPlan(f);
        if (sh) {
          const pic = await sh.picture(null, 1800);
          setBox({ sheet: sh, url: pic.url, scale: pic.scale, w: pic.w, h: pic.h, a: null, b: null });
          setPhase("box");
        }
        return;
      }
      if (!r) {
        setError(`The ${f.name.toLowerCase()} couldn't be read — pick its sheet and box the plan.`);
        setPhase("sheets");
        return;
      }
      applyRead(r);
      if (roomName) {
        const rs = roomsOf(r.doc);
        const exact = rs.find((rm) => rm.names.some((n) => sameRoom(n, roomName)));
        const best = exact ?? rs.map((rm) => ({ rm, k: Math.max(0, ...rm.names.map((n) => matchScore(roomName, n))) })).filter((x) => x.k >= 0.5).sort((a, b) => b.k - a.k)[0]?.rm;
        if (best) designRoom(best);
        else setNotes([`${roomName} is on the sheet, but its walls didn't close into a room in the read — find it on the plan, close its walls, and design it from the room list.`, ...r.notes]);
      }
    } finally {
      setSpaceBusy(null);
    }
  };
  /** The whole house: every floor read and laid out side by side, each named. */
  const openHouse = async () => {
    const levels = plans.filter((f) => f.level);
    const byFile = new Map<string, FloorPlan[]>();
    for (const f of levels) byFile.set(f.fileName, [...(byFile.get(f.fileName) ?? []), f]);
    const floorsOf = [...byFile.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    if (floorsOf.length < 2) {
      if (floorsOf[0]) await openSpace(floorsOf[0].key, null);
      return;
    }
    setSpaceBusy(`Reading every floor — ${floorsOf.map((f) => f.name).join(", ")}…`);
    try {
      const got: Array<{ f: FloorPlan; r: FloorRead }> = [];
      const skipped: string[] = [];
      for (const f of floorsOf) {
        const r = await ensureRead(f);
        if (r && r !== "box" && r.doc.walls.length) got.push({ f, r });
        else skipped.push(f.name);
      }
      if (!got.length) {
        setError("The floors couldn't be read — pick a sheet and box its plan.");
        setPhase("sheets");
        return;
      }
      let x = 0;
      const walls: DesignDoc["walls"] = [];
      const openings: DesignDoc["openings"] = [];
      const labels: DesignDoc["labels"] = [];
      const marks: DesignDoc["marks"] = [];
      const pics: Underlay[] = [];
      got.forEach(({ f, r }, i) => {
        const b = planBounds(r.doc);
        const dx = x - b.x;
        const dy = -b.y;
        const placed = placeFloor(r.doc, dx, dy, `f${i + 1}-`, f.name);
        walls.push(...placed.walls);
        openings.push(...placed.openings);
        labels.push(...placed.labels);
        marks.push(...placed.marks);
        pics.push({ ...r.underlay, x: r.underlay.x + dx, y: r.underlay.y + dy });
        x += b.w + 20 * 12; // 20 ft between floors
      });
      const first = got[0].r;
      const doc: DesignDoc = { ...emptyDesign(`${got[0].f.fileName.replace(/\.pdf$/i, "")} — whole house`), walls, openings, labels, marks, source: first.doc.source };
      applyRead({
        doc,
        notes: [`The whole house: ${got.map((g) => g.f.name).join(", ")} side by side. Pick any room to design it.`, ...(skipped.length ? [`${skipped.join(", ")} couldn't be read — open ${skipped.length === 1 ? "it" : "them"} from its sheet.`] : []), ...got.flatMap((g) => g.r.notes.map((n) => `${g.f.name}: ${n}`))],
        scaleNote: null,
        underlay: { ...pics[0], more: pics.slice(1).map(({ url, x: ux, y: uy, w, h }) => ({ url, x: ux, y: uy, w, h })) },
      });
    } finally {
      setSpaceBusy(null);
    }
  };

  /* ── Selection helpers ── */
  const selWall = selected?.kind === "wall" ? doc.walls.find((w) => w.id === selected.id) ?? null : null;
  const selOpening = selected?.kind === "opening" ? doc.openings.find((o) => o.id === selected.id) ?? null : null;
  const selLabel = selected?.kind === "label" ? doc.labels.find((l) => l.id === selected.id) ?? null : null;
  const selRoom = selected?.kind === "room" ? rooms.find((r) => (r.labelId ?? r.key) === selected.key) ?? null : null;
  const roomOfLabel = selLabel ? rooms.find((r) => r.labelId === selLabel.id) ?? null : null;
  const patch = (fn: (d: DesignDoc) => void) => {
    const next = clone(committed.current);
    fn(next);
    change(next, true);
  };
  const nameRoom = (room: Room) => {
    if (room.labelId) {
      setSelected({ kind: "label", id: room.labelId });
      return;
    }
    const lid = newId("r");
    patch((d) => d.labels.push({ id: lid, name: "Room", at: centroid(room.poly), ceiling: DEFAULT_CEILING }));
    setSelected({ kind: "label", id: lid });
  };
  const designRoom = (room: Room) => {
    let lid = room.labelId;
    if (!lid) {
      lid = newId("r");
      const id2 = lid;
      patch((d) => d.labels.push({ id: id2, name: room.name, at: centroid(room.poly), ceiling: DEFAULT_CEILING }));
    }
    // Designing starts: the house as it stands now is kept (once), every history step with it.
    const cur = committed.current;
    if (!cur.existing) {
      const next = withExisting(cur);
      committed.current = next;
      setDoc(next);
      setDirty(true);
      const keep = (d: DesignDoc) => (d.existing ? d : { ...d, existing: next.existing });
      setPast((p) => p.map(keep));
      setFuture((f) => f.map(keep));
    }
    setFocus(lid);
    setSelected(null);
    setTool("select");
    setThreeView("orbit");
    setFrameToken((t) => t + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ── Calibration ── */
  const applyCalibration = () => {
    if (!calibLine) return;
    const want = parseLength(calibText);
    const have = dist(calibLine.a, calibLine.b);
    if (!want || have < 1) return;
    const k = want / have;
    replace(scaleDoc(committed.current, k));
    setUnderlay((u) => (u ? { ...u, x: u.x * k, y: u.y * k, w: u.w * k, h: u.h * k } : u));
    setCalibLine(null);
    setCalibText("");
    setCalibrating(false);
    setFitToken((t) => t + 1);
    setNotes(["Scale set. Now draw the room: Room (drag its corners), or Wall to draw wall by wall, then add doors and windows by clicking the walls."]);
    setTool("room");
    setDirty(true);
  };

  /* ── Render ── */
  if (phase === "start") {
    return (
      <div className={s.studio}>
        <Head />
        {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
        <div className={s.startGrid}>
          <section className={s.card}>
            <div className={s.head}>
              <div>
                <div className={s.cardTitle}>Start from the blueprint</div>
                <p className={s.cardSub}>Drop the plan set — the floor plan is found and read into walls, doors, windows and rooms, ready to design.</p>
              </div>
            </div>
            <div className={s.body}>
              <label
                className={`${s.drop} ${dragging ? s.dragging : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void onFiles([...e.dataTransfer.files]);
                }}
                data-design-drop
              >
                <span className={s.dropTitle}>Drop the plan set here</span>
                <span className={s.dropSub}>PDF from the architect (best — read line by line), or a photo or scan of the floor plan to trace.</span>
                <span className={`${s.btn} ${s.btnPrimary}`}>Choose files</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    void onFiles([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                  data-design-file
                />
              </label>
            </div>
          </section>
          <section className={s.card}>
            <div className={s.head}>
              <div>
                <div className={s.cardTitle}>Or draw the room</div>
                <p className={s.cardSub}>No plan? Drag out the room by its corners, type the sizes, click its walls for doors and windows.</p>
              </div>
              <button
                type="button"
                className={`${s.btn} ${s.btnSm}`}
                onClick={() => {
                  replace({ ...emptyDesign("New room"), source: { kind: "drawn" } });
                  setUnderlay(null);
                  setNotes(["Drag out the room by its corners — then click its walls to add doors and windows."]);
                  setTool("room");
                  setPhase("plan");
                }}
                data-design-draw
              >
                Draw a room
              </button>
            </div>
            <div className={s.body}>
              <div className={s.cardTitle} style={{ fontSize: 12 }}>Your designs</div>
              {designs == null ? (
                <p className={s.note}>Loading…</p>
              ) : designs.length ? (
                <div className={s.designs}>
                  {designs.map((d) => (
                    <div className={s.designRow} key={d.id}>
                      <div style={{ minWidth: 0 }}>
                        <div className={s.designName}>{d.title}</div>
                        <div className={s.mono}>
                          {d.rooms} rooms · {new Date(d.updatedAt).toLocaleDateString()} {d.by ? `· ${d.by}` : ""}
                        </div>
                      </div>
                      <a className={`${s.btn} ${s.btnSm}`} href={`/dashboard/design-studio?design=${d.id}`}>
                        Open
                      </a>
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnSm} ${s.btnDanger}`}
                        onClick={async () => {
                          if (!window.confirm(`Delete "${d.title}"?`)) return;
                          await deleteDesign(d.id);
                          setDesigns((xs) => (xs ?? []).filter((x) => x.id !== d.id));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={s.note}>Nothing saved yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (phase === "opening" || phase === "reading") {
    return (
      <div className={s.studio}>
        <Head />
        <section className={s.card}>
          <div className={s.progress} data-design-progress>
            <div className={s.cardTitle}>{progress.step}</div>
            <div className={s.bar}>
              <div className={s.barFill} style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (phase === "spaces") {
    return (
      <div className={s.studio}>
        <Head />
        {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
        <SpacesPicker
          floors={spaces}
          multi={isMultiFloor(plans)}
          busy={spaceBusy}
          onRoom={(k, r) => void openSpace(k, r)}
          onFloor={(k) => void openSpace(k, null)}
          onHouse={() => void openHouse()}
          onSheets={() => setPhase("sheets")}
          onBack={() => setPhase("start")}
        />
      </div>
    );
  }

  if (phase === "sheets") {
    const sheet = sheets.find((x) => x.key === picked) ?? null;
    return (
      <div className={s.studio}>
        <Head />
        {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
        <section className={s.card}>
          <div className={s.head}>
            <div>
              <div className={s.cardTitle}>Which sheet is the floor plan?</div>
              <p className={s.cardSub}>The likeliest is first and picked. Read it, and the rooms come out drawn.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setPhase(plans.length ? "spaces" : "start")}>
                Back
              </button>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!sheet} onClick={() => sheet && void readSheet(sheet, null)} data-design-read>
                {sheet?.kind === "image" ? "Trace this plan" : "Read this sheet"}
              </button>
            </div>
          </div>
          <div className={s.body}>
            <div className={s.sheets}>
              {sheets.map((sh) => (
                <button type="button" key={sh.key} className={`${s.sheet} ${sh.key === picked ? s.on : ""}`} onClick={() => setPicked(sh.key)} onDoubleClick={() => void readSheet(sh, null)} data-design-sheet={sh.page}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sh.thumb} alt={`Sheet ${sh.page}`} />
                  <span className={s.sheetName}>{sh.title || `${sh.fileName} · page ${sh.page}`}</span>
                  <span className={s.mono}>
                    {sh.fileName.length > 24 ? `${sh.fileName.slice(0, 22)}…` : sh.fileName} · p{sh.page}
                  </span>
                  {sh.hint ? <span className={s.tag}>{sh.hint}</span> : null}
                </button>
              ))}
            </div>
            {skipped.length ? <p className={s.note}>Skipped: {skipped.join("; ")}</p> : null}
          </div>
        </section>
      </div>
    );
  }

  if (phase === "box" && box) {
    const sel = box.a && box.b ? { x: Math.min(box.a.x, box.b.x), y: Math.min(box.a.y, box.b.y), w: Math.abs(box.b.x - box.a.x), h: Math.abs(box.b.y - box.a.y) } : null;
    const at = (e: React.PointerEvent<HTMLDivElement>): P => {
      const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const k = box.w / r.width;
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top + (e.currentTarget as HTMLDivElement).scrollTop) * k };
    };
    return (
      <div className={s.studio}>
        <Head />
        <section className={s.card}>
          <div className={s.head}>
            <div>
              <div className={s.cardTitle}>Box the floor plan</div>
              <p className={s.cardSub}>This sheet keeps no CAD layers, so the reader needs to know where the plan is: drag a box around the floor plan only — not the schedules or the elevations.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setPhase("sheets")}>
                Back
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                disabled={!sel || sel.w < 40 || sel.h < 40}
                onClick={() => sel && void readSheet(box.sheet, { x: sel.x / box.scale, y: sel.y / box.scale, w: sel.w / box.scale, h: sel.h / box.scale })}
                data-design-read-box
              >
                Read the boxed plan
              </button>
            </div>
          </div>
          <div className={s.body}>
            <div
              className={s.boxWrap}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                const p = at(e);
                setBox({ ...box, a: p, b: p });
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1 || !box.a) return;
                setBox({ ...box, b: at(e) });
              }}
              data-design-box
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={box.url} alt="The sheet" draggable={false} />
              {sel ? <div className={s.boxSel} style={{ left: `${(sel.x / box.w) * 100}%`, top: `${(sel.y / box.h) * 100}%`, width: `${(sel.w / box.w) * 100}%`, height: `${(sel.h / box.h) * 100}%` }} /> : null}
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* ── The plan / the room ── */
  const toolBtn = (t: Tool, label: string) => (
    <button type="button" className={`${s.btn} ${s.btnSm} ${tool === t ? s.btnOn : ""}`} onClick={() => setTool(t)} aria-pressed={tool === t} data-design-tool={t}>
      {label}
    </button>
  );
  const editor = (
    <PlanEditor
      doc={doc}
      onChange={change}
      selected={selected}
      onSelect={setSelected}
      tool={tool}
      onTool={setTool}
      focus={focus}
      underlay={showUnderlay ? underlay : null}
      calibrating={calibrating}
      onCalibratePoints={(a, b) => setCalibLine({ a, b })}
      fitToken={fitToken}
      className={focus ? s.planSmall : s.plan}
      ghosts={ghosts}
      flags={flags}
    />
  );

  return (
    <div className={s.studio}>
      <Head
        title={focusRoom ? (focusRoom.names.length > 1 ? focusRoom.names.join(" · ") : focusRoom.name) : doc.title}
        sub={
          focusRoom
            ? `${Math.round(focusRoom.sqft)} sq ft · ${ftIn(focusRoom.ceiling)} ceiling · ${focusRoom.wallIds.length} walls · ${doc.openings.filter((o) => focusRoom.wallIds.includes(o.wallId)).length} doors & windows`
            : doc.source?.kind === "pdf"
              ? `Read from ${doc.source.fileName ?? "the plan"}${doc.source.page ? `, sheet ${doc.source.page}` : ""} · scale ${doc.source.scaleText ?? "assumed ¼\" = 1'-0\""}${doc.source.layers ? " · CAD layers" : ""}`
              : "Draw and fix the plan, then design a room in 3D."
        }
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={s.mono} data-design-saved>
              {saving ? "Saving…" : dirty ? (id ? "Unsaved changes" : "Not saved yet") : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
            </span>
            <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => void save()} disabled={saving} data-design-save>
              Save
            </button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => (window.location.href = "/dashboard/design-studio")}>
              New
            </button>
          </div>
        }
      />
      {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}

      <div className={s.work}>
        <div className={s.stage}>
          <div className={s.toolbar}>
            {focus ? (
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setFocus(null)} data-design-back>
                ← Whole plan
              </button>
            ) : null}
            {toolBtn("select", "Select")}
            {toolBtn("wall", "Wall")}
            {toolBtn("room", "Room")}
            {toolBtn("door", "Door")}
            {toolBtn("window", "Window")}
            {toolBtn("opening", "Opening")}
            {toolBtn("label", "Name")}
            <span className={s.toolSep} />
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={undo} disabled={!past.length} data-design-undo>
              Undo
            </button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={redo} disabled={!future.length}>
              Redo
            </button>
            {underlay ? (
              <button type="button" className={`${s.btn} ${s.btnSm} ${showUnderlay ? s.btnOn : ""}`} onClick={() => setShowUnderlay((v) => !v)} aria-pressed={showUnderlay}>
                Drawing
              </button>
            ) : null}
            {underlay && doc.source?.kind === "image" ? (
              <button type="button" className={`${s.btn} ${s.btnSm} ${calibrating ? s.btnOn : ""}`} onClick={() => setCalibrating((v) => !v)}>
                Set scale
              </button>
            ) : null}
            {focus ? (
              <>
                <span className={s.toolSep} />
                <div className={s.seg} role="group" aria-label="3D view">
                  <button type="button" className={`${s.segB} ${threeView === "orbit" ? s.on : ""}`} onClick={() => setThreeView("orbit")} data-design-view="orbit">
                    Look in
                  </button>
                  <button type="button" className={`${s.segB} ${threeView === "walk" ? s.on : ""}`} onClick={() => setThreeView("walk")} data-design-view="walk">
                    Walk in
                  </button>
                </div>
                <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setFrameToken((t) => t + 1)}>
                  Reset view
                </button>
              </>
            ) : null}
          </div>
          {calibLine ? (
            <div className={s.card} style={{ padding: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className={s.lbl}>That line is</span>
              <input className={s.in} style={{ width: 140 }} value={calibText} onChange={(e) => setCalibText(e.target.value)} placeholder={`12'-6"`} autoFocus onKeyDown={(e) => e.key === "Enter" && applyCalibration()} data-design-calib-input />
              <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={applyCalibration} disabled={!parseLength(calibText)} data-design-calib-apply>
                Set the scale
              </button>
              <button type="button" className={s.link} onClick={() => setCalibLine(null)}>
                Pick again
              </button>
            </div>
          ) : null}
          {focus ? (
            <div className={s.split}>
              <Room3D
                doc={doc}
                focus={focus}
                selectedWall={selWall?.id ?? null}
                onPickWall={(wid) => setSelected(wid ? { kind: "wall", id: wid } : null)}
                selectedItem={selected?.kind === "item" ? selected.id : null}
                onPickItem={(iid) => setSelected({ kind: "item", id: iid })}
                view={threeView}
                frameToken={frameToken}
                className={s.three}
                label={`${focusRoom?.name ?? "The room"} in 3D`}
              />
              {editor}
            </div>
          ) : (
            editor
          )}
          {threeView === "walk" && focus ? <p className={s.note}>Walking in: drag to look around; the arrow keys (or W A S D) walk once you click the 3D view.</p> : null}
        </div>

        <aside className={s.side}>
          {focus && focusRoom ? <DesignPanel doc={doc} room={focusRoom} focus={focus} selected={selected} onSelect={setSelected} tool={tool} onTool={setTool} onPatch={patch} onLaidOut={() => setTimeout(() => setFrameToken((t) => t + 1), 50)} checks={checks} /> : null}
          {notes.length || scaleNote ? (
            <section className={s.card}>
              <div className={s.body}>
                {scaleNote ? (
                  <p className={`${s.note} ${scaleNote.tone === "good" ? s.noteGood : s.noteWarn}`} data-design-scale-note>
                    {scaleNote.text}{" "}
                    {scaleNote.fix ? (
                      <button
                        type="button"
                        className={s.link}
                        onClick={() => {
                          const k = scaleNote.fix!;
                          change(scaleDoc(committed.current, k), true);
                          setUnderlay((u) => (u ? { ...u, x: u.x * k, y: u.y * k, w: u.w * k, h: u.h * k } : u));
                          setScaleNote({ tone: "good", text: "Scale adjusted to the plan's printed room areas." });
                          setFitToken((t) => t + 1);
                        }}
                      >
                        Match the plan&apos;s areas
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {notes.map((n) => (
                  <p key={n} className={s.note}>
                    {n}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {/* The selected thing's numbers. */}
          {selWall ? (
            <section className={s.card} data-design-inspector="wall">
              <div className={s.head}>
                <div className={s.cardTitle}>Wall</div>
                <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => { patch((d) => { d.walls = d.walls.filter((w) => w.id !== selWall.id); d.openings = d.openings.filter((o) => o.wallId !== selWall.id); }); setSelected(null); }} data-design-wall-out>
                  {doc.existing?.walls.some((w) => w.id === selWall.id) ? "Take out" : "Delete"}
                </button>
              </div>
              <div className={s.body}>
                <div className={s.fields}>
                  <LengthField label="Length" value={wallLen(selWall)} onCommit={(v) => change(setWallLength(committed.current, selWall.id, v), true)} />
                  <NumField label="Thickness (in)" value={selWall.thick} min={2} max={24} onCommit={(v) => patch((d) => { const w = d.walls.find((x) => x.id === selWall.id); if (w) w.thick = v; })} />
                  <NumField label="Height (in)" value={selWall.height} min={36} max={240} onCommit={(v) => patch((d) => { const w = d.walls.find((x) => x.id === selWall.id); if (w) w.height = v; })} />
                  <div className={s.field}>
                    <span className={s.lbl}>Side</span>
                    <div className={s.seg}>
                      <button type="button" className={`${s.segB} ${!selWall.exterior ? s.on : ""}`} onClick={() => patch((d) => { const w = d.walls.find((x) => x.id === selWall.id); if (w) delete w.exterior; })}>Inside</button>
                      <button type="button" className={`${s.segB} ${selWall.exterior ? s.on : ""}`} onClick={() => patch((d) => { const w = d.walls.find((x) => x.id === selWall.id); if (w) w.exterior = true; })}>Outside</button>
                    </div>
                  </div>
                </div>
                <p className={s.note}>Drag its ends to resize, its middle to slide it — joined walls follow. {(() => {
                    const n = doc.openings.filter((o) => o.wallId === selWall.id).length;
                    return n === 0 ? "No openings in it." : n === 1 ? "1 opening in it." : `${n} openings in it.`;
                  })()}</p>
                {(() => {
                  const reading = structure.get(selWall.id) ?? readWall(doc, selWall.id);
                  if (!reading) return null;
                  const standing = !!doc.existing?.walls.some((w) => w.id === selWall.id) || (!doc.existing && reading.level !== "new");
                  return (
                    <WallStructure
                      reading={reading}
                      isStanding={standing}
                      lengthIn={wallLen(selWall)}
                      onConfirm={(v) =>
                        patch((d) => {
                          const st = { ...(d.structure ?? {}) };
                          if (v) st[selWall.id] = v;
                          else delete st[selWall.id];
                          d.structure = st;
                        })
                      }
                      onOpenUp={() => change(openUp(withExisting(committed.current), selWall.id, newId("o")), true)}
                    />
                  );
                })()}
              </div>
            </section>
          ) : null}
          {selOpening ? (
            <section className={s.card} data-design-inspector="opening">
              <div className={s.head}>
                <div className={s.cardTitle}>{selOpening.kind === "window" ? "Window" : selOpening.kind === "opening" ? "Opening" : "Door"}</div>
                <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => { patch((d) => { d.openings = d.openings.filter((o) => o.id !== selOpening.id); }); setSelected(null); }}>
                  Delete
                </button>
              </div>
              <div className={s.body}>
                <div className={s.field}>
                  <span className={s.lbl}>Kind</span>
                  <select className={s.in} value={selOpening.kind} onChange={(e) => patch((d) => { const o = d.openings.find((x) => x.id === selOpening.id); if (o) { o.kind = e.target.value as OpeningKind; if (o.kind === "window") { o.sill = o.sill || 36; o.height = Math.min(o.height, 60); } else o.sill = 0; } })}>
                    <option value="door">Door</option>
                    <option value="double">Double door</option>
                    <option value="slider">Sliding door</option>
                    <option value="pocket">Pocket door</option>
                    <option value="window">Window</option>
                    <option value="opening">Cased opening</option>
                  </select>
                </div>
                <div className={s.fields}>
                  <NumField label="Width (in)" value={selOpening.width} min={12} max={240} onCommit={(v) => patch((d) => { const o = d.openings.find((x) => x.id === selOpening.id); if (o) o.width = v; })} />
                  <NumField label="Height (in)" value={selOpening.height} min={12} max={120} onCommit={(v) => patch((d) => { const o = d.openings.find((x) => x.id === selOpening.id); if (o) o.height = v; })} />
                  {selOpening.kind === "window" ? <NumField label="Sill (in)" value={selOpening.sill} min={0} max={96} onCommit={(v) => patch((d) => { const o = d.openings.find((x) => x.id === selOpening.id); if (o) o.sill = v; })} /> : null}
                  {selOpening.kind === "door" ? (
                    <div className={s.field}>
                      <span className={s.lbl}>Hinge · swing</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => patch((d) => { const o = d.openings.find((x) => x.id === selOpening.id); if (o) o.hinge = o.hinge === "b" ? "a" : "b"; })}>Flip hinge</button>
                        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => patch((d) => { const o = d.openings.find((x) => x.id === selOpening.id); if (o) o.swing = o.swing === "right" ? "left" : "right"; })}>Flip swing</button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <p className={s.note}>Drag it along its wall to move it.</p>
              </div>
            </section>
          ) : null}
          {selLabel ? (
            <section className={s.card} data-design-inspector="label">
              <div className={s.head}>
                <div className={s.cardTitle}>Room</div>
                <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => { patch((d) => { d.labels = d.labels.filter((l) => l.id !== selLabel.id); }); setSelected(null); }}>
                  Remove name
                </button>
              </div>
              <div className={s.body}>
                <TextField label="Name" value={selLabel.name} onCommit={(v) => patch((d) => { const l = d.labels.find((x) => x.id === selLabel.id); if (l) l.name = v || "Room"; })} />
                <NumField
                  label="Ceiling (in)"
                  value={selLabel.ceiling ?? DEFAULT_CEILING}
                  min={72}
                  max={240}
                  onCommit={(v) =>
                    patch((d) => {
                      const l = d.labels.find((x) => x.id === selLabel.id);
                      if (l) l.ceiling = v;
                      // The room's walls stand to its ceiling.
                      if (roomOfLabel) for (const w of d.walls) if (roomOfLabel.wallIds.includes(w.id)) w.height = v;
                    })
                  }
                />
                {roomOfLabel ? (
                  <>
                    <dl className={s.facts}>
                      <dt>Floor</dt>
                      <dd>{Math.round(roomOfLabel.sqft)} sq ft{selLabel.planSqFt ? ` (plan says ${selLabel.planSqFt})` : ""}</dd>
                      <dt>Walls</dt>
                      <dd>{roomOfLabel.wallIds.length}</dd>
                    </dl>
                    {focus !== selLabel.id ? (
                      <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => designRoom(roomOfLabel)} data-design-room-go>
                        Design this room
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className={`${s.note} ${s.noteWarn}`}>This name sits in no closed room yet — close the walls around it, or drag it into a room.</p>
                )}
              </div>
            </section>
          ) : null}
          {selRoom ? (
            <section className={s.card} data-design-inspector="room">
              <div className={s.head}>
                <div className={s.cardTitle}>{selRoom.names.length > 1 ? selRoom.names.join(" · ") : selRoom.name}</div>
              </div>
              <div className={s.body}>
                <dl className={s.facts}>
                  <dt>Floor</dt>
                  <dd>{Math.round(selRoom.sqft)} sq ft</dd>
                  <dt>Walls</dt>
                  <dd>{selRoom.wallIds.length}</dd>
                </dl>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => designRoom(selRoom)} data-design-room-go>
                    Design this room
                  </button>
                  {!selRoom.labelId ? (
                    <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => nameRoom(selRoom)}>
                      Name it
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {focus ? <HouseChanges doc={doc} onPatch={patch} onSelect={setSelected} ensureSaved={() => (id && !dirty ? Promise.resolve(id) : save())} /> : null}

          {/* Every room. */}
          <section className={s.card}>
            <div className={s.head}>
              <div>
                <div className={s.cardTitle}>Rooms</div>
                <p className={s.cardSub}>{rooms.length ? "Pick the room to design." : "Close the walls around a space and it becomes a room."}</p>
              </div>
            </div>
            <div className={s.body}>
              <div className={s.roomList} data-design-rooms>
                {rooms.map((r) => {
                  const key = r.labelId ?? r.key;
                  const on = focus ? focus === r.labelId : selected?.kind === "room" && selected.key === key;
                  return (
                    <button type="button" key={r.key} className={`${s.roomBtn} ${on ? s.on : ""}`} onClick={() => (focus ? designRoom(r) : setSelected({ kind: "room", key }))} onDoubleClick={() => designRoom(r)} data-design-room={r.name}>
                      <span className={s.roomName}>
                        {r.names.length > 1 ? r.names.join(" · ") : r.name}
                        {(() => {
                          // A whole house: which floor it's on.
                          const fl = r.labelId ? doc.labels.find((l) => l.id === r.labelId)?.floor : undefined;
                          return fl ? <span className={s.mono} style={{ display: "block" }}>{fl}</span> : null;
                        })()}
                      </span>
                      <span className={s.roomArea}>{Math.round(r.sqft)} sf</span>
                    </button>
                  );
                })}
              </div>
              <p className={s.note}>
                {doc.walls.length} walls · {doc.openings.filter((o) => o.kind !== "window").length} doors · {doc.openings.filter((o) => o.kind === "window").length} windows
                {doc.marks.length ? ` · ${doc.marks.length} plan items (cabinets, appliances, fixtures)` : ""}
              </p>
            </div>
          </section>
        </aside>
      </div>
      {focus && focusRoom && (doc.items ?? []).some((i) => i.room === focus) ? <EstimateSheet doc={doc} focus={focus} designId={id} market={market} shopAddress={shopAddress} onPatch={patch} /> : null}
    </div>
  );
}

function Head({ title, sub, right }: { title?: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className={s.pageHead}>
      <div>
        <div className={s.kicker}>
          Home Design Studio <span className={s.adminNote}>Admin preview</span>
        </div>
        <h1 className={s.pageTitle}>{title ?? "Design a room"}</h1>
        <p className={s.pageSub}>{sub ?? "From the blueprint to the room in 3D: walls, doors and windows where the plan has them — then the finishes, cabinets and fixtures."}</p>
      </div>
      {right ?? null}
    </header>
  );
}

function NumField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [txt, setTxt] = React.useState(String(Math.round(value * 100) / 100));
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setTxt(String(Math.round(value * 100) / 100));
  }
  const commit = () => {
    const n = Number(txt);
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n);
    else setTxt(String(Math.round(value * 100) / 100));
  };
  return (
    <label className={s.field}>
      <span className={s.lbl}>{label}</span>
      <input className={s.in} inputMode="decimal" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

function LengthField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [txt, setTxt] = React.useState(ftIn(value));
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setTxt(ftIn(value));
  }
  const commit = () => {
    const n = parseLength(txt.replace("−", "-"));
    if (n && n >= 6 && Math.abs(n - value) > 0.1) onCommit(n);
    else setTxt(ftIn(value));
  };
  return (
    <label className={s.field}>
      <span className={s.lbl}>{label}</span>
      <input className={s.in} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} data-design-length />
    </label>
  );
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [txt, setTxt] = React.useState(value);
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setTxt(value);
  }
  const commit = () => {
    if (txt.trim() !== value) onCommit(txt.trim().slice(0, 60));
  };
  return (
    <label className={`${s.field} ${s.full}`}>
      <span className={s.lbl}>{label}</span>
      <input className={s.in} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} data-design-name />
    </label>
  );
}
