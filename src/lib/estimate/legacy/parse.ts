export type AiDraftSection = {
  title: string;
  description: string;
};

export type AiDraftPricingLineItem = {
  name: string;
  system?: string;
  description?: string;
  sqft?: number;
  quantity?: number;
  unitPrice?: number;
  fixedPrice?: number;
  measurementType?: string;
  laborCost?: number;
  materialCost?: number;
  total?: number;
  /** Only asked for when the company prices labor by the hour (lib/estimate/companyPricing). */
  laborHours?: number;
};

export type AiDraftPricingScheduleItem = {
  name: string;
  percent: number;
};

export type AiDraftPricing = {
  summary?: string;
  currency?: string;
  basePricePerSqFt?: number;
  recommendedPrice?: number;
  laborRate?: number;
  crew?: number;
  hours1?: number;
  hours2?: number;
  laborCost?: number;
  overhead?: number;
  profit?: number;
  taxRate?: number;
  discount?: number;
  lineItems: AiDraftPricingLineItem[];
  schedule: AiDraftPricingScheduleItem[];
  notes?: string[];
};

export type AiDraftOutput = {
  title: string;
  summary: string;
  scope: string[];
  timeline: string;
  upsells: AiDraftSection[];
  disclaimers: string[];
  nextSteps: string[];
  pricing?: AiDraftPricing;
};

export function parseAiDraftResponse(raw: string): {
  draft: AiDraftOutput;
  warnings: string[];
} {
  const warnings: string[] = [];

  const defaultDraft: AiDraftOutput = {
    title: "Project Proposal",
    summary: raw.trim().slice(0, 600) || "AI-generated proposal draft.",
    scope: [],
    timeline: "",
    upsells: [],
    disclaimers: [
      "Pricing is a preliminary estimate and subject to field verification.",
      "Final scope, schedule, and materials will be confirmed in a signed contract.",
    ],
    nextSteps: ["Review this draft, adjust scope, and send to the client for approval."],
  };

  if (!raw) {
    warnings.push("AI response was empty; using fallback content.");
    return { draft: defaultDraft, warnings };
  }

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1) {
    warnings.push("AI response was not valid JSON; using plain text fallback.");
    return { draft: defaultDraft, warnings };
  }

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

    const draft: AiDraftOutput = {
      title: sanitizeString(parsed.title, defaultDraft.title),
      summary: sanitizeString(parsed.summary, defaultDraft.summary),
      scope: sanitizeStringArray(parsed.scope),
      timeline: sanitizeString(parsed.timeline, ""),
      upsells: Array.isArray(parsed.upsells)
        ? parsed.upsells
            .map((item: { title?: string; description?: string }) => ({
              title: sanitizeString(item?.title, "Optional upgrade"),
              description: sanitizeString(item?.description, ""),
            }))
            .filter((item: AiDraftSection) => item.description.length > 0)
        : [],
      disclaimers: sanitizeStringArray(parsed.disclaimers, defaultDraft.disclaimers),
      nextSteps: sanitizeStringArray(parsed.nextSteps, defaultDraft.nextSteps),
    };

    if (!draft.scope.length) {
      draft.scope = extractFallbackBullets(raw);
    }

    const pricing = sanitizePricing(parsed.pricing);
    if (pricing) {
      draft.pricing = pricing;
    }

    return { draft, warnings };
  } catch (error) {
    warnings.push("Failed to parse AI JSON output; using fallback text.");
    return { draft: defaultDraft, warnings };
  }
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function sanitizeStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function extractFallbackBullets(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || line.startsWith("*"))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);
}

function sanitizePricing(value: unknown): AiDraftPricing | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const obj = value as Record<string, unknown>;

  const lineItemsRaw = Array.isArray(obj.lineItems) ? obj.lineItems : [];
  const lineItems = lineItemsRaw.reduce<AiDraftPricingLineItem[]>((acc, item) => {
    if (typeof item !== "object" || item === null) return acc;
    const record = item as Record<string, unknown>;
    const description =
      typeof record.description === "string" && record.description.trim().length
        ? record.description.trim()
        : undefined;
    const system =
      typeof record.system === "string" && record.system.trim().length
        ? record.system.trim()
        : undefined;
    const rawName = sanitizeString(record.name, "").trim();
    const name = rawName || description || system || "";
    if (!name) return acc;
    const sqft = sanitizeNumber(record.sqft);
    const quantity = sanitizeNumber(record.quantity);
    const unitPrice = sanitizeNumber(record.unitPrice);
    const fixedPrice = sanitizeNumber(record.fixedPrice);
    const laborCost = sanitizeNumber(record.laborCost);
    const materialCost = sanitizeNumber(record.materialCost);
    const total = sanitizeNumber(record.total);
    const laborHours = sanitizeNumber(record.laborHours);
    const measurementType =
      typeof record.measurementType === "string" && record.measurementType.trim().length
        ? record.measurementType.trim()
        : undefined;
    acc.push({
      name,
      system,
      description,
      sqft,
      quantity,
      unitPrice,
      fixedPrice,
      measurementType,
      laborCost,
      materialCost,
      total,
      ...(laborHours != null && laborHours > 0 ? { laborHours } : {}),
    });
    return acc;
  }, []);

  const scheduleRaw = Array.isArray(obj.schedule) ? obj.schedule : [];
  const schedule: AiDraftPricingScheduleItem[] = scheduleRaw
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const name = sanitizeString(record.name, "");
      const percent = sanitizeNumber(record.percent);
      if (!name) return null;
      if (!Number.isFinite(percent)) return null;
      return { name, percent };
    })
    .filter((item): item is AiDraftPricingScheduleItem => item !== null);

  if (!lineItems.length && !schedule.length) {
    // If nothing meaningful, skip attaching pricing
    if (
      !Number.isFinite(sanitizeNumber(obj.laborRate)) &&
      !Number.isFinite(sanitizeNumber(obj.recommendedPrice)) &&
      !Number.isFinite(sanitizeNumber(obj.basePricePerSqFt))
    ) {
      return undefined;
    }
  }

  const notes =
    Array.isArray(obj.notes) && obj.notes.length
      ? sanitizeStringArray(obj.notes)
      : undefined;

  return {
    summary:
      typeof obj.summary === "string" && obj.summary.trim().length
        ? obj.summary.trim()
        : undefined,
    currency:
      typeof obj.currency === "string" && obj.currency.trim().length
        ? obj.currency.trim()
        : undefined,
    basePricePerSqFt: sanitizeNumber(obj.basePricePerSqFt),
    recommendedPrice: sanitizeNumber(obj.recommendedPrice),
    laborRate: sanitizeNumber(obj.laborRate),
    crew: sanitizeNumber(obj.crew),
    hours1: sanitizeNumber(obj.hours1),
    hours2: sanitizeNumber(obj.hours2),
    laborCost: sanitizeNumber(obj.laborCost),
    overhead: 0, // Overhead is always 0 for AI drafts - it's a manual option
    profit: sanitizeNumber(obj.profit),
    taxRate: sanitizeNumber(obj.taxRate),
    discount: sanitizeNumber(obj.discount),
    lineItems,
    schedule,
    notes,
  };
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = parseFloat(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

