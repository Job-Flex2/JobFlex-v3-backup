"use client";

// How to shoot the walk — the seven shots that give the reader every fact
// the engine needs, and what to say over each. Written for the phone in the
// contractor's hand: short, in shot order, with the words to say out loud
// (the audio is where most of the facts come from).

import type { BuildingModel } from "@/lib/hvac/types";

export interface Shot {
  n: number;
  title: string;
  detail: string;
  say: string;
}

export const SHOTS: Shot[] = [
  { n: 1, title: "Outdoor unit", detail: "Whole unit from six feet back, then fill the frame with the nameplate and hold it still for three seconds. Wipe the plate if it's dusty.", say: "“Carrier condenser, plate says three ton, R-410A.”" },
  { n: 2, title: "Furnace or air handler", detail: "The whole cabinet with the flue and gas line in view, then its plate for three seconds. Open the blower door if it comes off easily.", say: "“Gas furnace in the garage, eighty thousand BTU, ninety-two AFUE.”" },
  { n: 3, title: "Electrical panel", detail: "Door open, the main breaker in the middle of the frame, then the row of breakers so the free slots are visible.", say: "“Two-hundred-amp main, three open slots, electric dryer and range.”" },
  { n: 4, title: "Ducts", detail: "Attic hatch or crawl access: pan slowly along the trunk and a couple of runs. Show the return grille and the filter.", say: "“Attic ducts, insulated flex, one joint taped. Return grille twenty by twenty-five.”" },
  { n: 5, title: "Gas meter and water heater", detail: "The meter with the pipe size at the riser, and the water heater's fuel. Skip if the house is all-electric — say so.", say: "“Three-quarter-inch gas riser, gas water heater, no EV charger.”" },
  { n: 6, title: "One lap of the house", detail: "Walk the outside once. Point the camera at the windows on each side, the roof colour, the siding and any shade trees. Say the size, storeys, age, what the walls are (wood, brick, block) and any skylights.", say: "“Two thousand four hundred square feet, one storey, built ninety-eight, double-pane, dark shingles, no shade.”" },
  { n: 7, title: "Thermostat and the complaint", detail: "One frame of the thermostat, then say what the owner wants and what bothers them.", say: "“Owner wants to keep gas heat. Back bedroom never cools.”" },
];

export const TIPS = [
  "Landscape, phone in both hands",
  "Three seconds still on every plate",
  "Tap the plate to focus — no zoom, walk closer",
  "Say numbers as digits: “two hundred amp”",
  "Keep talking — the audio carries the facts",
  "Two to four minutes is plenty; five is the limit",
  "Dark attic: turn the phone light on",
];

export interface CoverageItem {
  key: string;
  title: string;
  got: boolean;
  /** What to do when it is missing. */
  fix: string;
}

/** What the walk (and the plates) caught, field by field, so the contractor
 *  sees at a glance what still needs a photo or a typed answer. */
export function coverageFor(m: BuildingModel | null): CoverageItem[] {
  const src = (path: string) => m?.provenance[path]?.source;
  const known = (path: string) => { const s = src(path); return !!s && s !== "default"; };
  return [
    { key: "outdoor", title: "Outdoor unit plate", got: known("existing.tons") || known("existing.model"), fix: "photograph the plate or type the model number" },
    { key: "indoor", title: "Furnace / air handler plate", got: known("existing.btuInput") || (m?.existing.kind === "split-heat-pump" && known("existing.model")), fix: "photograph the plate or type the BTU input" },
    { key: "panel", title: "Panel: main breaker amps", got: known("electrical.mainAmps"), fix: "photograph the panel or type the amps" },
    { key: "ducts", title: "Ducts: where and what shape", got: known("ducts.location") && known("ducts.condition"), fix: "pick the location and condition below" },
    { key: "fuel", title: "Fuel: gas or electric", got: known("gas.available") || known("existing.fuel"), fix: "answer below" },
    { key: "sqft", title: "Square footage", got: known("conditionedSqft") && (m?.conditionedSqft ?? 0) > 0, fix: "type the conditioned area" },
    { key: "year", title: "Year built", got: known("yearBuilt"), fix: "type it — it sets the insulation defaults" },
    { key: "windows", title: "Windows", got: known("windowType"), fix: "pick the pane type below" },
  ];
}
