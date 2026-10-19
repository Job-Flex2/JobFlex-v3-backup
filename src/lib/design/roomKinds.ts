// What kind of room a name is, and what the designer said it is (Home Design Studio, 2026-10-18). Its own module so
// the checks and the layouts can both read it. Pure.
import type { DesignDoc, Finishes, RoomKind } from "./model";
import type { Room } from "./geometry";
import { finishesFor } from "./library";

/** What kind of room a name is. Bath before bedroom: "Master bath" is a bath. */
export function roomKind(name: string): RoomKind {
  const n = name.toLowerCase();
  if (/kitchen|kitchenette/.test(n)) return "kitchen";
  if (/bath|powder|toilet|\bwc\b|lavatory|ensuite|en-suite|shower/.test(n)) return "bath";
  if (/laundry|utility/.test(n)) return "laundry";
  if (/pantry/.test(n)) return "pantry";
  if (/closet|wardrobe|\bwic\b|dressing/.test(n)) return "closet";
  if (/garage|shop|workshop/.test(n)) return "garage";
  if (/patio|porch|deck|terrace|balcony|veranda/.test(n)) return "outdoor";
  if (/bed\s*room|bedroom|\bbed\b|master|primary|guest|nursery|kids|suite|bunk/.test(n)) return "bedroom";
  if (/dining|nook|breakfast/.test(n)) return "dining";
  if (/office|study|\bden\b|library|craft/.test(n)) return "office";
  if (/living|great\s*room|family|media|theater|bonus|rec|game|lounge|sitting|loft|sun\s*room/.test(n)) return "living";
  if (/entry|foyer|vestibule|hall|mud/.test(n)) return "entry";
  return "other";
}

/** The room's kind: what the designer set it to, else what its name says. */
export function kindOfRoom(doc: Pick<DesignDoc, "labels">, room: Pick<Room, "labelId" | "name">): RoomKind {
  return doc.labels.find((l) => l.id === room.labelId)?.use ?? roomKind(room.name);
}

export const KIND_LABEL: Record<RoomKind, string> = {
  kitchen: "Kitchen",
  bath: "Bathroom",
  bedroom: "Bedroom",
  living: "Living",
  dining: "Dining",
  laundry: "Laundry",
  office: "Office",
  closet: "Closet",
  pantry: "Pantry",
  entry: "Entry",
  garage: "Garage",
  outdoor: "Outdoor",
  other: "Room",
};

/** A room's kind by its label id (null: no room). */
export function kindOfLabel(doc: Pick<DesignDoc, "labels">, labelId: string | null | undefined): RoomKind | undefined {
  const l = labelId ? doc.labels.find((x) => x.id === labelId) : undefined;
  return l ? (l.use ?? roomKind(l.name)) : undefined;
}

/** A room's finishes: what the designer chose, over its kind's starting point (a bath on tile). */
export const roomFinishes = (doc: Pick<DesignDoc, "labels" | "finishes">, labelId: string | null | undefined): Finishes => finishesFor(doc.finishes, labelId, kindOfLabel(doc, labelId));
