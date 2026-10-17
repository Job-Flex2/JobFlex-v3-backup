"use client";
import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import {
  FOLLOW_UP_CHANNELS,
  MAX_DELAY_MINUTES,
  TEXT_NEEDS_TWILIO,
  triggerMoment,
  type FollowUpChannel,
} from "@/lib/followUps/copy";
import { underField, type Refusal } from "@/lib/actionResult";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: {
    id?: string;
    name: string;
    triggerStatus: string;
    delayMinutes: number;
    enabled: boolean;
    channel: FollowUpChannel;
  }) => Promise<Refusal | void>;
  /** A configured Twilio number. Without one, TEXT is offered disabled with the
   *  same sentence the client message composer shows. */
  smsEnabled?: boolean;
  existing?: {
    id: string;
    name: string;
    triggerStatus: string;
    delayMinutes: number;
    enabled: boolean;
    channel: FollowUpChannel;
  } | null;
}

const TRIGGERS = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED"];

export function NewFollowUpRuleSheet({
  open,
  onClose,
  onSubmit,
  smsEnabled = false,
  existing,
}: Props) {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [triggerStatus, setTriggerStatus] = React.useState(existing?.triggerStatus ?? "SENT");
  // The typed text — Number("") is 0, and a number state hid what was typed.
  const [delayValue, setDelayValue] = React.useState(
    String(existing ? delayToValue(existing.delayMinutes).value : 48),
  );
  const [delayUnit, setDelayUnit] = React.useState<"minutes" | "hours" | "days">(
    existing ? delayToValue(existing.delayMinutes).unit : "hours",
  );
  const [enabled, setEnabled] = React.useState(existing?.enabled ?? true);
  const [channel, setChannel] = React.useState<FollowUpChannel>(existing?.channel ?? "EMAIL");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<{ name?: string; delayMinutes?: string; form?: string }>({});

  React.useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setTriggerStatus(existing?.triggerStatus ?? "SENT");
    const d = delayToValue(existing?.delayMinutes ?? 60 * 48);
    setDelayValue(String(d.value));
    setDelayUnit(d.unit);
    setEnabled(existing?.enabled ?? true);
    setChannel(existing?.channel ?? "EMAIL");
    setErrors({});
  }, [open, existing]);

  async function submit() {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Enter a rule name.";
    const delayMinutes = toMinutes(Number(delayValue.trim() || NaN), delayUnit);
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > MAX_DELAY_MINUTES) {
      errs.delayMinutes = "Enter a whole number — from 1 minute up to 365 days.";
    }
    setErrors(errs);
    if (errs.name || errs.delayMinutes) return;

    setBusy(true);
    try {
      const res = await onSubmit({
        id: existing?.id,
        name: name.trim(),
        triggerStatus,
        delayMinutes,
        enabled,
        channel,
      });
      if (res && !res.ok) {
        // The server's refusal: under the field it names, else above the buttons.
        setErrors(res.field === "name" || res.field === "delayMinutes" ? { [res.field]: underField(res) } : { form: res.error });
        return;
      }
      onClose();
      toast.success(existing ? "Rule updated" : "Rule created");
    } catch (err: any) {
      toast.error("Save failed", err?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? "Edit follow-up rule" : "New follow-up rule"}
      description="Trigger an email when a proposal hits a status, after a delay."
      width="min(480px, 100vw)"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            {existing ? "Save changes" : "Create rule"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Rule name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nudge after sending"
          error={errors.name}
          aria-invalid={!!errors.name}
        />
        <Select
          label="Trigger status"
          value={triggerStatus}
          onChange={(e) => setTriggerStatus(e.target.value)}
        >
          {TRIGGERS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <div className="grid grid-cols-[1fr_150px] gap-3">
          <Input
            label="Delay"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={delayValue}
            onChange={(e) => setDelayValue(e.target.value)}
            error={errors.delayMinutes}
            aria-invalid={!!errors.delayMinutes}
          />
          <Select
            label="Unit"
            value={delayUnit}
            onChange={(e) => setDelayUnit(e.target.value as any)}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </Select>
        </div>
        <div>
          <Select
            label="Send by"
            value={channel}
            onChange={(e) => setChannel(e.target.value as FollowUpChannel)}
          >
            {FOLLOW_UP_CHANNELS.map((c) => (
              <option key={c.value} value={c.value} disabled={c.value === "TEXT" && !smsEnabled}>
                {c.label}
              </option>
            ))}
          </Select>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-[color:var(--ink-muted)]">
              {channel === "TEXT" && !smsEnabled
                ? TEXT_NEEDS_TWILIO
                : `Wording is written for "${triggerMoment(triggerStatus)}".`}
            </span>
            <Link
              href={"/dashboard/crm" as never}
              className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[color:var(--accent-ink)] hover:underline"
            >
              <Sparkles className="h-3 w-3" />
              Preview it
            </Link>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-[color:var(--accent)]"
          />
          Enabled
        </label>
        {errors.form ? (
          <p role="alert" className="text-[11px] text-[color:var(--rose)]">
            {errors.form}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function toMinutes(value: number, unit: "minutes" | "hours" | "days") {
  if (unit === "minutes") return value;
  if (unit === "hours") return value * 60;
  return value * 60 * 24;
}

function delayToValue(minutes: number): { value: number; unit: "minutes" | "hours" | "days" } {
  if (minutes % (60 * 24) === 0) return { value: minutes / (60 * 24), unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}
