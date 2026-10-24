// THE HOUSE PHOTO, SERVER SIDE (2026-10-23) — server only, shared by the studio's door (actions/deckEstimator, behind
// the studio's gate) and the client's (actions/deckClientDesign, the link's token the key): the picture checked, kept in
// the private store under a folder the caller names, and read by the vision model — the whole picture's look by a
// reasoning model first (OPENAI_HOUSE_MODEL, else gpt-5), the estimators' vision model standing in when the key's
// project lacks it; the close look by the vision model (lib/deck/houseRead).

import { randomUUID } from "node:crypto";
import { logServerError } from "@/lib/server-events";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { friendlyAIError, getVisionModel, isOpenAIEnabled } from "@/lib/sdk/openai";
import { HOUSE_READ_PROMPT, HOUSE_ZOOM_NOTE, parseHouseRead, type HouseRead } from "@/lib/deck/houseRead";
import { putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** The studio shrinks a photo to about 1,600 px before sending it; this is the ceiling, not the aim. */
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

export type DeckPhotoResult = { ok: true; url: string; href: string; w: number; h: number } | { ok: false; error: string };
export type HousePhotoRead = { ok: true; read: HouseRead; /** Which model answered. */ model: string } | { ok: false; error: string; configured: boolean };

/** The picture in a form, checked: a JPEG, PNG or WebP the browser already shrank. */
export function photoOf(form: FormData): { ok: true; file: File } | { ok: false; error: string } {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No picture was sent." };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Use a JPEG, PNG or WebP picture." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "That picture is too big — it should have been shrunk first. Try again." };
  return { ok: true, file };
}

/**
 * The picture kept in the PRIVATE store under `folder` (it ends with "/"). Back come the stored URL and a 15-minute
 * read link. `inline: false` — a caller whose design cannot carry a picture as a data URL (the client's, saved as it
 * goes) — gets an empty URL when the server has no file store, and keeps the house without the picture.
 */
export async function keepHousePhoto(form: FormData, folder: string, logAs: { organizationId: string }, opts: { inline?: boolean } = {}): Promise<DeckPhotoResult> {
  const p = photoOf(form);
  if (!p.ok) return p;
  const w = Math.round(Number(form.get("w")));
  const h = Math.round(Number(form.get("h")));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 20000 || h > 20000) return { ok: false, error: "The picture's size could not be read." };
  try {
    const ext = p.file.type === "image/png" ? "png" : p.file.type === "image/webp" ? "webp" : "jpg";
    const body = Buffer.from(await p.file.arrayBuffer());
    const stored = await putPrivate(`${folder}${randomUUID()}.${ext}`, body, p.file.type);
    if (stored.mode === "inline" && opts.inline === false) return { ok: true, url: "", href: "", w, h };
    const href = mediaHref(stored.url) ?? stored.url;
    return { ok: true, url: stored.url, href, w, h };
  } catch (err) {
    logServerError("deck-photo", err, { kind: "action", organizationId: logAs.organizationId });
    return { ok: false, error: "The picture could not be saved. Try again in a moment." };
  }
}

/**
 * THE HOUSE READ OFF ITS PHOTO (2026-10-23): the vision model looks at the picture of the back wall and says the wall's
 * lines and what the 3D house needs besides — every door and window, the roof's shape, the cladding, the wall's sections
 * (lib/deck/houseRead HOUSE_READ_PROMPT). `look=close` in the form: the wall cut out and enlarged (HOUSE_ZOOM_NOTE).
 */
export async function readHouseImage(form: FormData, logAs: { organizationId: string }): Promise<HousePhotoRead> {
  const p = photoOf(form);
  if (!p.ok) return { ...p, configured: true };
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the picture needs the AI key on the server.", configured: false };
  try {
    const dataUrl = `data:${p.file.type};base64,${Buffer.from(await p.file.arrayBuffer()).toString("base64")}`;
    const close = form.get("look") === "close";
    const ask = (model?: string) => runVisionJson<unknown>({ model, systemPrompt: close ? `${HOUSE_READ_PROMPT}\n${HOUSE_ZOOM_NOTE}` : HOUSE_READ_PROMPT, userPrompt: close ? "Read the house's wall in this close picture and answer with the JSON." : "Read this photo of the house and answer with the JSON.", imageUrl: dataUrl, detail: "high" });
    let raw: unknown = null;
    let model = getVisionModel();
    const strong = close ? null : process.env.OPENAI_HOUSE_MODEL?.trim() || "gpt-5";
    if (strong) {
      try {
        raw = await ask(strong);
        model = strong;
      } catch (err) {
        logServerError("deck-house-read-model", err, { kind: "action", organizationId: logAs.organizationId });
      }
    }
    if (!parseHouseRead(raw)) {
      raw = await ask();
      model = getVisionModel();
    }
    const read = parseHouseRead(raw);
    if (!read) return { ok: false, error: "The house's wall could not be found in that picture — take it square on from the yard, the whole wall in it.", configured: true };
    return { ok: true, read, model };
  } catch (err) {
    logServerError("deck-house-read", err, { kind: "action", organizationId: logAs.organizationId });
    return { ok: false, error: friendlyAIError(err, "deck-house-read"), configured: true };
  }
}
