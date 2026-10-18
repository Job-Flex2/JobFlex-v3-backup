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
import { useRouter } from "next/navigation";
import type { Route } from "next";
import s from "./design-studio.module.css";
import { PlanEditor, setWallLength, type Selection, type Tool, type Underlay } from "./plan-editor";
import type { DesignDoc, OpeningKind, P } from "@/lib/design/model";
import { emptyDesign, ftIn, newId, DEFAULT_CEILING } from "@/lib/design/model";
import { centroid, dist, roomsOf, wallLen, type Room } from "@/lib/design/geometry";
import { readPlan, type PlanRead } from "@/lib/design/planRead";
import { openDesignFiles, type DesignSheet } from "@/lib/design/pdfSheets";
import { deleteDesign, listDesigns, readRoomNames, saveDesign, type DesignRow } from "@/actions/designStudio";

const Room3D = dynamic(() => import("./room-3d").then((m) => m.Room3D), { ssr: false, loading: () => <div className={s.three} /> });

type Phase = "start" | "opening" | "sheets" | "box" | "reading" | "plan";

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
  };
}

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

export function DesignStudio({ initial }: { initial: { id: string; doc: DesignDoc } | null }) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>(initial ? "plan" : "start");
  const [designs, setDesigns] = React.useState<DesignRow[] | null>(null);
  const [sheets, setSheets] = React.useState<DesignSheet[]>([]);
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ step: string; pct: number }>({ step: "", pct: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  // The design and its history.
  const [doc, setDoc] = React.useState<DesignDoc>(() => initial?.doc ?? emptyDesign());
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
  const [scaleNote, setScaleNote] = React.useState<{ tone: "good" | "warn"; text: string; fix?: number } | null>(null);
  const [box, setBox] = React.useState<{ sheet: DesignSheet; url: string; scale: number; w: number; h: number; a: P | null; b: P | null } | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const rooms = React.useMemo(() => roomsOf(doc), [doc]);
  const focusRoom = focus ? rooms.find((r) => r.labelId === focus) ?? null : null;

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
    async (quiet = false) => {
      setSaving(true);
      const res = await saveDesign({ id, doc: { ...committed.current, focus } });
      setSaving(false);
      if (!res.ok) {
        if (!quiet) setError(res.error);
        return;
      }
      setDirty(false);
      setSavedAt(res.updatedAt);
      if (res.id !== id) {
        setId(res.id);
        router.replace(`/dashboard/design-studio?design=${res.id}` as Route, { scroll: false });
      }
    },
    [id, focus, router],
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
      setPhase(sorted.length ? "sheets" : "start");
      if (!sorted.length) setError(res.skipped[0] ?? "No plan sheets were found in those files.");
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

  const readSheet = async (sheet: DesignSheet, region: { x: number; y: number; w: number; h: number } | null) => {
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
      const { sheet: vs, texts } = await sheet.read();
      if (!sheet.layered && !region) {
        // No CAD layers: the contractor boxes the floor plan so only its lines are read.
        const pic = await sheet.picture(null, 1800);
        setBox({ sheet, url: pic.url, scale: pic.scale, w: pic.w, h: pic.h, a: null, b: null });
        setPhase("box");
        return;
      }
      setProgress({ step: "Finding walls, doors and windows…", pct: 40 });
      await new Promise((r) => setTimeout(r, 30));
      const title = (sheet.title || sheet.fileName.replace(/\.pdf$/i, "")).replace(/[\s|·:,-]+$/g, "").replace(/^[\s|·:,-]+/g, "").trim();
      const r: PlanRead = readPlan(vs, texts, { region, fileName: sheet.fileName, page: sheet.page, title: title || "Floor plan" });
      let d = r.doc;
      const k = r.inPerPt;
      setProgress({ step: "Drawing the sheet underneath…", pct: 55 });
      const pic = await sheet.picture(r.region, 2400);
      const toPx = pic.scale / k; // plan inches → picture pixels
      setUnderlay({ url: pic.url, x: 0, y: 0, w: pic.w / toPx, h: pic.h / toPx, opacity: 0.35 });
      const rs = roomsOf(d);
      const extra: string[] = [...r.notes];
      if (!d.labels.length && rs.length) {
        setProgress({ step: `Reading the names of ${rs.length} rooms…`, pct: 72 });
        const numbered = await numberedPicture(pic.url, rs, toPx);
        const names = await readRoomNames({ image: numbered, count: rs.length });
        if (names.ok) {
          const labels = [...d.labels];
          for (const nr of names.rooms) {
            const room = rs[nr.n - 1];
            if (!room || !nr.names.length) continue;
            const c = centroid(room.poly);
            nr.names.forEach((name, i) => labels.push({ id: newId("r"), name, at: { x: c.x, y: c.y + (i - (nr.names.length - 1) / 2) * 30 }, ceiling: DEFAULT_CEILING, planSqFt: i === 0 ? nr.sqft : null }));
          }
          d = { ...d, labels };
        } else extra.push(`Room names weren't read (${names.error}) — name the rooms by clicking them.`);
      }
      // The scale, checked against the areas the plan prints. A wrong scale throws EVERY room off by the same factor;
      // one room off on its own is a wall the read missed (a hall merged into a bedroom) — said as that.
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
          setScaleNote({ tone: "good", text: `Sizes check out: ${good.map((c) => c.name).join(", ")} ${good.length === 1 ? "measures" : "measure"} within ${Math.max(1, Math.round(worst * 100))}% of the area the plan prints.` });
          for (const c of off) extra.push(`${c.name} measures ${Math.round(c.have)} sq ft where the plan prints ${c.want} — ${c.k > 1 ? "a wall may be missing there (a hall or closet joined to it)" : "a wall may be read in the wrong place"}; check it in the plan.`);
        } else if (consistent) {
          const med = ks[Math.floor(ks.length / 2)];
          setScaleNote({ tone: "warn", text: `Every room measures ${Math.round(Math.abs(med - 1) * 100)}% ${med > 1 ? "bigger" : "smaller"} than the plan prints — the scale is likely off.`, fix: Math.sqrt(1 / med) });
        } else for (const c of off) extra.push(`${c.name} measures ${Math.round(c.have)} sq ft where the plan prints ${c.want} — check its walls in the plan.`);
      }
      setNotes(extra);
      replace(d);
      setDirty(true);
      setProgress({ step: "Done", pct: 100 });
      setPhase("plan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sheet could not be read.");
      setPhase("sheets");
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
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setPhase("start")}>
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
              <Room3D doc={doc} focus={focus} selectedWall={selWall?.id ?? null} onPickWall={(wid) => setSelected(wid ? { kind: "wall", id: wid } : null)} view={threeView} frameToken={frameToken} className={s.three} label={`${focusRoom?.name ?? "The room"} in 3D`} />
              {editor}
            </div>
          ) : (
            editor
          )}
          {threeView === "walk" && focus ? <p className={s.note}>Walking in: drag to look around; the arrow keys (or W A S D) walk once you click the 3D view.</p> : null}
        </div>

        <aside className={s.side}>
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
                <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => { patch((d) => { d.walls = d.walls.filter((w) => w.id !== selWall.id); d.openings = d.openings.filter((o) => o.wallId !== selWall.id); }); setSelected(null); }}>
                  Delete
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
                <p className={s.note}>Drag its ends to resize, its middle to slide it — joined walls follow. {doc.openings.filter((o) => o.wallId === selWall.id).length} openings on it.</p>
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
                      <span className={s.roomName}>{r.names.length > 1 ? r.names.join(" · ") : r.name}</span>
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
