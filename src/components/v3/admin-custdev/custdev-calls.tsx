"use client";
// Customer development · who to talk to next (owner, 2026-10-22): one card per account, why now, how to reach them,
// the questions to ask, and two moves — log the interview, or email them from the console's composer.
import { CALL_GROUPS, type CallCard } from "@/lib/custDev/model";
import { Empty, cx } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { EmailContractorButton } from "@/components/v3/admin-mail/contractor-mail";
import type { InterviewDraft } from "./custdev-interviews";
import s from "./custdev.module.css";

export function CallCards({ calls, onLog }: { calls: CallCard[]; onLog: (d: InterviewDraft) => void }) {
  if (!calls.length) return <Empty>Nobody to call right now — every account with contact details was talked to in the last 30 days, or there are no accounts yet.</Empty>;
  return (
    <ul className={s.calls}>
      {calls.map((c) => {
        const g = CALL_GROUPS.find((x) => x.key === c.group);
        return (
          <li key={`${c.group}:${c.orgId}`} className={s.call} data-custdev-call={c.group}>
            <div className={s.callHead}>
              <span className={s.callGroup}>{g?.label}</span>
              <span className={s.callCompany}>{c.company}</span>
              <span className={s.callTrade}>{c.trade}</span>
            </div>
            <p className={s.callWhy}>{c.reason}</p>
            <p className={s.callContact}>
              {c.contact.name ? <span>{c.contact.name}</span> : null}
              {c.contact.phone ? <a href={`tel:${c.contact.phone}`}>{c.contact.phone}</a> : null}
              {c.contact.email ? <span className={s.callEmail}>{c.contact.email}</span> : null}
            </p>
            {g ? (
              <details className={s.callQs}>
                <summary>What to ask</summary>
                <ol>
                  {g.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
              </details>
            ) : null}
            <div className={s.callActs}>
              <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm, s.tap)} onClick={() => onLog({ orgId: c.orgId, company: c.company, trade: c.trade, person: c.contact.name ?? "", kind: g?.kind ?? "problem" })}>
                Log interview
              </button>
              <EmailContractorButton orgId={c.orgId} seed={{ business: c.company, ownerName: c.contact.name ?? undefined, ownerEmail: c.contact.email ?? undefined }} label="Email" className={s.tap} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
