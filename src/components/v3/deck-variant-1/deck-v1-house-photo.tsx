"use client";
// THE HOUSE BUILT FROM ITS PHOTO, in Variant 1's House step (2026-10-23). Owner: "when I upload the picture of my back
// wall … get from that picture approximate shape already, and even windows and where the doors is, and if there is any
// jogs … apply it to the 3D shaper … the client will just give the back wall picture … and we just upload it" — "and
// contractor can upload the picture as well". And: "if picture comes with a roof, with the porch roof, and old deck,
// show it on the 3D shaper as well … with one click you just remove it and build new one".
//
// Three ways in — a photo from the computer or the phone, the phone's camera, a photo a client already put in their job
// folder — one way through: the picture shrunk, its black bands cut, read once by the vision model (actions
// readHousePhoto), straightened when it was taken at an angle, its wall's colour and its roof's measured off its own
// pixels, saved; then "Here's what I see": the picture with every line the read found, each one draggable, and the
// house that would be built, in words; "Build my house" lays it over the design (lib/deck/houseFromPhoto). The photo
// stays beside the wall drawing to look back at — never pasted on the wall in the 3D (owner, 2026-10-11).
//
// Under it, WHAT'S THERE NOW: the old deck, the patio roof, the slab the picture showed, each drawn as it stands until
// "Tear it out" takes it off the 3D and puts its tear-out in the price; "Clear it all away" does all of them at once.

import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, ImagePlus, RotateCcw, Trash2, Users, X } from "lucide-react";
import type { DeckDesign } from "@/lib/deck/design";
import type { DeckPatch } from "@/lib/deck/checks";
import {
  EXISTING_LABEL,
  EXISTING_LIMITS,
  existingSqFt,
  isHouseHex,
  type HouseExisting,
  type HousePhoto,
} from "@/lib/deck/house";
import {
  addReadDoor,
  addReadJog,
  addReadWindow,
  blankHouseRead,
  flipReadJog,
  mapHouseRead,
  moveHouseMark,
  removeReadDoor,
  removeReadJog,
  removeReadWindow,
  type HouseMark,
  type HouseRead,
} from "@/lib/deck/houseRead";
import {
  colourZones,
  dominantColour,
  ftIn,
  houseFromPhoto,
  type PhotoHouse,
} from "@/lib/deck/houseFromPhoto";
import {
  applyHomography,
  autoRectify,
  transformRead,
} from "@/lib/deck/photoFit";
import {
  deckClientPhotoData,
  deckClientPhotos,
  deckPhotoHref,
  readHousePhoto,
  uploadDeckPhoto,
  type ClientPhoto,
} from "@/actions/deckEstimator";
import {
  shrinkPhoto,
  straightenPhoto,
  trimLetterbox,
} from "@/components/v3/deck-estimator-blueprint/deck-photo";
import { NumberInput, Toggle, cx, feetText, parseFeet } from "./deck-v1-parts";

export interface HouseReview {
  url: string;
  href: string;
  w: number;
  h: number;
  read: HouseRead;
  measured: { siding: string | null; roof: string | null };
  wallWidthFt: number | null;
  useHeight: boolean;
  veneer: boolean;
  /** How far off square the shot was, percent, when it was straightened. */
  straightened: number | null;
  /** The picture could not be read: the lines are a start to drag onto the wall. */
  byHand: string | null;
}

export interface HousePhotoState {
  busy: string | null;
  error: string | null;
  review: HouseReview | null;
  setReview: React.Dispatch<React.SetStateAction<HouseReview | null>>;
  built: PhotoHouse | null;
  thumb: string | null;
  /** The two hidden file inputs, as callback refs (the elements are kept in state): a picture, and the phone's camera. */
  setFileInput: (el: HTMLInputElement | null) => void;
  setCamInput: (el: HTMLInputElement | null) => void;
  pickFile: () => void;
  pickCamera: () => void;
  onFile: (file: File | null) => void;
  clientPhotos: ClientPhoto[] | null;
  openClientPhotos: () => Promise<void>;
  closeClientPhotos: () => void;
  pickClientPhoto: (id: string) => Promise<void>;
  build: () => void;
  lookAgain: () => Promise<void>;
  removePhoto: () => void;
  setTearOut: (id: string, on: boolean) => void;
  clearAll: () => void;
  setExistingDepth: (id: string, depthFt: number) => void;
}

function loadImg(
  file: Blob,
): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () =>
      resolve({ img: el, release: () => URL.revokeObjectURL(url) });
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("That picture could not be opened — use a JPEG or PNG."),
      );
    };
    el.src = url;
  });
}

/** The wall's colour and the roof's, off the picture's own pixels (lib/deck/houseFromPhoto colourZones + dominantColour). */
async function measureColours(
  file: Blob,
  read: HouseRead,
): Promise<{ siding: string | null; roof: string | null }> {
  const none = { siding: null, roof: null };
  try {
    const { img, release } = await loadImg(file);
    try {
      const W = 360;
      const H = Math.max(
        16,
        Math.round((W * img.naturalHeight) / Math.max(1, img.naturalWidth)),
      );
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return none;
      g.drawImage(img, 0, 0, W, H);
      const data = g.getImageData(0, 0, W, H).data;
      const z = colourZones(read, W, H);
      const wall: number[] = [];
      const roof: number[] = [];
      for (
        let y = Math.max(0, Math.floor(z.box.y0 * H));
        y < Math.min(H, Math.ceil(z.box.y1 * H));
        y += 2
      ) {
        for (
          let x = Math.max(0, Math.floor(z.box.x0 * W));
          x < Math.min(W, Math.ceil(z.box.x1 * W));
          x += 2
        ) {
          const fx = (x + 0.5) / W;
          const fy = (y + 0.5) / H;
          const i = (y * W + x) * 4;
          if (z.wall(fx, fy)) wall.push(data[i], data[i + 1], data[i + 2]);
          else if (z.roof?.(fx, fy))
            roof.push(data[i], data[i + 1], data[i + 2]);
        }
      }
      const siding = dominantColour(wall);
      let roofHex = dominantColour(roof, { maxSat: 0.25 });
      // The sky or a pale soffit is not the roof: a roof reads darker than this.
      if (roofHex && luma(roofHex) > 0.6) roofHex = null;
      return { siding, roof: roofHex };
    } finally {
      release();
    }
  } catch {
    return none;
  }
}
const luma = (hex: string) =>
  (0.299 * parseInt(hex.slice(1, 3), 16) +
    0.587 * parseInt(hex.slice(3, 5), 16) +
    0.114 * parseInt(hex.slice(5, 7), 16)) /
  255;

export function useHousePhoto({
  design,
  patch,
  clientId,
  onBuilt,
}: {
  design: DeckDesign;
  patch: (p: DeckPatch, keys?: string[]) => void;
  clientId?: string;
  onBuilt?: () => void;
}): HousePhotoState {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [review, setReview] = React.useState<HouseReview | null>(null);
  const [clientPhotos, setClientPhotos] = React.useState<ClientPhoto[] | null>(
    null,
  );
  const [thumb, setThumb] = React.useState<string | null>(null);
  const [fileInput, setFileInput] = React.useState<HTMLInputElement | null>(
    null,
  );
  const [camInput, setCamInput] = React.useState<HTMLInputElement | null>(null);
  const photo = design.house.photo ?? null;

  // The saved picture's link (the stored URL never goes to the browser as is).
  React.useEffect(() => {
    let live = true;
    if (!photo?.url) {
      queueMicrotask(() => live && setThumb(null));
      return;
    }
    void deckPhotoHref(photo.url).then((h) => live && setThumb(h));
    return () => {
      live = false;
    };
  }, [photo?.url]);

  const built = React.useMemo(
    () =>
      review
        ? houseFromPhoto({
            read: review.read,
            photoW: review.w,
            photoH: review.h,
            deckWidthFt: design.shape.widthFt,
            house: design.house,
            wallWidthFt: review.wallWidthFt,
            measured: review.measured,
          })
        : null,
    [review, design.shape.widthFt, design.house],
  );

  const fromFile = async (file: File) => {
    setBusy("Reading the picture…");
    setError(null);
    setClientPhotos(null);
    try {
      const small = await shrinkPhoto(file);
      const clean = await trimLetterbox(small.file, small.w, small.h);
      setBusy("Finding the wall, the windows and the doors…");
      const form = new FormData();
      form.set("file", clean.file);
      const res = await readHousePhoto(form);
      let image: { file: File; w: number; h: number } = clean;
      let read: HouseRead = blankHouseRead();
      let straightened: number | null = null;
      let byHand: string | null = null;
      if (res.ok) {
        read = res.read;
        // An angled shot is straightened first (lib/deck/photoFit autoRectify), so a foot is a foot across the wall.
        const plan = autoRectify(read, clean.w, clean.h);
        if (plan) {
          setBusy("Straightening the picture…");
          const warped = await straightenPhoto(
            clean.file,
            plan.H,
            { w: plan.w, h: plan.h },
            { w: clean.w, h: clean.h },
          ).catch(() => null);
          if (warped) {
            const pt = (p: { x: number; y: number }) => {
              const m = applyHomography(plan.H, {
                x: p.x * clean.w,
                y: p.y * clean.h,
              });
              return { x: m.x / warped.w, y: m.y / warped.h };
            };
            read = mapHouseRead(
              read,
              (r) =>
                transformRead(r, plan.H, clean.w, clean.h, warped.w, warped.h),
              pt,
            );
            image = warped;
            straightened = plan.obliquePct;
          }
        }
      } else
        byHand = res.configured
          ? `${res.error} Drag the lines onto the wall, then add the windows and the door.`
          : "The picture can't be read here — drag the lines onto the wall, then add the windows and the door.";
      setBusy("Matching the colours…");
      const measured = res.ok
        ? await measureColours(image.file, read)
        : { siding: null, roof: null };
      setBusy("Saving the picture…");
      const up = new FormData();
      up.set("file", image.file);
      up.set("w", String(image.w));
      up.set("h", String(image.h));
      const saved = await uploadDeckPhoto(up);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setReview({
        url: saved.url,
        href: saved.href,
        w: saved.w,
        h: saved.h,
        read,
        measured,
        wallWidthFt: null,
        useHeight: true,
        veneer: true,
        straightened,
        byHand,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The picture could not be read.",
      );
    } finally {
      setBusy(null);
      if (fileInput) fileInput.value = "";
      if (camInput) camInput.value = "";
    }
  };
  const onFile = (file: File | null) => {
    if (file && !busy) void fromFile(file);
  };

  const openClientPhotos = async () => {
    setError(null);
    setBusy("Finding your clients' photos…");
    const res = await deckClientPhotos({ clientId: clientId ?? null }).catch(
      () => null,
    );
    setBusy(null);
    if (!res || !res.ok) {
      setError(
        res && !res.ok
          ? res.error
          : "The clients' photos could not be read right now.",
      );
      return;
    }
    setClientPhotos(res.photos);
  };
  const pickClientPhoto = async (id: string) => {
    setBusy("Opening the photo…");
    const res = await deckClientPhotoData(id).catch(() => null);
    if (!res || !res.ok) {
      setBusy(null);
      setError(res && !res.ok ? res.error : "That photo could not be opened.");
      return;
    }
    const blob = await fetch(res.dataUrl).then((r) => r.blob());
    await fromFile(
      new File([blob], res.name || "house.jpg", {
        type: blob.type || "image/jpeg",
      }),
    );
  };

  /** The house the review shows, laid over the design: the photo kept with it, what was torn out before kept torn out. */
  const build = () => {
    if (!review || !built) return;
    const before = new Map((design.house.existing ?? []).map((e) => [e.id, e]));
    const existing = (built.house.existing ?? []).map((e) =>
      before.get(e.id)?.tearOut ? { ...e, tearOut: true } : e,
    );
    const kept: HousePhoto = {
      url: review.url,
      w: review.w,
      h: review.h,
      read: review.read,
      wallFt: built.wallFt,
      by: built.scale.by,
      deckAtFt: built.deckAtFt,
      at: new Date().toISOString(),
    };
    const p: DeckPatch = { house: { ...built.house, existing, photo: kept } };
    if (review.useHeight && built.heightIn) p.heightIn = built.heightIn;
    const veneer =
      built.house.material === "brick" || built.house.material === "stone";
    if (veneer && review.veneer) p.wall = "brick-veneer";
    const torn = existing.find((e) => e.kind === "deck" && e.tearOut);
    if (torn)
      p.extras = {
        demoSqFt: Math.max(design.extras.demoSqFt, existingSqFt(torn)),
      };
    patch(p, ["house-photo", ...(p.heightIn ? ["height"] : [])]);
    setReview(null);
    onBuilt?.();
  };

  /** The review again, from the saved picture and its read — no second look by the model. */
  const lookAgain = async () => {
    if (!photo) return;
    const href = thumb ?? (await deckPhotoHref(photo.url).catch(() => null));
    if (!href) {
      setError("The saved picture could not be opened — upload it again.");
      return;
    }
    const own = (v: string) => (isHouseHex(v) ? v : null);
    setReview({
      url: photo.url,
      href,
      w: photo.w,
      h: photo.h,
      read: photo.read ?? blankHouseRead(),
      measured: {
        siding: own(design.house.siding),
        roof: own(design.house.roofColour),
      },
      wallWidthFt: photo.by === "width" ? photo.wallFt : null,
      useHeight: false,
      veneer: design.wall === "brick-veneer",
      straightened: null,
      byHand: photo.read
        ? null
        : "Drag the lines onto the wall, then add the windows and the door.",
    });
  };
  const removePhoto = () => patch({ house: { photo: null } });

  // WHAT'S THERE NOW — kept, or torn out with one click. An old deck's tear-out is the design's own line (Extras →
  // tear-out); a patio roof's and a slab's are priced from the house itself (lib/deck/pricing).
  const list = design.house.existing ?? [];
  const tearPatch = (next: HouseExisting[]): DeckPatch => {
    const p: DeckPatch = { house: { existing: next } };
    const was = list
      .filter((e) => e.kind === "deck" && e.tearOut)
      .reduce((a, e) => a + existingSqFt(e), 0);
    const now = next
      .filter((e) => e.kind === "deck" && e.tearOut)
      .reduce((a, e) => a + existingSqFt(e), 0);
    if (was !== now)
      p.extras = {
        demoSqFt: Math.max(
          0,
          Math.min(4000, design.extras.demoSqFt - was + now),
        ),
      };
    return p;
  };
  const setTearOut = (id: string, on: boolean) =>
    patch(
      tearPatch(list.map((e) => (e.id === id ? { ...e, tearOut: on } : e))),
    );
  const clearAll = () =>
    patch(tearPatch(list.map((e) => ({ ...e, tearOut: true }))));
  const setExistingDepth = (id: string, depthFt: number) =>
    patch(tearPatch(list.map((e) => (e.id === id ? { ...e, depthFt } : e))));

  return {
    busy,
    error,
    review,
    setReview,
    built,
    thumb,
    setFileInput,
    setCamInput,
    pickFile: () => fileInput?.click(),
    pickCamera: () => camInput?.click(),
    onFile,
    clientPhotos,
    openClientPhotos,
    closeClientPhotos: () => setClientPhotos(null),
    pickClientPhoto,
    build,
    lookAgain,
    removePhoto,
    setTearOut,
    clearAll,
    setExistingDepth,
  };
}

/* ── The card at the top of the House step ─────────────────────────────── */

/** The two hidden file inputs: a picture from the phone or the computer, and the phone's camera. */
function PhotoInputs({
  fileInput,
  camInput,
  onFile,
}: {
  fileInput: (el: HTMLInputElement | null) => void;
  camInput: (el: HTMLInputElement | null) => void;
  onFile: (file: File | null) => void;
}) {
  return (
    <>
      <input
        ref={fileInput}
        className="v1-file-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        data-deck-house-photo-input
      />
      <input
        ref={camInput}
        className="v1-file-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </>
  );
}

export function HousePhotoCard({
  hp,
  design,
}: {
  hp: HousePhotoState;
  design: DeckDesign;
}) {
  const photo = design.house.photo ?? null;
  const n = design.house.openings?.length ?? 0;
  const wins =
    design.house.openings?.filter((o) => o.kind === "window").length ?? 0;
  return (
    <div
      className="v1-hp-card"
      data-deck-house-photo={photo ? "built" : "none"}
    >
      {photo ? (
        <div className="v1-hp-built">
          {hp.thumb ? (
            <button
              type="button"
              className="v1-hp-thumb"
              onClick={() => void hp.lookAgain()}
              aria-label="Look at the photo again"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind this app's own signed link */}
              <img src={hp.thumb} alt="The back of the house" />
            </button>
          ) : (
            <span className="v1-hp-thumb" aria-hidden="true" />
          )}
          <div className="v1-hp-built-text">
            <b>Built from the photo</b>
            <span>
              ≈ {ftIn(Math.round(photo.wallFt * 2) / 2)} wall · {wins}{" "}
              {wins === 1 ? "window" : "windows"}
              {n - wins
                ? ` · ${n - wins} ${n - wins === 1 ? "door" : "doors"}`
                : ""}{" "}
              · {design.house.storeys === 2 ? "two storeys" : "one storey"}
            </span>
            <div className="v1-row-acts">
              <button
                type="button"
                className="v1-btn v1-btn-sm"
                onClick={() => void hp.lookAgain()}
                data-deck-house-photo-again
              >
                <RotateCcw size={15} aria-hidden="true" /> Look again
              </button>
              <button
                type="button"
                className="v1-btn v1-btn-sm"
                onClick={hp.pickFile}
                disabled={!!hp.busy}
              >
                <ImagePlus size={15} aria-hidden="true" /> New photo
              </button>
              <button
                type="button"
                className="v1-btn v1-btn-sm v1-btn-quiet"
                onClick={hp.removePhoto}
                title="The house stays as it was built"
              >
                Remove the photo
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="v1-hp-lead">
            <b>Build the house from a photo</b>
            <span>
              The back (or side) wall where the deck goes — the client&rsquo;s
              picture or yours. The wall, its steps, the windows and doors, the
              storeys, the roof and the colour come off it; then adjust
              anything.
            </span>
          </div>
          <div className="v1-row-acts">
            <button
              type="button"
              className="v1-btn v1-btn-sm v1-btn-primary"
              onClick={hp.pickFile}
              disabled={!!hp.busy}
              data-deck-house-photo-upload
            >
              <ImagePlus size={15} aria-hidden="true" /> Upload a photo
            </button>
            <button
              type="button"
              className="v1-btn v1-btn-sm"
              onClick={hp.pickCamera}
              disabled={!!hp.busy}
              data-deck-house-photo-camera
            >
              <Camera size={15} aria-hidden="true" /> Take a photo
            </button>
            <button
              type="button"
              className="v1-btn v1-btn-sm"
              onClick={() => void hp.openClientPhotos()}
              disabled={!!hp.busy}
              data-deck-house-photo-clients
            >
              <Users size={15} aria-hidden="true" /> Client&rsquo;s photos
            </button>
          </div>
        </>
      )}
      <PhotoInputs
        fileInput={hp.setFileInput}
        camInput={hp.setCamInput}
        onFile={hp.onFile}
      />
      {hp.busy ? (
        <p className="v1-hint" role="status" data-deck-house-photo-busy>
          {hp.busy}
        </p>
      ) : null}
      {hp.error ? <p className="v1-call v1-call-bad">{hp.error}</p> : null}
      {hp.clientPhotos ? (
        <div className="v1-hp-clients" data-deck-house-photo-client-list>
          <div className="v1-pop-head">
            <b>Photos your clients sent</b>
            <button
              type="button"
              className="v1-icon-btn"
              onClick={hp.closeClientPhotos}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {hp.clientPhotos.length ? (
            hp.clientPhotos.map((p) => (
              <button
                key={p.id}
                type="button"
                className="v1-hp-client-row"
                onClick={() => void hp.pickClientPhoto(p.id)}
                disabled={!!hp.busy}
              >
                <span>
                  <b>{p.from}</b>
                  {p.mine ? (
                    <span className="v1-stamp is-info">This client</span>
                  ) : null}
                </span>
                <span className="v1-meta">
                  {p.name} ·{" "}
                  {new Date(p.at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            ))
          ) : (
            <p className="v1-hint">
              No photos from clients yet. A homeowner adds them to the job
              folder on their request; or upload one here.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── What stands there now ────────────────────────────────────────────── */

const EXISTING_WORDS: Record<HouseExisting["kind"], string> = {
  deck: "Tear-out and haul-away of the old deck",
  cover: "Tear-out of the old patio roof and its posts",
  slab: "Break-out of the concrete patio",
};

export function ExistingList({
  hp,
  design,
}: {
  hp: HousePhotoState;
  design: DeckDesign;
}) {
  const list = design.house.existing ?? [];
  if (!list.length) return null;
  const standing = list.filter((e) => !e.tearOut);
  return (
    <div className="v1-hp-existing" data-deck-existing>
      <div className="v1-hp-existing-head">
        <b>What&rsquo;s there now</b>
        {standing.length > 1 ? (
          <button
            type="button"
            className="v1-btn v1-btn-sm v1-btn-danger"
            onClick={hp.clearAll}
            data-deck-existing-clear
          >
            <Trash2 size={15} aria-hidden="true" /> Clear it all away
          </button>
        ) : null}
      </div>
      {list.map((e) => (
        <div
          key={e.id}
          className={cx("v1-hp-exist-row", e.tearOut && "is-torn")}
          data-deck-existing-item={e.kind}
          data-deck-existing-torn={e.tearOut || undefined}
        >
          <div className="v1-hp-exist-text">
            <b>{EXISTING_LABEL[e.kind]}</b>
            <span className="v1-meta">
              {ftIn(Math.round((e.x1Ft - e.x0Ft) * 2) / 2)} along the wall ×{" "}
              {ftIn(e.depthFt)} out · {existingSqFt(e)} sq ft
              {e.tearOut
                ? ` — ${EXISTING_WORDS[e.kind].toLowerCase()} is in the price`
                : ""}
            </span>
          </div>
          <label className="v1-hp-exist-depth">
            <span className="v1-lbl">Out</span>
            <NumberInput
              label={`How far the ${EXISTING_LABEL[e.kind].toLowerCase()} reaches out, feet`}
              value={e.depthFt}
              parse={parseFeet}
              format={feetText}
              min={EXISTING_LIMITS.depthFt.min}
              max={EXISTING_LIMITS.depthFt.max}
              onCommit={(n) => hp.setExistingDepth(e.id, n)}
            />
          </label>
          {e.tearOut ? (
            <button
              type="button"
              className="v1-btn v1-btn-sm v1-btn-quiet"
              onClick={() => hp.setTearOut(e.id, false)}
              data-deck-existing-keep
            >
              Keep it
            </button>
          ) : (
            <button
              type="button"
              className="v1-btn v1-btn-sm v1-btn-danger"
              onClick={() => hp.setTearOut(e.id, true)}
              data-deck-existing-tear
            >
              Tear it out
            </button>
          )}
        </div>
      ))}
      <p className="v1-hint">
        How far each reaches out can&rsquo;t be seen in a picture taken from the
        front — set it here.
      </p>
    </div>
  );
}

/* ── "Here's what I see" — the review ─────────────────────────────────── */

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
type Sel = { kind: "win" | "door" | "jog"; i: number } | null;

export function HousePhotoReview({
  hp,
  design,
}: {
  hp: HousePhotoState;
  design: DeckDesign;
}) {
  const r = hp.review;
  const stageRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    mark: HouseMark;
    moved: boolean;
    x: number;
    y: number;
    sel: Sel;
  } | null>(null);
  const [sel, setSel] = React.useState<Sel>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!r) return;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hp.setReview(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [r, hp]);
  if (!r) return null;
  const read = r.read;
  const b = hp.built;
  const setRead = (next: HouseRead) =>
    hp.setReview((v) => (v ? { ...v, read: next } : v));
  const at = (e: React.PointerEvent) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: (e.clientX - box.left) / Math.max(1, box.width),
      y: (e.clientY - box.top) / Math.max(1, box.height),
    };
  };
  const begin = (mark: HouseMark, s: Sel) => (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { mark, moved: false, x: e.clientX, y: e.clientY, sel: s };
    stageRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    setRead(moveHouseMark(read, d.mark, at(e)));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setSel(d.sel);
  };
  const handle = (
    mark: HouseMark,
    x: number,
    y: number,
    label: string,
    s: Sel = null,
    cls = "",
  ) => (
    <button
      key={mark}
      type="button"
      className={cx(
        "v1-hp-handle",
        cls,
        s && sel && s.kind === sel.kind && s.i === sel.i && "is-sel",
      )}
      style={{ left: pct(x), top: pct(y) }}
      aria-label={label}
      onPointerDown={begin(mark, s)}
      data-house-mark={mark}
    />
  );
  const removeSel = () => {
    if (!sel) return;
    if (sel.kind === "win") setRead(removeReadWindow(read, sel.i));
    else if (sel.kind === "door") setRead(removeReadDoor(read, sel.i));
    else setRead(removeReadJog(read, sel.i));
    setSel(null);
  };
  const veneer = b?.house.material === "brick" || b?.house.material === "stone";
  // On the page itself, above the app's sidebar (the studio's own layer sits under it), in the studio's style scope.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="jf-deck-v1 v1-hp-portal" data-nest>
      <div
        className="v1-hp-scrim"
        role="dialog"
        aria-modal="true"
        aria-label="The house read off the photo"
        data-deck-house-review
      >
        <div className="v1-hp-sheet">
          <div className="v1-hp-head">
            <div>
              <h3 className="v1-h3">Here&rsquo;s what I see</h3>
              <span className="v1-meta">
                {r.byHand
                  ? "Marked by hand"
                  : `Read off the photo${r.straightened ? ` · straightened (the shot was ${r.straightened}% off square)` : ""}`}{" "}
                — drag any line that&rsquo;s off; tap a window, a door or a step
                to remove it.
              </span>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="v1-icon-btn"
              onClick={() => hp.setReview(null)}
              aria-label="Close without building"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="v1-hp-body">
            <div className="v1-hp-picwrap">
              <div
                ref={stageRef}
                className="v1-hp-pic"
                style={
                  {
                    "--ar": `${r.w} / ${r.h}`,
                    "--arn": r.w / r.h,
                  } as React.CSSProperties
                }
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                data-deck-house-review-pic
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind this app's own signed link */}
                <img
                  src={r.href}
                  alt="The back of the house"
                  draggable={false}
                />
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    className="v1-hp-l-base"
                    x1={read.base.left.x * 1000}
                    y1={read.base.left.y * 1000}
                    x2={read.base.right.x * 1000}
                    y2={read.base.right.y * 1000}
                  />
                  {read.eave ? (
                    <line
                      className="v1-hp-l-eave"
                      x1={read.eave.left.x * 1000}
                      y1={read.eave.left.y * 1000}
                      x2={read.eave.right.x * 1000}
                      y2={read.eave.right.y * 1000}
                    />
                  ) : null}
                  {read.eave ? (
                    <>
                      <line
                        className="v1-hp-l-side"
                        x1={read.base.left.x * 1000}
                        y1={read.base.left.y * 1000}
                        x2={read.eave.left.x * 1000}
                        y2={read.eave.left.y * 1000}
                      />
                      <line
                        className="v1-hp-l-side"
                        x1={read.base.right.x * 1000}
                        y1={read.base.right.y * 1000}
                        x2={read.eave.right.x * 1000}
                        y2={read.eave.right.y * 1000}
                      />
                    </>
                  ) : null}
                  {read.patio ? (
                    <line
                      className="v1-hp-l-patio"
                      x1={read.patio.x0 * 1000}
                      y1={(read.base.left.y + 0.012) * 1000}
                      x2={read.patio.x1 * 1000}
                      y2={(read.base.left.y + 0.012) * 1000}
                    />
                  ) : null}
                  {read.oldDeck ? (
                    <rect
                      className="v1-hp-l-exist"
                      x={read.oldDeck.x0 * 1000}
                      y={(read.oldDeck.top ?? read.base.left.y - 0.04) * 1000}
                      width={(read.oldDeck.x1 - read.oldDeck.x0) * 1000}
                      height={Math.max(
                        8,
                        (read.base.left.y -
                          (read.oldDeck.top ?? read.base.left.y - 0.04)) *
                          1000,
                      )}
                    />
                  ) : null}
                  {read.cover ? (
                    <rect
                      className="v1-hp-l-exist"
                      x={read.cover.x0 * 1000}
                      y={read.cover.top * 1000}
                      width={(read.cover.x1 - read.cover.x0) * 1000}
                      height={(read.cover.bottom - read.cover.top) * 1000}
                    />
                  ) : null}
                  {read.windows.map((w, i) => (
                    <rect
                      key={`w${i}`}
                      className={cx(
                        "v1-hp-l-win",
                        sel?.kind === "win" && sel.i === i && "is-sel",
                      )}
                      x={w.x0 * 1000}
                      y={w.head * 1000}
                      width={(w.x1 - w.x0) * 1000}
                      height={(w.sill - w.head) * 1000}
                    />
                  ))}
                  {read.doors.map((d, i) => (
                    <rect
                      key={`d${i}`}
                      className={cx(
                        "v1-hp-l-door",
                        sel?.kind === "door" && sel.i === i && "is-sel",
                      )}
                      x={d.x0 * 1000}
                      y={d.top * 1000}
                      width={(d.x1 - d.x0) * 1000}
                      height={(d.bottom - d.top) * 1000}
                    />
                  ))}
                  {read.jogs.map((j, i) => (
                    <line
                      key={`j${i}`}
                      className={cx(
                        "v1-hp-l-jog",
                        sel?.kind === "jog" && sel.i === i && "is-sel",
                      )}
                      x1={j.x * 1000}
                      y1={
                        (read.eave
                          ? read.eave.left.y +
                            ((read.eave.right.y - read.eave.left.y) *
                              (j.x - read.eave.left.x)) /
                              Math.max(
                                1e-6,
                                read.eave.right.x - read.eave.left.x,
                              )
                          : j.y - 0.25) * 1000
                      }
                      x2={j.x * 1000}
                      y2={j.y * 1000}
                    />
                  ))}
                </svg>
                {handle(
                  "base-left",
                  read.base.left.x,
                  read.base.left.y,
                  "The wall's base, left corner",
                  null,
                  "is-corner",
                )}
                {handle(
                  "base-right",
                  read.base.right.x,
                  read.base.right.y,
                  "The wall's base, right corner",
                  null,
                  "is-corner",
                )}
                {read.eave
                  ? handle(
                      "eave-left",
                      read.eave.left.x,
                      read.eave.left.y,
                      "The eave, left end",
                      null,
                      "is-corner",
                    )
                  : null}
                {read.eave
                  ? handle(
                      "eave-right",
                      read.eave.right.x,
                      read.eave.right.y,
                      "The eave, right end",
                      null,
                      "is-corner",
                    )
                  : null}
                {read.jogs.map((j, i) =>
                  handle(
                    `jog-${i}`,
                    j.x,
                    j.y,
                    `Step ${i + 1} in the wall`,
                    { kind: "jog", i },
                    "is-jog",
                  ),
                )}
                {read.doors.map((d, i) => (
                  <React.Fragment key={`dh${i}`}>
                    {handle(
                      `door-${i}`,
                      (d.x0 + d.x1) / 2,
                      d.bottom,
                      `Door ${i + 1} — its threshold`,
                      { kind: "door", i },
                      "is-door",
                    )}
                    {handle(
                      `door-top-${i}`,
                      (d.x0 + d.x1) / 2,
                      d.top,
                      `Door ${i + 1} — its top`,
                      { kind: "door", i },
                      "is-door is-small",
                    )}
                  </React.Fragment>
                ))}
                {read.windows.map((w, i) =>
                  handle(
                    `win-${i}`,
                    (w.x0 + w.x1) / 2,
                    (w.head + w.sill) / 2,
                    `Window ${i + 1}`,
                    { kind: "win", i },
                    "is-win",
                  ),
                )}
              </div>
              <div className="v1-row-acts v1-hp-tools">
                <button
                  type="button"
                  className="v1-btn v1-btn-sm"
                  onClick={() => setRead(addReadWindow(read, r.w, r.h))}
                  data-deck-house-review-add-window
                >
                  + Window
                </button>
                <button
                  type="button"
                  className="v1-btn v1-btn-sm"
                  onClick={() => setRead(addReadDoor(read, r.w, r.h))}
                  data-deck-house-review-add-door
                >
                  + Door
                </button>
                <button
                  type="button"
                  className="v1-btn v1-btn-sm"
                  onClick={() => setRead(addReadJog(read))}
                  disabled={read.jogs.length >= 4}
                >
                  + Step
                </button>
                {sel?.kind === "jog" ? (
                  <button
                    type="button"
                    className="v1-btn v1-btn-sm"
                    onClick={() => setRead(flipReadJog(read, sel.i))}
                  >
                    {read.jogs[sel.i]?.dir === "toward"
                      ? "It comes out → steps back"
                      : "It steps back → comes out"}
                  </button>
                ) : null}
                {sel ? (
                  <button
                    type="button"
                    className="v1-btn v1-btn-sm v1-btn-danger"
                    onClick={removeSel}
                    data-deck-house-review-remove
                  >
                    Remove the{" "}
                    {sel.kind === "win"
                      ? "window"
                      : sel.kind === "door"
                        ? "door"
                        : "step"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="v1-hp-side">
              {r.byHand ? (
                <p className="v1-call v1-call-warn">{r.byHand}</p>
              ) : null}
              {b ? (
                <ul className="v1-hp-facts" data-deck-house-review-facts>
                  {b.facts.map((f) => (
                    <li key={f.id} data-fact={f.id}>
                      <span className="v1-lbl">{f.label}</span>
                      <span className="v1-hp-fact">
                        {f.swatch ? (
                          <span
                            className="v1-swatch"
                            style={{ background: f.swatch }}
                            aria-hidden="true"
                          />
                        ) : null}
                        {f.value}
                        {f.guess ? (
                          <span className="v1-stamp is-warn">estimate</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="v1-call v1-call-warn">
                  Nothing in the picture gives a size yet — mark the door, or
                  type the wall&rsquo;s width below.
                </p>
              )}
              <label className="v1-hp-width">
                <span className="v1-lbl">
                  Measured the wall? Its width corner to corner
                </span>
                <NumberInput
                  label="The wall's width, corner to corner, feet"
                  value={r.wallWidthFt ?? 0}
                  parse={(t) => (t.trim() === "" ? 0 : parseFeet(t))}
                  format={(n) => (n > 0 ? feetText(n) : "")}
                  min={0}
                  max={200}
                  onCommit={(n) =>
                    hp.setReview((v) =>
                      v ? { ...v, wallWidthFt: n >= 4 ? n : null } : v,
                    )
                  }
                />
              </label>
              {b?.heightIn ? (
                <Toggle
                  checked={r.useHeight}
                  onChange={(on) =>
                    hp.setReview((v) => (v ? { ...v, useHeight: on } : v))
                  }
                >
                  Set the deck&rsquo;s floor from the door — {b.heightIn} in.
                  (an inch under its threshold; now {design.heightIn} in.)
                </Toggle>
              ) : null}
              {veneer ? (
                <Toggle
                  checked={r.veneer}
                  onChange={(on) =>
                    hp.setReview((v) => (v ? { ...v, veneer: on } : v))
                  }
                >
                  The wall is {b?.house.material} veneer — no ledger can be
                  bolted to it: set the house wall to brick veneer.
                </Toggle>
              ) : null}
              {b?.checks.length ? (
                <div
                  className="v1-call v1-call-warn"
                  data-deck-house-review-checks
                >
                  <b>Look at</b>
                  <ul>
                    {b.checks.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="v1-row-acts v1-hp-go">
                <button
                  type="button"
                  className="v1-btn v1-btn-primary"
                  onClick={hp.build}
                  disabled={!b}
                  data-deck-house-build
                >
                  Build my house
                </button>
                <button
                  type="button"
                  className="v1-btn v1-btn-quiet"
                  onClick={() => hp.setReview(null)}
                >
                  Cancel
                </button>
              </div>
              <p className="v1-hint">
                The photo stays with the design to look back at. Everything it
                built can be changed afterwards in the wall drawing and the
                fields below it.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
