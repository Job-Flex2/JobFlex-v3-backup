import type { Metadata } from "next";
import { orgBySlug, settingsOf } from "@/lib/bookingBook";
import { listedEmail } from "./sms-company";
import { BookWizard } from "./book-wizard";

// BOOK A VISIT (2026-09-23) — public, /book/<company slug>. The company's
// bookable services and open times; a visit booked here lands on the
// calendar as an appointment and, for a new customer, as a lead.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a visit", description: "Pick a service and a time that suits you." };

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await orgBySlug(slug);
  const settings = org ? settingsOf(org) : null;
  const name = org?.name ?? "This company";
  // The contact email the company listed with its texting registration — with no website of its own, this page is its website.
  const email = org ? await listedEmail(org.id) : null;
  return (
    <main className="min-h-screen bg-[color:var(--paper,#f4f2ec)] px-4 py-10">
      <div className="mx-auto w-full max-w-lg rounded-[14px] border border-[color:var(--ink-line,#ddd)] bg-white overflow-hidden">
        <div className="p-6 border-b border-[color:var(--ink-line,#ddd)]">
          <div className="quiet-caps mb-2">{name}</div>
          <h1 className="text-[24px] font-semibold leading-tight">Book a visit</h1>
          {org?.phone && <p className="mt-1 text-[13px] text-[color:var(--ink-muted,#666)]">Rather call? {org.phone}</p>}
          {email && (
            <p className="mt-1 text-[13px] text-[color:var(--ink-muted,#666)]" data-book-email>
              Email: <a className="underline" href={`mailto:${email}`}>{email}</a>
            </p>
          )}
        </div>
        <div className="p-6">
          {!org || !settings ? (
            <p className="text-[14px]">This booking page is not available.</p>
          ) : !settings.enabled ? (
            <p className="text-[14px]">Online booking is off right now — please call {name}{org.phone ? ` at ${org.phone}` : ""}.</p>
          ) : (
            <BookWizard slug={org.slug} orgName={name} services={settings.services} intro={settings.intro} arrivalWindow={settings.arrivalWindow} />
          )}
        </div>
      </div>
    </main>
  );
}
