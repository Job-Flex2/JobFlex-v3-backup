// THE REQUEST JUST SENT (2026-10-23) — pure, for both sides. The intake wizard's photos go into the new request's job
// folder (lib/home/files) right after it is sent. The wizard has the request's own token, never the home's key (that is
// shown on screen only to a first-timer — the intake is public and the email may not be someone's own), so the folder's
// upload door also opens to the request's token alone: for a little while after sending, adding files only, a few.

/** Said in place of the home key in the upload routes (a real key is 24 random characters, never this). */
export const FRESH_REQUEST_KEY = "just-sent";
/** How long after sending the request's token alone may add files. */
export const FRESH_REQUEST_MS = 2 * 60 * 60 * 1000;
/** How many files the wizard may add that way (the dashboard's folder holds more). */
export const FRESH_REQUEST_MAX_FILES = 12;
/** How many files the wizard takes. */
export const WIZARD_MAX_FILES = 6;
