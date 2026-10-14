// THE FIELDS A FIX CAN ASK FOR (2026-10-10) — pure, client-safe.
//
// Owner: "offer in HVAC to fix it right here — when a check is opened, show
// the field, prefilled, or add it here." A check's plan (lib/hvac/fixes) names
// a model path to type; this is what that path looks like as a control — the
// same label, kind, options and placeholder the intake step uses — so the
// design step can render the field inside the open check row instead of
// sending the contractor to another step. A path with no spec falls back to
// the jump.
export type FixFieldKind = "num" | "text" | "select" | "bool";
export interface FixFieldSpec {
  label: string;
  kind: FixFieldKind;
  options?: Array<[string, string]>;
  placeholder?: string;
  step?: string;
  /** "20x25" typed here is multiplied out (square inches). */
  area?: boolean;
  /** A select whose values are numbers (amps, inches). */
  numeric?: boolean;
}

export const FIX_FIELDS: Record<string, FixFieldSpec> = {
  "ducts.measuredTespInWc": { label: "Static pressure (in. w.c.)", kind: "num", step: "0.05", placeholder: "0.5" },
  "ducts.supplyTrunk": { label: "Supply trunk (Ø or W×H, in)", kind: "text", placeholder: "16 or 20×8" },
  "ducts.returnDuct": { label: "Return duct (Ø or W×H, in)", kind: "text", placeholder: "16 or 20×10" },
  "ducts.returnGrilleSqIn": { label: "Return grille (sq in, W×H)", kind: "num", placeholder: "20×25 = 500", area: true },
  "ducts.condition": { label: "Duct condition", kind: "select", options: [["good", "Good"], ["fair", "Fair"], ["poor", "Poor"], ["unknown", "Not seen"]] },
  "ducts.insulated": { label: "Ducts insulated", kind: "bool" },
  "ducts.location": { label: "Ducts are in", kind: "select", options: [["conditioned", "Conditioned space"], ["attic", "Attic"], ["crawl", "Crawlspace"], ["basement", "Basement"], ["none", "No ducts"]] },
  "electrical.mainAmps": { label: "Main breaker", kind: "select", numeric: true, options: [["60", "60 A"], ["100", "100 A"], ["125", "125 A"], ["150", "150 A"], ["200", "200 A"], ["225", "225 A"], ["400", "400 A"]] },
  "electrical.freeSlots": { label: "Open breaker slots", kind: "num", placeholder: "2" },
  "gas.pipeIn": { label: "Gas pipe", kind: "select", numeric: true, options: [["0.5", "½ in"], ["0.75", "¾ in"], ["1", "1 in"], ["1.25", "1¼ in"]] },
  "gas.longestRunFt": { label: "Gas run ft", kind: "num", placeholder: "40" },
  "gas.available": { label: "Gas at the house", kind: "bool" },
  windowSqft: { label: "Window area (sq ft)", kind: "num", placeholder: "280" },
  windowType: { label: "Windows", kind: "select", options: [["single", "Single pane"], ["double", "Double pane"], ["double-lowe", "Double, low-E"], ["triple", "Triple pane"]] },
  wallInsulation: { label: "Wall insulation", kind: "select", options: [["none", "None"], ["r11", "R-11"], ["r13", "R-13"], ["r19", "R-19"], ["r21", "R-21"]] },
  ceilingInsulation: { label: "Attic insulation", kind: "select", options: [["none", "None"], ["r11", "R-11"], ["r19", "R-19"], ["r30", "R-30"], ["r38", "R-38"], ["r49", "R-49"]] },
  tightness: { label: "Air tightness", kind: "select", options: [["leaky", "Leaky"], ["average", "Average"], ["tight", "Tight"], ["very-tight", "Very tight"]] },
  conditionedSqft: { label: "Conditioned sq ft", kind: "num", placeholder: "2,400" },
  storeys: { label: "Storeys", kind: "num" },
  yearBuilt: { label: "Year built", kind: "num", placeholder: "1998" },
  ceilingHeightFt: { label: "Ceiling ft", kind: "num" },
  occupants: { label: "Occupants", kind: "num" },
  "existing.tons": { label: "Tons", kind: "num", step: "0.5" },
  "existing.keptUp": { label: "On the hottest days it", kind: "select", options: [["yes", "Kept up"], ["no", "Couldn't keep up"]] },
  "existing.btuInput": { label: "Furnace BTU input", kind: "num", placeholder: "80,000" },
  "existing.refrigerant": { label: "Refrigerant", kind: "select", options: [["R-22", "R-22"], ["R-410A", "R-410A"], ["R-454B", "R-454B"], ["R-32", "R-32"]] },
  "existing.fuel": { label: "Fuel", kind: "select", options: [["gas", "Natural gas"], ["propane", "Propane"], ["electric", "Electric"], ["oil", "Oil"], ["none", "None"]] },
};

export const fixFieldSpec = (path: string): FixFieldSpec | undefined => FIX_FIELDS[path];
