"use client";
// THE ROOF VISUALIZER (2026-10-25). Owner: "when they pick the material it shows on the roof picture — how the roof
// will look; by clicking or changing the material, metal, colour; isolating the exact roof the contractor is
// estimating". The engine is lib/roofLook (pure); this is the card in the roof estimator:
//   THE ROOF      from the air (the satellite picture the estimate already uses, or EagleView's ortho) the roof is the
//                 MEASURED OUTLINE — the exact roof of the estimate, projected onto the picture, nothing to draw; on a
//                 street photo the contractor uploads, the model finds the roof (findRoofInPhoto) and a tap grows it
//                 from the picture's own colours — more taps add, the brush takes away.
//   THE LOOK      a family (the estimate's own roof type first) and a colour; the picture keeps its light and shadows,
//                 the roof takes the material and its pattern — seams, shingle rows, barrel tiles, shakes, slates.
//   OUT           compare before/after, save it to the proposal (Blob + ROOF_LOOK, the client's page shows it as
//                 "Your roof in …"), download it.
import * as React from "react";
import { toast } from "@/components/ui/Toast";
import { getMeasurementOrtho, getMeasurementPhoto } from "@/actions/roofMeasurement";
import { findRoofInPhoto, saveRoofLook } from "@/actions/roofLook";
import type { RoofFamily } from "@/lib/roofPackage/catalog";
import { LOOK_FAMILIES, ROOF_COLORS, brushMask, cleanMask, defaultPeriod, growMask, lookColor, lookWords, maskStats, measuredMask, normalizedPolygons, paintRoof, polygonMask, type RoofLook as Look } from "@/lib/roofLook";
import type { LatLng, RoofFrame } from "@/lib/roofPictures";
import "./roof-look.css";

type Source = "satellite" | "ortho" | "photo";
type Tool = "add" | "take";

interface Props {
  measurementId: string | null;
  rings: LatLng[][];
  pin: LatLng | null;
  /** The ortho's bbox, when the measurement carries EagleView's clear aerial. */
  orthoBbox: [number, number, number, number] | null;
  /** The estimate's own roof type, the look starts there. */
  family: RoofFamily | null;
  proposalId?: string | null;
}

const WORK_MAX = 1400;
const STATIC_PX = 640;

/** A picture (data URL or File) drawn into a raster no wider than WORK_MAX on its long side. */
function loadRaster(src: string): Promise<{ img: HTMLImageElement; data: ImageData; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, w, h);
      resolve({ img, data: g.getImageData(0, 0, w, h), w, h });
    };
    img.onerror = () => reject(new Error("The picture could not be read."));
    img.src = src;
  });
}

export function RoofLook({ measurementId, rings, pin, orthoBbox, family, proposalId }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [source, setSource] = React.useState<Source>("satellite");
  const [pictures, setPictures] = React.useState<Partial<Record<Source, string>>>({});
  const [zoom, setZoom] = React.useState(20);
  const [raster, setRaster] = React.useState<ImageData | null>(null);
  const [mask, setMask] = React.useState<Uint8Array | null>(null);
  const [history, setHistory] = React.useState<Uint8Array[]>([]);
  const [look, setLook] = React.useState<Look>(() => ({ family: family ?? "asphalt", colorId: ROOF_COLORS[family ?? "asphalt"][0].id }));
  const [tool, setTool] = React.useState<Tool>("add");
  const [tolerance, setTolerance] = React.useState(40);
  const [brush, setBrush] = React.useState(22);
  const [texture, setTexture] = React.useState(1);
  const [strength, setStrength] = React.useState(0.8);
  const [compare, setCompare] = React.useState(100);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [isolated, setIsolated] = React.useState<"measured" | "model" | "tap" | null>(null);
  const painted = React.useRef<Uint8ClampedArray | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // the estimate's roof type leads the look until the contractor picks another (adjusted during render, not in an effect)
  const [lastFamily, setLastFamily] = React.useState(family);
  if (family !== lastFamily) {
    setLastFamily(family);
    if (family) setLook({ family, colorId: ROOF_COLORS[family][0].id });
  }

  /** The frame the measured rings project with, for the picture on screen. */
  const frame = React.useCallback((): RoofFrame | null => {
    if (source === "satellite" && pin) return { kind: "satellite", lat: pin.lat, lng: pin.lng, zoom, px: STATIC_PX };
    if (source === "ortho" && orthoBbox) return { kind: "ortho", token: "", bbox: orthoBbox };
    return null;
  }, [source, pin, zoom, orthoBbox]);

  const pushHistory = (m: Uint8Array | null) => setHistory((h) => (m ? [...h.slice(-8), m] : h));

  /** The roof isolated: the measured outline from the air; the model's outline on a photo (a tap refines it). */
  const isolate = React.useCallback(async (r: ImageData, src: Source, pic: string) => {
    const f = src === "photo" ? null : frame();
    if (f && rings.length) {
      const m = cleanMask(measuredMask(rings, f, r.width, r.height, 0), r.width, r.height, { open: 0, close: 0, feather: 2 });
      setMask(m); setIsolated("measured"); setNote(null);
      return;
    }
    if (src === "photo") {
      setBusy("find");
      try {
        const res = await findRoofInPhoto(pic);
        if (res.ok && res.polygons.length) {
          const polys = normalizedPolygons(res.polygons, r.width, r.height);
          const m0 = polygonMask(r.width, r.height, polys);
          // the model's outline, snapped to the picture: grow from inside it, kept within a margin of it
          const st = maskStats(m0, r.width, r.height);
          const seeds: Array<[number, number]> = polys.map((p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]);
          let m = new Uint8Array(r.width * r.height);
          for (const s of seeds) growMask(r, s, tolerance, m);
          const grownStats = maskStats(m, r.width, r.height);
          if (grownStats.area < st.area * 0.4) m = m0;
          setMask(cleanMask(m, r.width, r.height, { feather: 2 }));
          setIsolated("model"); setNote("The roof was found by the model — tap it to add a plane, switch to Take away for anything that isn't roof.");
          return;
        }
        setMask(null); setIsolated(null);
        setNote(res.ok ? "The model saw no roof in that picture — tap the roof to pick it out." : res.error);
      } catch {
        setMask(null); setIsolated(null); setNote("Tap the roof to pick it out.");
      } finally {
        setBusy(null);
      }
    }
  }, [frame, rings, tolerance]);

  /** A picture for the source: the satellite and the ortho come from the estimate's own loaders. */
  const show = React.useCallback(async (src: Source, pic?: string) => {
    let p = pic ?? pictures[src];
    if (!p && measurementId && src !== "photo") {
      setBusy("picture");
      try {
        const res = src === "satellite" ? await getMeasurementPhoto(measurementId) : await getMeasurementOrtho(measurementId);
        if (!res.ok) { setNote(res.error); return; }
        p = res.dataUrl;
        if (src === "satellite" && "zoom" in res) setZoom(res.zoom);
        setPictures((x) => ({ ...x, [src]: p }));
      } catch (err) {
        setNote(err instanceof Error ? err.message : "The picture could not be loaded.");
        return;
      } finally {
        setBusy(null);
      }
    }
    if (!p) return;
    setSource(src);
    const { data } = await loadRaster(p);
    setRaster(data); setMask(null); setHistory([]); setSaved(null); setIsolated(null); setNote(null);
    void isolate(data, src, p);
  }, [pictures, measurementId, isolate]);

  // the satellite picture first, on its own
  const booted = React.useRef(false);
  React.useEffect(() => {
    if (booted.current || !measurementId) return;
    booted.current = true;
    void show("satellite");
  }, [measurementId, show]);

  // draw: the painted roof, the compare slider sweeping the original back in, the mask's edge
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c || !raster) return;
    c.width = raster.width; c.height = raster.height;
    const g = c.getContext("2d")!;
    const out = mask ? paintRoof(raster, mask, look, { period: defaultPeriod(look.family, maskStats(mask, raster.width, raster.height)) * texture, strength }) : raster.data;
    painted.current = out;
    const img = new ImageData(new Uint8ClampedArray(out), raster.width, raster.height);
    g.putImageData(img, 0, 0);
    if (mask && compare < 100) {
      const cut = Math.round((compare / 100) * raster.width);
      const orig = new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height);
      g.putImageData(orig, 0, 0, cut, 0, raster.width - cut, raster.height);
      g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(cut - 1, 0, 2, raster.height);
    }
  }, [raster, mask, look, texture, strength, compare]);

  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c || !raster) return;
    const box = c.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * raster.width, y = ((e.clientY - box.top) / box.height) * raster.height;
    const base = mask ? new Uint8Array(mask) : new Uint8Array(raster.width * raster.height);
    pushHistory(mask);
    if (tool === "take") {
      brushMask(base, raster.width, raster.height, [x, y], brush * (raster.width / box.width), false);
      setMask(base);
      return;
    }
    const { added } = growMask(raster, [x, y], tolerance, base);
    if (!added) { setNote("Nothing there to add — tap on the roof."); return; }
    setMask(cleanMask(base, raster.width, raster.height, { feather: 2 }));
    if (!isolated) setIsolated("tap");
    setNote(null);
  };

  const undo = () => { const h = [...history]; const last = h.pop(); setHistory(h); setMask(last ?? null); };
  const clear = () => { pushHistory(mask); setMask(null); setIsolated(null); };

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { toast.error("That picture is over 12 MB — a phone photo is fine, a scan is too big."); return; }
    const url = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("read")); fr.readAsDataURL(file); });
    // the picture the model reads is the working-size JPEG, never the phone's full frame
    const { w, h, data } = await loadRaster(url);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.putImageData(data, 0, 0);
    const jpeg = c.toDataURL("image/jpeg", 0.86);
    setPictures((x) => ({ ...x, photo: jpeg }));
    await show("photo", jpeg);
  };

  const exportPng = (): string | null => {
    if (!raster || !painted.current) return null;
    const c = document.createElement("canvas"); c.width = raster.width; c.height = raster.height;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(painted.current), raster.width, raster.height), 0, 0);
    return c.toDataURL("image/png");
  };
  const download = () => {
    const url = exportPng(); if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = `roof-${look.family}-${look.colorId}.png`; a.click();
  };
  const save = async () => {
    const url = exportPng();
    if (!url || !measurementId || !mask) return;
    setBusy("save");
    try {
      const res = await saveRoofLook({ measurementId, proposalId: proposalId ?? null, png: url, family: look.family, colorId: look.colorId, source: source === "photo" ? "photo" : "aerial" });
      if (!res.ok) { toast.error(res.error); return; }
      setSaved(res.url);
      toast.success("Saved to the proposal", `The client's page will show the roof in ${lookWords(look)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The look could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const stats = mask && raster ? maskStats(mask, raster.width, raster.height) : null;
  const words = lookWords(look);
  return (
    <div className="card rf-card rl" data-roof-look data-roof-look-source={source} data-roof-look-isolated={isolated ?? ""}>
      <div className="rf-head rf-head--bar">
        <div>
          <div className="card-title">Roof visualizer</div>
          <div className="card-sub">The roof in the material and colour you pick — the picture keeps its light, only the roof changes. From the air it is the measured roof exactly; on a photo, tap the roof.</div>
        </div>
        <div className="vw-controls">
          <div className="vsw" role="radiogroup" aria-label="Picture">
            <button type="button" role="radio" aria-checked={source === "satellite"} className={"vsw-btn" + (source === "satellite" ? " active" : "")} disabled={!measurementId || !!busy} onClick={() => void show("satellite")} data-roof-look-src="satellite">From the air</button>
            {orthoBbox && <button type="button" role="radio" aria-checked={source === "ortho"} className={"vsw-btn" + (source === "ortho" ? " active" : "")} disabled={!measurementId || !!busy} onClick={() => void show("ortho")} data-roof-look-src="ortho">Clear aerial</button>}
            <button type="button" role="radio" aria-checked={source === "photo"} className={"vsw-btn" + (source === "photo" ? " active" : "")} disabled={!!busy} onClick={() => (pictures.photo ? void show("photo") : fileRef.current?.click())} data-roof-look-src="photo">A photo</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0] ?? null)} data-roof-look-file />
        </div>
      </div>

      <div className="rl-body">
        <div className="rl-stage" data-roof-look-stage>
          {raster ? (
            <canvas ref={canvasRef} className={"rl-canvas" + (source === "photo" || !isolated ? " rl-canvas--tap" : "")} onPointerDown={tap} aria-label="The roof, in the chosen look — tap the roof to add a plane" data-roof-look-canvas />
          ) : (
            <div className="rl-empty" data-roof-look-empty>
              {busy === "picture" ? "Loading the picture…" : measurementId ? note ?? "No picture yet." : "Measure a roof first, or add a photo of the house."}
              {!measurementId && <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>Add a photo</button>}
            </div>
          )}
          {raster && (
            <div className="rl-under">
              <label className="rl-compare">
                <span>Before · after</span>
                <input type="range" min={0} max={100} value={compare} onChange={(e) => setCompare(Number(e.target.value))} aria-label="Before and after" data-roof-look-compare />
              </label>
              <span className="rl-status" data-roof-look-status>
                {busy === "find" ? "Finding the roof…" : stats && stats.area ? `${isolated === "measured" ? "The measured roof" : isolated === "model" ? "The roof the model found" : "The roof you tapped"} · ${Math.round(stats.share * 100)}% of the picture · ${words}` : note ?? "Tap the roof to pick it out."}
              </span>
            </div>
          )}
        </div>

        <div className="rl-side">
          <div className="rl-sec">
            <div className="rl-lbl">Material</div>
            <div className="rl-fams" role="radiogroup" aria-label="Roof material">
              {LOOK_FAMILIES.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={look.family === f.id} className={"rl-fam" + (look.family === f.id ? " active" : "")} onClick={() => setLook({ family: f.id, colorId: ROOF_COLORS[f.id][0].id })} data-roof-look-family={f.id}>{f.label}</button>
              ))}
            </div>
          </div>
          <div className="rl-sec">
            <div className="rl-lbl">Colour · <b data-roof-look-color-name>{lookColor(look).name}</b></div>
            <div className="rl-swatches" role="radiogroup" aria-label="Roof colour">
              {ROOF_COLORS[look.family].map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={look.colorId === c.id} className={"rl-swatch" + (look.colorId === c.id ? " active" : "")} style={{ background: c.hex }} title={c.name} aria-label={c.name} onClick={() => setLook({ ...look, colorId: c.id })} data-roof-look-color={c.id} />
              ))}
            </div>
          </div>
          <div className="rl-sec">
            <div className="rl-lbl">The roof</div>
            <div className="rl-tools" role="radiogroup" aria-label="Tap tool">
              <button type="button" role="radio" aria-checked={tool === "add"} className={"rl-tool" + (tool === "add" ? " active" : "")} onClick={() => setTool("add")} data-roof-look-tool="add">Add a plane</button>
              <button type="button" role="radio" aria-checked={tool === "take"} className={"rl-tool" + (tool === "take" ? " active" : "")} onClick={() => setTool("take")} data-roof-look-tool="take">Take away</button>
            </div>
            <label className="rl-range"><span>Reach of a tap</span><input type="range" min={5} max={90} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} data-roof-look-tolerance /></label>
            <label className="rl-range"><span>Brush</span><input type="range" min={6} max={80} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>
            <div className="rl-acts">
              {(source === "satellite" || source === "ortho") && rings.length > 0 && raster && (
                <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => { pushHistory(mask); void isolate(raster, source, pictures[source] ?? ""); }} data-roof-look-measured>The measured roof</button>
              )}
              {source === "photo" && raster && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => { pushHistory(mask); void isolate(raster, "photo", pictures.photo ?? ""); }} data-roof-look-find>Find the roof</button>}
              <button type="button" className="btn btn-ghost" disabled={!history.length} onClick={undo} data-roof-look-undo>Undo</button>
              <button type="button" className="btn btn-ghost" disabled={!mask} onClick={clear} data-roof-look-clear>Clear</button>
            </div>
          </div>
          <div className="rl-sec">
            <div className="rl-lbl">The finish</div>
            <label className="rl-range"><span>Texture size</span><input type="range" min={0.5} max={2.5} step={0.1} value={texture} onChange={(e) => setTexture(Number(e.target.value))} data-roof-look-texture /></label>
            <label className="rl-range"><span>Texture strength</span><input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /></label>
          </div>
          <div className="rl-acts rl-acts--out">
            <button type="button" className="btn btn-primary" disabled={!mask || !measurementId || busy === "save"} onClick={() => void save()} data-roof-look-save>{busy === "save" ? "Saving…" : saved ? "Saved — save again" : "Save to the proposal"}</button>
            <button type="button" className="btn btn-ghost" disabled={!raster} onClick={download} data-roof-look-download>Download</button>
          </div>
          {saved && <p className="rl-note" data-roof-look-saved>On the client&apos;s page as &ldquo;Your roof in {words}&rdquo;.</p>}
          {note && raster && <p className="rl-note" data-roof-look-note>{note}</p>}
        </div>
      </div>
    </div>
  );
}
