// "Have the AI desk call me" — the open page (lib/outreach): a contractor types their number and asks for the call.
import type { Metadata } from "next";
import { CallMeForm } from "@/components/v3/call-me/call-me-form";

export const metadata: Metadata = {
  title: "Hear the AI desk · JobFlex",
  description: "JobFlex's AI desk calls you in half a minute and answers the way it would for your business.",
};

export default function CallMePage() {
  return <CallMeForm token={null} prefill={null} />;
}
