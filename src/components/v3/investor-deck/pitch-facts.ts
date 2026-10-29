// THE OUTSIDE FACTS ON THE PITCH DECK (2026-10-25) — the market, the hours, what leads cost elsewhere. Each one is
// quoted from its source as found (Oct 2026) and the slide links to it; an arithmetic step on top of a source says so
// beside it. Nothing here is a JobFlex measurement — those come live from the report and the Lead Center.

export interface PitchSource { label: string; url: string }

const JCHS: PitchSource = { label: "Harvard Joint Center for Housing Studies, LIRA (Jan 2025)", url: "https://www.jchs.harvard.edu/benchmark-update-lifts-remodeling-market-size-projections" };
const NAHB: PitchSource = { label: "NAHB, from the 2022 Economic Census and Nonemployer Statistics", url: "https://eyeonhousing.org/2025/08/most-home-builders-are-small-businesses/" };
const TTAN: PitchSource = { label: "ServiceTitan fiscal 2025 results (SEC 8-K)", url: "https://www.sec.gov/Archives/edgar/data/1638826/000095017025038719/ttan-ex99_1.htm" };
const FMI: PitchSource = { label: "FMI & PlanGrid, Construction Disconnected (2018), ~600 construction leaders", url: "https://pg.plangrid.com/rs/572-JSV-775/images/Construction_Disconnected.pdf" };
const HCP: PitchSource = { label: "Housecall Pro, lead-platform comparison (updated Oct 2026)", url: "https://www.housecallpro.com/resources/marketing/software-advice/angi-formerly-angies-list-competitors-sites-like-angi/" };
// Wisetack, read Oct 28, 2026: what a contractor gets and pays, and that it pays platforms a share.
const WT_HOME: PitchSource = { label: "Wisetack, home services ($500–$65,000 jobs; 3.9% per transaction; paid 1–3 business days after the job)", url: "https://www.wisetack.com/get-started/home-services" };
const WT_PARTNERS: PitchSource = { label: "Wisetack for software platforms (shared revenue model; financed jobs 4.5× bigger, Wisetack's figure)", url: "https://www.wisetack.com/partnerships" };
const WT_JOBBER: PitchSource = { label: "Wisetack in partnership with Jobber", url: "https://www.wisetack.com/getting-started/jobber" };
const WT_HCP: PitchSource = { label: "Housecall Pro, Wisetack consumer financing", url: "https://help.housecallpro.com/en/articles/3836042-wisetack-consumer-financing-overview" };
const LGE: PitchSource = { label: "LeadGen Economy, home-improvement lead marketplaces (updated Apr 2026)", url: "https://www.leadgen-economy.com/blog/home-improvement-lead-marketplaces-angi-thumbtack-homeadvisor/" };

/** One-person specialty trade contractors (NAHB) and their share of all trade-contractor businesses. */
export const NONEMPLOYER_SHOPS = 1_900_000;
export const NONEMPLOYER_SHARE = 0.79;
/** All specialty trade contractor businesses, worked out from the two: 1.9M ÷ 79%. */
export const ALL_TRADE_SHOPS = Math.round(NONEMPLOYER_SHOPS / NONEMPLOYER_SHARE / 100_000) * 100_000;

export const MARKET_FACTS: Array<{ figure: string; line: string; source: PitchSource; math?: string }> = [
  { figure: "$509B", line: "spent on remodeling and repairs of owner-occupied US homes — the work homeowners bring, projected for 2025", source: JCHS },
  { figure: "1.9M+", line: "one-person trade contractors in the US — 79% of all specialty trade businesses", source: NAHB },
  { figure: `≈${(ALL_TRADE_SHOPS / 1_000_000).toFixed(1)}M`, line: "specialty trade contractor businesses in all", source: NAHB, math: "1.9M ÷ 79%" },
  { figure: "2 of 3", line: "trade contractors with employees take in under $1M a year — no office staff to carry the paperwork", source: NAHB },
];

/** The category leader: revenue and customers in its fiscal 2025. */
export const LEADER = { name: "ServiceTitan", revenueCents: 77_190_000_000, customers: 9_500, source: TTAN };

export const HOURS_FACT = { figure: "14 h", line: "a week lost per person to non-productive work — hunting for information, resolving conflicts, rework", source: FMI };

/** What a lead costs a contractor elsewhere, as published. */
export const LEAD_PRICES: Array<{ name: string; price: string; how: string; source: PitchSource }> = [
  { name: "Angi", price: "$15–$100+ a lead", how: "plus $0–$350 a month; the same request goes to several pros", source: HCP },
  { name: "Thumbtack", price: "$10–$80+ a lead", how: "no monthly fee; pros still compete for the job", source: HCP },
  { name: "Google Local Services", price: "$25–$100 a lead", how: "exclusive, by trade and area", source: LGE },
];

export const ALL_SOURCES: PitchSource[] = [JCHS, NAHB, TTAN, FMI, HCP, LGE, WT_HOME, WT_PARTNERS, WT_JOBBER, WT_HCP];

/** Financing (2026-10-28): built in JobFlex, switched on with the lending partnership. The share is the owner's target
 *  for the partner agreement — NOT signed yet, and the slide says so. The rest is Wisetack's own published terms. */
export const FINANCING = {
  shareLowPct: 2,
  shareHighPct: 3,
  jobMinCents: 50_000,
  jobMaxCents: 6_500_000,
  merchantFeePct: 3.9,
  sources: [WT_HOME, WT_PARTNERS, WT_JOBBER, WT_HCP],
};
