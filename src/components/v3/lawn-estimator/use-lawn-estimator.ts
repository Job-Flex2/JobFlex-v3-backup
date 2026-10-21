"use client";
// THE LAWN ESTIMATOR'S STATE (2026-10-20): the read, the brush edits, the pricing and the writes, lifted out of
// lawn-estimator.tsx so the desk page and the phone page (mobile-lawn-estimator) run the same estimator. Each page
// passes the URL it lives at; drafts open and save there. Nothing here draws.
import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { CLS } from "@/lib/lawn/classify";
import { decodeLabels, encodeLabels, lotMaskOf, measureSite, withYard, type LawnSite } from "@/lib/lawn/site";
import { countPiece, DEFAULT_REACH_FT, fillPiece, keepYard, reReach } from "@/lib/lawn/yard";
import type { Pt } from "@/lib/lawn/geo";
import { DEFAULT_LAWN_SETTINGS, DEFAULT_OPTIONS, priceYard, type LawnSettings, type PricedService, type ServiceId, type ServiceOptions } from "@/lib/lawn/pricing";
import { monthsOf } from "@/lib/lawn/season";
import { rulesAt } from "@/lib/lawn/rules";
import { planTotals, seasonCalendar, type PlanVisit } from "@/lib/lawn/calendar";
import { lawnTaxed } from "@/lib/lawn/tax";
import { convertLawnToProposal, createLawnPlan, deleteLawnDraft, listLawnDrafts, loadLawnDraft, readLawnProperty, readLawnSettings, saveLawnDraft, type LawnClient, type LawnDraftRow } from "@/actions/lawnEstimator";

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });
export const sqft = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;
/** An area the way a landscaper says it: square feet, or acres once it's past half of one. */
export const area = (n: number) => (n >= 21780 ? `${(n / 43560).toFixed(2)} acres` : sqft(n));
export const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The read's steps, in the order the server works through them. */
export const READ_STEPS = ["Find the address and the lot line", "Read the USDA aerial photo", "Tell lawn from trees", "Measure the slope", "Count the lawn, beds and edges"] as const;
/** Where the progress bar stands on each step (the read is timed, not reported). */
const READ_PCT = [8, 27, 46, 66, 86];

export const PAINTS: Array<{ cls: number; label: string }> = [
  { cls: CLS.LAWN, label: "Lawn" },
  { cls: CLS.BED, label: "Bed" },
  { cls: CLS.TREE, label: "Tree" },
  { cls: CLS.HARD, label: "Paving" },
  { cls: CLS.NATURAL, label: "Not serviced" },
];

/** Ticked by default: the season's core, and what the yard plainly needs. */
function defaultPicked(sv: PricedService[]): Set<ServiceId> {
  const on = new Set<ServiceId>(["mow", "fert", "aerate", "springCleanup", "fallCleanup", "mulch", "irrigationStart", "irrigationBlowout", "shrubs", "hedges", "snow"]);
  return new Set(sv.filter((x) => on.has(x.id)).map((x) => x.id));
}

export function useLawnEstimator({ initialDraftId, basePath }: { initialDraftId?: string | null; basePath: string }) {
  const router = useRouter();
  // The init effect stays keyed on the draft alone; the router rides in a ref (blueprint hard-nav memory).
  const routerRef = React.useRef(router);
  React.useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [phase, setPhase] = React.useState<"start" | "reading" | "site">(initialDraftId ? "reading" : "start");
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [site, setSite] = React.useState<LawnSite | null>(null);
  const [labels, setLabels] = React.useState<Uint8Array | null>(null);
  // Undo goes back to the labels and the reach they were picked out at.
  const [past, setPast] = React.useState<Array<{ labels: Uint8Array; reachFt: number | null | undefined }>>([]);
  const [settings, setSettings] = React.useState<LawnSettings>(DEFAULT_LAWN_SETTINGS);
  const [ownRate, setOwnRate] = React.useState(false);
  const [options, setOptions] = React.useState<ServiceOptions>(DEFAULT_OPTIONS);
  const [picked, setPicked] = React.useState<Set<ServiceId> | null>(null);
  const [paint, setPaint] = React.useState<number | null>(null);
  const [tapping, setTapping] = React.useState(false);
  const [tapNote, setTapNote] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState<"yard" | "lot">("yard");
  const [brushFt, setBrushFt] = React.useState(4);
  const [view, setView] = React.useState<"both" | "photo" | "classes">("both");
  const [drawingLot, setDrawingLot] = React.useState<Pt[] | null>(null);
  const [drafts, setDrafts] = React.useState<LawnDraftRow[]>([]);
  const [draftsLoaded, setDraftsLoaded] = React.useState(false);
  const [draftId, setDraftId] = React.useState<string | null>(initialDraftId ?? null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [client, setClient] = React.useState<LawnClient | null>(null);
  const [made, setMade] = React.useState<string | null>(null);
  const [readStep, setReadStep] = React.useState(0);
  const [readingAddress, setReadingAddress] = React.useState<string>("");
  const [plan, setPlan] = React.useState<{ id: string; sent: boolean; emailed: boolean; href: string | null } | null>(null);
  const [sendPlanToo, setSendPlanToo] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    readLawnSettings().then((r) => {
      if (live && r.ok) {
        setSettings(r.settings);
        setOwnRate(r.own);
      }
    });
    listLawnDrafts().then((r) => {
      if (!live) return;
      if (r.ok) setDrafts(r.drafts);
      setDraftsLoaded(true);
    });
    if (initialDraftId)
      loadLawnDraft(initialDraftId).then((r) => {
        if (!live) return;
        if (!r.ok) {
          setError(r.error);
          setPhase("start");
          return;
        }
        const d = r.draft;
        const opened = withYard(d.site, decodeLabels(d.site.labels, d.site.grid.w * d.site.grid.h));
        setSite(opened.site);
        setLabels(opened.labels);
        setOptions(d.options);
        setPicked(new Set(d.picked as ServiceId[]));
        setSavedAt(r.updatedAt);
        setPhase("site");
      });
    return () => {
      live = false;
    };
  }, [initialDraftId]);

  // The read takes a few seconds; say what it's doing while it does.
  React.useEffect(() => {
    if (phase !== "reading") return;
    const t = setInterval(() => setReadStep((n) => Math.min(n + 1, READ_STEPS.length - 1)), 1600);
    return () => clearInterval(t);
  }, [phase]);

  const read = async (input: { address?: string; lat?: number; lng?: number; ring?: Array<{ lat: number; lng: number }> }) => {
    setError(null);
    setReadStep(0);
    setReadingAddress(input.address ?? site?.address ?? "");
    setPhase("reading");
    const r = await readLawnProperty(input);
    if (!r.ok) {
      setError(r.error);
      setPhase(site ? "site" : "start");
      return;
    }
    setSite(r.site);
    setLabels(decodeLabels(r.site.labels, r.site.grid.w * r.site.grid.h));
    setPast([]);
    setPicked(null);
    setMade(null);
    setDrawingLot(null);
    setOptions((o) => ({ ...o, stories: r.site.lot.stories && r.site.lot.stories > 0 ? Math.min(4, r.site.lot.stories) : o.stories }));
    setPhase("site");
  };

  const lotInfo = React.useMemo(() => (site ? lotMaskOf(site) : null), [site]);
  // The photo's own reading, before the yard was picked out of it: "As read", a reach change and "count it in" go back to it.
  const asRead = React.useMemo(() => (site ? decodeLabels(site.readLabels, site.grid.w * site.grid.h) : null), [site]);
  const measures = React.useMemo(() => (site && labels ? measureSite(site, labels) : null), [site, labels]);
  const quote = React.useMemo(() => (site && measures ? priceYard({ measures, settings, options, locationFactor: site.locationFactor, state: site.state, ownRate }) : null), [site, measures, settings, options, ownRate]);
  const chosen = React.useMemo(() => picked ?? (quote ? defaultPicked(quote.services) : new Set<ServiceId>()), [picked, quote]);
  const rules = React.useMemo(() => (site ? rulesAt(site.state, site.county ?? null, site.place) : null), [site]);
  // The season, date by date, from today: what the plan books and what the proposal counts.
  const calendar = React.useMemo<PlanVisit[]>(() => (quote && rules ? seasonCalendar({ start: new Date(), quote, picked: chosen, fertRounds: options.fertRounds, frequency: options.frequency, rules, crewSize: settings.crewSize }) : []), [quote, rules, chosen, options.fertRounds, options.frequency, settings.crewSize]);
  const lines = React.useMemo(() => {
    if (!quote) return [];
    const count = (id: ServiceId) => calendar.filter((v) => v.service === id).length;
    // Visits the calendar books are counted from it (mowing, bed weeding, fertilizer rounds the rules left in).
    return quote.services.filter((x) => chosen.has(x.id)).map((x) => (x.id === "mow" || x.id === "bedWeeding" || x.id === "fert" ? { ...x, qty: count(x.id) || x.qty } : x));
  }, [quote, chosen, calendar]);
  const season = lines.reduce((t, l) => t + l.unitPrice * l.qty, 0);
  const tax = site ? lines.reduce((t, l) => t + (lawnTaxed(site.state, l.taxClass) ? l.unitPrice * l.qty : 0), 0) : 0;
  const totals = quote ? planTotals(calendar, quote, chosen) : null;

  const stroke = (next: Uint8Array) => {
    if (labels) setPast((p) => [...p.slice(-30), { labels, reachFt: site?.yard?.reachFt }]);
    setLabels(next);
  };
  /** The yard picked out again at another reach, the contractor's own edits kept. */
  const setReach = (to: number) => {
    if (!site || !labels || !asRead || !lotInfo) return;
    const from = site.yard?.reachFt ?? DEFAULT_REACH_FT;
    if (from === to) return;
    const next = reReach(asRead, labels, lotInfo.mask, site.grid, from, to);
    stroke(next.labels);
    setSite({ ...site, yard: { reachFt: to } });
  };
  /** A tap: a dimmed (natural) piece counted in, anything else in the yard left out. Trees and the house stay. */
  const tapPiece = (at: number) => {
    if (!site || !labels || !asRead || !lotInfo || !lotInfo.mask[at]) return;
    const c = labels[at];
    if (c === CLS.BUILDING || c === CLS.TREE || c === CLS.OUT) {
      setTapNote(c === CLS.TREE ? "That's under trees — if there's lawn there, paint it in with the Lawn brush." : c === CLS.BUILDING ? "That's the house." : null);
      return;
    }
    setTapNote(null);
    const { w, h } = site.grid;
    stroke(c === CLS.NATURAL ? countPiece(labels, asRead, lotInfo.mask, w, h, at) : fillPiece(labels, lotInfo.mask, w, h, at, CLS.NATURAL));
  };
  const undo = () => {
    if (!past.length) return;
    const last = past[past.length - 1];
    setLabels(last.labels);
    if (site && last.reachFt !== site.yard?.reachFt) setSite({ ...site, yard: last.reachFt === undefined ? undefined : { reachFt: last.reachFt } });
    setPast(past.slice(0, -1));
  };
  /** Put the yard back the way the photo read it (the caller confirms). */
  const resetToRead = () => {
    if (!site || !labels || !asRead || !lotInfo) return;
    const y = keepYard(asRead, lotInfo.mask, site.grid, { reachFt: site.yard?.reachFt ?? DEFAULT_REACH_FT });
    setPast((p) => [...p, { labels, reachFt: site.yard?.reachFt }]);
    setLabels(y.labels);
    setSite({ ...site, yard: { reachFt: y.reachFt } });
  };
  const pickPaint = (cls: number) => {
    setTapping(false);
    setPaint((x) => (x === cls && !tapping ? null : cls));
  };
  const toggleTapping = () => {
    setTapping((t) => !t);
    setTapNote(null);
  };
  const toggle = (id: ServiceId) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const draftOf = () => (site && labels ? { site: { ...site, labels: encodeLabels(labels) }, options, picked: [...chosen], clientId: client?.id ?? null, title: site.address } : null);
  const save = async () => {
    const d = draftOf();
    if (!d) return;
    setBusy("save");
    const r = await saveLawnDraft({ id: draftId, draft: d, lawnSqft: measures?.lawnSqft ?? null });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setDraftId(r.id);
    setSavedAt(r.updatedAt);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `${basePath}?draft=${r.id}`);
  };
  const openDraft = (id: string) => routerRef.current.push(`${basePath}?draft=${encodeURIComponent(id)}` as Route);
  const startNew = () => routerRef.current.push(basePath as Route);
  const removeDraft = async (id: string) => {
    await deleteLawnDraft(id);
    setDrafts((x) => x.filter((y) => y.id !== id));
  };
  const createProposal = async () => {
    if (!site || !measures || !quote || !lines.length) return;
    setBusy("proposal");
    setError(null);
    const months = monthsOf(quote.climate);
    const scope = [
      `Lawn and landscape care for ${site.address || "the property"}, ${MONTH[months[0] - 1]} through ${MONTH[months[months.length - 1] - 1]}.`,
      `Measured from the USDA aerial photo${site.photo ? ` of ${new Date(site.photo.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : ""}: ${sqft(measures.lawnSqft)} of lawn (front ${sqft(measures.lawnByZone.front)}, back ${sqft(measures.lawnByZone.back)}, sides ${sqft(measures.lawnByZone.side)}), ${sqft(measures.bedSqft)} of beds${measures.yardSqft ? ` — a maintained yard of ${area(measures.yardSqft)}` : ""} on a ${area(measures.lotSqft)} lot.`,
      ...lines.map((l) => `${l.name}: ${l.desc}.`),
      `The season comes to ${usd(season)}${tax ? " plus sales tax on the lines the state taxes" : ""} — ${usd(season / 12)} a month over 12 months on a service plan.`,
    ].join("\n");
    const r = await convertLawnToProposal({
      title: `Lawn care — ${site.address || site.place}`,
      clientId: client?.id ?? null,
      address: site.address || null,
      state: site.state,
      scope,
      lines: lines.map((l) => ({ key: l.id, name: l.name, description: l.desc, quantity: l.qty, unit: l.unit, unitPrice: l.unitPrice, labor: l.labor, taxClass: l.taxClass })),
      draftId,
      site: draftOf()?.site ?? null,
      measures,
    });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setMade(r.id);
  };

  const putOnPlan = async () => {
    if (!site || !quote || !client || !calendar.length) return;
    setBusy("plan");
    setError(null);
    const months = monthsOf(quote.climate);
    const benefits = lines.map((l) => `${l.name}${l.qty > 1 ? ` (${l.qty}${l.unit === "cu yd" ? " cu yd" : ""})` : ""}`);
    const r = await createLawnPlan({
      clientId: client.id,
      name: "Lawn care plan",
      description: `The season's lawn care for ${site.address || "your home"}, ${MONTH[months[0] - 1]}–${MONTH[months[months.length - 1] - 1]}: every visit on our calendar, billed in twelve equal months.`,
      address: site.address || null,
      monthly: Math.round((season / 12) * 100) / 100,
      visits: calendar,
      benefits,
      send: sendPlanToo,
      place: { lat: site.lat, lng: site.lng },
    });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPlan({ id: r.planId, sent: r.sent, emailed: r.emailed, href: r.acceptHref });
  };

  const readPct = READ_PCT[Math.min(readStep, READ_PCT.length - 1)];

  return {
    phase, address, setAddress, error, setError, site, labels, past, settings, setSettings, ownRate, setOwnRate,
    options, setOptions, chosen, paint, pickPaint, tapping, toggleTapping, tapNote, zoom, setZoom, brushFt, setBrushFt,
    view, setView, drawingLot, setDrawingLot, drafts, draftsLoaded, savedAt, busy, client, setClient, made, readStep,
    readPct, readingAddress, plan, sendPlanToo, setSendPlanToo, lotInfo, asRead, measures, quote, rules, calendar,
    lines, season, tax, totals, read, stroke, setReach, tapPiece, undo, resetToRead, toggle, save, openDraft, startNew,
    removeDraft, createProposal, putOnPlan,
  };
}

export type LawnState = ReturnType<typeof useLawnEstimator>;
