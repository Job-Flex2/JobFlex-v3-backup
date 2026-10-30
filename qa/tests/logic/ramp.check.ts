// RAMP CARDS ON JOBFLEX — the pure rules (lib/ramp/shared, 2026-10-29): what a transaction says, the job it names,
// the category, the text that asks the tech, the reply that answers, the webhook signature.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/ramp.check.ts
import { createHmac } from "node:crypto";
import {
  RAMP_FIELD_ID, RAMP_FIELD_NAME, RAMP_STOCK_OPTION_ID, askText, confirmText, jobOptionValue, parseJobReply, rampAmount, rampCategory, rampEventTransactionId, rampExpenseNote, rampJobTag, rampMerchant, rampSignatureMatches, rampSpentAt, rampTxState,
  type JobOption, type RampTransaction,
} from "../../../src/lib/ramp/shared";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const tx: RampTransaction = {
  id: "tx_1",
  state: "CLEARED",
  amount: 212.4,
  entity_amount: { value: 212.4, currency: "USD" },
  merchant_name: "The Home Depot #4512",
  sk_category_name: "Hardware Stores",
  user_transaction_time: "2026-10-28T17:12:00Z",
  receipts: ["rc_1"],
  card_holder: { user_id: "u_mike", first_name: "Mike", last_name: "Rivera" },
  accounting_field_selections: [{ id: "opt_ramp_9", external_id: "job_smith", name: "Smith roof · Smith", category_info: { id: "fld_ramp_1", external_id: RAMP_FIELD_ID, name: RAMP_FIELD_NAME, type: "OTHER" } }],
};

console.log("── what a transaction says");
check("state, signed amount, merchant, who, when", rampTxState(tx) === "cleared" && rampAmount(tx) === 212.4 && rampMerchant(tx) === "The Home Depot #4512" && rampSpentAt(tx)?.toISOString() === "2026-10-28T17:12:00.000Z");
check("a refund is negative; a pending one with only the old amount still reads", rampAmount({ entity_amount: { value: -40 } }) === -40 && rampAmount({ amount: 12.345, entity_amount: null }) === 12.35 && rampTxState({ state: "PENDING" }) === "pending" && rampTxState({ state: "DECLINED" }) === "declined" && rampTxState({}) === "pending");
check("the job tag from our field, by the field's Ramp id or by its own id", rampJobTag(tx, "fld_ramp_1")?.kind === "job" && (rampJobTag(tx, "fld_ramp_1") as { jobId: string }).jobId === "job_smith" && (rampJobTag(tx, null) as { jobId: string }).jobId === "job_smith");
check("another field's selection is not a job; the stock option is stock; a memo we wrote counts", rampJobTag({ accounting_field_selections: [{ external_id: "job_x", category_info: { id: "other", name: "Department" } }] }, "fld_ramp_1") === null && rampJobTag({ accounting_field_selections: [{ external_id: RAMP_STOCK_OPTION_ID, category_info: { id: "fld_ramp_1" } }] }, "fld_ramp_1")?.kind === "stock" && (rampJobTag({ memo: "JobFlex: cmv123456789 (Lopez deck)" }, null) as { jobId: string }).jobId === "cmv123456789" && rampJobTag({ memo: "JobFlex: stock" }, null)?.kind === "stock");
check("categories from Ramp's words and the merchant", rampCategory(tx) === "Materials" && rampCategory({ sk_category_name: "Gas Stations", merchant_name: "Chevron" }) === "Fuel" && rampCategory({ merchant_name: "Sunbelt Rentals" }) === "Equipment rental" && rampCategory({ merchant_name: "City of Sacramento Permit Center" }) === "Permits" && rampCategory({ sk_category_name: "Restaurants" }) === "Meals" && rampCategory({ merchant_name: "Harbor Freight" }) === "Tools" && rampCategory({ merchant_name: "Mystery Co" }) === "Materials");
check("the expense note", rampExpenseNote(tx) === "Ramp card · The Home Depot #4512 · Mike Rivera · Hardware Stores");

console.log("── the text and the reply");
const options: JobOption[] = [
  { jobId: "job_smith", title: "Smith roof", value: "Smith roof · Smith" },
  { jobId: "job_lopez", title: "Lopez deck", value: "Lopez deck · Maria Lopez" },
  { jobId: "job_oak", title: "12 Oak St fence", value: "12 Oak St fence · Nguyen" },
];
check("the option's words: title, then the client when the title does not say it", jobOptionValue({ title: "Smith roof", clientName: "Smith" }) === "Smith roof" && jobOptionValue({ title: "Lopez deck", clientName: "Maria Lopez" }) === "Lopez deck · Maria Lopez" && jobOptionValue({ title: "Deck", clientName: null, address: "12 Oak St" }) === "Deck · 12 Oak St");
const ask = askText("Ridgeview Roofing", tx, options);
check("the ask names the company, the money, the merchant and the numbered jobs", ask === "Ridgeview Roofing: $212.40 at The Home Depot #4512 on the Ramp card — which job? Reply 1 Smith roof · 2 Lopez deck · 3 12 Oak St fence · S stock. Or the job's name.", ask);
check("a number answers", (parseJobReply("2", options) as { jobId: string }).jobId === "job_lopez" && (parseJobReply(" #1 ", options) as { jobId: string }).jobId === "job_smith" && parseJobReply("9", options) === null);
check("S or stock is the warehouse; none leaves it", parseJobReply("s", options)?.kind === "stock" && parseJobReply("Stock", options)?.kind === "stock" && parseJobReply("none", options)?.kind === "none" && parseJobReply("skip", options)?.kind === "none");
check("the job's name answers when it is one job's", (parseJobReply("lopez", options) as { jobId: string }).jobId === "job_lopez" && (parseJobReply("the oak st fence", options) as { jobId: string }).jobId === "job_oak" && (parseJobReply("Smith roof job", options) as { jobId: string }).jobId === "job_smith");
check("words that fit nothing, or two jobs, do not answer", parseJobReply("roof deck", options) === null && parseJobReply("thanks", options) === null && parseJobReply("", options) === null);
check("the confirmation", confirmText(tx, "Smith roof") === "Got it — $212.40 at The Home Depot #4512 is on Smith roof. Snap the receipt to Ramp if you haven't.");

console.log("── the webhook");
const raw = JSON.stringify({ id: "evt_1", type: "transactions.cleared", business_id: "biz_1", object: { id: "tx_1" } });
const hex = (s: string, r: string) => createHmac("sha256", s).update(r).digest("hex");
const b64 = (s: string, r: string) => createHmac("sha256", s).update(r).digest("base64");
check("the signature holds in hex or base64, with or without a prefix, and fails otherwise", rampSignatureMatches(raw, "sec", hex("sec", raw), hex, b64) && rampSignatureMatches(raw, "sec", b64("sec", raw), hex, b64) && rampSignatureMatches(raw, "sec", `sha256=${hex("sec", raw)}`, hex, b64) && !rampSignatureMatches(raw, "sec", hex("other", raw), hex, b64) && !rampSignatureMatches(raw, "sec", null, hex, b64) && !rampSignatureMatches(raw + " ", "sec", hex("sec", raw), hex, b64));
check("the event's transaction id, wherever it sits", rampEventTransactionId(JSON.parse(raw)) === "tx_1" && rampEventTransactionId({ object: { transaction_id: "tx_2" } }) === "tx_2" && rampEventTransactionId({ data: { id: "tx_3" } }) === "tx_3" && rampEventTransactionId({}) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
