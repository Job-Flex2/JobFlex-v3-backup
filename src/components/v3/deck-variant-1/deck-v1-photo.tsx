"use client";
// THE PHOTO OF THE HOUSE in Variant 1 — dormant, as in the live studio it replaced (2026-10-18). The owner took the
// photo out on 2026-10-11 ("let's not use that picture at all — the 3D model, and you draw the house"); the live
// studio kept its flow behind PHOTO_ENABLED = false, and so does this one. Turn the flag on and the photo comes
// back here whole: the "Where it stands" choice, the Photo view with its fit, marking and straightening tools, the
// photo as the wall in the 3D, and the photo section of the House step.
//
// The state and handlers are COPIED FROM deck-studio.tsx (the smart fit, the read again, the refit, the offer, the
// marks, the straightening and its undo), their comments' intent kept; the presentation is Variant 1's. With the flag
// off nothing here touches the design: a reopened design that carries a photo keeps it, untouched, in what it saves.

import * as React from "react";
import type { DeckDesign, DeckPhoto } from "@/lib/deck/design";
import type { DeckPatch } from "@/lib/deck/checks";
import type { DeckScene } from "@/lib/deck/scene";
import { deckElevation, defaultPlacement, type Elevation } from "@/lib/deck/elevation";
import { deckPhotoHref, readDeckPhoto, uploadDeckPhoto } from "@/actions/deckEstimator";
import { addDoor, addJog, addScaleLine, autoRectify, blankRead, fitPhoto, fitSummary, markedRead, rectifyPlan, removeDoor, removeJog, removeScaleLine, setJog, setScaleLength, shapeWithOffer, transformPlaced, transformRead, wallExtent, wallQuadFromRead, type FitDeck, type PhotoFit, type Placed, type Quad, type WallRead } from "@/lib/deck/photoFit";
import type { DeckBackdrop } from "@/components/estimator/deck/DeckModel3D";
import { DeckPhotoView, cropPhoto, shrinkPhoto, straightenPhoto, trimLetterbox } from "@/components/v3/deck-estimator-blueprint/deck-photo";
import { NumberInput, Seg, cx, feetText, parseFeet, parseInches } from "./deck-v1-parts";

/** Mirrors `PHOTO_ENABLED` in deck-estimator-blueprint/deck-studio.tsx (private there): the photo of the house is out. */
export const PHOTO_ENABLED = false;

export type V1View = "3d" | "plan" | "wall" | "photo";

export interface DeckPhotoState {
  elevation: Elevation | null;
  photoHref: string | null;
  photoBusy: boolean;
  photoError: string | null;
  photoStage: string | null;
  photoNote: string | null;
  /** The hidden file input, as a callback ref (the element is kept in state). */
  setFileInput: (el: HTMLInputElement | null) => void;
  pickPhoto: () => void;
  onPhotoFile: (file: File | null) => void;
  readPhotoAgain: () => Promise<void>;
  refitPhoto: () => void;
  applyOffer: () => void;
  showHouse: boolean;
  setShowHouse: React.Dispatch<React.SetStateAction<boolean>>;
  backdrop: DeckBackdrop | null;
  marking: boolean;
  setMarking: React.Dispatch<React.SetStateAction<boolean>>;
  markRead: WallRead;
  applyRead: (read: WallRead) => void;
  straightening: boolean;
  corners: Quad | null;
  setCorners: (q: Quad) => void;
  wallWidthFt: number | null;
  setWallWidthFt: (n: number | null) => void;
  startStraighten: () => void;
  cancelStraighten: () => void;
  straightenNow: () => Promise<void>;
  unstraighten: () => void;
  heightOffer: number | null;
  refreshPhoto: () => Promise<void>;
  removePhoto: () => void;
}

/** The photo's state and handlers (copied from deck-studio.tsx). */
export function useDeckPhoto({ design, patch, scene, view, setView }: { design: DeckDesign; patch: (p: DeckPatch, keys?: string[]) => void; scene: DeckScene; view: V1View; setView: (v: V1View) => void }): DeckPhotoState {
  // The elevation is only the photo's: with the flag off it is not worked out at all.
  const elevation = React.useMemo(() => (PHOTO_ENABLED ? deckElevation(scene) : null), [scene]);
  const [photoHref, setPhotoHref] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const [fileInput, setFileInput] = React.useState<HTMLInputElement | null>(null);
  const pickPhoto = () => fileInput?.click();
  /** What the studio is doing with the picture right now, for the buttons. */
  const [photoStage, setPhotoStage] = React.useState<string | null>(null);
  /** The read's own trouble (no key, no wall seen): the picture still goes up, placed by hand. */
  const [photoNote, setPhotoNote] = React.useState<string | null>(null);
  /** The last picture chosen, so "Fit to the wall" can read it again at full size. */
  const lastFile = React.useRef<File | null>(null);
  const fitDeck = React.useMemo<FitDeck | null>(() => (elevation ? { shape: design.shape, depthFt: design.shape.depthFt, elevWidthFt: elevation.widthFt, elevHeightFt: elevation.heightFt, elevLeftFt: elevation.leftFt } : null), [design.shape, elevation]);
  // THE SMART FIT (owner, 2026-10-10): the picture is shrunk, its black bands cut, read once by the vision model
  // (actions readDeckPhoto), cropped to the wall and placed by the read (lib/deck/photoFit) — then saved. A read that
  // fails still saves the picture, centred, and says why.
  const placePhoto = async (file: File) => {
    if (!fitDeck) return;
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoNote(null);
    try {
      lastFile.current = file;
      setPhotoStage("Reading the picture…");
      const small = await shrinkPhoto(file);
      const clean = await trimLetterbox(small.file, small.w, small.h);
      setPhotoStage("Finding the wall…");
      const readForm = new FormData();
      readForm.set("file", clean.file);
      const read = await readDeckPhoto(readForm);
      let toUpload: { file: File; w: number; h: number } = clean;
      let placed = defaultPlacement();
      let fit: PhotoFit | null = null;
      let wallRead: WallRead | null = null;
      let before: NonNullable<DeckPhoto["straightened"]>["before"] | null = null;
      let quad: Quad | null = null;
      let autoNote: string | null = null;
      if (read.ok) {
        wallRead = read.read;
        // AN ANGLED SHOT IS STRAIGHTENED ON ITS OWN (owner, 2026-10-11): the wall's corners from the read make the warp
        // (lib/deck/photoFit autoRectify); the picture as taken, cut to its wall, is kept too, so "Original picture" can
        // bring it back.
        const plan = autoRectify(read.read, clean.w, clean.h);
        let warped: { file: File; w: number; h: number } | null = null;
        if (plan) {
          setPhotoStage("Straightening the picture…");
          warped = await straightenPhoto(clean.file, plan.H, { w: plan.w, h: plan.h }, { w: clean.w, h: clean.h }).catch(() => null);
        }
        if (plan && warped) {
          const fit0 = fitPhoto(read.read, fitDeck, design.heightIn, clean.w, clean.h);
          const cut0 = await cropPhoto(clean.file, fit0.crop, clean.w, clean.h);
          const form0 = new FormData();
          form0.set("file", cut0.file);
          form0.set("w", String(cut0.w));
          form0.set("h", String(cut0.h));
          const res0 = await uploadDeckPhoto(form0);
          if (res0.ok) before = { url: res0.url, w: res0.w, h: res0.h, placed: fit0.placed, fit: fitSummary(fit0, read.read) };
          wallRead = transformRead(read.read, plan.H, clean.w, clean.h, warped.w, warped.h);
          quad = wallQuadFromRead(read.read);
          fit = fitPhoto(wallRead, fitDeck, design.heightIn, warped.w, warped.h);
          toUpload = await cropPhoto(warped.file, fit.crop, warped.w, warped.h);
          autoNote = `The shot was ${plan.obliquePct}% off square — the picture was straightened so the wall stands true and the windows sit where they are. "Original picture" brings back the one you took.`;
        } else {
          fit = fitPhoto(read.read, fitDeck, design.heightIn, clean.w, clean.h);
          toUpload = await cropPhoto(clean.file, fit.crop, clean.w, clean.h);
        }
        placed = fit.placed;
      } else setPhotoNote(read.error);
      setPhotoStage("Saving the picture…");
      const form = new FormData();
      form.set("file", toUpload.file);
      form.set("w", String(toUpload.w));
      form.set("h", String(toUpload.h));
      const res = await uploadDeckPhoto(form);
      if (!res.ok) {
        setPhotoError(res.error);
        return;
      }
      setPhotoHref(res.href);
      patch({ photo: { url: res.url, w: res.w, h: res.h, placed, fit: fit && wallRead ? fitSummary(fit, wallRead) : null, straightened: before && quad ? { quad, before } : null } });
      if (autoNote) setPhotoNote(autoNote);
      setView("photo");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The picture could not be read.");
    } finally {
      setPhotoBusy(false);
      setPhotoStage(null);
      if (fileInput) fileInput.value = "";
    }
  };
  const onPhotoFile = (file: File | null) => {
    if (file) void placePhoto(file);
  };
  /** The model's read again — on the picture as chosen when it is still here, else on the saved one. */
  const readPhotoAgain = async () => {
    if (!design.photo || photoBusy) return;
    let file = lastFile.current;
    if (!file) {
      const href = photoHref ?? (await deckPhotoHref(design.photo.url).catch(() => null));
      if (!href) return;
      try {
        const blob = await fetch(href).then((r) => (r.ok ? r.blob() : null));
        if (!blob) return;
        file = new File([blob], "house.jpg", { type: blob.type || "image/jpeg" });
      } catch {
        return;
      }
    }
    await placePhoto(file);
  };
  /** The fit again, from the read the picture carries — no second look by the model. */
  const refitPhoto = () => {
    const p = design.photo;
    if (!p || photoBusy || !fitDeck) return;
    const read = p.fit?.read;
    if (!read) {
      void readPhotoAgain();
      return;
    }
    const fit = fitPhoto(read, fitDeck, design.heightIn, p.w, p.h, { recrop: false });
    patch({ photo: { ...p, placed: fit.placed, fit: fitSummary(fit, read) } });
  };
  /** The house's step taken into the deck's shape — then the deck is set on it again once the new shape's elevation is in. */
  const refitAfter = React.useRef(false);
  const refitRef = React.useRef(refitPhoto);
  React.useEffect(() => {
    refitRef.current = refitPhoto;
  });
  const applyOffer = () => {
    const offer = design.photo?.fit?.offer;
    if (!offer) return;
    refitAfter.current = true;
    patch({ shape: shapeWithOffer(design.shape, offer) });
  };
  React.useEffect(() => {
    if (!refitAfter.current) return;
    refitAfter.current = false;
    queueMicrotask(() => refitRef.current());
  }, [fitDeck]);
  // A design that already holds a photo (a reopened estimate) needs its read link.
  React.useEffect(() => {
    const url = design.photo?.url;
    if (!PHOTO_ENABLED || !url || photoHref) return;
    let gone = false;
    deckPhotoHref(url)
      .then((href) => {
        if (!gone && href) setPhotoHref(href);
      })
      .catch(() => null);
    return () => {
      gone = true;
    };
  }, [design.photo?.url, photoHref]);
  // THE PHOTO AS THE WALL in the 3D (owner, 2026-10-10): the same picture, placement and scale the photo view uses.
  // On the house (a ledger, or a roof on the wall) it IS the wall; a detached gazebo keeps it as a backdrop a yard back.
  const [showHouse, setShowHouse] = React.useState(true);
  const backdrop = React.useMemo<DeckBackdrop | null>(() => {
    const p = design.photo;
    if (!PHOTO_ENABLED || !elevation || !showHouse || !p?.placed || !photoHref) return null;
    return { href: photoHref, w: p.w, h: p.h, placed: p.placed, elevWidthFt: elevation.widthFt, elevLeftFt: elevation.leftFt, jogs: (p.fit?.read?.jogs ?? []).map((j) => ({ x: j.x, dir: j.dir, depthFt: j.depthFt })), standoffFt: scene.house ? 0 : 16, wall: p.fit?.read ? wallExtent(p.fit.read) : null };
  }, [design.photo, photoHref, elevation, showHouse, scene.house]);
  // MARK THE WALL (owner, 2026-10-10): the read's base, door, measure and steps as handles on the picture; every
  // change fits the deck again, from the marks, with no model.
  const [marking, setMarking] = React.useState(false);
  const markRead: WallRead = design.photo?.fit?.read ?? blankRead();
  const applyRead = (read: WallRead) => {
    const p = design.photo;
    if (!p || !fitDeck) return;
    const marked = markedRead(read);
    const fit = fitPhoto(marked, fitDeck, design.heightIn, p.w, p.h, { recrop: false, fallback: p.placed ?? defaultPlacement(), hand: true });
    patch({ photo: { ...p, placed: fit.placed, fit: fitSummary(fit, marked, true) } });
  };
  // STRAIGHTEN THE PICTURE (owner, 2026-10-11): four corners put on the wall, and the picture is warped so the wall
  // stands square (lib/deck/photoFit rectifyPlan). The picture before is kept in the design, so it can be undone.
  const [straightening, setStraightening] = React.useState(false);
  const [corners, setCornersState] = React.useState<Quad | null>(null);
  const [wallWidthFt, setWallWidthFt] = React.useState<number | null>(null);
  const startStraighten = () => {
    if (!design.photo) return;
    setCornersState(wallQuadFromRead(design.photo.fit?.read ?? null));
    setMarking(false);
    setStraightening(true);
    setView("photo");
  };
  const cancelStraighten = () => {
    setStraightening(false);
    setCornersState(null);
  };
  const straightenNow = async () => {
    const p = design.photo;
    if (!p || !corners || photoBusy || !fitDeck) return;
    const read = p.fit?.read ?? null;
    const plan = rectifyPlan(corners, read, p.w, p.h, { wallWidthFt });
    if (!plan) {
      setPhotoError("The four corners do not make a wall: the two top corners above the two bottom ones, left of right, each a little apart.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoNote(null);
    try {
      setPhotoStage("Straightening the picture…");
      const href = photoHref ?? (await deckPhotoHref(p.url).catch(() => null));
      const blob = href ? await fetch(href).then((r) => (r.ok ? r.blob() : null)).catch(() => null) : null;
      if (!blob) throw new Error("The picture could not be fetched to straighten it — try again.");
      const warped = await straightenPhoto(new File([blob], "house.jpg", { type: blob.type || "image/jpeg" }), plan.H, { w: plan.w, h: plan.h }, { w: p.w, h: p.h });
      if (!warped) throw new Error("The picture could not be straightened.");
      setPhotoStage("Saving the picture…");
      const form = new FormData();
      form.set("file", warped.file);
      form.set("w", String(warped.w));
      form.set("h", String(warped.h));
      const res = await uploadDeckPhoto(form);
      if (!res.ok) {
        setPhotoError(res.error);
        return;
      }
      const read2 = read ? transformRead(read, plan.H, p.w, p.h, warped.w, warped.h) : null;
      let placed: Placed = p.placed ? transformPlaced(p.placed, plan.H, p.w, p.h, warped.w, warped.h) : defaultPlacement();
      let fit: DeckPhoto["fit"] = null;
      if (read2) {
        const f = fitPhoto(read2, fitDeck, design.heightIn, warped.w, warped.h, { recrop: false, fallback: placed, hand: p.fit?.hand });
        placed = f.placed;
        fit = fitSummary(f, read2, p.fit?.hand ?? false);
      }
      setPhotoHref(res.href);
      patch({ photo: { url: res.url, w: res.w, h: res.h, placed, fit, straightened: { quad: corners, before: { url: p.url, w: p.w, h: p.h, placed: p.placed, fit: p.fit ?? null } } } });
      setStraightening(false);
      setCornersState(null);
      setPhotoNote(plan.by === "edges" ? `Straightened from the corners alone (the shot was ${plan.obliquePct}% off square). For the exact width, go back to the original, type the wall's width or draw a measure across it, and straighten again.` : plan.by === "width" ? "Straightened to the width you typed." : "Straightened to the measure you drew.");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The picture could not be straightened.");
    } finally {
      setPhotoBusy(false);
      setPhotoStage(null);
    }
  };
  /** Back to the picture as it was taken, with its own placement and read. */
  const unstraighten = () => {
    const st = design.photo?.straightened;
    if (!st) return;
    patch({ photo: { ...st.before, straightened: null } });
    setPhotoHref(null);
    setPhotoNote(null);
  };
  const suggestedHeight = design.photo?.fit?.suggestedHeightIn ?? null;
  const heightOffer = suggestedHeight !== null && Math.abs(suggestedHeight - design.heightIn) >= 2 ? suggestedHeight : null;
  const refreshPhoto = async () => {
    if (!design.photo) return;
    const href = await deckPhotoHref(design.photo.url).catch(() => null);
    if (href) setPhotoHref(href);
  };
  const removePhoto = () => {
    patch({ photo: null });
    setPhotoHref(null);
    if (view === "photo") setView("3d");
  };
  return { elevation, photoHref, photoBusy, photoError, photoStage, photoNote, setFileInput, pickPhoto, onPhotoFile, readPhotoAgain, refitPhoto, applyOffer, showHouse, setShowHouse, backdrop, marking, setMarking, markRead, applyRead, straightening, corners, setCorners: setCornersState, wallWidthFt, setWallWidthFt, startStraighten, cancelStraighten, straightenNow, unstraighten, heightOffer, refreshPhoto, removePhoto };
}

/** The hidden file input every "Add a photo" opens. */
export function PhotoFileInput({ inputRef, onFile }: { inputRef: (el: HTMLInputElement | null) => void; onFile: (file: File | null) => void }) {
  if (!PHOTO_ENABLED) return null;
  return <input ref={inputRef} className="v1-file-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Photo of the house" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />;
}

/** The Photo view's picture: the deck drawn over the house, or the ask for one. */
export function PhotoViewBox({ ph, design, patch, what }: { ph: DeckPhotoState; design: DeckDesign; patch: (p: DeckPatch) => void; what: string }) {
  if (design.photo && ph.elevation) {
    const photo = design.photo;
    return <DeckPhotoView photo={photo} href={ph.photoHref} elevation={ph.elevation} onPlace={(placed) => patch({ photo: { ...photo, placed } })} onRefresh={() => void ph.refreshPhoto()} marking={ph.marking} read={ph.marking ? ph.markRead : (photo.fit?.read ?? null)} onRead={ph.applyRead} corners={ph.straightening ? ph.corners : null} onCorners={ph.setCorners} />;
  }
  return (
    <div className="v1-photo-empty" data-deck-photo="empty">
      <p>Take a picture of the back of the house from the yard, square on. The {what.toLowerCase()} is drawn over it, and the client sees their own house with it in place.</p>
      <button type="button" className="v1-btn v1-btn-primary" onClick={ph.pickPhoto} disabled={ph.photoBusy}>
        {ph.photoBusy ? (ph.photoStage ?? "Saving the picture…") : "Add a photo of the house"}
      </button>
      {ph.photoError ? <p className="v1-call v1-call-bad" role="alert">{ph.photoError}</p> : null}
    </div>
  );
}

/** Under the Photo view: fit, mark, straighten, the offers the read makes, and what the picture showed. */
export function PhotoTools({ ph, design, patch }: { ph: DeckPhotoState; design: DeckDesign; patch: (p: DeckPatch) => void }) {
  const photo = design.photo;
  if (!PHOTO_ENABLED || !photo) return null;
  const { markRead, applyRead } = ph;
  return (
    <>
      <div className="v1-tools" data-deck-photo-row>
        <span className="v1-meta v1-photo-say">{photo.fit ? "Fitted to the wall — drag to adjust, pull the handle to size · the client sees it placed like this" : "Drag the outline to the wall · pull the handle to size it · the client sees it placed like this"}</span>
        <button type="button" className="v1-btn v1-btn-sm v1-btn-primary" onClick={ph.refitPhoto} disabled={ph.photoBusy} data-deck-photo-refit>{ph.photoBusy ? (ph.photoStage ?? "Working…") : "Fit to the wall"}</button>
        <button type="button" className={cx("v1-btn", "v1-btn-sm", ph.marking && "is-on")} aria-pressed={ph.marking} onClick={() => { ph.cancelStraighten(); ph.setMarking((m) => !m); }} data-deck-photo-mark>{ph.marking ? "Marking the wall" : "Mark the wall"}</button>
        <button type="button" className={cx("v1-btn", "v1-btn-sm", ph.straightening && "is-on")} aria-pressed={ph.straightening} onClick={() => (ph.straightening ? ph.cancelStraighten() : ph.startStraighten())} disabled={ph.photoBusy} data-deck-photo-straighten>{ph.straightening ? "Straightening" : "Straighten the picture"}</button>
        {photo.straightened ? <button type="button" className="v1-btn v1-btn-sm" onClick={ph.unstraighten} disabled={ph.photoBusy} data-deck-photo-unstraighten>Original picture</button> : null}
        {photo.fit?.read ? <button type="button" className="v1-btn v1-btn-sm" onClick={() => void ph.readPhotoAgain()} disabled={ph.photoBusy} data-deck-photo-reread>Read the picture again</button> : null}
        {photo.fit?.offer ? (
          <button type="button" className="v1-btn v1-btn-sm" onClick={ph.applyOffer} data-deck-photo-offer>
            {photo.fit.offer.kind === "notch" ? "Notch the deck around the step" : `Fit the deck into the ${photo.fit.offer.widthFt} ft recess`}
          </button>
        ) : null}
        {ph.heightOffer !== null ? <button type="button" className="v1-btn v1-btn-sm" onClick={() => patch({ heightIn: ph.heightOffer! })} data-deck-photo-height>Use {ph.heightOffer} in. height</button> : null}
        <button type="button" className="v1-btn v1-btn-sm" onClick={() => patch({ photo: { ...photo, placed: defaultPlacement() } })}>Centre it</button>
        <button type="button" className="v1-btn v1-btn-sm" onClick={ph.pickPhoto} disabled={ph.photoBusy}>Another photo</button>
        <button type="button" className="v1-btn v1-btn-sm v1-btn-danger" onClick={ph.removePhoto}>Remove</button>
      </div>
      {ph.straightening ? (
        <div className="v1-tools" data-deck-photo-straighten-tools>
          <span className="v1-meta v1-photo-say">Drag the four white corners onto the wall — where it meets the ground at the left and the right, and the top of the wall above each. The picture is then warped so the wall stands square.</span>
          <label className="v1-photo-mark">
            <span className="v1-meta">The wall between the corners is</span>
            <NumberInput label="Width of the wall between the corners, feet" value={ph.wallWidthFt ?? 0} parse={parseFeet} format={(n2) => (n2 > 0 ? feetText(n2) : "")} min={0} max={200} onCommit={(n2) => ph.setWallWidthFt(n2 > 0 ? n2 : null)} />
            <span className="v1-meta">ft wide — optional, it sets the exact width</span>
          </label>
          <button type="button" className="v1-btn v1-btn-sm v1-btn-primary" onClick={() => void ph.straightenNow()} disabled={ph.photoBusy} data-deck-photo-straighten-go>{ph.photoBusy ? (ph.photoStage ?? "Working…") : "Straighten it"}</button>
          <button type="button" className="v1-btn v1-btn-sm" onClick={ph.cancelStraighten} disabled={ph.photoBusy}>Cancel</button>
        </div>
      ) : null}
      {ph.marking ? (
        <div className="v1-tools" data-deck-photo-tools>
          <span className="v1-meta v1-photo-say">Drag the yellow ends to where the wall meets the ground · the door&apos;s bottom to its threshold, its top to the frame · a step where the wall jogs · a measure along anything you know the size of</span>
          {markRead.door ? (
            <button type="button" className="v1-btn v1-btn-sm" onClick={() => applyRead(removeDoor(markRead))} data-deck-mark-door="remove">Remove the door</button>
          ) : (
            <button type="button" className="v1-btn v1-btn-sm" onClick={() => applyRead(addDoor(markRead, photo.w, photo.h))} data-deck-mark-door="add">Add the door</button>
          )}
          {markRead.scaleLine ? (
            <>
              <label className="v1-photo-mark">
                <span className="v1-meta">The measure is</span>
                <NumberInput label="Length of the measure, inches" value={markRead.scaleLine.lengthIn} parse={parseInches} format={(n2) => String(Math.round(n2))} min={6} max={600} onCommit={(n2) => applyRead(setScaleLength(markRead, n2))} />
                <span className="v1-meta">in.</span>
              </label>
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => applyRead(removeScaleLine(markRead))} data-deck-mark-measure="remove">Remove the measure</button>
            </>
          ) : (
            <button type="button" className="v1-btn v1-btn-sm" onClick={() => applyRead(addScaleLine(markRead))} data-deck-mark-measure="add">Add a measure</button>
          )}
          <button type="button" className="v1-btn v1-btn-sm" onClick={() => applyRead(addJog(markRead))} disabled={markRead.jogs.length >= 4} data-deck-mark-step="add">Add a step</button>
          {markRead.jogs.map((j, i) => (
            <span key={i} className="v1-photo-mark" data-deck-mark-jog={i}>
              <span className="v1-meta">step {i + 1} · the part to its right</span>
              <Seg label={`Step ${i + 1} goes`} value={j.dir} onChange={(dir: "toward" | "away") => applyRead(setJog(markRead, i, { dir }))} options={[{ value: "toward", label: "comes out" }, { value: "away", label: "steps back" }]} />
              <NumberInput label={`Step ${i + 1} depth, feet`} value={j.depthFt ?? 2} parse={parseFeet} format={feetText} min={0.5} max={40} onCommit={(n2) => applyRead(setJog(markRead, i, { depthFt: n2 }))} />
              <span className="v1-meta">ft</span>
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => applyRead(removeJog(markRead, i))} aria-label={`Remove step ${i + 1}`}>×</button>
            </span>
          ))}
          <button type="button" className="v1-btn v1-btn-sm v1-btn-primary" onClick={() => ph.setMarking(false)} data-deck-mark-done>Done</button>
        </div>
      ) : null}
      {photo.fit?.notes.length || ph.photoNote ? (
        <ul className="v1-photo-notes" data-deck-photo-fit aria-label="What the picture showed">
          {ph.photoNote ? <li className="is-bad">{ph.photoNote}</li> : null}
          {(photo.fit?.notes ?? []).map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      ) : null}
      {ph.photoError ? <p className="v1-call v1-call-bad v1-photo-err" role="alert">{ph.photoError}</p> : null}
    </>
  );
}

/** "Where it stands" — a plain site with the drawn house, or the house's own wall from a photo (the Kind step). */
export function PhotoWhere({ ph, design, what, setView }: { ph: DeckPhotoState; design: DeckDesign; what: string; setView: (v: V1View) => void }) {
  if (!PHOTO_ENABLED) return null;
  const photo = design.photo;
  return (
    <div className="v1-field v1-field-wide">
      <span className="v1-lbl"><span>Where it stands</span></span>
      <div className="v1-answers v1-answers-2" role="group" aria-label="Where it stands">
        <button type="button" className={cx("v1-answer", !photo && "is-on")} aria-pressed={!photo} onClick={() => { if (photo) ph.removePhoto(); }} data-deck-site="plain">
          <span className="v1-answer-text"><span className="v1-answer-name">A plain site</span><span className="v1-answer-sub">the drawn house</span></span>
        </button>
        <button type="button" className={cx("v1-answer", !!photo && "is-on")} aria-pressed={!!photo} onClick={() => (photo ? setView("photo") : ph.pickPhoto())} disabled={ph.photoBusy} data-deck-site="photo">
          <span className="v1-answer-text">
            <span className="v1-answer-name">{photo ? "The photo of the house" : "A photo of the house"}</span>
            <span className="v1-answer-sub">{photo ? `${photo.straightened ? "straightened · " : ""}${photo.fit?.hand ? "marked by hand" : photo.fit ? "fitted to the wall" : "placed by hand"}` : ph.photoBusy ? (ph.photoStage ?? "working…") : "upload one — the wall is read off it"}</span>
          </span>
        </button>
      </div>
      <p className="v1-hint">With a photo the wall, the door and its steps are read off the picture — or marked by hand — and the {what.toLowerCase()} is set against the real wall, in the 3D too. A gazebo that stands on its own keeps the house behind it.</p>
    </div>
  );
}

/** The photo's own section (the House step): add, place, remove. */
export function PhotoSection({ ph, design, what, setView }: { ph: DeckPhotoState; design: DeckDesign; what: string; setView: (v: V1View) => void }) {
  if (!PHOTO_ENABLED) return null;
  return (
    <section className="v1-sub" aria-label="Photo of the house" data-deck-photo-step>
      <h3 className="v1-h3">Photo of the house</h3>
      <p className="v1-hint">A picture of the back of the house, taken square on from the yard. The studio finds the wall, the door and the windows, cuts the picture to the wall and sets the {what.toLowerCase()} against it at the right size — then you drag it if it should sit elsewhere. The client&apos;s page shows their own house with it in place.</p>
      <div className="v1-row-acts">
        <button type="button" className={cx("v1-btn", "v1-btn-sm", !design.photo && "v1-btn-primary")} onClick={ph.pickPhoto} disabled={ph.photoBusy} data-deck-photo-add>
          {ph.photoBusy ? (ph.photoStage ?? "Saving the picture…") : design.photo ? "Another photo" : "Add a photo"}
        </button>
        {design.photo ? (
          <>
            <button type="button" className="v1-btn v1-btn-sm" onClick={() => setView("photo")}>Place it on the photo</button>
            <button type="button" className="v1-btn v1-btn-sm v1-btn-danger" onClick={ph.removePhoto}>Remove</button>
          </>
        ) : null}
      </div>
      {ph.photoError ? <p className="v1-call v1-call-bad" role="alert">{ph.photoError}</p> : null}
    </section>
  );
}

/** What the photo is now, for the step's answer. */
export const photoWords = (design: DeckDesign) => (design.photo ? (design.photo.fit && !design.photo.fit.notes[0]?.startsWith("The wall could not") ? "Fitted to the wall" : design.photo.placed ? "Placed on the photo" : "Photo added — place it") : "No photo yet");
