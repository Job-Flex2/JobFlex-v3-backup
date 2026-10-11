// What the Deck Studio hands to convertDeckEstimateToProposal — kept out of
// the "use server" file so the QA harness (scripts/qa/deck-engine.check.ts)
// can hold the engine's lines against the SAME rules the action applies: a
// line the engine can produce and the schema refuses is a conversion that
// fails in the field (the fence estimator's lesson, lib/fence/convertSchema).
//
// The deck itself rides with the proposal as an ActivityEvent of kind
// DECK_PLAN, the way the fence's layout does (FENCE_PLAN): the design, so
// the studio can open it again, and the 3D scene, frozen, for the client's
// page. No table of its own, nothing uploaded.
import { z } from "zod";
import { normalizeDeckDesign, type DeckDesign } from "./design";
import { parseDeckScene, type DeckScene } from "./scene";

export const DECK_PLAN_EVENT = "DECK_PLAN";
/** v2 (2026-10-10): the structure, the roof and the photo joined; v3 (M3, the same day): stairs, rails, levels, the site and the electrical, the scene version 3. Older plans read back as they were. */
export const DECK_PLAN_VERSION = 3;

/** The deck as it is kept with a proposal. */
export interface DeckPlan {
  v: typeof DECK_PLAN_VERSION;
  design: DeckDesign;
  scene: DeckScene;
  address: string | null;
}

export const deckConvertSchema = z.object({
  title: z.string().min(1).max(200),
  scope: z.string().max(6000).optional(),
  assumptions: z.array(z.string().max(600)).max(20),
  // The package's lines (lib/deck/pricing): one row per step of the job with
  // its MATERIAL and LABOR halves per unit, as the fence package sends them.
  lines: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(400).optional(),
        quantity: z.number().finite().min(0),
        unit: z.string().optional(),
        materialCost: z.number().finite().min(0),
        laborCost: z.number().finite().min(0),
      }),
    )
    .min(1)
    .max(60),
  // The job address: rides with the proposal and sets the state's sales tax.
  address: z.string().max(300).optional().nullable(),
  // The deck: any design is brought inside its rails; a scene that does not
  // read back is refused, so a broken picture never reaches a client.
  plan: z
    .object({
      design: z.unknown().transform((v) => normalizeDeckDesign(v)),
      scene: z.unknown().transform((v, ctx) => {
        const scene = parseDeckScene(v);
        if (!scene) {
          ctx.addIssue({ code: "custom", message: "The deck's 3D could not be read" });
          return z.NEVER;
        }
        return scene;
      }),
    })
    .optional(),
  // Pre-links the proposal to a client when converted from a client's page.
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
});

export type DeckConvertInput = z.infer<typeof deckConvertSchema>;

/** A stored deck, read back defensively: a bad shape is no deck, never a crash. */
export function parseDeckPlan(raw: unknown): DeckPlan | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r) return null;
  const scene = parseDeckScene(r.scene);
  if (!scene) return null;
  return { v: DECK_PLAN_VERSION, design: normalizeDeckDesign(r.design), scene, address: typeof r.address === "string" ? r.address.slice(0, 300) : null };
}

/** The first thing wrong, as a person would say it: "lines.3.name: too short". */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.length ? issue.path.join(".") + ": " : "";
  return (path + issue.message).slice(0, 160);
}
