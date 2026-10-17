"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PhoneCall, SlidersHorizontal } from "lucide-react";
import { DeskSteps } from "./desk-steps";
import { DESK_COPY, type DeskSettingsData } from "../settings-blueprint/settings-data";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import s from "./desk-workspace-header.module.css";

export type DeskWorkspaceData = { desk: DeskSettingsData | null; registration: SmsRegistrationView | null };

/** Kept beside the call log so switching tabs preserves its filters and open drafts. The two tabs are one framed
 *  Blueprint switch (owner, 2026-10-16) — the plans' Monthly | Annual build: the open one filled with ink. */
export function DeskWorkspaceHeader({ settings }: { settings?: DeskWorkspaceData }) {
  const params = useSearchParams();
  const router = useRouter();
  const settingsOpen = params.get("tab") === "settings";
  return (
    <section className={s.workspace} data-nest data-ai-desk-tab={settingsOpen ? "settings" : "calls"}>
      <h1>AI desk</h1>
      <nav className={s.tabs} aria-label="AI desk">
        <Link href="/dashboard/phone" aria-current={!settingsOpen ? "page" : undefined}>
          <PhoneCall size={15} strokeWidth={2.2} aria-hidden />
          Calls
        </Link>
        <Link href="/dashboard/phone?tab=settings" aria-current={settingsOpen ? "page" : undefined}>
          <SlidersHorizontal size={15} strokeWidth={2.2} aria-hidden />
          AI desk setup
        </Link>
      </nav>
      {settingsOpen && <div className={s.settings}>
          {settings?.desk?.canManage ? (
            <DeskSteps desk={settings.desk} registration={settings.registration} onNumber={() => { router.push("/dashboard/texting#texting-own-number"); }} />
          ) : <p>{settings ? DESK_COPY.managersOnly : "Desk settings could not be loaded. Refresh to try again."}</p>}
      </div>}
    </section>
  );
}
