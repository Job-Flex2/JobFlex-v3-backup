JobFlex roof estimator — demo videos for the landing (recorded from the real app, 2026-10-19)

What it is: the real /dashboard/roof-estimator on a local production build (next build + next start,
no dev overlay), signed in as qa@acme.test, walked at a person's pace and filmed frame by frame —
the same camera, film and render as the HVAC demo (advertisement/hvac/: record.js → film-demo.html →
render-demo.js; its camera class is copied here unchanged, the plates and end card are the same
design). Every screen is the app itself; nothing is cropped, the page scrolls instead.

Files (render-demo.js; two-pass so each lands under its cap; -an, +faststart, yuv420p, 30 fps):
  public/landing-e/roof-demo-16x9.mp4          1920x1080 H.264 High   41.70 s   4,419,400 B   cap 5 MB
  public/landing-e/roof-demo-16x9.webm         1920x1080 VP9          41.70 s   2,958,039 B   cap 3.5 MB
  public/landing-e/roof-demo-4x5.mp4           1080x1350 H.264 High   42.60 s   3,509,753 B   cap 4 MB
  public/landing-e/roof-demo-4x5.webm          1080x1350 VP9          42.60 s   2,646,121 B   cap 3 MB
  public/landing-e/roof-demo-poster-16x9.webp  the 15.64 s frame (04, the brands and their $ a square), q35, 58,074 B   cap 60 KB
  public/landing-e/roof-demo-poster-4x5.webp   the 18.97 s frame (04, GAF top pick $132 + $200 /sq), q30, 48,158 B   cap 50 KB
  No audio stream in any of the four; in both MP4s moov comes right after ftyp (before mdat).
  out/roof-demo-<fmt>-master.mkv — the lossless renders (FFV1, RGB), gitignored.

The two shapes (as the HVAC demo):
  16:9 — viewport 1920x1080 at deviceScaleFactor 1, the desktop layout; the sidebar is hidden by CSS
         in the Playwright context (aside.sb + the layout's grid), not in the project. A pointer
         (drawn by the film) moves and clicks.
  4:5  — the real handheld layout: viewport 390x488 (4:5 of 1080x1350), isMobile + touch, an iPhone
         UA, deviceScaleFactor 1080/390 = 2.769; the mobile shell (header with menu/+/bell), the
         estimate's sticky total bar, the price book's in-place row + sheet, the phone builder, the
         client's phone page. A finger mark shows each tap and each swipe. Same choice as HVAC and
         for the same reason: at 390x844 shown in a 4:5 frame the 13 px text would land at ~8 px on a
         feed; at 488 tall the page is at its own size on a phone. Every step reads at this height.
  Hidden in both by context CSS: the floating Help button and the "Files for <client>" chip (on a
  488-px phone it floats mid-screen over the page; the builder shows the client anyway).

The scenario — the estimator's own steps (it has no job picker: it starts at the address).
Formula kept: Measure it. Price it. Send it.
  01 · The house        Type the address. The pin lands on the roof.
       Google's suggestions fill in the city, state and ZIP — and the satellite shows the house before
       anything is measured.
  02 · The measurement  One click: the roof, measured
       2,840 sq ft · 28.4 squares · 5/12 pitch · 6 facets — from aerial roof data, not a tape on a ladder.
  03 · The roof         What's up there
       Eaves 10 ft up, shingle, 13 years old, condition poor, one chimney — read with the measurement.
  04 · The system       Pick the roof. Brands ranked for your state.
       Asphalt, metal, tile, shake, slate, synthetic or flat — GAF, Owens Corning, CertainTeed, IKO: top
       picks for Washington.
  05 · The takeoff      Every part of the roof counted
       Underlayment, ice & water, edges, flashing, vents balanced for the attic, tear-off — each row
       opens to change.
  06 · The price        Every line priced
       26 lines — materials and labor — $18,143. Every quantity and rate yours to edit.
  07 · Your price book  Your prices, your book
       62 roof types and materials. Type your price a square — every estimate prices from your book.
  08 · The client       One click: a proposal they can sign
       Every line and the total, $19,322.41 with tax — sent to the homeowner to accept online, with a
       PDF to keep.
  end card              JobFlex · Roof estimator — Measure it. Price it. Send it. — Start your free trial
       fine print: Demo company and client. Roof figures from aerial roof data; edge lengths estimated
       from the outline. Brand names belong to their owners.
  The figures in 06/07/08 are read off the page by record.js (tape.json facts) and put into the plates
  by film-demo.html, so a re-take with other prices cannot leave stale numbers; 02/03 are the stored
  measurement's own values (the page printed the same in every take).

Timing, by second (each plate fades in over 0.35 s from its start and out over the last 0.18 s; a
change of place dips for 0.3 s; the end card cross-fades in over 0.5 s):
  16:9   01 0.00–6.05 · 02 6.05–11.86 · 03 11.86–14.56 · 04 14.56–17.61 · 05 17.61–20.04
         06 20.04–26.37 · 07 26.37–32.43 · 08 32.43–38.70 · end card 38.70–41.70
         Place: centred lower third (x 420–1500, y 916–1048; the page's working area is kept above
         y 900); at the top 20.04–26.37 (Review lines, then the total and its Convert at the foot of the
         page) and 32.43–33.94 (Convert to proposal); at the left (x 60–1140) 26.78–31.41 while the price
         book's drawer is open at the right edge.
  4:5    01 0.00–6.29 · 02 6.29–12.84 · 03 12.84–16.07 · 04 16.07–19.63 · 05 19.63–22.96
         06 22.96–28.38 · 07 28.38–33.33 · 08 33.33–39.61 · end card 39.61–42.61
         Place: full width over the sticky total bar at the bottom; at the top while the bottom holds
         what is used: the address and its suggestions 0.42–4.07, Review lines / the lines / the total
         22.96–28.38, the price-book row and its sheet 28.78–32.34, Convert 33.33–34.55, Save & send and
         its answer 36.31–38.09 (on the sheet the top plate covers the sheet's title — the same choice as
         the HVAC 4:5 inventory scene; its fields and buttons are all in view).

The walk (record.js, the same in both shapes; real pace — T runs with the wall clock while the page
is live; a scroll is stepped frame by frame; a page load is cut with a 0.3–0.45 s dissolve):
  01  the empty estimator → "9903 117th Pl NE" typed (14 keys/s) → Places' suggestions (the same number
      and street exist in Marysville and Arlington; the Kirkland one is picked) → city/state/ZIP fill
      in, the pin preview's satellite loads live → the page scrolls so Measure this roof is clear
  02  Measure this roof → "Measuring the roof…" for the real 3.0–3.2 s → the eight tiles (2,840 sq ft,
      28.4 squares, 5/12, 6 facets, eaves + rakes 238 ft, ridge + hips 66 ft, valleys 21 ft); the app's
      toast says "reused the already-paid measurement — nothing new was billed"
  03  Details beside the map: eave height 10 ft each side, shingle, condition poor, 13 years, chimney
      yes, no solar, no rooftop AC
  04  Build an estimate → Roof package: roof type (asphalt picked), Architectural shingle · 30-yr, 12%
      waste, "Top picks for architectural shingle in Washington": GAF Timberline HDZ (top pick)
      $132 + $200 /sq, Owens Corning $137, CertainTeed $132, IKO $128
  05  the takeoff rows: underlayment, edges (ESTIMATED: eave 131, rake 107, ridge 66 ft), flashing
      (1 valley, 3 pipe boots, 1 chimney), vents (BALANCED), tear-off & extras, commercial job, custom lines
  06  Review 26 lines → the page builds the lines and moves to them → scrolled down to Estimate total
      $18,143 (materials $7,786, labor $10,357)
  07  Roofing inventory → Price book (62 items, built-in "Catalog") → Architectural shingle · 30-yr →
      material $125 → 132 → Save to company ("Saved to the company · Every roof estimate lists it"; the
      book now "Yours", 1 company default). Filmed first, so the estimate in 04–06 already prices
      from it ($132 a square).
  08  Convert to proposal → the builder (02 The client: Mark Ellison, filed the way the estimator picker
      files it) → Save & send → "Your proposal is on its way. PRO-xxxx was sent to
      mark.ellison@example.com" → the client's own link (no contractor session): the roof's figures,
      Your full name, Accept proposal, then the estimate detail; grand total $19,322.41 (6.5% tax).

Where the data comes from:
  • the house is real: 9903 117th Pl NE, Kirkland, WA 98033 (a single-family house in Eastside King
    County; not the HVAC film's 12629 NE 100th Pl).
  • the measurement: the estimator's provider is EagleView Property Data by default (the code's default
    since 2026-10-07). A NEW lookup is a billed EagleView order, and no order was bought for this film.
    The account already owns this house's answer — request aa5f7a47-63c2-4224-8e49-b2243072220f, all
    seven packs, bought 2026-08-27 under another of the account's organisations (Acme). stand/make-db.py copies that ledger row into QA Co's ledger in the stand's own database
    copy, so the click goes the app's real reuse path (actions/roofMeasurement obtainInstant → stored
    order) — the app itself says "reused the already-paid measurement — nothing new was billed". The
    figures (area, squares, pitch, facets, eave heights, material, condition, age, chimney, footprint)
    are EagleView's; edge lengths are the app's estimate from the outline and the gable shape (it labels
    them ESTIMATED). A guard (stand/ev-guard.cjs) sits between the stand and EagleView's Property Data
    host: reads pass, POST /property/v2/request (a new, billed order) is refused — it refused nothing
    in any take ("orders refused by the guard this take: 0").
  • live on the stand with the local keys: Google Places + geocoder (the suggestions, the city/ZIP),
    the Maps JavaScript satellite (pin preview and the Map view), EagleView token + image fetches (not
    billed; see the bug below), the stored parcel/lot cache.
  • the shop: QA Co (qa@acme.test) in the stand's copy of dev.db, dressed as "Alder Peak Roofing"
    (made-up), Kirkland, WA (town only), (425) 555-0136, owner "Dana Fischer", Enterprise (manual); its
    test leads marked lost, its earlier roof rows removed, and its roof book reset to the built-in book
    (the agents' test book held script-injection probe rows and a "QA solar tile").
  • the homeowner: Mark Ellison, (425) 555-0172, mark.ellison@example.com — the fictional 555 exchange
    and the reserved example.com domain.
  • the takeoff, the brands, the prices, the lines and the totals are the app's, computed on the stand.
  • mail: the stand blanks RESEND_API_KEY and SMTP_* (stand/serve.cjs); the server log of every take
    shows "[email] No transport configured … — would send: Your proposal from Alder Peak Roofing →
    mark.ellison@example.com". Nothing left the machine. Stripe, SMS, Meta, PostHog blanked too.

Not in the film, on purpose:
  • the roof picture on the client's page: it shows the app's stand-in ("The aerial picture could
    not be loaded just now", see the bug below), so the client's page enters scrolled to the roof's
    figures line, the name field and Accept proposal;
  • the "Aerial ortho" view in the estimator (the same expired images) — the Map view is shown;
  • Re-measure (new paid lookup) — billed.

App bugs found on the way (reported, not fixed):
  1. The client's roof picture fails for a reused EagleView order older than EagleView's image age
     limit: GET /property/v2/image/{token} answers 410 {"errorCode":10638,"errorDescription":"Image is
     older than the maximum allowed age"}; lib/roofPictures roofFrameFor() picks the ortho whenever the
     answer has imagery and the credentials are set, with no fall-back to the Google satellite tile, so
     the client gets the stand-in. Any repeat customer whose order is a few weeks old hits it. The
     server log also shows "parcel mask unavailable: eagleview property image failed (410)" on every
     measure of this house.
  2. On that stand-in the pin is drawn over the "could not be loaded" line (the pin sits at the
     centre, the text at y 440–480 of 1000).
  3. The same saved price-book row is badged COMPANY on the desktop and DEFAULT on the phone.
  4. (data, not code) QA Co's roof book in prisma/dev.db holds the agents' test rows:
     '<img src=x onerror="window.__qaXss=1">…' (twice, $1/$1) and "QA solar tile" — they render as
     text (escaped), but any screenshot of QA Co's book shows them.
  5. (known from the HVAC film) the "Files for <client>" chip floats mid-screen on a 488-px-tall phone.

Frames: frames/16x9/tNN.jpg (960 px wide, 0–41) and frames/4x5/tNN.jpg (540 px wide, 0–42) — one
frame of the delivered MP4 at every whole second.

Re-recording and re-rendering (from the repo root; NODE_PATH must reach playwright-core, system
Chrome; FFMPEG=<path> if ffmpeg is not on PATH — this was ffmpeg-static 5.2.0 from
.cache/hvac-ad/tools; with MSYS_NO_PATHCONV=1 paths must be C:/… style):
    bash advertisement/roof/stand/build.sh               # own prod build, .next-roofrec-prod (when the app changed)
    bash advertisement/roof/stand/rec-shoot.sh 16x9      # → advertisement/roof/rec/16x9/ (frames + tape.json)
    bash advertisement/roof/stand/rec-shoot.sh 4x5
    node advertisement/roof/render-demo.js 16x9          # → out/ master, public/landing-e files, frames/16x9/
    node advertisement/roof/render-demo.js 4x5
    node advertisement/roof/preview-demo.js 16x9 "3,9,17"   # stills → frames/pv-16x9-*.png (gitignored)
  rec-shoot.sh stops :3511 and the guard on :3512, makes a fresh .cache/roof-rec/rec.db from
  prisma/dev.db (stand/make-db.py — every take writes a measurement, a book price and a proposal),
  starts next start + the guard (stand/serve.cjs), signs qa@acme.test in (stand/login.cjs, password
  QA_PASS_OWNER from .env.local), runs record.js and prints how many orders the guard refused.
  A take is about 2 minutes; a render about 3. Each take spends one Places session + geocode on the
  Google key and no EagleView order.
  The poster is the 04 step: POSTER_AT=<seconds after the 04 mark> (defaults 1.08 for 16:9, 2.9 for
  4:5 — check that no pointer/finger covers a price after a re-take).
  The film is film-demo.html: every frame is a function of t (open it with ?fmt=16x9&t=17 —
  preview-demo.js and render-demo.js open it in Chrome with --allow-file-access-from-files).
