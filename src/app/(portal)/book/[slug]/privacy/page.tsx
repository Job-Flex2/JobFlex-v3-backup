// PRIVACY POLICY — /book/<slug>/privacy (2026-10-12). The company's own privacy policy for what its booking page and its
// texts collect, public. Twilio's toll-free review asks for it (error 30519) and rejects a policy that lets text-message
// opt-in data reach third parties (30477, 30521) — the sharing paragraph below is the carriers' own wording.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../../book-public.css";
import { SMS_PAGES_UPDATED, phoneWords, smsCompany } from "../sms-company";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await smsCompany((await params).slug);
  return { title: c ? `Privacy policy · ${c.name}` : "Privacy policy", robots: { index: false, follow: true } };
}

export default async function CompanyPrivacyPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await smsCompany((await params).slug);
  if (!c) notFound();
  const phone = phoneWords(c.phone);
  return (
    <main className="jf-book" data-sms-privacy>
      <article className="jfb-sheet jfb-legal">
        <div className="jfb-kicker">{c.name}</div>
        <h1 className="text-[26px] font-semibold leading-tight">Privacy policy</h1>
        <p className="mt-1 text-[13px] text-[color:var(--ink-muted,#666)]">{c.name} · updated {SMS_PAGES_UPDATED}</p>

        <h2 className="mt-6 text-[17px] font-semibold">What we collect</h2>
        <p className="mt-1">
          When you book a visit or ask us for an estimate we collect what you give us: your name, email, phone number, the address of the work and your notes
          about it, and — if you tick the box — your agreement to receive texts from us.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">How we use it</h2>
        <p className="mt-1">
          To schedule and confirm your visit, prepare and send the estimate or proposal you asked for, do the work and keep you informed about it — by email,
          by phone, and by text if you agreed to texts. We do not sell your information.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">Text messages and your phone number</h2>
        <p className="mt-1">
          No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Information sharing to subcontractors in
          support services, such as customer service, is permitted. All other categories exclude text messaging originator opt-in data and consent; this
          information will not be shared with any third parties. Reply STOP to any text to stop them; see our{" "}
          <a className="underline" href={`/book/${encodeURIComponent(c.slug)}/texting`}>texting terms</a>.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">Who handles it for us</h2>
        <p className="mt-1">
          Our scheduling software, JobFlex, stores this information for us and sends our emails and texts (through its messaging provider) only to provide these
          services to you — never for its own marketing.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">How we keep it</h2>
        <p className="mt-1">
          Your information is kept on secured, access-controlled systems for as long as we need it to serve you and keep our business records. Ask us and we
          will correct it or delete what we are not required to keep.
        </p>

        <h2 className="mt-6 text-[17px] font-semibold">Contact us</h2>
        <p className="mt-1">
          {c.name}
          {phone ? <> · <a className="underline" href={`tel:${c.phone}`}>{phone}</a></> : null}
          {c.email ? <> · <a className="underline" href={`mailto:${c.email}`}>{c.email}</a></> : null}
        </p>
      </article>
    </main>
  );
}
