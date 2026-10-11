// /auth/register/code?k=… — the "Continue in browser" button in the code email
// (lib/signupOtp, 2026-10-10). It does what typing the code does, in whatever
// browser the mail app opened it: a new address goes on to the plan step of
// its sign-up, an address with an account is signed in. Same framed card as
// /auth/register/confirm.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ContinueWithCode } from "./continue-with-code";

export const metadata: Metadata = {
  title: "JobFlex · Continue",
  description: "Continue your JobFlex sign-up.",
  robots: { index: false },
};

export default function CodeLinkPage() {
  return (
    <Suspense fallback={null}>
      <ContinueWithCode />
    </Suspense>
  );
}
