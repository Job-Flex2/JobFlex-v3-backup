// Auth · Create account — the donor's icon sprite, verbatim.
// Source: the hidden `<svg width="0" height="0">` defs block that opens the
// donor's <body> in `jobflex-auth-register-blueprint.html`. Every
// `<use href="#i-…">` on the page resolves against it, so it must stay mounted
// ahead of the markup that references it.
//
// viewBox and path data are character-for-character the donor's — no icon is
// substituted from an existing sprite in this repo.

export function RegisterSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24">
        <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2" />
        <path d="M6.6 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2" />
        <path d="M3 3l18 18" />
      </symbol>
      <symbol id="i-arrow-r" viewBox="0 0 24 24">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24">
        <path d="M6 18L18 6" />
        <path d="M9 6h9v9" />
      </symbol>
      <symbol id="i-back" viewBox="0 0 24 24">
        <path d="M15 5l-7 7 7 7" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M12 6v12" />
          <path d="M6 12h12" />
        </symbol>
        <symbol id="i-minus" viewBox="0 0 24 24">
          <path d="M6 12h12" />
        </symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M4 12.5l5 5L20 6.5" />
      </symbol>
      {/* Not the donor's: the price strip's tag on step 1 (2026-10-18), the roof estimator sprite's i-tag. */}
      <symbol id="i-tag" viewBox="0 0 24 24">
        <path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.2 8.2a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z" />
        <circle cx="7" cy="7" r="1.2" />
      </symbol>
      <symbol id="i-gift" viewBox="0 0 24 24">
        <rect x="3" y="9" width="18" height="12" rx="1" />
        <path d="M3 13h18" />
        <path d="M12 9v12" />
        <path d="M8 9a2.5 2.5 0 0 1 0-5c2 0 4 5 4 5" />
        <path d="M16 9a2.5 2.5 0 0 0 0-5c-2 0-4 5-4 5" />
      </symbol>
      <symbol id="i-google" viewBox="0 0 48 48">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.97 6.19C6.51 42.62 14.62 48 24 48Z"
        />
      </symbol>
    </svg>
  );
}
