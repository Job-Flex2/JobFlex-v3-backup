"use client";

// Speak instead of typing (owner, 2026-10-15: "add speech-to-text instead of type-in, that you can speak into the
// task"). The browser's own speech recognition (hooks/useDictation): words land in the field as they're heard, after
// what is already there; hidden where the browser can't listen (Firefox).

import { Mic } from "lucide-react";
import { DictateButton } from "@/components/estimator/DictateButton";
import { cx } from "./task-bits";

export function TaskDictate({ value, onChange, label, max }: { value: string; onChange: (next: string) => void; label: string; max?: number }) {
  return (
    <DictateButton
      value={value}
      onChange={(next) => onChange(max ? next.slice(0, max) : next)}
      label={label}
      wrapClassName={cx("dict")}
      buttonClassName={cx("dictBtn")}
      onClassName={cx("dictOn")}
      noteClassName={cx("dictNote")}
      icon={<Mic size={14} aria-hidden />}
    />
  );
}
