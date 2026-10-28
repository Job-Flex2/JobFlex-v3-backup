// Provider response bodies can echo credentials, Authorization headers or
// webhook URLs. Never send their free-form messages to a browser or a log.
export function credentialErrorMessage(provider: "Stripe" | "Square" | "Stax" | "Wisetack", error: unknown): string {
  const e = error && typeof error === "object" ? error as { statusCode?: unknown; status?: unknown; message?: unknown } : null;
  const status = e?.statusCode ?? e?.status;
  if (status === 401) return `${provider} rejected the credential. Check that it is valid and has not expired or been revoked.`;
  // Recognize a documented permission identifier, never interpolate the body.
  if (provider === "Stripe" && status === 403 && typeof e?.message === "string" && e.message.includes("connected_account_read")) {
    return "Stripe needs Accounts Read permission to verify this account. Enable Accounts Read on your restricted key in Stripe, then reconnect.";
  }
  if (status === 403) return `${provider} denied access. Check the credential's required permissions in your ${provider} dashboard.`;
  if (status === 429) return `${provider} is receiving too many requests. Wait a few minutes and try again.`;
  return `${provider} could not complete the request. Check your provider dashboard or try again later.`;
}
