"use server";
import { IMAGE_DATA_URL, safeFilename } from "@/lib/safeHref";
import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { createJobExpense } from "@/lib/jobExpenses";
import { friendlyAIError, isOpenAIEnabled } from "@/lib/sdk/openai";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";
import { planEndedRefusal } from "@/lib/paidCaps";

export interface OcrResult {
  vendor?: string;
  total?: number;
  category?: string;
  note?: string;
  lineItems?: { name: string; amount: number }[];
}

const STUB: OcrResult = {
  vendor: "Home Depot",
  total: 248.5,
  category: "Materials",
  note: "Invoice stub — add OPENAI_API_KEY for real OCR.",
  lineItems: [
    { name: "2x4x8 stud (pack)", amount: 68 },
    { name: "Deck screws 3\"", amount: 24 },
    { name: "Joist hangers", amount: 42.5 },
  ],
};

/** The formats the vision model reads. HEIC is not one of them — the browser
 *  re-encodes a phone photo to JPEG before it gets here (lib/receiptImage),
 *  and anything else is refused with a sentence rather than a 400 from OpenAI. */
const READABLE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
/** Decoded bytes. The client sends ~3 MB at most; this is the wall behind it,
 *  under the 4.5 MB request ceiling production enforces before the code runs. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function decodedBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Every refusal names what happened. A silent "No OCR result" was the whole
 *  of what the owner saw when a phone photo failed (2026-09-19). */
export async function scanReceipt(input: {
  jobId: string;
  dataUrl: string;
}): Promise<
  | { ok: true; ocr: OcrResult; disabled?: false }
  | { ok: true; ocr: OcrResult; disabled: true }
  | { ok: false; error: string }
> {
  const { organizationId } = await requireManager();
  await enforceRateLimit(`vision:${organizationId}`, 60, HOUR, "receipt scans");
  const job = await db.job.findUnique({ where: { id: input.jobId } });
  if (!job || job.organizationId !== organizationId) return { ok: false, error: "That job isn't in this organization — pick another job and retry." };

  const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";
  if (!dataUrl.startsWith("data:image/")) {
    return { ok: false, error: "That is not an image — a receipt uploads as a photo: JPG, PNG or WebP." };
  }
  if (!READABLE_DATA_URL.test(dataUrl)) {
    const kind = (dataUrl.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1] ?? "that").toUpperCase();
    return {
      ok: false,
      error: /hei[cf]/i.test(kind)
        ? "HEIC photos can't be read here — share it from the phone as JPEG, or screenshot it and upload that."
        : `${kind} images can't be read here — upload a JPG, PNG or WebP of the receipt.`,
    };
  }
  const bytes = decodedBytes(dataUrl);
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: `That photo is ${(bytes / 1048576).toFixed(1)} MB — too large to read. Try a closer shot of just the receipt.` };
  }

  // A paid vision read: closed once the plan has ended (lib/paidCaps).
  const ended = await planEndedRefusal(organizationId, "receipt reading");
  if (ended) return ended;
  if (!isOpenAIEnabled()) return { ok: true, ocr: STUB, disabled: true };
  // The card-less trial's AI ceiling (lib/trialMeter): one read, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;

  try {
    const result = await runVisionJson<OcrResult>({
      systemPrompt:
        'You are an expense clerk reading a receipt photo. Return strictly JSON: {vendor: string, total: number, category: one of [Materials, Labor, Fuel, Tools, Subcontractor, Other], note: string, lineItems: [{name: string, amount: number}] (up to 10)}. Do your best to infer the total even if torn or faded. If it is not a receipt, return {vendor: "", total: 0, category: "Other", note: "not a receipt", lineItems: []}.',
      userPrompt: "Extract the fields from this receipt.",
      imageUrl: dataUrl,
      // A receipt is a tall strip of small print: at "auto" the model may
      // take one 512px glance at it. "high" tiles it at full resolution, so
      // the long edge the browser keeps (2000px, under the model's own 2048)
      // is actually read.
      detail: "high",
    });
    if (!result) {
      return { ok: false, error: "The reader answered with nothing usable from that photo — try a sharper, straighter shot of the whole receipt." };
    }
    const vendor = typeof result.vendor === "string" ? result.vendor.trim() : "";
    const total = typeof result.total === "number" && Number.isFinite(result.total) ? result.total : 0;
    if (!vendor && total <= 0) {
      return { ok: false, error: "That doesn't read as a receipt — no vendor or total was found. Try a clearer photo of the whole receipt, top to bottom." };
    }
    return { ok: true, ocr: { ...result, vendor, total } };
  } catch (err) {
    // A 400 is the model refusing the picture itself (format, corrupt bytes,
    // a data URL it cannot open) — say that, since "try again" would not help.
    const status = (err as { status?: number })?.status;
    const raw = err instanceof Error ? err.message : String(err);
    if (status === 400 || /image|invalid_image|unsupported/i.test(raw)) {
      console.error(`[receiptOcr] the model refused the image (${status ?? "?"}): ${raw}`);
      return { ok: false, error: "The reader couldn't open that photo. Upload a JPG or PNG straight from the camera, or a screenshot of it." };
    }
    return { ok: false, error: friendlyAIError(err, "the receipt reader") };
  }
}

export async function saveReceiptExpense(input: {
  jobId: string;
  dataUrl: string;
  filename: string;
  vendor: string;
  total: number;
  category: string;
  note: string | null;
  ocrJson: OcrResult | null;
}) {
  const { organizationId, user, role } = await requireManager();
  await enforceRateLimit(`vision:${organizationId}`, 60, HOUR, "receipt scans");
  const job = await db.job.findUnique({ where: { id: input.jobId } });
  if (!job || job.organizationId !== organizationId) throw new Error("Not found");

  // Inline image only — the stored URL is rendered as a link + thumbnail in
  // the financials ledger for every manager.
  const match = input.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match || !IMAGE_DATA_URL.test(input.dataUrl)) throw new Error("Receipt must be an image");
  // A receipt is private (stage B): the private store, the local fallback,
  // or — production before the store exists — the data URL, as before.
  const { url: receiptUrl } = await putPrivate(`receipts/${input.jobId}/${Date.now()}-${safeFilename(input.filename, "receipt")}`, Buffer.from(match[2], "base64"), match[1].toLowerCase());

  // The id and the resolved receipt URL come back so a caller that keeps its
  // own on-screen copy of the book can append the REAL row — one that its
  // delete button can then address — instead of a placeholder.
  // The one rule (lib/jobExpenses, stage A 2026-09-30): the office's row is
  // APPROVED at once, with the vendor in its own column and the trail row
  // that names who booked it.
  const created = await createJobExpense(
    { organizationId, userId: user.id, role },
    {
      jobId: input.jobId,
      category: input.category,
      amount: input.total,
      note: input.note || (input.vendor ? `Vendor: ${input.vendor}` : null),
      receiptUrl,
      ocrJson: input.ocrJson ? JSON.stringify(input.ocrJson) : null,
      vendor: input.vendor || null,
      via: "dashboard",
    },
  );
  revalidatePath(`/dashboard/jobs/${input.jobId}`);
  revalidatePath("/dashboard/financials");
  revalidatePath("/dashboard/financials/expenses");
  // The page keeps its own copy of the book: it gets the short signed link.
  return { ok: true, id: created.id, receiptUrl: mediaHref(receiptUrl) ?? receiptUrl };
}
