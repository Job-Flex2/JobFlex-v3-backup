// What kind of space a room is, from its name on the plans. Pure.
import type { PlanOpening, PlanRoom } from "./sheet";

export const isGarage = (r: PlanRoom) => /\bgarage\b/i.test(r.name);
export const isPorch = (r: PlanRoom) => /\b(porch|patio|deck|balcony|lanai|veranda)\b/i.test(r.name);
export const isBath = (r: PlanRoom) => /\b(bath|powder|wc|ensuite|en-suite|pdr|mba\d?|bth|ba\s?\d+)\b/i.test(r.name);
export const isKitchen = (r: PlanRoom) => /\bkitchen\b/i.test(r.name);
export const isBedroom = (r: PlanRoom) => /\b(bed\w*|bdrm\w*|br\s?\d?|mbr\d?|primary suite|master suite|guest suite|nursery)\b/i.test(r.name) && !isBath(r);
/** "OPEN TO BELOW" over a two-story room is a void, not floor. */
export const isVoid = (r: PlanRoom) => /\bto below\b|\bopen to\b|\bvoid\b|^open$/i.test(r.name.trim());

/** How big a room of this kind runs, relative to the others — for rooms the plans give no size. */
export function roomWeight(r: PlanRoom): number {
  const n = r.name.toLowerCase();
  if (/powder|\bpdr\b|half bath|\bw\.?c\.?\b/.test(n)) return 30;
  if (/(master|mstr|primary|owner'?s?)[^a-z]*(bath|ba\b)|\bmba\d?\b/.test(n)) return 130;
  if (/\bbath|\bba\s?\d|\bbth\b|ensuite/.test(n)) return 60;
  if (/(master|mstr|primary|owner'?s?)[^a-z]*(bed|br\b|suite)|\bmbr\d?\b/.test(n)) return 230;
  if (/\bbed|\bbdrm|\bbr\s?\d|guest|nursery/.test(n)) return 150;
  if (/great|family|living|media|bonus|game|recreation|\brec\b|loft/.test(n)) return 320;
  if (/kitchen/.test(n)) return 220;
  if (/nook|dining|breakfast/.test(n)) return 150;
  if (/\bden\b|office|study|library/.test(n)) return 130;
  if (/\bw\.?i\.?c\b|closet|wardrobe/.test(n)) return 45;
  if (/linen|\bcoat\b/.test(n)) return 12;
  if (/laundry|utility|\blndy\b/.test(n)) return 70;
  if (/\bmud\b/.test(n)) return 50;
  if (/pantry|\bpty\b|\bptry\b|\bbp\b|butler/.test(n)) return 40;
  if (/foyer|entry/.test(n)) return 80;
  if (/hall|landing|corridor|stair/.test(n)) return 60;
  if (/mech|\bah\b|furnace|storage/.test(n)) return 25;
  return 100;
}
export const isOverheadDoor = (d: PlanOpening) => /overhead|\bo\.?\s?h\.?\b|garage door|sectional|roll/i.test(`${d.type ?? ""}`) || (d.widthIn ?? 0) >= 96;
export const isStairOrHall = (r: PlanRoom) => /\b(stair|hall|entry|foyer|landing|corridor)\b/i.test(r.name);
export const roomPerimeter = (r: PlanRoom) => (r.widthFt && r.lengthFt ? 2 * (r.widthFt + r.lengthFt) : r.areaSqFt ? 4 * Math.sqrt(r.areaSqFt) : 0);
export const isPowder = (r: PlanRoom) => /powder|\bpdr\b|half bath|^\s*w\.?c\.?\s*$/i.test(r.name);
export const isCloset = (r: PlanRoom) => /\bw\.?i\.?c\b|closet|wardrobe|linen|\bcoat\b/i.test(r.name);
export const isLaundry = (r: PlanRoom) => /laundry|utility|\blndy\b/i.test(r.name);
export const isPantry = (r: PlanRoom) => /pantry|\bpty\b|\bptry\b|butler/i.test(r.name);
export const isLiving = (r: PlanRoom) => /great|family|living|media|bonus|game|recreation|\brec\b|loft/i.test(r.name);
export const isDining = (r: PlanRoom) => /nook|dining|breakfast/i.test(r.name);
export const isDen = (r: PlanRoom) => /\bden\b|office|study|library/i.test(r.name);
export const isMud = (r: PlanRoom) => /\bmud\b/i.test(r.name);
