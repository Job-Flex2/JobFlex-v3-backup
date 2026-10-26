// THE PICTURES A PROPOSAL CARRIES TO THE CLIENT (2026-09-23) — server only.
//
// Owner: the client should receive the fence's 3D and layout, and a picture
// of the roof, on the phone and on the desk. One read for both portal
// builds: what pictures this proposal has and where each one is served.
//   fence-scene the fence stood up in 3D on the page itself (2026-09-27):
//               the stored plan and its scene block, served by
//               /api/public-quote/[publicId]/fence-scene and mounted by
//               components/v3/fence-scene — no picture upload, no Blob;
//   fence-3d    the estimator's 3D snapshot (Proposal.beforePhotos, a Blob
//               URL under fence-preview/) — the scene's poster when there is
//               a plan, the only 3D there is when a proposal predates plans;
//   fence-plan  the traced layout (an ActivityEvent FENCE_PLAN), drawn on
//               request by /api/public-quote/[publicId]/fence-plan;
//   roof-look   the roof in the material and colour the contractor chose in the estimator's visualizer
//               (2026-10-25, lib/roofLook) — a PNG on Blob, named by an ActivityEvent ROOF_LOOK;
//   roof-photo  the aerial (EagleView ortho, else Google satellite) with ONE
//               PIN on the roof, when a key is on the server — never the
//               measured outline (owner, 2026-10-12: "remove it and never
//               send any outlines for the roof"); no aerial, no roof picture.
//               The frame is the one that actually loads (2026-10-19, lib/
//               roofPictureFetch): an old order's ortho EagleView refuses →
//               the satellite, its pin projected onto it; neither loads →
//               the stand-in, no pin. The src names the frame for its route;
//   deck-scene  the Deck Studio's deck in 3D (2026-10-04): the scene frozen
//               with the proposal (an ActivityEvent DECK_PLAN), served by
//               /api/public-quote/[publicId]/deck-scene, mounted by
//               components/v3/deck-scene;
//   deck-photo  the contractor's photo of the back of the house (2026-10-10)
//               with the deck's elevation drawn where they placed it, served
//               by /api/public-quote/[publicId]/deck-photo (private store).

import { db } from "@/lib/db";
import type { InstantRoofData } from "@/lib/eagleview";
import { FENCE_PLAN_EVENT, parseFencePlan } from "@/lib/fence/planSvg";
import { DECK_PLAN_EVENT, parseDeckPlan } from "@/lib/deck/convertSchema";
import { deckElevation, defaultPlacement, elevationOverlay } from "@/lib/deck/elevation";
import { roofFactsLine, roofPinOnFrame, roofPinPoint, type RoofFacts } from "@/lib/roofPictures";
import { loadRoofPicture, subjectPin } from "@/lib/roofPictureFetch";
import { roofSubject } from "@/lib/roofSubject";
import type { PortalPicture } from "@/components/v3/mobile-proposal-client/portal-view";

const measuredOn = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The fence 3D snapshot's URL, when the first stored photo is one. */
function fencePreviewUrl(beforePhotos: string | null | undefined): string | null {
  try {
    const arr = JSON.parse(beforePhotos ?? "[]");
    const first = Array.isArray(arr) ? arr[0] : null;
    const url = typeof first === "string" ? first : first && typeof first === "object" && typeof first.url === "string" ? first.url : null;
    return url && /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/fence-preview\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function proposalPictures(p: { id: string; publicId: string; trade?: string | null; beforePhotos?: string | null }): Promise<PortalPicture[]> {
  const out: PortalPicture[] = [];
  const base = `/api/public-quote/${p.publicId}`;

  // ── the fence
  const preview = fencePreviewUrl(p.beforePhotos);
  let plan = null;
  try {
    const ev = await db.activityEvent.findFirst({ where: { proposalId: p.id, kind: FENCE_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    plan = ev?.meta ? parseFencePlan(JSON.parse(ev.meta)) : null;
  } catch {
    plan = null; /* no plan, or the table is not there */
  }
  if (plan) {
    const gates = plan.gates.length;
    const facts = `${plan.typeLabel} · ${plan.heightFt} ft · ${Math.round(plan.totalLf)} ft${gates ? ` · ${gates} ${gates === 1 ? "gate" : "gates"}` : ""}`;
    // The scene first: the page stands the fence up where the picture was.
    out.push({ kind: "fence-scene", src: `${base}/fence-scene`, alt: "Your fence, in 3D", caption: "Your fence, as it will stand", facts, overlay: null, poster: preview });
    out.push({ kind: "fence-plan", src: `${base}/fence-plan`, alt: "Your fence on the lot", caption: "Your fence on the lot", facts, overlay: null });
  } else if (preview) {
    out.push({ kind: "fence-3d", src: preview, alt: "Your fence, in 3D", caption: "Your fence, as it will stand", facts: null, overlay: null });
  }

  // ── the deck
  try {
    const ev = await db.activityEvent.findFirst({ where: { proposalId: p.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    const deck = ev?.meta ? parseDeckPlan(JSON.parse(ev.meta)) : null;
    if (deck) {
      const what = deck.design.structure === "deck" ? "deck" : deck.design.structure === "covered-deck" ? "covered deck" : deck.design.structure;
      out.push({ kind: "deck-scene", src: `${base}/deck-scene`, alt: `Your ${what}, in 3D`, caption: `Your ${what}, as it will stand`, facts: deck.scene.facts || null, overlay: null });
      // The photo of the house with the elevation drawn where the contractor placed it (M2, 2026-10-10).
      const photo = deck.design.photo;
      if (photo) {
        const elev = deckElevation(deck.scene);
        const overlay = elevationOverlay(elev, photo.placed ?? defaultPlacement(), photo.w, photo.h).map((o) => o.points);
        out.push({ kind: "deck-photo", src: `${base}/deck-photo`, alt: `Your house, with the ${what} drawn where it will go`, caption: `Where the ${what} goes`, facts: null, overlay });
      }
    }
  } catch {
    /* no deck, or the row does not read */
  }

  // ── the roof
  try {
    const link = await db.proposalSitePhoto.findUnique({ where: { proposalId: p.id }, select: { roofMeasurementId: true } });
    const row = link
      ? await db.roofMeasurement.findUnique({ where: { id: link.roofMeasurementId }, select: { address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true, provenanceJson: true, areaSqft: true, squares: true, predominantPitch: true, facetCount: true, createdAt: true } })
      : null;
    if (row) {
      let parsed: InstantRoofData | null = null;
      try { parsed = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null; } catch { parsed = null; }
      // The building(s) the estimate is about, not every building on the lot (lib/roofSubject).
      const subject = roofSubject(row, parsed);
      const instant = subject.instant;
      const facts: RoofFacts = { areaSqft: subject.areaSqft, squares: subject.squares, pitch: row.predominantPitch, facetCount: subject.facetCount, measuredOn: measuredOn(row.createdAt) };
      const factsLine = roofFactsLine(facts);
      const shot = await loadRoofPicture({ ...row, lat: subject.lat, lng: subject.lng, instant });
      const frame = shot.frame;
      if (frame) {
        out.push({ kind: "roof-photo", src: `${base}/roof-photo?f=${frame.kind}`, alt: "Your roof from the air, a pin on the house", caption: frame.kind === "ortho" ? "Your roof, as measured from the air" : "Your roof, from the air", facts: factsLine || null, overlay: null, pin: roofPinOnFrame(roofPinPoint(instant, subjectPin(subject)), frame) });
      } else if (shot.frames) {
        out.push({ kind: "roof-photo", src: `${base}/roof-photo?f=standin`, alt: "Your roof", caption: "Your roof", facts: factsLine || null, overlay: null, pin: null });
      }
      // The look the contractor chose in the estimator's visualizer (2026-10-25): the newest ROOF_LOOK for this
      // proposal, else for this measurement — "Your roof in <material · colour>".
      const look = await roofLookPicture(p.id, link!.roofMeasurementId);
      if (look) out.push(look);
    }
  } catch {
    /* the link table is not there, or the measurement is gone */
  }
  return out;
}

export const ROOF_LOOK_EVENT = "ROOF_LOOK";

/** The newest saved look for the proposal (or its measurement), as a picture; null when there is none. */
async function roofLookPicture(proposalId: string, measurementId: string): Promise<PortalPicture | null> {
  try {
    const rows = await db.activityEvent.findMany({ where: { kind: ROOF_LOOK_EVENT, OR: [{ proposalId }, { meta: { contains: measurementId } }] }, orderBy: { createdAt: "desc" }, select: { meta: true }, take: 5 });
    for (const r of rows) {
      const m = r.meta ? (JSON.parse(r.meta) as { url?: unknown; words?: unknown; measurementId?: unknown; source?: unknown }) : null;
      if (!m || typeof m.url !== "string" || !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/roof-look\//i.test(m.url)) continue;
      if (m.measurementId !== measurementId) continue;
      const words = typeof m.words === "string" ? m.words : "";
      const fromAir = m.source !== "photo";
      return { kind: "roof-look", src: m.url, alt: `Your roof in ${words || "the chosen material"}`, caption: fromAir ? `Your roof from the air, in ${words || "the chosen look"}` : `Your roof in ${words || "the chosen look"}`, facts: words || null, overlay: null, pin: null };
    }
  } catch {
    /* no event table, or a bad row — no look */
  }
  return null;
}
