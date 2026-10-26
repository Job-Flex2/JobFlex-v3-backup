// THE ROOF A PROPOSAL IS ABOUT (2026-10-26, ticket 8KETUL) — pure: no database, no fetch.
//
// A roof measurement can hold every building on the lot (an apartment complex
// came back as 25). The estimate is about the MAIN building plus the ones the
// contractor ticked in (provenance.mainStructure / provenance.included), so the
// client's picture and its figures are too: the pin goes on the main building,
// the picture is centred on it when the person chose it (their pin, "Make
// main") — otherwise on the measurement's own point, as before — and the area
// is the buildings in the estimate. Read by lib/proposalPictures and the
// public roof-photo route, so the page and the image it loads agree.
import type { InstantRoofData } from "@/lib/eagleview";
import { includedIndicesOf, instantTotalsOf, mainStructureOf } from "@/lib/roofDiagram/instantTotals";
import { roofPinPoint, type LatLng } from "@/lib/roofPictures";

/** How a main building is chosen by the person rather than by the rules. */
const PERSON_CHOSE = new Set(["user-pin", "near-user-pin", "chosen"]);

export interface RoofSubjectRow {
  lat: number | null;
  lng: number | null;
  areaSqft: number | null;
  squares: number | null;
  facetCount: number | null;
  provenanceJson?: string | null;
}

export function roofSubject(
  row: RoofSubjectRow,
  instant: InstantRoofData | null,
): { instant: InstantRoofData | null; lat: number | null; lng: number | null; areaSqft: number | null; squares: number | null; facetCount: number | null } {
  const plain = { instant, lat: row.lat, lng: row.lng, areaSqft: row.areaSqft, squares: row.squares, facetCount: row.facetCount };
  if (!instant?.structures?.length || instant.structures.length < 2) return plain;
  let prov: Record<string, unknown> = {};
  try {
    const parsed = row.provenanceJson ? (JSON.parse(row.provenanceJson) as { provenance?: Record<string, unknown> }) : null;
    prov = parsed?.provenance ?? {};
  } catch {
    prov = {};
  }
  const pick = mainStructureOf({ structures: instant.structures, provenance: prov, origin: { lat: row.lat, lng: row.lng } });
  if (pick.index == null) return plain;
  const main = instant.structures[pick.index];
  // Only the main building's outline is left in the answer the picture reads: its pin goes on that roof.
  const focused: InstantRoofData = { ...instant, structures: [main] };
  const included = includedIndicesOf(prov, instant.structures.length, pick.index).map((i) => instant.structures[i]);
  const totals = included.length ? instantTotalsOf([main, ...included]) : null;
  const centre: LatLng | null = PERSON_CHOSE.has(pick.how) ? roofPinPoint(focused, null) : null;
  return {
    instant: focused,
    lat: centre?.lat ?? row.lat,
    lng: centre?.lng ?? row.lng,
    areaSqft: totals ? totals.areaSqft : row.areaSqft,
    squares: totals ? totals.squares : row.squares,
    facetCount: totals ? totals.facetCount : row.facetCount,
  };
}
