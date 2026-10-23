// THE CLIENT DESIGNS THE DECK (2026-10-11, lib/deck/clientDesign): what a
// client sends back is laid over the contractor's design — the client's kind,
// size, height, stairs, rail style, boards, lower level and roof look; the
// contractor's lumber, footings, ledger, site, house, wiring and rail height
// (the client's lights come back; the wiring to them stays the contractor's),
// whatever the browser says — and settled to the tables. A blank start keeps
// the contractor's site and lumber. The link record reads back as written,
// and a broken one reads as nothing. The client's page module never imports
// the price module. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-client-design.check.ts
import { readFileSync } from "node:fs";
import { STRETCH_MAX, centreOn, houseFromSheet, parseLength, sheetWords, wallSheet } from "../../../src/lib/deck/wallMeasure";
import { deckShapeForHouse, defaultHouse } from "../../../src/lib/deck/house";
import { renderEmail } from "../../../src/lib/email/renderEmail";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, normalizeDeckDesign, structureWords, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { DECK_SAMPLES, sampleDesign } from "../../../src/lib/deck/samples";
import { AUTO_FIX } from "../../../src/lib/deck/settle";
import {
  CLIENT_TOKEN_RE,
  blankFor,
  changesFrom,
  clientCopyOf,
  clientLinkMessage,
  clientLinkRow,
  deckDraftKey,
  mergeClientDesign,
  parseClientLink,
  returnedEmailDoc,
  returnedTitle,
  type ClientDesignLink,
} from "../../../src/lib/deck/clientDesign";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The contractor's design: their own lumber, footings, ledger, rail height and a photo.
const contractor: DeckDesign = applyDeckPatch(defaultDeckDesign({ state: "PA", frostIn: 36 }), {
  framing: { species: "douglas-fir", joist: "2x10", spacingIn: 12, doubleRim: true },
  footing: { type: "poured", aboveGradeIn: 6, frostAlways: true },
  ledger: { fastener: "ledgerlok", lateral: "four" },
  rail: { type: "composite", heightIn: 42 },
  heightIn: 40,
  extras: { demoSqFt: 180 },
  photo: { url: "https://store.example/deck-photos/org1/a.jpg", w: 1600, h: 1200, placed: null },
});

check("the client's copy carries no photo of the house", clientCopyOf(contractor).photo === null && contractor.photo !== null);

// The browser sends a deck with the engineering changed — every one of those is put back.
const client = applyDeckPatch(contractor, {
  shape: { kind: "rect", widthFt: 20, depthFt: 14 },
  heightIn: 30,
  rail: { type: "aluminum", heightIn: 36 },
  decking: { product: "composite-best", pattern: "diagonal", wastePct: 2 },
  framing: { species: "spf", joist: "2x6", spacingIn: 24, doubleRim: false },
  footing: { type: "pier-block" },
  ledger: { fastener: "lag", lateral: "two" },
  frostIn: 0,
  extras: { demoSqFt: 0 },
  site: { ...contractor.site, state: "CA", groundSnowPsf: 0 },
});
const merged = mergeClientDesign(contractor, client, { settle: false });
check("the client's size, height, rail style and boards stand", merged.shape.widthFt === 20 && merged.shape.depthFt === 14 && merged.heightIn === 30 && merged.rail.type === "aluminum" && merged.decking.product === "composite-best" && merged.decking.pattern === "diagonal", `${merged.shape.widthFt}×${merged.shape.depthFt} h${merged.heightIn} ${merged.rail.type} ${merged.decking.product}`);
check("the contractor's lumber stands", merged.framing.species === contractor.framing.species && merged.framing.doubleRim === contractor.framing.doubleRim, merged.framing.species);
check("the contractor's footings and ledger stand", same(merged.footing, contractor.footing) && same(merged.ledger, contractor.ledger));
check("the contractor's site, frost and state stand", same(merged.site, contractor.site) && merged.frostIn === contractor.frostIn);
check("the contractor's rail height, waste and tear-out stand", merged.rail.heightIn === 42 && merged.decking.wastePct === contractor.decking.wastePct && merged.extras.demoSqFt === 180);
check("the contractor's photo stands", same(merged.photo, contractor.photo));
// The house is the client's (2026-10-12): they measured it.
const measured = applyDeckPatch(contractor, { house: { leftFt: 6, rightFt: 10, jogs: [{ id: "j1", atFt: 22, dir: "toward", depthFt: 3 }], storeys: 2 } });
const mergedHouse = mergeClientDesign(contractor, measured, { settle: false });
check("the client's measured house comes back", mergedHouse.house.leftFt === 6 && mergedHouse.house.rightFt === 10 && mergedHouse.house.jogs.length === 1 && mergedHouse.house.storeys === 2, JSON.stringify(mergedHouse.house.jogs));

// Settled: the contractor's hand-picked 2x10 at 12 in. may not reach a deeper deck — the tables fix it.
const deep = applyDeckPatch(contractor, { shape: { kind: "rect", widthFt: 24, depthFt: 22 } });
const settled = mergeClientDesign(contractor, deep);
const fails = deckChecks(buildStructure(settled)).filter((c) => c.level === "fail" && AUTO_FIX.test(c.id));
check("a bigger deck comes back settled to the tables", fails.length === 0, fails.map((f) => f.text).join(" | ").slice(0, 160));

// Every sample a client can pick survives the merge as that kind.
for (const sample of DECK_SAMPLES) {
  const d = mergeClientDesign(contractor, sampleDesign(sample, clientCopyOf(contractor)));
  check(`${sample.id}: comes back as a ${sample.structure}`, d.structure === sample.structure && d.framing.species === contractor.framing.species, structureWords(d));
}

// A custom rail (the shop's own price) is not the client's to pick.
const custom = mergeClientDesign(contractor, applyDeckPatch(contractor, { rail: { type: "custom" } }), { settle: false });
check("a client's 'custom' rail goes back to the contractor's", custom.rail.type === "composite", custom.rail.type);

// Garbage from the browser is a design, never a throw.
let threw = false;
try {
  const g = mergeClientDesign(contractor, { shape: "nope", heightIn: "a lot", stairs: [{ side: "roof" }] });
  check("garbage reads as a sound design", g.shape.widthFt >= 4 && Number.isFinite(g.heightIn));
} catch {
  threw = true;
}
check("garbage does not throw", !threw);

// A blank start: the stock deck on the contractor's site, house and lumber.
const blank = blankFor(clientCopyOf(contractor));
const stock = defaultDeckDesign({ state: "PA", frostIn: 36 });
check("blank: the stock shape and height", same(blank.shape, stock.shape) && blank.heightIn === stock.heightIn && blank.stairs.length === stock.stairs.length, `${blank.shape.widthFt}×${blank.shape.depthFt} h${blank.heightIn}`);
check("blank: the contractor's lumber, site and footings", blank.framing.species === contractor.framing.species && same(blank.site, contractor.site) && same(blank.footing, contractor.footing));
check("blank: no photo", blank.photo === null);

// The record reads back as written.
const link: ClientDesignLink = {
  v: 1,
  token: "AbCdEfGhIjKlMnOpQrStUvWx",
  orgId: "org1",
  createdBy: "user1",
  createdAt: "2026-10-11T10:00:00.000Z",
  expiresAt: "2027-01-09T10:00:00.000Z",
  clientName: "Jane Smith",
  clientPhone: "(555) 010-2233",
  clientEmail: "jane@example.com",
  clientId: null,
  address: "12 Oak St, Lancaster, PA 17601",
  title: "Smith back deck",
  start: "mine",
  base: clientCopyOf(contractor),
  work: merged,
  workAt: "2026-10-11T10:05:00.000Z",
  openedAt: "2026-10-11T10:01:00.000Z",
  note: "A gate at the top of the stairs, please.",
  unsure: ["height"],
  status: "sent",
  sentAt: "2026-10-11T10:06:00.000Z",
  sends: 1,
  draftId: "0b9c7c1e-3f1d-4c55-9a77-1f2e3d4c5b6a",
};
const back = parseClientLink(JSON.stringify(link));
check("a link reads back", !!back && back.token === link.token && back.clientName === "Jane Smith" && back.status === "sent" && back.draftId === link.draftId && back.unsure.includes("height") && back.start === "mine");
check("its designs read back", !!back && same(back.base, normalizeDeckDesign(link.base)) && !!back.work && back.work.shape.widthFt === 20);
check("a broken record reads as nothing", parseClientLink("{") === null && parseClientLink(JSON.stringify({ v: 2 })) === null && parseClientLink(JSON.stringify({ v: 1, token: 5 })) === null);
check("a bad draft id is dropped", parseClientLink(JSON.stringify({ ...link, draftId: "../../../x" }))?.draftId === null);
check("the token rule", CLIENT_TOKEN_RE.test(link.token) && !CLIENT_TOKEN_RE.test("short") && !CLIENT_TOKEN_RE.test("has/slash/aaaaaaaaaaaaaaaaaaa"));
const row = clientLinkRow(link, Date.parse("2026-11-01T00:00:00Z"));
check("the contractor's row: open, not expired", row.status === "sent" && !row.expired && row.draftId === link.draftId);
check("the contractor's row: expired after its day", clientLinkRow(link, Date.parse("2027-02-01T00:00:00Z")).expired);
check("the draft key is the studio's", deckDraftKey("org1", "abc") === "deckdraft:org1:abc");

// Words.
check("the draft's name", returnedTitle(link) === "Jane Smith's design — Smith back deck" && returnedTitle({ clientName: "Chris Jones", title: "Deck" }) === "Chris Jones' design — Deck", returnedTitle(link));
const msg = clientLinkMessage({ org: "Deckstand Builders", clientName: "Jane Smith", link: "https://x/deck-design/t", start: "mine" });
check("a company name ending in a period is not followed by a second one", clientLinkMessage({ org: "Ridgeline Roofing Co.", clientName: "Mike Turner", link: "https://x/deck-design/t", start: "mine" }).startsWith("Hi Mike, it's Ridgeline Roofing Co. Here is"));
check("the text to the client greets by first name and carries the link", msg.startsWith("Hi Jane, it's Deckstand Builders.") && msg.endsWith("https://x/deck-design/t") && !/\$/.test(msg), msg);
// THE CLIENT'S LIGHTS COME BACK (2026-10-22): a chandelier and two heaters said on the client's page reach the
// contractor; the feed, panel side, timer and the contractor's own fixture settings stay theirs.
{
  const wired: DeckDesign = applyDeckPatch(contractor, { electrical: { ...contractor.electrical, feedFt: 60, panelSide: "right", timer: true, fixtures: [{ id: "e-1", kind: "heater", supply: "we", qty: 1, at: null, volts240: true, custom: { name: "Bromic Tungsten", price: 1450 } }] } });
  const lit = applyDeckPatch(wired, { electrical: { ...wired.electrical, feedFt: 5, panelSide: "left", timer: false, fixtures: [
    { id: "e-1", kind: "heater", supply: "client", qty: 2, at: null, volts240: false, custom: null },
    { id: "e-2", kind: "chandelier", supply: "we", qty: 1, at: null, volts240: false, custom: { name: "Sneaky", price: 1 } },
  ] } });
  const back = mergeClientDesign(wired, lit, { settle: false });
  const f = back.electrical.fixtures;
  check("the client's chandelier comes back with the design", f.some((x) => x.kind === "chandelier"), JSON.stringify(f));
  check("the client's heater count comes back; the contractor's heater stays 240 V, theirs to supply, their product", f.find((x) => x.id === "e-1")?.qty === 2 && f.find((x) => x.id === "e-1")?.volts240 === true && f.find((x) => x.id === "e-1")?.supply === "we" && f.find((x) => x.id === "e-1")?.custom?.name === "Bromic Tungsten");
  check("a fixture the client adds carries no product name of theirs", f.find((x) => x.kind === "chandelier")?.custom == null);
  check("the feed, the panel side and the timer stay the contractor's", back.electrical.feedFt === 60 && back.electrical.panelSide === "right" && back.electrical.timer === true);
  check("the contractor reads the lights in what changed", changesFrom(wired, back).includes("lights: 2 patio heaters, a chandelier"), changesFrom(wired, back).join("; "));
  const dark = mergeClientDesign(wired, applyDeckPatch(wired, { electrical: { ...wired.electrical, fixtures: [] } }), { settle: false });
  check("lights the client takes off stay off", dark.electrical.fixtures.length === 0 && changesFrom(wired, dark).includes("no lights"));
}

const ch = changesFrom(clientCopyOf(contractor), merged);
check("what changed, in words", ch.some((c) => c.startsWith("size 20 × 14")) && ch.some((c) => /aluminum railing/i.test(c)) && ch.some((c) => /^boards: /.test(c)) && ch.some((c) => c === "height 30 in."), ch.join("; "));
check("nothing changed says nothing", changesFrom(contractor, contractor).length === 0);

// The email to the link's maker.
const doc = returnedEmailDoc({ org: { name: "Deckstand Builders", logoUrl: null, phone: "555-0100" }, name: "Jane Smith", phone: "(555) 010-2233", note: "A gate, please.", unsure: ["height"], words: "18 ft × 12 ft deck", changes: ch, href: "https://app.example/dashboard/deck-estimator?draft=abc", again: false });
const mail = renderEmail(doc);
check("the email renders with its subject, the note and the draft's link", mail.subject === "Jane Smith sent back their deck design" && mail.html.includes("A gate, please.") && mail.html.includes("draft=abc") && mail.text.includes("draft=abc"), mail.subject);
check("the email's measure-on-site row is the last", doc.box?.[doc.box.length - 1]?.type === "cond");
check("the email carries no price", !/\$\s?\d/.test(mail.text));
const again = returnedEmailDoc({ org: { name: "D", logoUrl: null, phone: null }, name: "Jane", phone: null, note: "", unsure: [], words: "deck", changes: [], href: "x", again: true });
check("a second send says so, and no note leaves no quote", again.subject === "Jane sent their deck design again" && again.prose === undefined && !again.box?.some((r) => r.type === "cond"));

// The wall as a tape reads it (lib/deck/wallMeasure).
{
  const shape = { kind: "rect" as const, widthFt: 16, depthFt: 12 };
  const h0 = { ...defaultHouse(), leftFt: 4, rightFt: 4, jogs: [] };
  const sh0 = wallSheet(h0, shape);
  check("a straight wall reads as one stretch", sh0.stretches.length === 1 && sh0.stretches[0].lengthFt === 24 && sh0.deckStartFt === 4 && sh0.totalFt === 24 && sh0.mainIndex === 0, JSON.stringify(sh0));
  // Walked outside: 4 ft, then 16 ft (the deck's wall), then 6 ft sticking out 3 ft. The deck starts 4 ft in.
  const r1 = houseFromSheet(h0, shape, { stretches: [{ lengthFt: 4, offsetFt: 0 }, { lengthFt: 16, offsetFt: 0 }, { lengthFt: 6, offsetFt: 3 }], deckStartFt: 4 });
  check("a bump-out past the deck's right end: one step at 16 ft, the wall 26 ft", r1.note === null && r1.house.jogs.length === 1 && r1.house.jogs[0].atFt === 16 && r1.house.jogs[0].dir === "toward" && r1.house.jogs[0].depthFt === 3 && r1.house.leftFt === 4 && r1.house.rightFt === 6, JSON.stringify(r1.house));
  const back1 = wallSheet(r1.house, shape);
  check("and it reads back the same (in-line stretches merge)", back1.stretches.length === 2 && back1.stretches[0].lengthFt === 20 && back1.stretches[1].lengthFt === 6 && back1.stretches[1].offsetFt === 3 && back1.totalFt === 26, sheetWords(back1));
  // The bump-out under the deck's right end: the deck notches around it.
  const r2 = houseFromSheet(h0, shape, { stretches: [{ lengthFt: 16, offsetFt: 0 }, { lengthFt: 8, offsetFt: 4 }], deckStartFt: 4 });
  const fit2 = deckShapeForHouse(shape, r2.house);
  check("a bump-out at the deck's right end notches it", fit2.shape.kind === "L" && fit2.shape.notch.corner === "back-right" && fit2.shape.notch.widthFt === 4 && fit2.shape.notch.depthFt === 4, JSON.stringify(fit2.shape));
  // A set-back part left of the deck.
  const r3 = houseFromSheet(h0, shape, { stretches: [{ lengthFt: 5, offsetFt: -2 }, { lengthFt: 20, offsetFt: 0 }], deckStartFt: 7 });
  check("a part set back left of the deck: a step at -2 ft", r3.house.jogs.length === 1 && r3.house.jogs[0].atFt === -2 && r3.house.jogs[0].dir === "toward" && r3.house.jogs[0].depthFt === 2 && r3.house.rightFt === 2, JSON.stringify(r3.house));
  // A wall typed shorter than the deck's run: the length stands, the deck slides back onto the wall.
  const r4 = houseFromSheet(h0, shape, { stretches: [{ lengthFt: 18, offsetFt: 0 }], deckStartFt: 4 });
  check("a deck running past the corner slides back, the typed length stands", !!r4.note && /now starts 2 ft/.test(r4.note) && r4.house.leftFt === 2 && r4.house.rightFt === 0 && wallSheet(r4.house, shape).totalFt === 18, r4.note ?? "");
  // A deck wider than the whole wall: the wall is drawn to the deck's end, and it is said.
  const r5 = houseFromSheet(h0, shape, { stretches: [{ lengthFt: 12, offsetFt: 0 }], deckStartFt: 2 });
  check("a deck wider than the wall is said, the wall drawn to its end", !!r5.note && /wider|but the wall is 12 ft/.test(r5.note) && r5.house.leftFt === 0 && r5.house.rightFt === 0, r5.note ?? "");
  check("five stretches at most", houseFromSheet(h0, shape, { stretches: Array.from({ length: 8 }, (_, i) => ({ lengthFt: 4, offsetFt: i % 2 ? 2 : 0 })), deckStartFt: 0 }).house.jogs.length <= STRETCH_MAX - 1);
  check("a step deeper than 12 ft is held and said", (() => { const r = houseFromSheet(h0, shape, { stretches: [{ lengthFt: 20, offsetFt: 0 }, { lengthFt: 6, offsetFt: 15 }], deckStartFt: 2 }); return r.house.jogs[0]?.depthFt === 12 && !!r.note; })());
  const c1 = centreOn(back1, 0, 16);
  check("centre the deck on its wall", c1 === 2, String(c1));
  check("a tape's words read", parseLength("12") === 12 && parseLength("12.5") === 12.5 && parseLength("12'6") === 12.5 && parseLength("12 ft 6 in") === 12.5 && parseLength("12 6") === 12.5 && parseLength("abc") === null && parseLength("") === null);
  check("the house's wall change is named for the contractor", changesFrom(contractor, measured).some((c) => /^house wall measured: /.test(c)) && changesFrom(contractor, measured).includes("two-storey house"), changesFrom(contractor, measured).join("; "));
}

// The client's page never prices.
const page = readFileSync("src/components/v3/deck-client-design/deck-client-designer.tsx", "utf8");
check("the client's page does not import the price module or a rate book", !/lib\/deck\/(pricing|rates|rateBookStore)/.test(page) && !/priceDeck|DeckRateBook|\$\{?money/.test(page));
check("the client's page shows no dollar figure", !/[^\\]\$\d/.test(page.replace(/`[^`]*`/g, "")));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
