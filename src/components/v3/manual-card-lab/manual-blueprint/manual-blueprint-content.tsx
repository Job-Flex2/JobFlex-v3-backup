"use client";

// MANUAL PROPOSAL / BLUEPRINT — the column.
// Route: /dashboard/manual-blueprint.
//
// The "Quiet" variant (/dashboard/manual-quiet), re-skinned into the house
// blueprint system. The composition below is unchanged from the build that was
// approved — same eleven cards, same order, same spacing, same de-emphasis. What
// moved is entirely in manual-blueprint.module.css: ink frames and hard offset
// shadows instead of a borderless soft-shadow surface, caps 900 card titles,
// mono confined to the drawing-annotation layer, square check plates instead of
// pill switches, and the fleet's entrance cascade.
//
// SURFACES: the three-tone trial (white / light beige / deep beige) is decided.
// White won everywhere, including the sticky total bar, so there is no `tone`
// prop any more — a card's surface is not a per-card decision. The one thing it
// cost is documented on `--mb-well` in the stylesheet: the control wells had to
// invert to a faint tint, because a white field inside a white card is defined
// by nothing but a hairline.
//
// THE BET: nothing collapses, and the calm comes from typography and air alone.
// All eleven cards are open, always. There is no accordion, no promotion state,
// no "open" affordance anywhere, because every one of those is a second thing to
// understand before you can read the first thing. If a long single column can
// be restful, it has to be restful with everything showing.
//
// ── THE FIXTURE IS GONE ─────────────────────────────────────────────
// The demo homeowner, the seeded Austin re-roof and its five priced rows have
// been deleted, along with the org name and reference number that were printed
// as fixtures on the client's copy and on every page of the PDF. This page now:
//
//   · opens EMPTY — one blank line row, no client, no scope, no terms;
//   · reads the org's real clients, projects and saved markup / tax defaults;
//   · honours `?client=<id>` (the spelling the estimator picker already hands
//     every engine) and `?proposal=<id>`;
//   · writes through the EXISTING `saveProposal` / `sendProposal` actions, and
//     writes `?proposal=<id>` into the URL after the first save so navigating
//     away and back reopens the row instead of a blank sheet;
//   · creates a real client record through `createClient`.
//
// What still does NOT survive a reload — the project pick, the terms text, the
// four "what prints" toggles and the staged files — has no column on Proposal,
// and this pass adds no schema. Each of the four cards says so on its own face
// rather than losing the input quietly. See manual-blueprint-bridge.ts.
//
// STATE. One `draft` object rather than twenty useStates, because the totals,
// the coverage meter and the client's copy all read the WHOLE draft on every
// keystroke. Three things sit OUTSIDE it on purpose:
//   · `contact` — Draft has no email/phone fields (they belong to the client
//     record), but the sheet still has to carry a contact for a typed name, so
//     the override lives here rather than being smuggled into a shared type
//     this variant may not edit;
//   · `clients` — the inline "add a new client" has to append somewhere, and
//     appending the row the server RETURNED keeps the roster and the database
//     in agreement without a refetch;
//   · `pdf` — the four page decisions, which describe the paper rather than the
//     proposal.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { EstimateSeedStrip } from "@/components/v3/estimate-seed-strip";
import type { Route } from "next";
import { toast } from "@/components/ui/Toast";
// One definition of the post-action hold, shared with the register surfaces.
import { REDIRECT_SECONDS } from "@/components/v3/auth-register-blueprint/register-content";
import { saveProposal, sendProposal } from "@/actions/proposals";
import { createClient } from "@/actions/clients";
import { ensureWithinLimit, reportPlanLimit } from "@/stores/usePlanLimitStore";
import type {
  ClientChoice,
  ClientRecord,
  Draft,
  Installment,
  Line,
  ProposalOptions,
  StagedFile,
} from "../manual-focus/manual-focus-types";
import { contractTotal } from "@/lib/contractTotal";
// What survives from the donor's data module: the starter TERMS text (a button
// the user presses, not seeded content) and the address → sales-tax lookup.
// Every fixture record, the seeded draft and the fake org identity are gone.
import { TERMS_TEMPLATE, estimateFromAddress, taxForState } from "../manual-focus/manual-focus-data";
import {
  bakeAdjustments,
  computeTotals,
  money,
  newId,
  pct,
} from "../manual-focus/manual-focus-math";
import styles from "./manual-blueprint.module.css";
import { Btn, Card, Field, Group, Ic, Pair, TextArea, TextField, cx } from "./bp-ui";
import { clientProposalUrl, proposalTextMessage, smsHref } from "@/lib/proposalLink";
import { ClientField, ProjectField, type NewClientInput } from "./bp-pickers";
// The line table is the lines-v2 block — the reference format: one entry row
// per line plus a full-width material/labor split beneath it, with the three
// money columns carrying their own running totals in the header. It lives
// outside this folder because it is shared with the line-item lab.
import { LinesV2 } from "../lines-v2/lines-v2";
// The handheld build of the same card. Not lazy: it is ~6KB beside a page that
// already ships the desk table, and a `dynamic()` here would blank the tallest
// card in the column for a frame on every phone load.
import { LinesMobile } from "../lines-mobile/lines-mobile";
import type { LineItemsProps } from "../lines-lab/lines-contract";
import { PaymentBlock } from "./bp-money";
import { MarkupBlock } from "./bp-markup";
import { PrintOptions, FilesBlock } from "./bp-blocks";
import { FenceSceneFigure } from "@/components/v3/fence-scene/fence-scene-figure";
import { DeckSceneFigure } from "@/components/v3/deck-scene/deck-scene-figure";
import { TheirCopy } from "./bp-proof";
// Card 11. The same proposal as PAPER — see the header of bp-pdf.tsx for why
// the file is produced by print CSS rather than by a PDF library.
import { DEFAULT_PDF_SETUP, PdfBlock, type PdfSetup } from "./bp-pdf";
import {
  addressOf,
  blankLine,
  emptyDraft,
  payloadFromDraft,
  proposalRef,
  whyNotSavable,
  type SheetIdentity,
} from "./manual-blueprint-bridge";
import { setClientEmail } from "@/actions/clients";
import type { ManualBuilderData } from "./manual-blueprint-load";
import { useReveal } from "./use-reveal";
import { useHandheld } from "./use-handheld";
import { ensureCompanyName } from "@/components/company-name/company-name-gate";

/**
 * The masthead chip. ONE state rather than a status enum plus a message,
 * because every one of these is "a sentence and how loudly to say it" — and a
 * chip that could be `saved` AND carry an error string is a state the page
 * would have to decide between at render time.
 */
type Note = { tone: "idle" | "live" | "ok" | "err"; text: string };
/** The origin never changes while the page is open: nothing to subscribe to. */
const noSubscribe = () => () => {};

const NOTE_NEW: Note = { tone: "idle", text: "Nothing saved yet" };
const NOTE_EDITED: Note = { tone: "live", text: "Edited — not saved" };

function contactOf(clients: ClientRecord[], choice: ClientChoice) {
  if (choice.mode !== "record") return { email: "", phone: "" };
  const rec = clients.find((c) => c.id === choice.id);
  return { email: rec?.email ?? "", phone: rec?.phone ?? "" };
}

/** Re-runs the address estimate, but ONLY while the rate is still automatic.
 *  The moment the field has been typed in, a later address change must not
 *  silently rewrite it.
 *
 *  `stateHint` is the selected client's own `state` column. It is tried FIRST
 *  because it is a fact, where the job-address parse is a guess: that parse
 *  scans the address string for a two-letter state token, so a client whose
 *  address was typed as one line ("12103 202nd St SE") carries no token, no
 *  state is found, and the tax field just sat at zero. */
function withTax(d: Draft, stateHint?: string): Draft {
  if (!d.taxAuto) return d;
  const code = (stateHint ?? "").trim().toUpperCase();
  const est = (code ? taxForState(code) : null) ?? estimateFromAddress(d.address);
  if (!est) return { ...d, taxState: "" };
  return { ...d, taxPct: est.pct, taxState: est.code };
}

/** The client record behind a choice, or undefined for a free-text/blank one. */
function recordOf(clients: ClientRecord[], choice: ClientChoice): ClientRecord | undefined {
  return choice.mode === "record" ? clients.find((c) => c.id === choice.id) : undefined;
}

/**
 * The draft this mount opens with.
 *
 * A reopened proposal wins outright. A new one is empty, then takes the client
 * from `?client=<id>` if the id resolved in this org — and its address with it,
 * which is the whole point of arriving from a client's record.
 */
function openingDraft(data: ManualBuilderData): Draft {
  const opened = data.proposal ? data.proposal.draft : emptyDraft(data.defaults);
  // A new proposal opened from a project page files under that project.
  const filed: Draft = !data.proposal && data.initialProjectId ? { ...opened, projectId: data.initialProjectId } : opened;
  // Opened from a lead (2026-09-22): the lead's words become the sheet —
  // the title, the overview and the scope of work — before the client is
  // settled below.
  const seed = !data.proposal ? data.seed : null;
  const base: Draft = seed ? { ...filed, title: seed.title, description: seed.words ?? "", scopeOfWork: seed.brief } : filed;
  const id = data.initialClientId;
  if (!id) {
    if (!seed) return base;
    // Nothing on file matched the lead's email or phone: a one-off name on
    // the sheet, with the lead's address; the send makes the client record.
    const next: Draft = { ...base, client: { mode: "freeText", name: seed.name }, address: seed.address ?? "" };
    return withTax(next, seed.state ?? undefined);
  }
  const rec = data.clients.find((c) => c.id === id);
  if (!rec) return base;
  const next: Draft = { ...base, client: { mode: "record", id } };
  // A reopened proposal has `addressAuto: false` and its own saved address, so
  // this only ever fills a blank sheet.
  if (next.addressAuto && !next.address) next.address = addressOf(rec);
  return withTax(next, rec.state);
}

export function ManualBlueprintContent({ data }: { data: ManualBuilderData }) {
  const [draft, setDraft] = useState<Draft>(() => openingDraft(data));
  const [clients, setClients] = useState<ClientRecord[]>(() => data.clients);
  const [contact, setContact] = useState(() => {
    // A lead with no record on file: its email and phone are the contact,
    // which is what a send needs to make the record (2026-09-22).
    if (!data.proposal && data.seed && !data.initialClientId) return { email: data.seed.email ?? "", phone: data.seed.phone ?? "" };
    return contactOf(
      data.clients,
      data.initialClientId
        ? { mode: "record", id: data.initialClientId }
        : { mode: "none" },
    );
  });
  const router = useRouter();
  // Set on a successful save or send: the panel that says so out loud and then
  // hands over to the proposals list. The bar's status chip alone was too quiet
  // to answer "did that work?" — a send that succeeded looked identical to a
  // click that never registered.
  const [done, setDone] = useState<{ sent: boolean; ref: string; text: string } | null>(null);
  // Set when "Save & send" is pressed against a client with no email on file.
  // The send is not refused — it is PAUSED on one question, and answering it
  // writes the address to the client record so the next proposal already has
  // it. `sendProposal` reads the client's stored email, so a value typed only
  // into the sheet's contact row would have gone nowhere.
  const [askEmail, setAskEmail] = useState<{ clientId: string; name: string } | null>(null);

  // Mirrors the ClientField's inline "add a new client" form — see the card
  // below, which hides the selected client's contact rows while it is open.
  const [addingClient, setAddingClient] = useState(false);
  const [openLines, setOpenLines] = useState<string[]>([]);
  const [note, setNote] = useState<Note>(() =>
    data.proposalMissing
      ? { tone: "err", text: "That proposal is gone — this is a new one" }
      : data.proposal
        ? { tone: "ok", text: `${data.proposal.ref} · ${data.proposal.status.toLowerCase()}` }
        : NOTE_NEW,
  );

  // The row this page is writing to. Seeded from `?proposal=<id>`; captured
  // from the first save otherwise, so every later write in the same session
  // UPDATES that row rather than creating a second one.
  const [savedId, setSavedId] = useState<string | null>(data.proposal?.id ?? null);
  /** The client's page exists once the proposal is saved — the link to copy or text (2026-09-24). */
  const [publicId, setPublicId] = useState<string | null>(data.proposal?.publicId ?? null);
  // A fence traced on the map gets a card of its own after the line items;
  // the cards after it move down one number.
  const fenceDrawing = !!data.proposal?.fenceDrawing;
  // A deck from the Deck Studio gets the same card, its 3D alone (2026-10-04).
  const deckDrawing = !!data.proposal?.deckDrawing;
  const drawing = fenceDrawing || deckDrawing;
  const N = (k: number) => String(drawing && k >= 4 ? k + 1 : k).padStart(2, "0");
  // The page's own host, for the link shown and copied: "" on the server and
  // on the first client paint (so they agree), the real origin right after.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const [identity, setIdentity] = useState<SheetIdentity>(data.identity);
  const [busy, setBusy] = useState<null | "save" | "send">(null);

  // The PDF's four page decisions. OUTSIDE `draft`, for the same reason
  // `contact` is: Draft is shared with four other card-lab variants and
  // describes the proposal, not the paper it is printed on. See PdfSetup.
  const [pdf, setPdf] = useState<PdfSetup>(DEFAULT_PDF_SETUP);

  // The fleet entrance cascade. Marker-driven, not children-driven — see
  // ./use-reveal.ts for why this page cannot use the donor's walk.
  useReveal();

  // Two of the eleven cards get a handheld build rather than a squeezed copy of
  // the desk one — the priced table (03) and the paper controls (11). See
  // ./use-handheld.ts.
  const handheld = useHandheld();

  /* Card 03's two builds behind one name. Both implement the lab's
     `LineItemsProps` contract — that contract exists precisely so a variant is
     a one-line swap — plus the builder's `hideTax`, so the annotation is the
     shared shape rather than either component's own. */
  const Lines: (props: LineItemsProps & { hideTax?: boolean }) => React.ReactNode = handheld
    ? LinesMobile
    : LinesV2;

  const totals = useMemo(() => computeTotals(draft), [draft]);
  /** What the client owes in total: this sheet plus every APPROVED change
   *  order, through the same helper the resolver, the portal and the invoice
   *  book use. A change order is not draft state — it is not edited or saved
   *  here — but it brings its own payment stage, so the coverage meter has to
   *  measure against it or a balanced schedule reads "over". */
  const contractValue = useMemo(
    () => contractTotal(totals.total, data.proposal?.changeOrders ?? []),
    [totals.total, data.proposal],
  );

  /* THE CLIENT PRICE PER LINE, for card 03 (owner, 2026-09-17: "where does
     the overhead and profit go?"). Once either sheet-level rate is on, every
     row and the foot also print the price the client is charged — the same
     figures card 10 prints — so the table and the total stop looking like two
     different jobs. Off at 0% / 0%, when cost and price are one number. */
  const clientPrices = useMemo(() => {
    if (!draft.overheadPct && !draft.profitPct) return undefined;
    const parts = [
      draft.overheadPct ? `${pct(draft.overheadPct)} overhead` : "",
      draft.profitPct ? `${pct(draft.profitPct)} profit` : "",
    ].filter(Boolean);
    const byId: Record<string, number> = {};
    for (const row of totals.printed) byId[row.id] = row.amount;
    return {
      byId,
      total: totals.preTax,
      note: `${parts.join(" and ")} ${draft.marginOnLabor ? "in the labor half of every line" : "spread across every line"}`,
    };
  }, [draft.overheadPct, draft.profitPct, draft.marginOnLabor, totals]);

  /* ---- editing ------------------------------------------------------ */

  const edit = (fn: (d: Draft) => Draft) => {
    setDraft(fn);
    setNote(NOTE_EDITED);
  };
  const patch = (p: Partial<Draft>) => edit((d) => ({ ...d, ...p }));

  const setClient = (choice: ClientChoice) => {
    edit((d) => {
      const next: Draft = { ...d, client: choice };
      const rec = recordOf(clients, choice);
      if (rec && d.addressAuto) next.address = addressOf(rec);
      return withTax(next, rec?.state);
    });
    setContact(contactOf(clients, choice));
  };

  /**
   * Inline "add a new client" — a REAL write now.
   *
   * The row the server returns is what lands in the roster and what the
   * proposal is filed against; the old build invented a local id, which would
   * have filed the proposal against a client that does not exist. Rejections
   * are re-thrown so the form prints them in place rather than closing over a
   * failure.
   */
  const createClientRecord = useCallback(async (input: NewClientInput) => {
    const created = await createClient({
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
    });
    const rec: ClientRecord = {
      id: created.id,
      name: created.name,
      email: created.email ?? "",
      phone: created.phone ?? "",
      address: created.address ?? "",
      city: created.city ?? "",
      state: created.state ?? "",
      zip: created.zip ?? "",
      tags: [],
    };
    setClients((list) => [...list, rec]);
    setDraft((d) =>
      withTax(
        {
          ...d,
          client: { mode: "record", id: rec.id },
          address: d.addressAuto && !d.address ? addressOf(rec) : d.address,
        },
        rec.state,
      ),
    );
    setContact({ email: rec.email, phone: rec.phone });
    setNote(NOTE_EDITED);
    return rec;
  }, []);

  const setAddress = (v: string) =>
    edit((d) => withTax({ ...d, address: v, addressAuto: false }));

  const patchLine = (id: string, p: Partial<Line>) =>
    edit((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) }));

  const addLine = () => edit((d) => ({ ...d, lines: [...d.lines, blankLine()] }));

  const removeLine = (id: string) => {
    edit((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));
    setOpenLines((ids) => ids.filter((x) => x !== id));
  };

  const patchInstallment = (id: string, p: Partial<Installment>) =>
    edit((d) => ({
      ...d,
      installments: d.installments.map((i) => (i.id === id ? { ...i, ...p } : i)),
    }));

  const addInstallment = () =>
    edit((d) => ({
      ...d,
      installments: [
        ...d.installments,
        { id: newId("in"), label: "", amount: 0, isPercent: true },
      ],
    }));

  const patchOptions = (p: Partial<ProposalOptions>) =>
    edit((d) => ({ ...d, options: { ...d.options, ...p } }));

  const addFiles = (staged: StagedFile[]) =>
    edit((d) => ({ ...d, files: [...d.files, ...staged] }));

  /**
   * The answer to that question. Writes the address onto the client RECORD —
   * the sheet's contact row is display state and never reaches the database,
   * so persisting there is the only thing that makes the send work — then
   * resumes the send it interrupted.
   */
  async function confirmEmail(email: string) {
    const ask = askEmail;
    if (!ask) return;
    const rec = clients.find((c) => c.id === ask.clientId);
    if (!rec) return;
    const next = { ...rec, email };
    await setClientEmail(ask.clientId, email);
    setClients((list) => list.map((c) => (c.id === ask.clientId ? next : c)));
    setContact((c) => ({ ...c, email }));
    setAskEmail(null);
    await persist({ sendAfter: true, sentTo: email });
  }

  /* ---- the two writes ----------------------------------------------- */

  /**
   * Save, and optionally send.
   *
   * The URL is rewritten with `history.replaceState` rather than `router.replace`
   * on purpose: the id has to survive a reload and a back-navigation, and a
   * router push here would re-render the server component and replay the whole
   * entrance cascade over a form the user is still typing in.
   */
  async function persist(
    opts?: { sendAfter?: boolean; sentTo?: string },
    /* The draft to write. Defaults to state; the one-off-client path below
       hands in a copy that already names the record it just created, because
       the setDraft it triggers has not flushed by the time the send runs. */
    draftOverride?: Draft,
  ) {
    /* THE SLIDERS ARE BAKED IN HERE (owner, 2026-09-05). Card 04's two cost
       adjustments are a tool until save: the saved lines carry the adjusted
       costs and the sliders go back to neutral — no memory of the original
       numbers after that. */
    const d = bakeAdjustments(draftOverride ?? draft);
    const why = whyNotSavable(d);
    if (why) {
      setNote({ tone: "err", text: why });
      // The chip is in the masthead, screens above the bar on a phone; the
      // bar's two buttons used to be DISABLED with the reason in a `title`,
      // which a touch screen never shows — so a tap on Save & send did
      // nothing at all. The buttons stay live and the reason is said here.
      toast.error(opts?.sendAfter ? "Can't send yet" : "Can't save yet", why);
      return;
    }
    // A send with nowhere to go used to complete "successfully" and report
    // "marked sent — no client email on file", which reads as a delivery.
    // Stop on the missing fact instead and ask for it.
    // `sentTo` is set by the gate's own resume and doubles as the "already
    // asked" flag: React has not flushed the updated `clients` yet at that
    // point, so re-running the check here would read the stale record and
    // reopen the dialog forever.
    if (opts?.sendAfter && !opts.sentTo) {
      const pick = d.client;
      /* A ONE-OFF NAME WITH AN EMAIL IS ENOUGH (owner's report, 2026-09-02:
         name, email and phone all filled in and the send still refused). The
         proposal is filed against a client RECORD — that is where the send
         reads its address — so the record is created here from what was
         typed, exactly as the inline "add a new client" form would, and the
         send carries on against it. */
      if (pick.mode === "freeText" && pick.name.trim()) {
        const email = contact.email.trim();
        if (!email || !email.includes("@")) {
          setNote({ tone: "err", text: "Add the client's email before sending" });
          toast.error("Can't send yet", "Add the client's email address in card 02 first");
          return;
        }
        try {
          const rec = await createClientRecord({
            name: pick.name.trim(),
            email,
            phone: contact.phone.trim(),
            address: d.address ?? "",
          });
          await persist(
            { sendAfter: true, sentTo: rec.email },
            { ...d, client: { mode: "record", id: rec.id } },
          );
        } catch (err: unknown) {
          const text = err instanceof Error && err.message ? err.message : "Couldn't save the client";
          setNote({ tone: "err", text });
          toast.error("Can't send yet", text);
        }
        return;
      }
      if (pick.mode !== "record") {
        setNote({ tone: "err", text: "Name the client before sending" });
        toast.error("Can't send yet", "Name the client in card 02 first");
        return;
      }
      const rec = clients.find((c) => c.id === pick.id);
      if (!rec?.email?.trim()) {
        setAskEmail({ clientId: pick.id, name: rec?.name ?? "this client" });
        return;
      }
    }
    // A brand-new proposal counts against the monthly cap; the dialog the shell
    // already mounts is what explains it.
    if (!savedId && !(await ensureWithinLimit("proposalsCreated"))) return;
    // The first send to a client names the business first (lib/orgName).
    if (opts?.sendAfter && !(await ensureCompanyName())) return;

    setBusy(opts?.sendAfter ? "send" : "save");
    setNote({ tone: "live", text: "Saving…" });
    try {
      const res = await saveProposal(payloadFromDraft(d, savedId ?? undefined));
      setSavedId(res.id);
      setPublicId(res.publicId);
      // What was saved is what the sheet now holds: the baked costs, the two
      // sliders at zero. Merged, not replaced, so an edit made while the save
      // was in flight is not thrown away.
      setDraft((cur) => ({
        ...cur,
        lines: d.lines,
        materialMarkupPct: 0,
        laborMarkupPct: 0,
      }));
      const ref = proposalRef(res.publicId);
      setIdentity((prev) => ({ ...prev, ref }));
      window.history.replaceState(
        null,
        "",
        `/dashboard/manual-blueprint?proposal=${encodeURIComponent(res.id)}`,
      );

      if (opts?.sendAfter) {
        setNote({ tone: "live", text: "Sending…" });
        await sendProposal(res.id);
        // `sendProposal` sends to the CLIENT RECORD's address, so that is the
        // one this line may name — handed in by the gate when it just wrote it,
        // read from the record otherwise. The gate guarantees one exists.
        const to =
          opts.sentTo ||
          clients.find((c) => (d.client.mode === "record" ? c.id === d.client.id : false))
            ?.email ||
          "";
        // No corner toast on success (owner, 2026-09-02): the panel below
        // already says it, centred, and two notices for one save read as two
        // events. The masthead chip keeps the short form for after the panel
        // is dismissed.
        const text = to ? `${ref} was sent to ${to}` : `${ref} was sent`;
        setNote({ tone: "ok", text });
        setDone({ sent: true, ref, text });
      } else {
        const text = `${ref} was saved to your proposals`;
        setNote({ tone: "ok", text });
        setDone({ sent: false, ref, text });
      }
    } catch (err: unknown) {
      if (reportPlanLimit(err)) {
        setNote({ tone: "err", text: "Monthly proposal limit reached" });
        return;
      }
      // A zod failure serialises to a JSON array — never surface that raw.
      const raw = err instanceof Error ? err.message : "";
      const text =
        raw && !raw.trim().startsWith("[")
          ? raw
          : "Save failed — check the title and that every line has a name";
      setNote({ tone: "err", text });
      // The chip in the masthead is easy to miss from the bar at the bottom of
      // a long sheet, which is how a failed send read as a dead button.
      toast.error(opts?.sendAfter ? "Couldn't send" : "Couldn't save", text);
    } finally {
      setBusy(null);
    }
  }

  /* ---- derived ------------------------------------------------------ */

  // Bound to a const first: narrowing a discriminated union through
  // `draft.client.mode` is lost the moment the check crosses into the `find`
  // callback, because `draft` is not provably unchanged in there.
  const choice = draft.client;
  const clientName =
    choice.mode === "record"
      ? (clients.find((c) => c.id === choice.id)?.name ?? "")
      : choice.mode === "freeText"
        ? choice.name.trim()
        : "";

  // The project's NAME, not its id: the client's copy and the PDF both name it,
  // and neither has any business printing a cuid.
  const projectName = data.projects.find((p) => p.id === draft.projectId)?.name ?? "";

  const blocked = whyNotSavable(draft);
  const working = busy !== null;

  return (
    <div className={styles.page}>
      {/* The lead this sheet was opened from; the strip keeps it past the seed-spending refresh. */}
      <EstimateSeedStrip seed={!data.proposal ? data.seed : null} />
      <div className={cx("page-head", styles.head)} data-rv="">
        <div>
          <div className="kicker">Proposal builder</div>
          <h1 className="page-title">Manual proposal</h1>
        </div>
        {/* ── THE MASTHEAD'S ANNOTATIONS, IN TWO BUILDS ────────────────
            On the desk they are a right-aligned column hanging off the
            title: reference, org, save state, three sizes and three
            colours, read as a margin note beside a 46px heading.

            At 390 that column has nowhere to hang. Stacked left under the
            title it became three unlabelled lines of near-identical
            weight — "DRAFT · 2026-09-01", then a company name, then a
            sentence about saving — and nothing said which of the three was
            a fact about the document and which was a fact about THIS
            MOMENT. The one that changes while you work was the quietest.

            The handheld build separates those two questions. The save
            state is promoted to a plate that carries its own tone (idle /
            working / saved / blocked), because it is a status and a status
            should look like one. Everything the document simply IS — its
            reference, its date, whose it is — collapses onto ONE mono
            annotation line under it, which is what the mono layer is for
            on this page. Two rows, in rank order, instead of three that
            rank equally. */}
        {handheld ? (
          <div className={styles.metaMob}>
            <span
              className={cx(
                styles.mstat,
                note.tone === "live" && styles.mstatLive,
                note.tone === "ok" && styles.mstatOk,
                note.tone === "err" && styles.mstatErr,
              )}
              role="status"
            >
              <span className={styles.mstatDot} aria-hidden="true" />
              {note.text}
            </span>
            <span className={styles.mline}>
              {identity.ref}
              <span className={styles.mlineSep} aria-hidden="true">
                ·
              </span>
              {identity.date}
              {identity.orgName ? (
                <>
                  <span className={styles.mlineSep} aria-hidden="true">
                    ·
                  </span>
                  {identity.orgName}
                </>
              ) : null}
            </span>
          </div>
        ) : (
          <div className={styles.meta}>
            <span className={styles.metaMono}>
              {identity.ref} · {identity.date}
            </span>
            <span className={styles.metaOrg}>{identity.orgName}</span>
            <span className={styles.state} role="status">
              <span
                className={cx(
                  styles.stateDot,
                  (note.tone === "live" || note.tone === "err") && styles.stateDotLive,
                )}
              />
              {note.text}
            </span>
          </div>
        )}
      </div>

      <div className={styles.stack}>
        {/* 01 ------------------------------------------------------- */}
        <Card num="01" title="The job" id="q-01">
          <Group>
            <Field label="Title" htmlFor="q-title">
              <TextField
                id="q-title"
                value={draft.title}
                onChange={(v) => patch({ title: v })}
                placeholder="What is this proposal for?"
              />
            </Field>
            <ProjectField
              projects={data.projects}
              value={draft.projectId}
              onChange={(id) => patch({ projectId: id })}
              // Stored on the proposal since 2026-09-18: the proposal, its
              // change orders and its job show on the project.
              hint="Groups it with the project's other proposals"
            />
          </Group>
          <Field label="Overview" htmlFor="q-overview">
            <TextArea
              id="q-overview"
              rows={4}
              value={draft.description}
              onChange={(v) => patch({ description: v })}
            />
          </Field>
        </Card>

        {/* 02 ------------------------------------------------------- */}
        <Card num="02" title="The client" id="q-02">
          <Group>
            <ClientField
              clients={clients}
              choice={draft.client}
              onChoice={setClient}
              onCreate={createClientRecord}
              onCreatingChange={setAddingClient}
            />
            {/* The contact rows describe the SELECTED client. While the inline
                "add a new client" form is open it collects its own email, phone
                and address, so showing these underneath stacked two identical
                sets of boxes on one card — the lower pair looking editable but
                belonging to a client that has not been chosen yet. They come
                back the moment the form is closed or the client is saved. */}
            {!addingClient && (
            <Pair>
              <Field
                label="Email"
                htmlFor="q-email"
                hint={
                  draft.client.mode === "record" ? "From the client record" : undefined
                }
              >
                <TextField
                  id="q-email"
                  value={contact.email}
                  onChange={(v) => {
                    setContact((c) => ({ ...c, email: v }));
                    setNote(NOTE_EDITED);
                  }}
                />
              </Field>
              <Field label="Phone" htmlFor="q-phone">
                <TextField
                  id="q-phone"
                  value={contact.phone}
                  onChange={(v) => {
                    setContact((c) => ({ ...c, phone: v }));
                    setNote(NOTE_EDITED);
                  }}
                />
              </Field>
            </Pair>
            )}
          </Group>
          {!addingClient && (
            <Field
              label="Job address"
              htmlFor="q-address"
              hint={draft.addressAuto ? "From the client record" : undefined}
            >
              <TextField id="q-address" value={draft.address} onChange={setAddress} />
            </Field>
          )}
        </Card>

        {/* 03 ------------------------------------------------------- */}
        {/* `wide` — the priced table is ~860px on its own grid, which is wider
            than a phone and is not a layout to squeeze. At handheld width it
            scrolls inside this card rather than panning the whole column. */}
        {/* `wide` is the DESK card's escape hatch — the seven-column priced
            table is ~860px and scrolls inside the card rather than taking the
            whole column sideways. The handheld build has no table and no
            overflow, so it must not get a scroll container: `wide` also clips,
            and the row's unit <select> hangs its popup outside the body. */}
        <Card num="03" title="Line items" id="q-03" wide={!handheld}>
          <Lines
            lines={draft.lines}
            openIds={openLines}
            onToggle={(id) =>
              setOpenLines((ids) =>
                ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
              )
            }
            onPatch={patchLine}
            onAdd={addLine}
            onRemove={removeLine}
            baseTotal={totals.baseTotal}
            adjust={{ materialPct: draft.materialMarkupPct, laborPct: draft.laborMarkupPct }}
            client={clientPrices}
            namedCount={totals.printed.length}
            unnamedCount={totals.unnamedCount}
            taxPct={draft.taxPct}
            taxAuto={draft.taxAuto}
            taxState={draft.taxState}
            onTaxPct={(n) => patch({ taxPct: n, taxAuto: false, taxState: "" })}
            // Tax lives in card 04 now, in the chain between the subtotal and
            // the grand total, with the note explaining where the rate came
            // from. Rendering it here too would be the same control in two
            // cards. The props still flow so the block stays contract-shaped.
            hideTax
          />
        </Card>

        {/* 04 (a fence traced on the map) — THE DRAWING. The 3D the estimator
            showed and the fence on the lot, both from the stored plan — the two
            the client's page carries (2026-09-27: "when I open the fence
            proposal after saving, it shows no 3D and no layout"). */}
        {deckDrawing && publicId ? (
          <Card num="04" title="The drawing" id="q-drawing">
            <DeckSceneFigure className={styles.drawingScene} src={`/api/public-quote/${publicId}/deck-scene`} caption="In 3D" facts="Drag to look around · Build it stands it up layer by layer" />
            <p className={styles.drawingNote}>The client&apos;s page carries the same 3D, frozen as it was priced.</p>
            {/* Open it again (owner, 2026-10-12): the studio re-prices THIS proposal from the changed design. */}
            {data.proposal?.deckEditable ? (
              <div className={styles.drawingEdit} data-deck-edit>
                <a className={cx(styles.btn, styles.btnPrimary)} href={`/dashboard/deck-estimator?proposal=${encodeURIComponent(data.proposal.id)}`}>
                  <Ic name="pen" />
                  Edit the deck design
                </a>
                <span>Opens it in the Deck Studio. Change anything, then Update the proposal re-prices this one — lines you added here stay.</span>
              </div>
            ) : null}
          </Card>
        ) : null}
        {fenceDrawing && publicId ? (
          <Card num="04" title="The drawing" id="q-drawing">
            <div className={styles.drawing}>
              <FenceSceneFigure className={styles.drawingScene} src={`/api/public-quote/${publicId}/fence-scene`} caption="In 3D" facts="Drag to look around · click to walk through" />
              <figure className={styles.drawingPlan}>
                {/* eslint-disable-next-line @next/next/no-img-element -- drawn by this app's own route */}
                <img src={`/api/public-quote/${publicId}/fence-plan`} alt="The fence on the lot" loading="lazy" />
                <figcaption>On the lot</figcaption>
              </figure>
            </div>
            <p className={styles.drawingNote}>The client&apos;s page carries both — the 3D to look around, the layout to keep.</p>
          </Card>
        ) : null}


        {/* 04 — SIX controls on the left, an ESTIMATE plate on the right, and
            a margin badge. The plate now runs the WHOLE chain and ends on the
            grand total, so discount and tax had to come with it: a card that
            prints the final figure while two of its inputs live on a different
            card is the "hold a number in your head while you scroll" failure.

            Still deliberately NOT merged with the deposits below — the split is
            by question ("what am I charging?" vs "when do they pay it?"), not
            by arithmetic. ------------------------------------------- */}
        <Card num={N(4)} title="Cost adjustment" id="q-04">
          <MarkupBlock
            materialMarkupPct={draft.materialMarkupPct}
            laborMarkupPct={draft.laborMarkupPct}
            overheadPct={draft.overheadPct}
            profitPct={draft.profitPct}
            onMaterialMarkupPct={(n) => patch({ materialMarkupPct: n })}
            onLaborMarkupPct={(n) => patch({ laborMarkupPct: n })}
            onOverheadPct={(n) => patch({ overheadPct: n })}
            onProfitPct={(n) => patch({ profitPct: n })}
            marginOnLabor={draft.marginOnLabor === true}
            onMarginOnLabor={(v) => patch({ marginOnLabor: v })}
            discountPct={draft.discountPct}
            // The two dollar-mode fields are OPTIONAL on Draft so the sibling
            // manual-focus route is untouched by their addition; the defaults
            // are applied here, at the one boundary that knows about them.
            discountFlat={draft.discountFlat ?? 0}
            discountIsPercent={draft.discountIsPercent ?? true}
            taxPct={draft.taxPct}
            taxAuto={draft.taxAuto}
            taxState={draft.taxState}
            onPatch={patch}
            onTaxPct={(n) => patch({ taxPct: n, taxAuto: false, taxState: "" })}
            totals={totals}
            priceOnly={data.proposal?.priceOnly === true}
          />
        </Card>

        {/* 05 ------------------------------------------------------- */}
        <Card num={N(5)} title="Scope & notes" id="q-05">
          <Field label="Scope of work" htmlFor="q-scope">
            <TextArea
              id="q-scope"
              rows={7}
              value={draft.scopeOfWork}
              onChange={(v) => patch({ scopeOfWork: v })}
            />
          </Field>
          <Field label="Internal notes" htmlFor="q-notes" hint="Never printed.">
            <TextArea
              id="q-notes"
              rows={3}
              value={draft.notes}
              onChange={(v) => patch({ notes: v })}
            />
          </Field>
        </Card>

        {/* 06 ------------------------------------------------------- */}
        <Card num={N(6)} title="Show to client" id="q-06">
          <PrintOptions options={draft.options} onPatch={patchOptions} />
        </Card>

        {/* 07 ------------------------------------------------------- */}
        <Card num={N(7)} title="Terms" id="q-07">
          <Field
            label="Terms & conditions"
            htmlFor="q-terms"
            hint="Prints on the sheet — not stored on the proposal yet"
          >
            <TextArea
              id="q-terms"
              rows={7}
              value={draft.terms}
              onChange={(v) => patch({ terms: v })}
              placeholder="Nothing here yet."
            />
          </Field>
          {draft.terms.trim() === "" ? (
            <Btn tone="add" icon="pen" onClick={() => patch({ terms: TERMS_TEMPLATE })}>
              Insert starter template
            </Btn>
          ) : null}
        </Card>

        {/* 08 — WHEN it is paid, and nothing else. The four-row receipt that
            used to sit above these fields is gone: card 04 now runs the whole
            chain and ends on the grand total, and printing the same arithmetic
            again here — a scroll away, with no way to tell which was
            authoritative — was the one-number-many-places failure at its
            worst. The schedule divides a figure produced up there; the coverage
            meter is what says whether the division adds up. ------------ */}
        <Card num={N(8)} title="Payment & deposits" id="q-08">
          <PaymentBlock
            installments={draft.installments}
            total={contractValue}
            pctBase={totals.total}
            onPatch={patchInstallment}
            onAdd={addInstallment}
            onRemove={(id) =>
              edit((d) => ({ ...d, installments: d.installments.filter((i) => i.id !== id) }))
            }
          />
        </Card>

        {/* 09 ------------------------------------------------------- */}
        <Card num={N(9)} title="Files" id="q-09">
          <FilesBlock
            files={draft.files}
            onAdd={addFiles}
            onRemove={(id) => edit((d) => ({ ...d, files: d.files.filter((f) => f.id !== id) }))}
          />
          {/* FROM THE CREW (2026-09-27): the photos and videos shot on this
              proposal's job, as they come in from the phones. Each opens the
              job's Photos tab; nothing here is staged or removed — the job
              page is where the office manages them. */}
          {data.proposal?.media && data.proposal.media.length > 0 ? (
            <div className={styles.crewMedia} data-crew-media>
              <div className={styles.crewMediaH}>
                <b>From the crew</b>
                <span>{data.proposal.media.length} {data.proposal.media.length === 1 ? "file" : "files"} on the job</span>
              </div>
              <div className={styles.crewMediaGrid}>
                {data.proposal.media.map((m) => (
                  <a key={m.id} className={styles.crewMediaItem} href={`/dashboard/jobs/${m.jobId}`} title={`${m.kind} · ${m.when}${m.by ? ` · ${m.by}` : ""}`} data-media={m.media}>
                    {m.media === "video" ? (
                      <video src={m.url} preload="metadata" muted playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- a data: URL or the store; next/image adds nothing
                      <img src={m.url} alt={m.kind} loading="lazy" />
                    )}
                    <span className={styles.crewMediaTag}>{m.media === "video" ? "video · " : ""}{m.kind}</span>
                    <span className={styles.crewMediaBy}>{m.when}{m.by ? ` · ${m.by}` : ""}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        {/* 10 ------------------------------------------------------- */}
        <Card num={N(10)} title="Their copy" id="q-10" sheet>
          {publicId ? (
            <div className={styles.shareRow} data-client-link>
              <Btn
                icon="link"
                title="Copy the client's link to paste into a text"
                onClick={() => {
                  const url = clientProposalUrl(publicId, origin || undefined);
                  navigator.clipboard.writeText(url).then(
                    () => setNote({ tone: "ok", text: "Client link copied — paste it into a text." }),
                    () => setNote({ tone: "err", text: `Couldn't copy. The link: ${url}` }),
                  );
                }}
              >
                Copy client link
              </Btn>
              <Btn
                icon="phone"
                title="Opens your messages with the link filled in"
                onClick={() => {
                  window.location.assign(
                    smsHref(
                      contactOf(clients, draft.client).phone,
                      proposalTextMessage({ org: identity.orgName, clientName, title: draft.title, link: clientProposalUrl(publicId, origin || undefined) }),
                    ),
                  );
                }}
              >
                Text the link
              </Btn>
              <span className={styles.shareNote}>{clientProposalUrl(publicId, origin).replace(/^https?:\/\//, "")}</span>
            </div>
          ) : null}
          <TheirCopy
            identity={identity}
            title={draft.title}
            clientName={clientName}
            address={draft.address}
            scopeOfWork={draft.scopeOfWork}
            terms={draft.terms}
            taxPct={draft.taxPct}
            discountPct={draft.discountIsPercent === false ? 0 : draft.discountPct}
            options={draft.options}
            totals={totals}
          />
        </Card>

        {/* 11 — THE SAME PROPOSAL AS PAPER.
            Card 10 answers "what will they see"; this answers "what will they
            receive". It is a separate card and not a button on card 10 because
            the document has decisions of its own — trim size, cover, running
            furniture — and none of them belongs to the on-screen copy.

            It carries `sheet` as card 10 does: the column now ends on a
            two-card coda, the same artifact in two media, and both are
            documents rather than forms. */}
        <Card num={N(11)} title="The PDF" id="q-11" sheet>
          <PdfBlock
            setup={pdf}
            onPatch={(p) => {
              setPdf((s) => ({ ...s, ...p }));
              // These change what the client receives, so they count as an
              // edit even though they live outside the draft.
              setNote(NOTE_EDITED);
            }}
            doc={{
              identity,
              title: draft.title,
              clientName,
              email: contact.email,
              phone: contact.phone,
              address: draft.address,
              projectName,
              description: draft.description,
              scopeOfWork: draft.scopeOfWork,
              terms: draft.terms,
              taxPct: draft.taxPct,
              options: draft.options,
              totals,
              installments: draft.installments,
              files: draft.files,
            }}
          />
        </Card>
      </div>

      {askEmail && (
        <EmailPanel
          name={askEmail.name}
          onCancel={() => setAskEmail(null)}
          onConfirm={confirmEmail}
        />
      )}

      {done && (
        <DonePanel
          sent={done.sent}
          proposalRef={done.ref}
          text={done.text}
          onGo={() => router.push("/dashboard/proposals" as Route)}
          onStay={() => setDone(null)}
        />
      )}

      {/* THE ONE PERSISTENT DEVICE ---------------------------------- */}
      <div className={styles.bar} data-rv="">
        <div className={styles.barTotal}>
          <div className={styles.barLabel}>Grand total</div>
          {/* The figure steps down a size past 13 characters
              ("$1,234,567.89"), the last that fits beside the two actions on
              a 390px bar, and may break past that — a capped line is still
              a 22-character total, and a 24px figure that could not break
              ran 240px past the screen. */}
          <div
            className={cx(styles.barMoney, money(totals.total).length > 12 && styles.barMoneyLong)}
          >
            {money(totals.total)}
          </div>
        </div>
        {/* The two actions that move the proposal forward, and nothing else —
            which is what a persistent bar should carry. Both are DISABLED
            rather than hidden while the sheet is not savable, and the reason
            travels in `title` and in the masthead chip. */}
        <div className={styles.barActions}>
          <Btn onClick={() => void persist()} disabled={working} title={blocked ?? undefined}>
            {busy === "save" ? "Saving…" : "Save"}
          </Btn>
          <Btn
            tone="primary"
            icon="send"
            onClick={() => void persist({ sendAfter: true })}
            disabled={working}
            title={blocked ?? undefined}
          >
            {busy === "send" ? "Sending…" : "Save & send"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/**
 * What a finished save or send looks like.
 *
 * The bar's status chip lives at the bottom of a sheet that can run several
 * screens; a person who clicks "Save & send" and stays where they are gets no
 * answer they can see. This says what happened, then hands over to the
 * proposals list on a five-second clock — with a way out for anyone who wants
 * to keep editing, because a redirect nobody can stop is its own bug.
 *
 * Portalled into <body>: the builder's own column is a transformed, scrolling
 * surface, and a fixed overlay hosted inside it would be clipped by the column
 * instead of covering the viewport.
 */
/**
 * "Where should this go?" — the one question a send with no client email has to
 * answer before it can mean anything.
 *
 * Same plate as DonePanel, portalled to the same host for the same reasons; see
 * the note there. It is a PAUSE, not a refusal: Escape and Cancel abandon the
 * send, and confirming writes the address to the client record and resumes it.
 */
function EmailPanel({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: (email: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function submit() {
    const email = value.trim();
    // The shape check is the page's, so a typo is caught before a round trip;
    // the action parses it again, which is the boundary that actually counts.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErr("Enter a valid email address");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onConfirm(email);
    } catch (e: unknown) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Couldn't save that address");
    }
  }

  if (typeof document === "undefined") return null;
  const host = document.querySelector<HTMLElement>(".jf-blueprint") ?? document.body;

  return createPortal(
    <div
      className={styles.doneWrap}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mb-email-h"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.doneBox}>
        <p className={styles.doneKicker}>Send</p>
        <h2 className={styles.doneH} id="mb-email-h">
          Where should this go?
        </h2>
        <p className={styles.doneText}>
          {name} has no email on file. Add one and the proposal goes out now — it is
          saved to the client, so the next one already has it.
        </p>
        <input
          ref={inputRef}
          className={styles.emailIn}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="name@company.com"
          value={value}
          aria-invalid={err ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (err) setErr("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {err ? (
          <p className={styles.emailErr} role="alert">
            {err}
          </p>
        ) : null}
        <div className={styles.doneActions}>
          <Btn tone="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Sending…" : "Send proposal"}
          </Btn>
          <Btn tone="quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
        </div>
      </div>
    </div>,
    host,
  );
}

function DonePanel({
  sent,
  proposalRef,
  text,
  onGo,
  onStay,
}: {
  sent: boolean;
  /** The sheet's number — the one thing on the panel worth remembering. */
  proposalRef: string;
  /** The whole sentence, beginning with that number. */
  text: string;
  onGo: () => void;
  onStay: () => void;
}) {
  const [left, setLeft] = useState(REDIRECT_SECONDS);
  useEffect(() => {
    if (left <= 0) {
      onGo();
      return;
    }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, onGo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStay();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStay]);

  if (typeof document === "undefined") return null;

  // The shell root, NOT <body>. Every rule this panel paints with resolves
  // against tokens declared on that root (`--ink`, `--border`, `--radius`,
  // `--blueprint`, `--muted`, `--font-mono`), and `Btn` is styled
  // `:global(.jf-blueprint) .btn` — it needs `.jf-blueprint` as an ANCESTOR.
  // Portalled into <body> the panel lost all of it at once: the 2px frame and
  // the hard offset shadow vanished, the kicker went grey, and the two actions
  // rendered as bare text. The root is untransformed, so a fixed overlay still
  // covers the viewport — which is the reason the portal exists at all.
  const host = document.querySelector<HTMLElement>(".jf-blueprint") ?? document.body;

  return createPortal(
    <div className={styles.doneWrap} role="dialog" aria-modal="true" aria-labelledby="mb-done-h">
      <div className={styles.doneBox}>
        <p className={styles.doneKicker}>{sent ? "Sent" : "Saved"}</p>
        <h2 className={styles.doneH} id="mb-done-h">
          {sent ? "Your proposal is on its way." : "Your proposal is saved."}
        </h2>
        <p className={styles.doneText}>
          <b className={styles.doneRef}>{proposalRef}</b>
          {text.startsWith(proposalRef) ? text.slice(proposalRef.length) : ` ${text}`}
        </p>
        <p className={styles.doneCount} role="status">
          Taking you to your proposals in {left}…
        </p>
        {/* The same five seconds, drawn: a rule that empties as the clock
            runs, so the panel says "this page is leaving" without the line
            above having to be read. */}
        <div className={styles.doneBar} aria-hidden="true">
          <span style={{ width: `${(left / REDIRECT_SECONDS) * 100}%` }} />
        </div>
        <div className={styles.doneActions}>
          <Btn tone="primary" onClick={onGo}>
            Go now
          </Btn>
          <Btn tone="quiet" onClick={onStay}>
            Stay on this sheet
          </Btn>
        </div>
      </div>
    </div>,
    host,
  );
}
