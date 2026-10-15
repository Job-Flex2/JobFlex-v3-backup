// The crew on site (2026-09-27): the day count behind Start / Back on site /
// Complete, the words the office reads, what a JobPhoto row is (photo or
// video), the store-URL gate, and the owner's roster groups over the stored
// text cells. Static imports only.
import { localDayKey, nextDay, onSiteLine, progressSummary, siteDays } from "../../../src/lib/jobProgressShared";
import { blobPathFor, fileSize, isJobBlobUrl, isVideoType, mediaMetaJson, mediaOf } from "../../../src/lib/jobMediaShared";
import { jobBackLine, jobCompletedLine, jobMediaLine, jobStartedLine } from "../../../src/lib/sms/format";
import { PREF_EVENTS, SMS_GROUPS, defaultNotificationPrefs, parseNotificationPrefs, prefKeyForEvent, smsGroupsOf } from "../../../src/lib/notificationPrefsShared";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const TZ = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

// ── days on site
const rows = [
  { kind: "STARTED", createdAt: at("2026-09-21T15:10:00Z") }, // Mon 8:10 AM PT
  { kind: "STARTED", createdAt: at("2026-09-21T20:00:00Z") }, // Mon again — same day
  { kind: "PHOTO", createdAt: at("2026-09-21T21:00:00Z") },
  { kind: "STARTED", createdAt: at("2026-09-22T15:00:00Z") }, // Tue
  { kind: "STARTED", createdAt: at("2026-09-24T14:30:00Z") }, // Thu
];
check("a day is a local day: two starts on Monday count once", siteDays(rows, TZ).join(",") === "2026-09-21,2026-09-22,2026-09-24");
check("the day key follows the company's clock, not UTC", localDayKey(at("2026-09-22T05:30:00Z"), TZ) === "2026-09-21" && localDayKey(at("2026-09-22T05:30:00Z"), "America/New_York") === "2026-09-22");
let n = nextDay(rows, TZ, at("2026-09-25T15:00:00Z"));
check("a new day: the next press is day 4, today not yet on the clock", n.day === 4 && !n.startedToday && n.daysSoFar === 3, JSON.stringify(n));
n = nextDay(rows, TZ, at("2026-09-24T22:00:00Z"));
check("later the same day: today is already on the clock, day 3", n.day === 3 && n.startedToday && n.daysSoFar === 3, JSON.stringify(n));
check("a fresh job: day 1", nextDay([], TZ).day === 1 && nextDay([], TZ).daysSoFar === 0);

// ── words
check("the trail sentences", progressSummary("Sofia Ramos", "Roof replacement", "started", 1) === "Sofia Ramos started Roof replacement" && progressSummary("Sofia Ramos", "Roof replacement", "continued", 3) === "Sofia Ramos is back on Roof replacement — day 3" && progressSummary("Sofia Ramos", "Roof replacement", "completed", 3) === "Sofia Ramos completed Roof replacement after 3 days" && progressSummary("Sofia Ramos", "Roof replacement", "completed", 1) === "Sofia Ramos completed Roof replacement");
check("the line under the status", onSiteLine({ day: 2, startedToday: true, daysSoFar: 2 }, "IN_PROGRESS") === "On site today · day 2" && onSiteLine({ day: 3, startedToday: false, daysSoFar: 2 }, "IN_PROGRESS") === "2 days on site so far" && onSiteLine({ day: 1, startedToday: false, daysSoFar: 0 }, "SCHEDULED") === null && onSiteLine({ day: 3, startedToday: true, daysSoFar: 3 }, "COMPLETED") === "Done after 3 days on site");
const link = "https://jobflex.app/dashboard/jobs/j1";
check("the texts to the office", /^Sofia started "Roof replacement"\. https/.test(jobStartedLine("Sofia", "Roof replacement", link)) && /is back on "Roof replacement" — day 3\./.test(jobBackLine("Sofia", "Roof replacement", 3, link)) && /marked "Roof replacement" complete after 3 days\. Photos: https/.test(jobCompletedLine("Sofia", "Roof replacement", 3, link)) && /marked "Roof replacement" complete\. Photos/.test(jobCompletedLine("Sofia", "Roof replacement", 1, link)));
check("the media text counts photos and videos", jobMediaLine("Sofia", "Roof replacement", 3, 1, link).startsWith('Sofia added 3 photos and 1 video of "Roof replacement". See them: ') && jobMediaLine("Sofia", "Roof", 1, 0, null) === 'Sofia added 1 photo of "Roof".');

// ── media rows
check("a video row is read off its JSON marker", mediaOf({ url: "https://x.public.blob.vercel-storage.com/jobs/j1/1-a.mp4", analysis: mediaMetaJson({ media: "video", contentType: "video/mp4", bytes: 12 }) }).media === "video");
check("a photo row (no marker) is a photo, even from an older vision analysis", mediaOf({ url: "data:image/jpeg;base64,abc", analysis: JSON.stringify({ labels: ["roof"] }) }).media === "photo" && mediaMetaJson({ media: "photo" }) === null);
check("a .mov URL without a marker still plays as a video", mediaOf({ url: "https://x.public.blob.vercel-storage.com/jobs/j1/clip.MOV" }).media === "video");
check("video types", isVideoType("video/quicktime") && isVideoType("video/mp4") && !isVideoType("image/jpeg") && !isVideoType(null));
check("the store-URL gate: only this job's folder in the public store", isJobBlobUrl("https://abc123.public.blob.vercel-storage.com/jobs/j1/1-a.jpg", "j1") && !isJobBlobUrl("https://abc123.public.blob.vercel-storage.com/jobs/j2/1-a.jpg", "j1") && !isJobBlobUrl("https://evil.com/jobs/j1/a.jpg", "j1") && !isJobBlobUrl("javascript:alert(1)", "j1"));
check("a blob path is under the job and safe", /^jobs\/j1\/\d+-my-roof-2.jpg$/.test(blobPathFor("j1", "../my roof 2.jpg", "photo.jpg")) && /^jobs\/j1\/\d+-photo\.jpg$/.test(blobPathFor("j1", "", "photo.jpg")));
check("file sizes read", fileSize(900) === "900 B" && fileSize(300 * 1024) === "300 KB" && fileSize(2.4 * 1024 * 1024) === "2.4 MB" && fileSize(48 * 1024 * 1024) === "48 MB");

// ── preferences
const seeded = defaultNotificationPrefs();
check("the crew events text the office by default", seeded.matrix["job-started"][2] === true && seeded.matrix["job-completed"][2] === true && seeded.matrix["job-photos"][2] === true);
check("an older stored matrix without the new keys seeds them on", parseNotificationPrefs(JSON.stringify({ matrix: { "lead-assigned": [true, true, false] } })).matrix["job-started"][2] === true);
check("STARTED and MEDIA rows map to their preference rows", prefKeyForEvent({ kind: "STARTED" }) === "job-started" && prefKeyForEvent({ kind: "MEDIA" }) === "job-photos" && prefKeyForEvent({ kind: "COMPLETED" }) === "job-completed");
check("every group key is a real event", SMS_GROUPS.every((g) => g.keys.every((k) => PREF_EVENTS.some((e) => e.key === k && e.smsAvailable))));
const off = defaultNotificationPrefs();
for (const k of SMS_GROUPS[0].keys) off.matrix[k] = [true, false, false];
const groups = smsGroupsOf(off);
check("a group reads off the cells: crew off, sales and money on", groups.crew === false && groups.sales === true && groups.money === true, JSON.stringify(groups));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
