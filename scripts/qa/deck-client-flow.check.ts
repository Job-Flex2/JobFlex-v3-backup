// THE CLIENT DESIGN FLOW'S RULES (2026-10-13, owner: "a smart flow — the design comes back into the studio with
// a flash, the folder names the client, the proposal's line opens the client's design, accepted shows on the
// line"). Pure: the link record's new facts round-trip, "unseen" means sent back and not opened since, the
// standing words every surface shares, the row's data shape.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-client-flow.check.ts
import { defaultDeckDesign } from "../../src/lib/deck/design";
import { clientLinkRow, clientStanding, isUnseenReturn, parseClientLink, standingLine, STANDING_WORDS, type ClientDesignLink } from "../../src/lib/deck/clientDesign";
import { deckConvertSchema, deckUpdateSchema } from "../../src/lib/deck/convertSchema";
import { deckingProduct, defaultDecking, treatedDecking } from "../../src/lib/deck/catalog";
import { REGIONAL_STATES } from "../../src/lib/deck/regional";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const ago = (iso: string) => `${Math.round((Date.now() - Date.parse(iso)) / 3600000)} h ago`;
const T0 = "2026-10-13T10:00:00.000Z";
const T1 = "2026-10-13T11:00:00.000Z";
const T2 = "2026-10-13T12:00:00.000Z";
const base = defaultDeckDesign({ state: "TX" });
const link: ClientDesignLink = {
  v: 1, token: "abcdefghijklmnopqrstuvwx", orgId: "org1", createdBy: "u1", createdAt: T0, expiresAt: "2027-01-01T00:00:00.000Z",
  clientName: "Jane Smith", clientPhone: "555-0100", clientEmail: null, clientId: null, address: null, title: "Smith deck", start: "mine",
  base, work: null, workAt: null, openedAt: null, note: "", unsure: [], status: "open", sentAt: null, sends: 0, draftId: null,
  proposalId: "cmv123", byName: "Quinn Adler", seenAt: null,
};

// ── the record
const back = parseClientLink(JSON.stringify(link));
check("the new facts round-trip: proposal, maker, seen", !!back && back.proposalId === "cmv123" && back.byName === "Quinn Adler" && back.seenAt === null);
const old = parseClientLink(JSON.stringify({ ...link, proposalId: undefined, byName: undefined, seenAt: undefined }));
check("a link saved before them reads back with none", !!old && old.proposalId === null && old.byName === null && old.seenAt === null);
check("a bad proposal id is dropped", parseClientLink(JSON.stringify({ ...link, proposalId: "no spaces here!" }))?.proposalId === null);

// ── unseen
check("not sent back = nothing to see", !isUnseenReturn(link));
const sent = { ...link, status: "sent" as const, sentAt: T1, work: base, workAt: T1, openedAt: T0, draftId: "0f0f0f0f-0000-4000-8000-000000000001" };
check("sent back, never opened = unseen", isUnseenReturn(sent));
check("opened after it came = seen", !isUnseenReturn({ ...sent, seenAt: T2 }));
check("sent again after being opened = unseen again", isUnseenReturn({ ...sent, seenAt: T1, sentAt: T2 }));
const row = clientLinkRow(sent, Date.parse(T2));
check("the row carries unseen, the words and the proposal", row.unseen && !!row.words && row.proposalId === "cmv123" && row.byName === "Quinn Adler");

// ── standing
check("waiting → opened → designing → returned, closed when expired", clientStanding(clientLinkRow(link, Date.parse(T2))) === "waiting" && clientStanding(clientLinkRow({ ...link, openedAt: T0 }, Date.parse(T2))) === "opened" && clientStanding(clientLinkRow({ ...link, openedAt: T0, workAt: T1 }, Date.parse(T2))) === "designing" && clientStanding(row) === "returned" && clientStanding(clientLinkRow({ ...link, expiresAt: T0 }, Date.parse(T2))) === "closed");
check("a returned design stays 'returned' even after the link expires", clientStanding(clientLinkRow({ ...sent, expiresAt: T0 }, Date.parse(T2))) === "returned");
check("every standing has words", (["waiting", "opened", "designing", "returned", "closed"] as const).every((k) => STANDING_WORDS[k].length > 3));
const at = { sentAt: sent.sentAt, workAt: sent.workAt, openedAt: sent.openedAt, createdAt: sent.createdAt };
check("the line names the client by first name and when", standingLine(row, ago, at).startsWith("Jane sent back a design · ") , standingLine(row, ago, at));
check("…waiting says the link went out and was not opened", /^Design link sent to Jane · not opened yet$/.test(standingLine(clientLinkRow(link, Date.parse(T2)), ago, { ...at, sentAt: null, workAt: null, openedAt: null })));
check("…a nameless client is 'The client'", standingLine({ ...row, clientName: "  " }, ago, at).startsWith("The client sent back"));

// ── the token rides with a convert / an update
const lines = [{ name: "Framing", quantity: 1, materialCost: 1, laborCost: 1 }];
check("a convert may carry the client's token", deckConvertSchema.safeParse({ title: "t", assumptions: [], lines, clientToken: link.token }).success);
check("…and refuses a malformed one", !deckConvertSchema.safeParse({ title: "t", assumptions: [], lines, clientToken: "short" }).success);
check("an update too", deckUpdateSchema.safeParse({ title: "t", assumptions: [], lines, proposalId: "p1", clientToken: link.token }).success);

// ── the client's "Pressure-treated wood" button (fixed 2026-10-13): a treated board in every region, no state too
check("treatedDecking is a treated board for every state and for none", [...REGIONAL_STATES, null, "ZZ"].every((st) => deckingProduct(treatedDecking(st)).family === "treated"));
check("…where the region's default board is a composite (the West Coast), it still is", ["CA", "OR", "WA", "HI"].every((st) => deckingProduct(defaultDecking(st)).family !== "treated" && deckingProduct(treatedDecking(st)).family === "treated"));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
