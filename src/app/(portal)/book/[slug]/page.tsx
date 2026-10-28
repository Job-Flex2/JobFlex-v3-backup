import type { Metadata } from "next";
import { orgBySlug, settingsOf } from "@/lib/bookingBook";
import { listedEmail } from "./sms-company";
import { BookWizard } from "./book-wizard";
import { requireOrg } from "@/lib/orgContext";
import "../book-public.css";

// BOOK A VISIT (2026-09-23) — public, /book/<company slug>. The company's
// bookable services and open times; a visit booked here lands on the
// calendar as an appointment and, for a new customer, as a lead.
// Redrawn as a Blueprint sheet 2026-10-28 (book-public.css, root `.jf-book`).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a visit", description: "Pick a service and a time that suits you." };

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await orgBySlug(slug);
  const settings = org ? settingsOf(org) : null;
  const name = org?.name ?? "This company";
  // The contact email the company listed with its texting registration — with no website of its own, this page is its website.
  const email = org ? await listedEmail(org.id) : null;
  // The company's own people previewing their page get a way back to the desk; a customer never sees it.
  let member = false;
  if (org) {
    try {
      member = (await requireOrg()).organizationId === org.id;
    } catch {
      member = false;
    }
  }
  return (
    <main className="jf-book">
      {member && (
        <nav className="jfb-desk" aria-label="Your dashboard">
          <a className="jfb-btn jfb-btn--sm" href="/dashboard/booking">
            <svg className="jfb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            Back to dashboard
          </a>
          <span>Your page, as your customers see it</span>
        </nav>
      )}
      <div className="jfb-sheet">
        <header className="jfb-head">
          <div className="jfb-kicker">{name}</div>
          <h1 className="jfb-title">Book a visit</h1>
          {(org?.phone || email) && (
            <div className="jfb-contact">
              {org?.phone && (
                <a className="jfb-contact-a" href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}>
                  <svg className="jfb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
                  <span>Rather call? {org.phone}</span>
                </a>
              )}
              {email && (
                <a className="jfb-contact-a" href={`mailto:${email}`} data-book-email>
                  <svg className="jfb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="1" /><path d="m22 6-10 7L2 6" /></svg>
                  <span>Email: {email}</span>
                </a>
              )}
            </div>
          )}
        </header>
        <div className="jfb-body">
          {!org || !settings ? (
            <p className="jfb-state">This booking page is not available.</p>
          ) : !settings.enabled ? (
            <p className="jfb-state">Online booking is off right now — please call {name}{org.phone ? ` at ${org.phone}` : ""}.</p>
          ) : (
            <BookWizard slug={org.slug} orgName={name} services={settings.services} intro={settings.intro} arrivalWindow={settings.arrivalWindow} />
          )}
        </div>
      </div>
    </main>
  );
}
