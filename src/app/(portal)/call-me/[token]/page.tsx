// "Have the AI desk call me" — from JobFlex's one email (lib/outreach): the contractor's business filled in by the
// link's signed token. A token that doesn't check out is the open page.
import type { Metadata } from "next";
import { callMePrefill } from "@/actions/outreach";
import { CallMeForm } from "@/components/v3/call-me/call-me-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hear the AI desk · JobFlex",
  description: "JobFlex's AI desk calls you in half a minute and answers the way it would for your business.",
  robots: { index: false, follow: false },
};

export default async function CallMeTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const prefill = await callMePrefill(token);
  return <CallMeForm token={prefill ? token : null} prefill={prefill} />;
}
