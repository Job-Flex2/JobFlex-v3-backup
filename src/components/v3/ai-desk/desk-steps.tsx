"use client";
// THE AI DESK'S SETUP, IN FOUR STEPS (2026-10-14) — the one piece the desk pane and the
// handheld settings page both show:
//   1 · your numbers         desk-numbers.tsx   the desk's number, the business phone, forwarding, who picks up
//   2 · about your company   desk-brief.tsx     say it or type it → the instructions, read or edited line by line
//   3 · when it can book     desk-booking.tsx   time zone, the booking calendar, the next open times
//   4 · voice and a test     desk-voice.tsx     the voice, try it by text, test it by voice
// Each step wears Done / To do from what is actually saved; the minutes card lives beside it.
import { useState } from "react";

import type { DeskFaq } from "@/lib/aiDesk/profile";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import { DeskBooking } from "./desk-booking";
import { DeskBrief } from "./desk-brief";
import { DeskNumbers } from "./desk-numbers";
import { DeskVoiceAndTest } from "./desk-voice";
import s from "./ai-desk.module.css";

function Step({ n, title, sub, done, children, id }: { n: number; title: string; sub: string; done: boolean; children: React.ReactNode; id: string }) {
  return (
    <section className={s.step} id={id} data-desk-step={n} data-done={done ? "1" : "0"}>
      <div className={s.stepHead}>
        <span className={s.stepNum} aria-hidden>
          {n}
        </span>
        <div className={s.stepTitles}>
          <div className={s.stepTitle}>{title}</div>
          <div className={s.note}>{sub}</div>
        </div>
        <span className={`${s.stepChip} ${done ? s.stepChipDone : ""}`}>{done ? C.stepDone : C.stepTodo}</span>
      </div>
      <div className={s.stepBody}>{children}</div>
    </section>
  );
}

export function DeskSteps({ desk, registration, onNumber }: { desk: DeskSettingsData; registration: SmsRegistrationView | null; onNumber?: () => void }) {
  const [written, setWritten] = useState(desk.steps.profile);
  const [samples, setSamples] = useState<DeskFaq[]>([]);
  return (
    <div className={s.steps} data-desk-steps>
      <Step n={1} id="desk-step-numbers" title={C.step1} sub={C.step1Sub} done={desk.steps.number}>
        <DeskNumbers desk={desk} registration={registration} onNumber={onNumber} />
      </Step>
      <Step n={2} id="desk-step-brief" title={C.step2} sub={C.step2Sub} done={written}>
        <DeskBrief
          desk={desk}
          onWritten={(xs) => {
            setWritten(true);
            setSamples(xs);
          }}
        />
      </Step>
      <Step n={3} id="desk-step-booking" title={C.step3} sub={C.step3Sub} done={desk.steps.booking}>
        <DeskBooking desk={desk} />
      </Step>
      <Step n={4} id="desk-step-voice" title={C.step4} sub={C.step4Sub} done={desk.steps.tested}>
        <DeskVoiceAndTest desk={desk} samples={samples} />
      </Step>
    </div>
  );
}
