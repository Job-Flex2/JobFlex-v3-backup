// TEXTING TERMS — /book/<slug>/texting (2026-10-12). The company's own SMS terms, public: what it texts, how a client
// agrees, how often, the cost, STOP and HELP. Twilio's toll-free review asks for this page (error 30493) when JobFlex
// registers the company's texting number in its name.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../../book-public.css";
import { bookingConsentText } from "@/lib/sms/registrationShared";
import { SMS_PAGES_UPDATED, phoneWords, smsCompany } from "../sms-company";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await smsCompany((await params).slug);
  return { title: c ? `Text messages from ${c.name}` : "Text messages", robots: { index: false, follow: true } };
}

export default async function TextingTermsPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await smsCompany((await params).slug);
  if (!c) notFound();
  const phone = phoneWords(c.phone);
  const consent = bookingConsentText(c.name);
  return (
    <main className="jf-book" data-sms-terms>
      <article className="jfb-sheet jfb-legal">
        <div className="jfb-kicker">{c.name}</div>
        <h1 className="text-[26px] font-semibold leading-tight">Text messages from {c.name}</h1>
        <p className="mt-1 text-[13px] text-[color:var(--ink-muted,#666)]">Texting terms · updated {SMS_PAGES_UPDATED}</p>

        <h2 className="mt-6 text-[17px] font-semibold">What we text</h2>
        <p className="mt-1">
          {c.name} texts the clients who ask for it about their own visits and work: the confirmation of a visit you booked, a reminder the evening before,
          the link to the estimate or proposal you asked for, and updates about your job. Our crew members get their own job schedules. We do not send marketing
          or promotional texts.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">How you agree</h2>
        <p className="mt-1">
          When you book a visit on our <a className="underline" href={`/book/${encodeURIComponent(c.slug)}`}>booking page</a>, you can tick
          {" "}“{consent.lead}” The box is not ticked for you, and agreeing is not a condition of booking or of any purchase.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">How often, and the cost</h2>
        <p className="mt-1">Message frequency varies with your visits and your job — usually a few texts per job. Message and data rates may apply.</p>

        <h2 className="mt-6 text-[17px] font-semibold">Stop or get help any time</h2>
        <p className="mt-1">
          Reply <b>STOP</b> to any text and the texts stop. Reply <b>START</b> to receive them again. Reply <b>HELP</b> for help,
          {phone ? <> or call us at <a className="underline" href={`tel:${c.phone}`}>{phone}</a></> : null}
          {c.email ? <>{phone ? "," : ""} or email <a className="underline" href={`mailto:${c.email}`}>{c.email}</a></> : null}
          {phone || c.email ? "." : " or reach us through our booking page."}
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">Good to know</h2>
        <p className="mt-1">
          Carriers are not liable for delayed or undelivered messages. How we use and protect your information, including your phone number, is in our{" "}
          <a className="underline" href={`/book/${encodeURIComponent(c.slug)}/privacy`}>privacy policy</a>.
        </p>

        <p className="mt-8 text-[12px] text-[color:var(--ink-muted,#666)]">{c.name} sends these texts through JobFlex, its scheduling software.</p>
      </article>
    </main>
  );
}
