"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { DeskSteps } from "./desk-steps";
import { DESK_COPY, type DeskSettingsData } from "../settings-blueprint/settings-data";
import type { SmsRegistrationView } from "@/lib/sms/registrationShared";
import s from "./desk-workspace-header.module.css";

export type DeskWorkspaceData = { desk: DeskSettingsData | null; registration: SmsRegistrationView | null };

/** Kept beside the call log so switching tabs preserves its filters and open drafts. */
export function DeskWorkspaceHeader({ settings }: { settings?: DeskWorkspaceData }) {
  const params = useSearchParams();
  const router = useRouter();
  const settingsOpen = params.get("tab") === "settings";
  return (
    <section className={s.workspace} data-nest data-ai-desk-tab={settingsOpen ? "settings" : "calls"}>
      <h1>AI desk</h1>
      <div className={s.controls}>
        <nav aria-label="AI desk">
          <Link href="/dashboard/phone" aria-current={!settingsOpen ? "page" : undefined}>Calls</Link>
          <Link href="/dashboard/phone?tab=settings" aria-current={settingsOpen ? "page" : undefined}>Settings</Link>
        </nav>
        <Link className={s.setup} href="/dashboard/phone?tab=settings">Set up the desk</Link>
      </div>
      {settingsOpen && <div className={s.settings}>
          {settings?.desk?.canManage ? (
            <DeskSteps desk={settings.desk} registration={settings.registration} onNumber={() => { router.push("/dashboard/settings?pane=texting"); }} />
          ) : <p>{settings ? DESK_COPY.managersOnly : "Desk settings could not be loaded. Refresh to try again."}</p>}
      </div>}
    </section>
  );
}
