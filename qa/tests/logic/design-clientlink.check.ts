// Home Design Studio, the client's link (2026-10-19): the room sent to the homeowner with the finishes they may choose
// among — the design's own first, a cheaper and a dearer one where the price moves — what they pick laid on the
// design, the total the page shows equal to the one the server prices on approval, the shop's own line prices never
// on the page, and the contractor's email and words.
//   npx tsx qa/tests/logic/design-clientlink.check.ts
import { autoKitchen } from "../../../src/lib/design/kitchen";
import { roomsOf } from "../../../src/lib/design/geometry";
import { DEFAULT_OPTIONS, estimateTotal, priceDesign, takeoff } from "../../../src/lib/design/estimate";
import { roomFinishes } from "../../../src/lib/design/roomKinds";
import { renderEmail } from "../../../src/lib/email/renderEmail";
import {
  applyChosen,
  applyPicks,
  approvedEmailDoc,
  choicesOf,
  chosenWords,
  cleanOptions,
  cleanPicks,
  currentChoice,
  linkMessage,
  linkPrices,
  linkRow,
  linkTotal,
  pricedTotal,
  slotsFor,
  standing,
  suggestOptions,
  withChoice,
  type Picks,
  type RoomClientLink,
  type Slot,
} from "../../../src/lib/design/clientLink";
import type { DesignDoc, Wall } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = (id: string, ax: number, ay: number, bx: number, by: number, thick = 4.5): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick, height: 96 });

// A 14 × 12 ft kitchen laid out by the studio, and a bath beside it.
const base: DesignDoc = {
  v: 1,
  title: "client link",
  walls: [W("top", 0, 0, 168, 0), W("right", 168, 0, 168, 144), W("bottom", 168, 144, 0, 144), W("left", 0, 144, 0, 0), W("bt", 168, 0, 264, 0), W("br", 264, 0, 264, 96), W("bb", 264, 96, 168, 96)],
  openings: [
    { id: "win", wallId: "top", kind: "window", at: 84, width: 36, height: 48, sill: 40 },
    { id: "door", wallId: "bottom", kind: "door", at: 120, width: 32, height: 80, sill: 0 },
  ],
  labels: [
    { id: "k", name: "Kitchen", at: { x: 84, y: 72 } },
    { id: "b", name: "Bath", at: { x: 216, y: 48 } },
  ],
  marks: [],
};
const kroom = roomsOf(base).find((r) => r.labelId === "k")!;
const doc: DesignDoc = { ...base, items: autoKitchen(base, kroom, "k").items };
const pricing = { factor: 1.1, place: "Testville", opts: DEFAULT_OPTIONS, book: {} as Record<string, number>, products: [] };
const totalOf = (d: DesignDoc, book: Record<string, number> = {}) => estimateTotal(priceDesign(takeoff(d, "k")!, roomFinishes(d, "k"), pricing.opts, pricing.factor, book, []));
const priceOf = (slot: Slot, key: string) => totalOf({ ...doc, finishes: { ...(doc.finishes ?? {}), k: withChoice(roomFinishes(doc, "k"), slot, key) } });

console.log("── what the room offers");
check("a kitchen offers cabinets, counter, backsplash, floor, walls and hardware", slotsFor("kitchen").join() === "cabinets,counter,backsplash,floor,wall,hardware");
check("a bath's cabinets read as the vanity", suggestOptions(doc, "b", () => 0).some((o) => o.title === "Vanity"));
check("a bedroom offers the floor and the walls", slotsFor("bedroom").join() === "floor,wall");
const opts = suggestOptions(doc, "k", priceOf);
const f0 = roomFinishes(doc, "k");
check("every slot of the kitchen offered", opts.length === 6, opts.map((o) => o.slot).join(", "));
check("the design's own choice first in each", opts.every((o) => o.choices[0].key === currentChoice(f0, o.slot).key));
check("three choices a slot, no repeats", opts.every((o) => o.choices.length === 3 && new Set(o.choices.map((c) => c.key)).size === 3));
const floor = opts.find((o) => o.slot === "floor")!;
const fd = floor.choices.slice(1).map((c) => priceOf("floor", c.key) - priceOf("floor", floor.choices[0].key));
check("the floor: one that costs less and one that costs more", fd.some((d) => d < -1) && fd.some((d) => d > 1), fd.map((d) => Math.round(d)).join(", "));
const paint = opts.find((o) => o.slot === "wall")!;
check("a paint colour doesn't move the price", paint.choices.every((c) => Math.abs(priceOf("wall", c.key) - priceOf("wall", paint.choices[0].key)) < 0.01));

console.log("── what the browser may send");
const sent = [
  { slot: "floor", choices: [{ key: floor.choices[1].key }, { key: "made-up" }, { key: choicesOf("floor")[0].key }] },
  { slot: "floor", choices: [{ key: floor.choices[2].key }] },
  { slot: "roof", choices: [{ key: "x" }] },
  { slot: "hardware", choices: [] },
];
const clean = cleanOptions(sent, doc, "k");
check("a slot the room doesn't have, a made-up key, a second floor row and a slot with nothing to choose — all dropped", clean.length === 1 && clean[0].slot === "floor" && !clean[0].choices.some((c) => c.key === "made-up"), JSON.stringify(clean.map((o) => [o.slot, o.choices.map((c) => c.key)])));
check("the design's own floor put first, whatever was sent", clean[0].choices[0].key === currentChoice(f0, "floor").key);
const many = cleanOptions([{ slot: "cabinets", choices: choicesOf("cabinets").map((c) => ({ key: c.key })) }], doc, "k");
check("at most four choices a slot", many[0].choices.length === 4);
const picks0 = cleanPicks({ floor: floor.choices[1].key, counter: "granite-from-mars", wall: 42, roof: "x" }, opts);
check("picks: only real choices of offered slots", Object.keys(picks0).join() === "floor", JSON.stringify(picks0));

console.log("── picked, laid on the design");
const pick: Picks = { floor: floor.choices[2].key, cabinets: opts[0].choices[1].key, wall: paint.choices[1].key };
const laid = applyPicks(doc, "k", opts, pick);
const lf = roomFinishes(laid, "k");
check("the floor, the cabinets and the paint the client chose", currentChoice(lf, "floor").key === pick.floor && currentChoice(lf, "cabinets").key === pick.cabinets && currentChoice(lf, "wall").key === pick.wall);
check("the rest as designed", currentChoice(lf, "counter").key === currentChoice(f0, "counter").key && currentChoice(lf, "backsplash").key === currentChoice(f0, "backsplash").key);
check("the other rooms untouched", JSON.stringify(roomFinishes(laid, "b")) === JSON.stringify(roomFinishes(doc, "b")));
check("a pick the link doesn't offer isn't laid", currentChoice(roomFinishes(applyPicks(doc, "k", opts, { counter: choicesOf("counter").find((c) => !opts[1].choices.some((x) => x.key === c.key))!.key }), "k"), "counter").key === currentChoice(f0, "counter").key);
check("Apply their choices in the studio gives the same room", JSON.stringify(roomFinishes(applyChosen(doc, "k", pick), "k")) === JSON.stringify(lf));

console.log("── one number: the page's total is the server's");
const link: RoomClientLink = {
  v: 1, token: "t".repeat(24), orgId: "org", createdBy: "u", byName: "Alex", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(),
  clientName: "Dana Whitfield", clientEmail: null, clientPhone: null, clientId: null, designId: "d1", room: "k", roomName: "Kitchen", title: "Kitchen design", address: null,
  doc, options: opts, showPrice: true, pricing, picks: {}, picksAt: null, openedAt: null, note: "", status: "open", approvedAt: null, approvedName: null, approvedTotal: null, appliedAt: null,
};
const prices = linkPrices(link)!;
check("the design's own total is the studio's", Math.abs(prices.base - totalOf(doc)) < 0.01, `${prices.base.toFixed(2)} vs ${totalOf(doc).toFixed(2)}`);
let worst = 0;
let combos = 0;
const walk = (i: number, acc: Picks) => {
  if (i === opts.length) {
    combos++;
    worst = Math.max(worst, Math.abs(pricedTotal(prices, acc) - linkTotal(link, acc)!));
    return;
  }
  for (const c of opts[i].choices) walk(i + 1, { ...acc, [opts[i].slot]: c.key });
};
walk(0, {});
check(`every one of the ${combos} combinations: the page's sum = the server's price`, worst === 0, `worst off by $${worst}`);
check("the floor's difference is what the studio shows", Math.abs(prices.delta.floor![floor.choices[1].key] - (priceOf("floor", floor.choices[1].key) - totalOf(doc))) < 0.01);
const shop = { ...link, pricing: { ...pricing, book: { floor: 99, splash: 99 } } };
const own = linkPrices(shop)!;
check("the shop's own prices price the link", own.base !== prices.base || JSON.stringify(own.delta) !== JSON.stringify(prices.delta));
check("the page never gets the shop's line prices — a total and differences only", Object.keys(own).join() === "base,delta" && Object.keys(own.delta).every((k) => (slotsFor("kitchen") as string[]).includes(k)));

console.log("── the contractor's words");
const row = linkRow({ ...link, picks: pick, picksAt: new Date().toISOString() }, Date.now());
check("what they changed, in words", row.picked.length === 3 && row.picked.some((w) => w.startsWith("Floor: ")), row.picked.join(" · "));
check("where they are with it", standing(row) === "Choosing" && standing({ ...row, status: "approved", approvedName: "Dana" }) === "Approved by Dana" && standing({ ...row, picksAt: null, openedAt: null }) === "Not opened yet" && standing({ ...row, expired: true, status: "open" }) === "Link closed");
const msg = linkMessage({ org: "Ridgeline Remodeling", clientName: "Dana Whitfield", roomName: "Kitchen", link: "https://jobflex.app/room-design/abc" });
check("the message greets them by first name, names the shop and carries the link", msg.startsWith("Hi Dana,") && msg.includes("Ridgeline Remodeling") && msg.endsWith("https://jobflex.app/room-design/abc"), msg);
const words = chosenWords(opts, pick);
check("the chosen words name every slot, the design's own where they didn't choose", words.length === 6 && words.some((w) => w.startsWith("Countertop") || w.startsWith("Counter")), words.join(" · "));
const mail = renderEmail(approvedEmailDoc({ org: { name: "Ridgeline Remodeling", logoUrl: null, phone: "555-0100" }, name: "Dana Whitfield", roomName: "Kitchen", total: 41250, chosen: words, note: "Can we start in May?", href: "https://jobflex.app/dashboard/design-studio?design=d1" }));
check("the approval email: who, the room, the total, their note and the way back", mail.subject === "Dana Whitfield approved the kitchen design" && mail.text.includes("$41,250") && mail.text.includes("Can we start in May?") && mail.html.includes("design-studio?design=d1"));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
