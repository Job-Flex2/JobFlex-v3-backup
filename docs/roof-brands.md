# Roofing brands by state — what the picker uses

Read 2026-10-16. Code: `src/lib/roofPackage/brands.ts`. Check: `qa/tests/logic/roof-brands.check.ts`.

There is no public market-share table by state, so the picker never says "most popular". Each line is ranked from
signals anyone can check, and the tile says which ones apply:

| Signal | Effect | Where it comes from |
| --- | --- | --- |
| Miami-Dade NOA (HVHZ) | Florida +4; other hurricane states +1 ("for the coast") | Miami-Dade Product Control NOAs |
| Florida Product Approval | Florida +3. If known to have none, the line is held back. If not on our list, it says "Check its Florida approval before quoting" | floridabuilding.org evaluation reports |
| Class 4 insurance discount or grant | +2.5 | TDI, NCDOI, Kentucky DOI, NAIC state mitigation programs |
| Heavy hail (no discount law found) | +2 | III and NICB hail-claim data |
| Cool-roof rated, in California | +1.5 | CEC Title 24 (climate zones 4 and 8–15) |
| SBS / flexible shingle, in cold states | +1 | the makers' own product pages |
| Documented regional stronghold | +1.5 | the makers' own pages and trade press |
| Plant in the state | +2 | the makers' plant lists |
| Plant in the Census division | +1 | the makers' plant lists |
| Brand reach | +3 for the three national shingle leaders (shingles only); +1.5 for any brand sold nationwide | — |

These rules also apply:
- A regional brand is hidden outside the states where it sells. PABCO sells only in the West; Malarkey in the West plus Oklahoma.
- A line sold mostly in one region (CertainTeed ClimateFlex and NorthGate, North and East) is held back elsewhere with "ask your yard".
- The picker shows four different brands up front. Each brand's other lines sit under "More brands".

## What to re-check when the data changes

- **Florida approvals and NOAs expire.** Re-read them yearly; the NOA numbers are listed below.
- **New plants are announced but not open yet,** so they are not counted:
  - GAF, Newton KS (2027)
  - Owens Corning, Prattville AL (2027)
  - Malarkey, Franklin IN

## Prices — how a brand moves the estimate (2026-10-16)

A line is priced from the contractor's own rate for its roof type (Manage roof types). That rate is moved by how far
the line's retail price sits from a typical line of the same type: the median of the lines that have a price. The
move is clamped between ×0.7 and ×1.6. Labor and hip & ridge stay the contractor's. Once the contractor types a
material, labor or cap price while a line is on, that becomes the line's own price (`Prefs.brandRates`). It is saved
with the defaults, and "Back to the starting price" clears it. A line with no public price starts on the type's rate,
and the page says so.

**One basis, so lines compare fairly.** `retailPerSq` is a supply-house shelf price where the line is stocked there.
That is A+ Roofing Supply in Sugar Hill GA (aroofingsupply.com), read 2026-10-16. Otherwise it is a big-box listing
scaled by that store's measured gap to the supply house, taken from the lines both carry:

| Store | Median gap to A+ | Lines it was measured on |
| --- | --- | --- |
| Home Depot | ×0.82 | HDZ, UHDZ, Royal Sovereign, Heritage, Camelot II |
| Lowe's | ×0.75 | HDZ, UHDZ, Duration, Oakridge, Royal Sovereign, XT 25, Supreme |
| Menards | ×0.81 | Duration, Oakridge, Pinnacle Pristine, Supreme |

Home Depot and Lowe's pages refuse automated reads, so their prices are search-result snippets, some of them months
old. Menards prices are taken before its mail-in rebate. Bundle coverage is the listing's own:
- Owens Corning, Atlas and TAMKO bundles cover 32.8 sq ft (3 per 98.4 sq ft).
- GAF Camelot II and Woodland are 4 bundles per square.

**Left out on purpose:**
- Lines with low-confidence prices: Malarkey Highlander, Atlas Briarwood Pro, CertainTeed Landmark ClimateFlex.
- Lines whose bundle count is unresolved: CertainTeed Grand Manor and Belmont.
- Systems with fewer than three priced lines get no "typical", so every line in them starts on the contractor's rate.
  That covers synthetic, TPO, PVC and metal, which are mostly sold by quote.

Supply-house basis $/sq used (only the ratios matter):
- Architectural (typical 110):
  - HDZ 110, UHDZ 147, HDZ RS 135
  - Duration 114, Oakridge 104
  - Landmark 110, Landmark PRO 120, Landmark Solaris 131
  - Cambridge 100, Dynasty 107
  - Pinnacle Pristine 112, Castlebrook 94, Pinnacle Sun 123
  - Heritage 98, Titan XT 108
- 3-tab (typical 93): Royal Sovereign 96, Supreme 93, XT 25 92, Marathon 93, Elite Glass-Seal 91.
- Class 4 (typical 144.5): Timberline AS II 156, Duration STORM 123, Duration FLEX 162, StormFighter FLEX 133.
- Designer (typical 220): Camelot II 228, Slateline 191, Woodland 220.
- Self-adhered mod bit, cap plus base (typical 180): Liberty 182, Flintlastic SA 180, DeckSeal SA 178.
- Synthetic, one store (Green Building Supply): EcoStar Majestic 753, Seneca 845; Brava slate 856, shake 900.
- Single ply: EverGuard TPO 96, EverGuard PVC 156.

Price sources:
- A+ Roofing Supply categories: https://aroofingsupply.com/product-category/roofing-materials/architectural-shingles/, …/3-tab-shingles/, …/designer-shingles/
- Menards Pinnacle Pristine: https://www.menards.com/main/building-materials/roofing/roofing-shingles/atlas-pinnacle-reg-pristine-architectural-roofing-shingles-32-8-sq-ft/1516712/p-1536647321035-c-5814.htm
- Green Building Supply, EcoStar slate: https://greenbuildingsupply.com/products/ecostar-traditional-slate-roof-tiles
- Green Building Supply, Brava slate: https://greenbuildingsupply.com/products/brava-slate-composite-roof-tiles
- GAF EverGuard TPO 60 mil (Builders Warehouse): https://builderswarehouse.com/gaf-everguard-tpo-roofing-membrane-60mil-10x100-white.html

## Sources

Florida approvals:
- GAF FL10124 (R34, non-HVHZ, 2023-06-20): https://www.floridabuilding.org/upload/PR_Tech_Docs/FL10124_R34_AE_2023_06_20_FINAL_PEER-GAF-002.A_NON-HVHZ_FL10124-R34.pdf
- Owens Corning FL10674 (R19): https://www.floridabuilding.org/upload/PR_Tech_Docs/FL10674_R19_AE_2023_10_23_FINAL_PEER-OC-004.A_FL10674-R19.pdf
- CertainTeed FL5444 (R22, non-HVHZ and HVHZ): https://www.floridabuilding.org/upload/PR_Tech_Docs/FL5444_R22_AE_2024_01_18_FINAL_PEER-CTR-001.A_NON-HVHZ_FL5444-R22.pdf and https://www.floridabuilding.org/upload/PR_Tech_Docs/FL5444_R22_AE_2024_01_18_FINAL_PEER-CTR-001.B_HVHZ_FL5444-R22.pdf
- IKO FL30310 (R5, plants listed): https://floridabuilding.org/upload/PR_Tech_Docs/FL30310_R5_AE_IKO19002.6%202023%20FBC%20Eval%20Shingles%20final.pdf
- Atlas FL16305 (R12): https://www.floridabuilding.org/upload/PR_Tech_Docs/FL16305_R12_AE_ATL13002.12%202020%20FBC%20Eval%20Shingles%20final.pdf
- Malarkey FL14809 (R7, non-HVHZ): https://www.floridabuilding.org/upload/PR_Tech_Docs/FL14809_R7_AE_2022_12_09_FINAL_ER_MALARKEY_NON-HVHZ_FL14809-R7.pdf

Miami-Dade NOAs:
- IKO NOA 25-1202.02 (2026–2031): Dynasty, Cambridge, Nordic and others. https://www.miamidade.gov/building/library/productcontrol/noa/25120202.pdf
- TAMKO NOA 26-0331.03 (2026–2030): Heritage, Titan XT, StormFighter FLEX, HailGuard. https://www.miamidade.gov/building/library/productcontrol/noa/26033103.pdf
- GAF NOA 22-1221.04: Timberline HDZ, UHDZ, CS and others. https://www.miamidade.gov/building/library/productcontrol/noa/22122104.pdf

Plants and lines:
- GAF Timberline AS II, listed by GAF as Florida-approved: https://www.gaf.com/en-us/roofing-materials/residential-roofing-materials/shingles/timberline-as-ii
- CertainTeed locations: https://www.certainteed.com/about-us/locations
- CertainTeed ClimateFlex regions: https://www.certainteed.com/about/newsroom/certainteed-announces-regional-expansion-landmark-climateflex-across-us-and-canada
- IKO locations: https://www.iko.com/na/iko-locations/
- IKO Clay Hill, FL: https://www.iko.com/na/iko-celebrates-grand-opening-of-clay-hill-manufacturing-campus-in-florida-marking-major-u-s-expansion-milestone/
- IKO Metals, Ennis TX (DECRA): https://www.iko.com/na/iko-announces-grand-opening-of-state-of-the-art-iko-metals-roofing-plant-in-ennis-texas/
- TAMKO: https://www.tamko.com/about
- TAMKO HailGuard: https://www.tamko.com/about/media-center/news-releases/post/2026/02/27/tamko-introduces-hailguard-shingles-the-industry-s-first-and-only-asphalt-shingle-system-with-a-hail-warranty
- Malarkey shingles: https://www.malarkeyroofing.com/shingles/
- PABCO Prestige, Class 4: https://www.businesswire.com/news/home/20230921876174/en/Prestige-Line-of-Shingles-from-PABCO-Roofing-Products-Earns-Highest-Rating-for-Impact-Resistance
- Owens Corning Duration STORM: https://www.owenscorning.com/en-us/roofing/shingles/trudefinition-duration-storm
- McElroy Metal locations: https://www.mcelroymetal.com/about/locations
- Metal Sales branches: https://www.metalsales.us.com/find-your-branch/
- Eagle Roofing plants: https://eagleroofing.com/about-us/team-eagle/manufacturing-plants/
- Westlake Royal Newpoint, Florida: https://www.businesswire.com/news/home/20241031471996/en/Westlake-Royal-Building-Products-Bolsters-Newpoint-Concrete-Roof-Tile-Operations-Capacity-in-Florida-to-Meet-Regional-Demand
- Slate Valley (VT/NY): https://www.jlconline.com/how-to/roofing/the-slate-valley_o/

Class 4 discounts, hail and Title 24:
- Texas TDI roofing discounts: https://tdi.texas.gov/company/roofing-discounts.html
- North Carolina fortified-home credits: https://www.ncdoi.gov/consumers/homeowners-insurance/fortified-homes-mitigation-credits
- Kentucky Strengthen Kentucky Homes: https://insurance.ky.gov/PPC/Documents/SKHPressRelease.pdf
- NAIC state mitigation programs: https://content.naic.org/sites/default/files/inline-files/State%20Mitigation%20Programs_2.pdf
- III hail facts: https://iii.org/fact-statistic/facts-statistics-hail
- NICB top hail-claim states: https://www.nicb.org/news/news-releases/top-5-states-hail-claims
- CEC cool roofs, single-family: https://www.energy.ca.gov/sites/default/files/2023-08/2022_Res_SF_Cool_Roof_ada.pdf
