import type { Metadata } from "next";
import { bookingForManage } from "@/actions/booking";
import { ManageVisit } from "./manage-visit";
import "../../book-public.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your visit", description: "Move or cancel your booked visit." };

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await bookingForManage(token);
  return (
    <main className="jf-book">
      <div className="jfb-sheet">
        <header className="jfb-head">
          <div className="jfb-kicker">{b.ok ? b.orgName : "Your visit"} · your visit</div>
          <h1 className="jfb-title jfb-title--sm">{b.ok ? b.serviceLabel : "This link is not active"}</h1>
          {b.ok && <p className="jfb-for">for {b.name}</p>}
        </header>
        <div className="jfb-body">
          {b.ok ? <ManageVisit token={token} status={b.status} when={b.when} /> : <p className="jfb-state">Please contact the company for a fresh link.</p>}
          {b.ok && (
            <p className="jfb-foot">
              Need something else? <a href={`/book/${b.slug}`}>Book another visit</a>.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
