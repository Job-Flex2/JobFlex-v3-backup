// QA LAB TEST ADDRESSES (2026-10-14). Every address under @qa.jobflex.test
// belongs to the automated checks in qa/ (qa/README.md). `.test` is a reserved
// top-level domain, so no such mailbox can exist. These accounts are left out
// of the admin statistics (lib/statsHidden), of PostHog and of Meta — on the
// server (lib/qaTestMode) and in the browser (markQaVisitor below) — and, with
// QA_TEST_MODE=1 outside production, their codes are kept for the test
// endpoint instead of being emailed (/api/qa/otp).
//
// No "server-only" here: the browser side needs the same rule.

export const QA_EMAIL_DOMAIN = "@qa.jobflex.test";

export function isQaEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(QA_EMAIL_DOMAIN);
}

const VISITOR_KEY = "jf_qa_visitor";

/** In the browser: once a QA address is typed and sent, this browser sends no
 *  analytics or ad events any more (posthog-capture, traffic-client, metaPixel). */
export function markQaVisitor(email: string | null | undefined): void {
  if (!isQaEmail(email) || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VISITOR_KEY, "1");
  } catch {
    /* storage off: this page still knows below */
  }
  (window as unknown as { __jfQaVisitor?: boolean }).__jfQaVisitor = true;
}

export function isQaVisitor(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as { __jfQaVisitor?: boolean }).__jfQaVisitor) return true;
  try {
    return window.localStorage.getItem(VISITOR_KEY) === "1";
  } catch {
    return false;
  }
}
