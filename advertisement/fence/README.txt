JobFlex fence estimator — landing demo videos (recorded from the real app, 2026-10-19)

What it is: the real Fence studio (/dashboard/fence-estimator) on a local production build (next
build + next start, no dev overlay), signed in as qa@acme.test, walked at a person's pace and filmed
frame by frame. The pipeline, the plates and the end card are the HVAC demo's (advertisement/hvac:
record.js → film-demo.html → render-demo.js), one to one; every screen is the app itself, nothing
is cropped — the page scrolls instead.

Files (render-demo.js; two-pass so each lands under its cap; -an, +faststart, yuv420p, 30 fps):
  public/landing-e/fence-demo-16x9.mp4          1920x1080 H.264 High   43.87 s   4,643,268 B   cap 5 MB
  public/landing-e/fence-demo-16x9.webm         1920x1080 VP9          43.87 s   2,995,782 B   cap 3.5 MB
  public/landing-e/fence-demo-4x5.mp4           1080x1350 H.264 High   41.63 s   3,527,423 B   cap 4 MB
  public/landing-e/fence-demo-4x5.webm          1080x1350 VP9          41.63 s   2,711,985 B   cap 3 MB
  public/landing-e/fence-demo-poster-16x9.webp  1280x720, the 25.39 s frame (06, the price), q75, 59,810 B   cap 60 KB
  public/landing-e/fence-demo-poster-4x5.webp   900x1125, the 24.60 s frame (06, the price), q75, 49,882 B   cap 50 KB
  No audio stream in any of the four; in both MP4s moov comes right after ftyp (before mdat).
  out/fence-demo-<fmt>-master.mkv — the lossless renders (FFV1, RGB), gitignored.
  The posters are the price step (06): the total, good · better · best and the lines, caption up.
  A frame with the drawn fence was the first choice, but the satellite does not fit the caps (16:9:
  141 KB at q40 full size; under 60 KB only at 960 px and q40), so the price step it is, scaled to
  1280 / 900 px wide (render-demo.js poster(); POSTER_ONLY=1 redoes just the posters from out/).

The two shapes:
  16:9 — viewport 1920x1080 at deviceScaleFactor 1, the desktop layout; the sidebar is hidden by
         CSS in the Playwright context (aside.sb + the layout's grid), not in the project, so the
         studio takes the full width. A pointer (drawn by the film) moves and clicks; the real mouse
         travels with it frame by frame, so the map's rubber band and the "on the corner / lot line"
         snap labels follow it the way they follow a hand.
  4:5  — the real handheld layout: viewport 390x488 (4:5 of 1080x1350), isMobile + touch, an iPhone
         UA, deviceScaleFactor 1080/390 = 2.769 → 1080x1351 frames, the film shows the top 1350.
         The mobile shell (header with menu/+/bell), the studio's own ≤860 px layout (the map card,
         its Undo point / Finish run strip, then the ticket, the runs, the takeoff, the types and the
         settings down the page), the price book's rows that open in place and its full-screen sheet,
         the phone builder, the client's phone page. A finger mark (drawn by the film) shows each tap
         and each swipe.
         The same choice as the HVAC demo, over 390x844 in a frame: at 844 the phone would be shown
         at 1.6x and its 13 px text lands at ~8 px on a 390-px-wide feed; at 488 tall it is 2.77x.
         Drawing works at 488: scrolled so the map card sits at y 100–420, the whole lot, the
         contours legend and the Finish run strip are in view at once, and the dots land where the
         finger taps (the map is 356x320 CSS px there — the corners are 90–190 px apart).

The captions (film-demo.html; the figures are filled from the take's own facts — tape.json, read
off the page by record.js — so each film prints its own run: the two traces differ by a foot).
Each plate fades in over 0.35 s from its start and out over the last 0.18 s; a change of side dips
through 0.15 s; the end card cross-fades in over 0.5 s.
  16:9 — the HVAC demo's lower third (1080 x ~130, its shadow, its type sizes), set at x 300 instead
  of centred so it stays clear of the studio's rail (the ticket and the fence types, x 1450 on), the
  builder's Grand total / Save & send and the price book drawer's buttons; the page's working area is
  kept above y 900. It goes up (y 92, under the top bar) for 05, whose takeoff card runs to the page's
  foot.
   0.00– 7.31  01 · The lot          7.31–14.76  02 · The fence        14.76–18.96  03 · The gate
  18.96–22.34  04 · The fence type   22.34–25.07  05 · The takeoff (plate up top)
  25.07–27.95  06 · The price        27.95–33.71  07 · Your price book  33.71–40.86  08 · The client
  40.86–43.87  end card
  4:5 — the HVAC demo's plate as it is (full width, 232 px tall), at the bottom, up top while the
  bottom holds what is being used: the suggestion list and the map with its Undo/Finish strip and
  the Gate menu (01–03), the sheet's Save to company (07), the builder's Save & send (08).
   0.00– 6.18  01 (top)      6.18–12.00  02 (top)      12.00–15.31  03 (top)     15.31–19.30  04
  19.30–23.00  05           23.00–26.55  06            26.55–31.44  07 (up 29.63–30.66 for Save)
  31.44–38.63  08 (up 34.10–35.88 for Save & send)     38.63–41.63  end card
  The texts (16:9 figures; the 4:5 prints 228 ft, 710 pickets, $15,141 from its own trace):
   01 · The lot          Type the address. The lot comes back.
                         The satellite, the property lines from the parcel record and the ground's
                         contours from USGS lidar — 16 ft of fall across this lot.
   02 · The fence        Draw it along the property line
                         Click (4:5: Tap) the corners — the dots snap to the lot lines. 227 ft in 3
                         runs, each with its own length and slope.
   03 · The gate         Drop a gate on the line
                         Single, double, triple or arched. A 4 ft single gate on run 3, hung on black
                         steel posts.
   04 · The fence type   Pick the fence and its height
                         15 types in the book — wood, vinyl, composite, chain link, aluminum, steel,
                         rail. Here: board-on-board, 6 ft.
   05 · The takeoff      Every post, rail and bag of concrete
                         32 posts, 29 sections at 8' o.c., 83 bags of concrete, 707 pickets —
                         stepped down the slope on 10' posts.
   06 · The price        Every line priced
                         Fence, installation, the gate, the slope steps — $15,025, with good · better
                         · best from the same takeoff.
   07 · Your price book  Your rates, your price
                         Board-on-board from the catalog's $28 to your $26.40 a foot — every
                         estimate prices from your book.
   08 · The client       One click: a proposal they can sign
                         Every line, the total and the fence in 3D on her lot — sent to the
                         homeowner, with a PDF to keep.
   end card              JobFlex · Fence estimator — Draw it. Price it. Send it. — Start your free
                         trial — "Demo company and client. Property lines from the parcel record; the
                         fence as traced, not a survey." (the client's page says the same: "layout as
                         traced · not a survey")
  The HVAC formula's "The job" step has no fence counterpart (the studio asks no job type: it starts
  at the address), so the film opens on the lot; the end line keeps its rhythm with the fence verbs.

The walk (record.js, the same in both shapes; real pace — T runs with the wall clock while the page
is live; a scroll is stepped frame by frame; a page load and one wait are cut with a 0.3–0.45 s
dissolve):
  01  the empty studio → the address typed ("9903 117th Pl NE", 14 keys/s) → Google's suggestions →
      the Kirkland one → the satellite opens on the lot with its property lines and the 2-ft
      contours (USGS lidar 1 m: 16 ft of fall, falls toward E, avg grade 9%) — they land in 0.25 s;
      the wait for the Property sides list (12 s on the stand, see below) is cut → the map card up
  02  four clicks / taps along the lot lines: a point on the north line, the NW corner, the SW
      corner, a point on the south line; the last one a double-click (4:5: Finish run) → three runs
      81 ft · 19% · 18–20 steps, 71 ft · 16% · 15 steps, 75–76 ft · 5% · 10 steps; the ticket
      prices as the dots go down (16:9: $5,990 → $8,946 → $12,148)
  03  Gate ▾ → Single gate 4 ft ($395 on cedar privacy) → on run 3 near the house → the ticket adds the
      gate and its black steel posts
  04  Board-on-board in the type list (the rail on the desk; down the page on a phone) → the
      Height card, 6 ft lit (board-on-board comes in 6 and 8)
  05  the Material takeoff: 26 line, 2 corner, 2 end, 2 gate posts, 83 bags, 96 rails, 707 (710)
      pickets, 9 boxes of nails, 43 (45) 10' step posts, 32 caps, the gate kit, crew ≈ 89–91 hrs
  06  the ticket: $15,025 (4:5 $15,141), Good pressure-treated $11,477 · Better board-on-board ·
      Best board-on-board stained $18,436, every line, the notes, Convert to proposal
  07  (filmed first, so the estimate already prices from it) Fence inventory → Price book →
      Board-on-board's pencil (4:5: the row, then Edit) → Material 28 → 26.40 → Save to company →
      the row reads $26.40, COMPANY (4:5: DEFAULT) — "Saved to the company · Every fence estimate
      prices from it"
  08  Convert to proposal ("Preparing the picture…") → the builder (Fence proposal, 02 The client:
      Megan Ortiz) → Save & send → "Your proposal is on its way. PRO-xxxx was sent to
      megan.ortiz@example.com" → the client's own link (no contractor session): prepared for Megan
      Ortiz, Board-on-board fence · 227 LF, $16,001.72 with tax (4:5 $16,125.57), valid until
      Nov 2, 2026, the fence live in 3D, the plan on the lot, Accept proposal
  Nothing in the film is missing from the app; nothing was added to it.

Where the data comes from:
  • the stand: stand/rec-shoot.sh — a production build in its own dist dir (.next-fencerec-prod,
    stand/build.sh), next start on :3536 over its own copy of dev.db (.cache/fence-rec/rec.db,
    stand/make-db.py), qa@acme.test signed in (stand/login.cjs); every take starts from a fresh copy
    (the price book scene writes a rate, the take makes a proposal);
  • the dressing (make-db.py): QA Co named Cedar & Post Fence Co. ((425) 555-0162, 8215 160th Ave NE,
    Redmond), owner shown as Jordan Hale, Enterprise (manual), its test leads marked lost, its QA
    fence price-book override and custom type removed (the book starts from the catalog); one
    client, Megan Ortiz ((425) 555-0177, megan.ortiz@example.com — the fictional exchange and the
    reserved domain); the estimate is filed to her the way the estimator picker does (jf_file_to);
  • the house and the lot are real: 9903 117th Pl NE, Kirkland, WA 98033 (0.20 ac). The parcel came
    from the app's own parcel cache (ParcelCache in dev.db — a ReportAll lot fetched earlier), the
    satellite, the address suggestions and the geocode are live Google (the local browser key), the
    contours are live USGS 3DEP lidar (/api/fence/elevation). ReportAll is blanked on the stand (the
    local key is expired; a cached lot needs no call); Stripe, mail, SMS, Meta, PostHog are blanked;
  • mail: no transport on the stand — the server log says "[email] No transport configured (set
    RESEND_API_KEY or SMTP_*) — would send: Your proposal from Cedar & Post Fence Co. →
    megan.ortiz@example.com"; "was sent" is the app's own answer and nothing left the machine;
  • set dressing in the browser only (record.js CSS): the sidebar (16:9), the floating Help button,
    the "Files for <client>" chip, and the parcel line under Property sides — it prints the recorded
    owner's name, a real person, not for an advert (visibility hidden);
  • the runs, slopes, takeoff, prices, tiers, lines and totals are the engine's (lib/fence/pricing)
    from the catalog, Seattle / Bellevue rates and the shop's one book rate.

Found on the stand, not fixed (app/data notes):
  • The Property sides list waits for fetchPropertyBoundary, whose OpenStreetMap streets come from
    Overpass with a 12 s budget (lib/overpass OVERPASS_TOTAL_MS); on every take the mirrors did not
    answer in time, so the list appeared 12 s after the lot and the page said "Street data was
    unavailable, so no side was marked as frontage — uncheck the street side manually." The lot
    lines and contours were there in 0.25 s; the film cuts the wait.
  • The client's plan says "227 ft of fence · 1 run" for the same trace the studio lists as 3 runs
    (Runs 3; the takeoff counts 2 corners): one word for two things.
  • The price book marks a company rate "COMPANY" on the desk table and "DEFAULT" on the phone row
    for the same state.
  • After the shop sets its own board-on-board material rate the ticket still says "Rates calibrated
    to Seattle / Bellevue, WA: labor +26%, wood materials −10% vs national — until you set your own
    on the type's row." True for the labor (still the catalog's), no longer for the material.
  (Not a mismatch: the client's copy is $16,001.72 against the ticket's $15,025 — the builder adds
  the 6.5% tax.)

Frames: frames/16x9/tNN.jpg (960 px wide) and frames/4x5/tNN.jpg (540 px wide) — one frame of the
delivered MP4 at every whole second.

Re-recording and re-rendering (from the repo root; NODE_PATH must reach playwright-core, system
Chrome; FFMPEG=<path> if ffmpeg is not on PATH — this was ffmpeg-static 5.2.0 in
.cache/hvac-ad/tools, ffprobe-static beside it):
    bash advertisement/fence/stand/build.sh             # when the app changed (.next-fencerec-prod)
    bash advertisement/fence/stand/rec-shoot.sh 16x9    # → advertisement/fence/rec/16x9/ (frames + tape.json)
    bash advertisement/fence/stand/rec-shoot.sh 4x5
    node advertisement/fence/render-demo.js 16x9        # → out/ master, public/landing-e files, frames/16x9/
    node advertisement/fence/render-demo.js 4x5
    node advertisement/fence/preview-demo.js 16x9 "8,12,20"   # stills → frames/pv-16x9-*.png (gitignored)
  A take is about 1.5 minutes; a render (frames + two-pass H.264 + two-pass VP9) a few minutes.
  Each take spends one Google Places session + geocode, the free USGS lookups and one parcel-limit
  count (cached lot: no ReportAll call); the stand's rate-limit rows are cleared by make-db.py.
  The film is film-demo.html: every frame is a function of t (open it with ?fmt=16x9&t=12 —
  preview-demo.js and render-demo.js open it in Chrome with --allow-file-access-from-files).
  The map: the page builds its own Google map; record.js keeps a read-only handle on it (an init
  script subclasses the Map class the page imports) to turn the lot's corners into screen pixels.
