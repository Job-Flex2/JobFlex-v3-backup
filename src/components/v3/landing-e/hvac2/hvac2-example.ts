/* THE EXAMPLE HOUSE'S FIGURES, BY THE REAL ENGINE (hvac2, 2026-10-19). The
   "how" cards and the four steps show the same house the hero's demo walks
   through (hvac-estimator-demo/demo-actions: 4418 NE 97th St, Kirkland, WA)
   and the same intake the demo plays — the three plates read, the crawl's
   ducts typed — run through src/lib/hvac exactly as the estimator runs it.
   Nothing here is typed in by hand: change the engine, the starter catalog
   or the rate card and these numbers follow. Computed once per server
   process, on the server; none of the engine ships to the browser for it. */

import { DEMO_READS, DEMO_SITE } from "../hvac-estimator-demo/demo-actions";
import { applyNameplate, applyStated, applyStatedNested, modelFromSite } from "@/lib/hvac/intake";
import { designConditionsFor } from "@/lib/hvac/designConditions";
import { runEngine } from "@/lib/hvac/engine";
import { DEFAULT_RATE_CARD, STARTER_CATALOG, normalizeRateCard, tiersFor } from "@/lib/hvac/ledger";
import type { BuildingModel } from "@/lib/hvac/types";

/** What the demo types on the walk (hvac-estimator-shot TYPED_FACTS). */
const TYPED: Record<string, unknown> = {
  "ducts.location": "crawl",
  "ducts.condition": "fair",
  foundation: "crawl-vented",
  "ducts.returnGrilleSqIn": 400,
  "ducts.supplyRegisters": 9,
  "gas.available": true,
  "gas.pipeIn": 0.75,
};

export interface Hvac2Example {
  address: string;
  county: string;
  state: string;
  livingSqft: number;
  yearBuilt: number;
  storeys: number;
  elevationFt: number;
  designCoolF: number;
  designHeatF: number;
  wallInsulation: string;
  ceilingInsulation: string;
  windowType: string;
  outdoor: string;
  indoor: string;
  panel: string;
  heatingBtuh: number;
  coolingBtuh: number;
  coolingTons: number;
  chosen: string;
  /** The chosen unit's size alone ("2.5 t"). */
  chosenTons: string;
  checks: { pass: number; fix: number; verify: number };
  checkNames: string[];
  tiers: Array<{ tier: string; subtotal: number; tons: number }>;
}

const R = (v: string) => v.replace(/^r(\d+)$/i, "R-$1");

let cached: Hvac2Example | null = null;

export function hvac2Example(): Hvac2Example {
  if (cached) return cached;
  const site = structuredClone(DEMO_SITE);
  const m: BuildingModel = modelFromSite(site);
  applyNameplate(m, DEMO_READS.outdoor);
  applyNameplate(m, DEMO_READS.indoor);
  if (DEMO_READS.panel.mcaAmps) applyStatedNested(m, "electrical.mainAmps", DEMO_READS.panel.mcaAmps);
  for (const [path, v] of Object.entries(TYPED)) {
    if (path.includes(".")) applyStatedNested(m, path, v);
    else applyStated(m, path as keyof BuildingModel, v as never);
  }
  const { conditions } = designConditionsFor(m.state, m.county, m.elevationFt ?? 0);
  // The demo picks the heat pump on the design step (hvac-estimator-shot T4.heatPump).
  const run = (pick?: string) => runEngine(m, { catalog: STARTER_CATALOG, outdoorKind: "heat-pump", ...(pick ? { pick } : {}) });
  const r = run();
  const card = normalizeRateCard(DEFAULT_RATE_CARD);
  const tiers = tiersFor(r, m, card, STARTER_CATALOG, {}, (id) => run(id));
  const o = DEMO_READS.outdoor;
  const i = DEMO_READS.indoor;
  const chosen = r.selection.chosen?.item;
  const ex: Hvac2Example = {
    address: site.address,
    county: site.county ?? "",
    state: site.state ?? "",
    livingSqft: site.livingSqft ?? m.conditionedSqft,
    yearBuilt: site.yearBuilt ?? m.yearBuilt ?? 0,
    storeys: site.storeys ?? m.storeys,
    elevationFt: site.elevationFt ?? 0,
    designCoolF: conditions.coolingF,
    designHeatF: conditions.heatingF,
    wallInsulation: R(m.wallInsulation),
    ceilingInsulation: R(m.ceilingInsulation),
    windowType: m.windowType.replace(/-/g, " "),
    outdoor: `${o.tons} ton AC · SEER ${o.seer} · ${o.yearMade}`,
    indoor: `${Math.round((i.btuInput ?? 0) / 1000)}k BTU furnace · ${i.afue}% AFUE · ${i.yearMade}`,
    panel: `${DEMO_READS.panel.mcaAmps} A panel`,
    heatingBtuh: r.load.heatingBtuh,
    coolingBtuh: r.load.coolingTotalBtuh,
    coolingTons: r.load.coolingTons,
    chosenTons: chosen?.tons ? `${chosen.tons} t` : "",
    chosen: chosen ? `${chosen.tons}-ton ${chosen.kind === "heat-pump" ? "heat pump" : chosen.kind.replace(/-/g, " ")}` : "",
    checks: {
      pass: r.checks.filter((c) => c.status === "pass").length,
      fix: r.checks.filter((c) => c.status === "fix").length,
      verify: r.checks.filter((c) => c.status === "verify").length,
    },
    checkNames: r.checks.slice(0, 4).map((c) => c.title),
    tiers: tiers.map((t) => ({ tier: t.tier, subtotal: Math.round(t.subtotal), tons: t.candidate.item.tons ?? 0 })),
  };
  cached = ex;
  return ex;
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const btu = (n: number) => `${Math.round(n).toLocaleString("en-US")} BTU/h`;
export const TIER_NAME: Record<string, string> = { value: "Good", mid: "Better", premium: "Best" };
