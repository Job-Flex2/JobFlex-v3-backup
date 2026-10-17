"use client";
import * as React from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Toggle } from "@/components/settings/Toggle";
import { toast } from "@/components/ui/Toast";
import { updateProposalDefaults } from "@/actions/settings";
import { underField } from "@/lib/actionResult";

interface ScheduleStep {
  id: string;
  label: string;
  pct: number;
}

type PricingField = "materialMarkupPct" | "laborMarkupPct" | "defaultTaxRate";
const PRICING_FIELDS: PricingField[] = ["materialMarkupPct", "laborMarkupPct", "defaultTaxRate"];
// The same ceilings actions/settings proposalDefaultsSchema enforces (tax there
// is the fraction, 1 = 100%).
const MARKUP_MAX = 1000;
const TAX_MAX = 100;

/** The typed percent as a number, or the sentence the field shows instead. */
function readPercent(text: string, max: number): number | string {
  const t = text.trim();
  if (!t) return "Enter a number — 0 for none.";
  const n = Number(t);
  if (!Number.isFinite(n)) return "Enter a number, like 12.5.";
  if (n < 0) return "Can't be below 0.";
  if (n > max) return `${max} at most.`;
  return n;
}

const DEFAULT_STEPS: ScheduleStep[] = [
  { id: "a", label: "Deposit on signature", pct: 30 },
  { id: "b", label: "Materials delivered", pct: 40 },
  { id: "c", label: "Completion", pct: 30 },
];

export function ProposalsSettingsForm({
  initialMaterialMarkup,
  initialLaborMarkup,
  initialTaxRate,
}: {
  initialMaterialMarkup: number;
  initialLaborMarkup: number;
  initialTaxRate: number;
}) {
  const [validity, setValidity] = React.useState(14);
  const [autoFollow, setAutoFollow] = React.useState(true);
  const [showMargin, setShowMargin] = React.useState(false);
  const [steps, setSteps] = React.useState<ScheduleStep[]>(DEFAULT_STEPS);

  // Real, persisted org-wide markup defaults (hidden from the client). Seeded
  // into every new proposal; overridable per proposal in the Estimate breakdown.
  // Held as the TYPED text: Number("") is 0, so a number state turned a cleared
  // field into a saved 0% markup without a word (QA F-1f3f6da5).
  const [matMk, setMatMk] = React.useState(String(initialMaterialMarkup));
  const [labMk, setLabMk] = React.useState(String(initialLaborMarkup));
  // Markup is a whole percent (20 = 20%). Tax is stored as a FRACTION (0.08),
  // so the field shows a percent (seed from fraction*100) and we divide by 100
  // on save. Do NOT treat these two the same way.
  const [taxPct, setTaxPct] = React.useState(String(+(initialTaxRate * 100).toFixed(4)));
  const [pricingErr, setPricingErr] = React.useState<Partial<Record<PricingField | "form", string>>>({});
  const [savingMarkup, setSavingMarkup] = React.useState(false);

  async function savePricing() {
    // A wrong value is the person's to fix: nothing is sent, the saved
    // defaults stay as they were, and the field says what it needs.
    const errs: Partial<Record<PricingField, string>> = {};
    const mat = readPercent(matMk, MARKUP_MAX);
    const lab = readPercent(labMk, MARKUP_MAX);
    const tax = readPercent(taxPct, TAX_MAX);
    if (typeof mat === "string") errs.materialMarkupPct = mat;
    if (typeof lab === "string") errs.laborMarkupPct = lab;
    if (typeof tax === "string") errs.defaultTaxRate = tax;
    setPricingErr(errs);
    if (typeof mat === "string" || typeof lab === "string" || typeof tax === "string") return;

    setSavingMarkup(true);
    try {
      const res = await updateProposalDefaults({
        materialMarkupPct: mat,
        laborMarkupPct: lab,
        defaultTaxRate: tax / 100,
      });
      if (!res.ok) {
        const field = res.field as PricingField | undefined;
        setPricingErr(field && PRICING_FIELDS.includes(field) ? { [field]: underField(res) } : { form: res.error });
        return;
      }
      toast.success("Saved", "Default pricing updated for new proposals.");
    } catch {
      toast.error("Couldn't save", "Please try again.");
    } finally {
      setSavingMarkup(false);
    }
  }

  function add() {
    setSteps((s) => [...s, { id: Math.random().toString(36).slice(2, 8), label: "", pct: 0 }]);
  }
  function update(id: string, patch: Partial<ScheduleStep>) {
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function remove(id: string) {
    setSteps((s) => s.filter((x) => x.id !== id));
  }
  const total = steps.reduce((a, s) => a + s.pct, 0);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Proposals"
        description="Defaults that ship with every new proposal."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>General</CardTitle>
              <CardSubtitle>Validity, language, defaults.</CardSubtitle>
            </div>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Default validity (days)"
              type="number"
              value={validity}
              onChange={(e) => setValidity(Number(e.target.value))}
              hint="Auto-expires after"
            />
          </div>
          <div className="mt-4 divide-y divide-[color:var(--ink-line)]">
            <Toggle
              checked={autoFollow}
              onChange={setAutoFollow}
              label="Auto follow-ups"
              description="Schedule reminders 3, 7, and 14 days after sending."
            />
            <Toggle
              checked={showMargin}
              onChange={setShowMargin}
              label="Show margin in editor"
              description="Display a margin badge while drafting (you only — clients never see it)."
            />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Default pricing</CardTitle>
              <CardSubtitle>Hidden markup + sales tax for every new proposal.</CardSubtitle>
            </div>
            <Badge tone="accent">applies forward</Badge>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Materials markup %"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={MARKUP_MAX}
              value={matMk}
              onChange={(e) => setMatMk(e.target.value)}
              error={pricingErr.materialMarkupPct}
              aria-invalid={!!pricingErr.materialMarkupPct}
            />
            <Input
              label="Labor markup %"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={MARKUP_MAX}
              value={labMk}
              onChange={(e) => setLabMk(e.target.value)}
              error={pricingErr.laborMarkupPct}
              aria-invalid={!!pricingErr.laborMarkupPct}
            />
          </div>
          <div className="mt-3">
            <Input
              label="Default tax rate %"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={TAX_MAX}
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
              error={pricingErr.defaultTaxRate}
              aria-invalid={!!pricingErr.defaultTaxRate}
              hint="Applied on top of the subtotal, after markup. Enter 0 for no tax."
            />
          </div>
          {pricingErr.form ? (
            <p role="alert" className="mt-3 text-[11px] text-[color:var(--rose)]">
              {pricingErr.form}
            </p>
          ) : null}
          <p className="mt-4 text-[11px] text-[color:var(--ink-muted)] leading-relaxed">
            New proposals start with this markup and tax. Markup is hidden — clients never
            see it as a separate line; it&apos;s folded into each item&apos;s price. Tax shows
            as its own line. You can still override both in any individual proposal. At 0%
            nothing changes.
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={savePricing} disabled={savingMarkup}>
              {savingMarkup ? "Saving…" : "Save pricing"}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Default payment schedule</CardTitle>
            <CardSubtitle>How installments break out of every total.</CardSubtitle>
          </div>
          <Button variant="outline" size="sm" onClick={add} icon={<Plus className="h-3 w-3" />}>
            Add step
          </Button>
        </CardHeader>
        <div className="space-y-2">
          {steps.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-12 gap-2 items-center p-3 rounded-[var(--r-md)] hairline bg-white/40 dark:bg-white/[0.02]"
            >
              <div className="col-span-7">
                <Input
                  placeholder="Deposit / Materials delivered / Completion"
                  value={s.label}
                  onChange={(e) => update(s.id, { label: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  value={s.pct}
                  onChange={(e) => update(s.id, { pct: Number(e.target.value) })}
                  suffix={<span className="text-[10px]">%</span>}
                />
              </div>
              <div className="col-span-1 text-[11px] text-[color:var(--ink-muted)] text-right tabular">
                {s.pct}%
              </div>
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="col-span-1 h-8 w-8 grid place-items-center rounded-[var(--r-sm)] text-[color:var(--ink-muted)] hover:text-rose-700 hover:bg-rose-50"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-[color:var(--ink-muted)]">Total</span>
          <span
            className={`font-display tabular text-[18px] ${
              total === 100 ? "text-[color:var(--ink)]" : "text-rose-700"
            }`}
          >
            {total}%
          </span>
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Standard terms</CardTitle>
            <CardSubtitle>
              Appears at the bottom of every proposal under "Terms &amp; conditions".
            </CardSubtitle>
          </div>
          <FileText className="h-4 w-4 text-[color:var(--ink-muted)]" />
        </CardHeader>
        <Textarea
          rows={6}
          defaultValue={`This proposal is valid for ${validity} days from the date of issue. A non-refundable deposit secures your slot on our calendar. Workmanship guaranteed for 12 months from completion.`}
        />
        <div className="mt-5 flex gap-2">
          <Button onClick={() => toast.success("Saved", "Proposal defaults updated.")}>
            Save changes
          </Button>
        </div>
      </Card>
    </>
  );
}
