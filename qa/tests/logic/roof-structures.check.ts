// The buildings a roof scan finds (2026-10-16, owner: "a single family, and it lists two dozen buildings"): the main
// one is the building the address pin stands on, ahead of the largest; the rest list this lot's first, then the ones
// the parcel check put outside the lot, nearest first. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-structures.check.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { feetBetween, feetToRing, includedIndicesOf, otherStructuresOf, pickMainStructure, pointInRing, userPinOf } from "../../../src/lib/roofDiagram/instantTotals";
import type { InstantStructure } from "../../../src/lib/eagleview";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
// A square roof `w` metres wide whose centre is `east`/`north` metres from the pin (47.58, -122.15 — Bellevue).
const PIN = { lat: 47.58, lng: -122.15 };
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((PIN.lat * Math.PI) / 180));
const box = (east: number, north: number, w: number) => {
  const h = w / 2;
  return [
    { lat: PIN.lat + (north - h) * M_LAT, lng: PIN.lng + (east - h) * M_LNG },
    { lat: PIN.lat + (north - h) * M_LAT, lng: PIN.lng + (east + h) * M_LNG },
    { lat: PIN.lat + (north + h) * M_LAT, lng: PIN.lng + (east + h) * M_LNG },
    { lat: PIN.lat + (north + h) * M_LAT, lng: PIN.lng + (east - h) * M_LNG },
  ];
};
const st = (areaSqft: number, outline: Array<{ lat: number; lng: number }> | null): InstantStructure => ({ areaSqft, outline } as unknown as InstantStructure);

check("a point inside a ring is inside; beside it is not", pointInRing(PIN, box(0, 0, 20)) && !pointInRing(PIN, box(40, 0, 20)) && !pointInRing(PIN, null));
check("feet between: 100 m north is about 328 ft", Math.abs(feetBetween(PIN, { lat: PIN.lat + 100 * M_LAT, lng: PIN.lng }) - 328) < 2);

// 2680 139th Ave SE, as it came back: a house under the pin, and two dozen larger neighbours all around.
const house = st(3200, box(0, 0, 18));
const garage = st(500, box(14, 4, 7));
const neighbours = Array.from({ length: 24 }, (_, n) => st(4000 + n * 90, box(40 + (n % 6) * 35, -60 + Math.floor(n / 6) * 35, 22)));
const all = [...neighbours.slice(0, 5), house, ...neighbours.slice(5), garage];
const houseAt = all.indexOf(house);
const garageAt = all.indexOf(garage);
const foreign = all.map((s, i) => i).filter((i) => i !== houseAt && i !== garageAt);

const atPin = pickMainStructure(all, { origin: PIN, parcelKnown: true });
check("the building under the address pin is the main one, though two dozen roofs are larger", atPin.index === houseAt && atPin.how === "at-pin", JSON.stringify(atPin));
const vetoed = pickMainStructure(all, { origin: PIN, parcelKnown: true, foreign });
check("…with the lot check's vetoes too", vetoed.index === houseAt && vetoed.how === "at-pin");
const pinOff = { lat: PIN.lat + 30 * M_LAT, lng: PIN.lng };
check("a pin on no roof: the largest building on the lot, as before", pickMainStructure(all, { origin: pinOff, parcelKnown: true, foreign }).index === houseAt && pickMainStructure(all, { origin: pinOff, parcelKnown: true, foreign }).how === "area+parcel");
check("…and with no lot known, the nearest the pin", pickMainStructure(all, { origin: pinOff, parcelKnown: false }).how === "nearest-pin");
check("a vetoed neighbour is never the main one, even under the pin", pickMainStructure([st(9000, box(0, 0, 30)), house], { origin: PIN, parcelKnown: true, foreign: [0] }).index === 1);

const others = otherStructuresOf({ structures: all, mainIndex: houseAt, foreign, origin: PIN });
check("the main one is not in the list", others.length === all.length - 1 && !others.some((o) => o.i === houseAt));
check("this lot's buildings first — the garage — then the neighbours", others[0].i === garageAt && !others[0].offLot && others.slice(1).every((o) => o.offLot));
check("each group nearest the house first, with its distance", others.slice(1).every((o, k, a) => k === 0 || (a[k - 1].feet ?? 0) <= (o.feet ?? 0)) && Math.round((others[0].feet ?? 0) / 10) * 10 === 50, `${Math.round(others[0].feet ?? 0)} ft`);
const noOutline = otherStructuresOf({ structures: [house, st(800, null), garage], mainIndex: 0, origin: PIN });
check("a building with no outline comes last, without a distance", noOutline[1].i === 1 && noOutline[1].feet === null && noOutline[0].i === 2);
const noParcel = otherStructuresOf({ structures: all, mainIndex: houseAt, origin: PIN });
check("with no lot check, every building counts as on the lot, nearest first", noParcel.every((o) => !o.offLot) && noParcel[0].i === garageAt);

// ── the person's pin (2026-10-26, ticket 8KETUL: EagleView's point for an apartment complex stood on its garage) ──
const onGarage = { lat: PIN.lat + 4 * M_LAT, lng: PIN.lng + 14 * M_LNG };
const userIn = pickMainStructure(all, { origin: PIN, parcelKnown: true, foreign, userPin: onGarage });
check("user-pin: the building under the person's pin is main, ahead of the address pin's", userIn.index === garageAt && userIn.how === "user-pin", JSON.stringify(userIn));
const userOnNeighbour = pickMainStructure(all, { origin: PIN, parcelKnown: true, foreign, userPin: { lat: PIN.lat - 60 * M_LAT, lng: PIN.lng + 40 * M_LNG } });
check("…even on a building the lot check called a neighbour's: the person pointed at it", userOnNeighbour.index === 0 && userOnNeighbour.how === "user-pin", JSON.stringify(userOnNeighbour));
const userBeside = pickMainStructure(all, { origin: PIN, parcelKnown: true, foreign, userPin: { lat: PIN.lat + 4 * M_LAT, lng: PIN.lng + 21 * M_LNG } });
check("user-pin on no roof: the building of this lot nearest it (the garage, 3 m away), not the largest", userBeside.index === garageAt && userBeside.how === "near-user-pin", JSON.stringify(userBeside));
check("feetToRing: 0 inside, the gap to the nearest edge outside", feetToRing(PIN, box(0, 0, 18)) === 0 && Math.abs(feetToRing({ lat: PIN.lat, lng: PIN.lng + 19 * M_LNG }, box(0, 0, 18)) - 10 * 3.28084) < 0.5);
check("no user pin (an older row, a re-pick of one): the rules as before", pickMainStructure(all, { origin: PIN, parcelKnown: true, foreign, userPin: null }).how === "at-pin");
check("a junk user pin is no pin", pickMainStructure(all, { origin: PIN, parcelKnown: true, foreign, userPin: { lat: NaN, lng: 1 } }).how === "at-pin");

// The ticket's own lot, moved to a made-up place: 25 buildings, EagleView's point on index 13.
const lot = JSON.parse(readFileSync(path.join(__dirname, "../_lib/fixtures/roof-complex-25.json"), "utf8")) as { lat: number; lng: number; googlePin: { lat: number; lng: number }; structures: InstantStructure[] };
const evPick = pickMainStructure(lot.structures, { origin: { lat: lot.lat, lng: lot.lng }, parcelKnown: true });
check("25 buildings: EagleView's point alone still picks index 13 (what the ticket saw)", evPick.index === 13 && evPick.how === "at-pin", JSON.stringify(evPick));
const c0 = lot.structures[0].outline!;
const onApartment = { lat: c0.reduce((a, p) => a + p.lat, 0) / c0.length, lng: c0.reduce((a, p) => a + p.lng, 0) / c0.length };
const pinned = pickMainStructure(lot.structures, { origin: { lat: lot.lat, lng: lot.lng }, parcelKnown: true, userPin: onApartment });
check("…a pin dragged onto another building makes that one main", pinned.index === 0 && pinned.how === "user-pin", JSON.stringify(pinned));

// ── the ticks kept on the row ──
check("included: valid indices, never the main one, each once", JSON.stringify(includedIndicesOf({ included: [3, 1, 3, 9, -1, 2.5, "4", 0] }, 5, 1)) === "[3,0]");
check("included: an older row has none", includedIndicesOf({}, 5, 0).length === 0 && includedIndicesOf(null, 5, 0).length === 0);
check("userPinOf: the stored pin, or null", userPinOf({ userPin: { lat: 1, lng: 2 } })?.lng === 2 && userPinOf({ userPin: null }) === null && userPinOf({}) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
