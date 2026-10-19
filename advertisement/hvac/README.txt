JobFlex HVAC estimator — demo videos

═══ 1 · The hvac2 landing's demo (recorded from the real app, 2026-10-19) ══════

What it is: the real /dashboard/hvac-estimator on a local production build (next build +
next start, no dev overlay), signed in as qa@acme.test, walked at a person's pace and filmed
frame by frame. Same scenario and caption texts as the delivered 40 s edit (source/, kept as the
reference); every screen here is the app itself, nothing is cropped, the page scrolls instead.

Files (render-demo.js; two-pass so each lands under its cap; -an, +faststart, yuv420p, 30 fps):
  public/landing-e/hvac-demo-16x9.mp4          1920x1080 H.264 High   41.27 s   4,599,816 B   cap 5 MB
  public/landing-e/hvac-demo-16x9.webm         1920x1080 VP9          41.27 s   2,848,940 B   cap 3.5 MB
  public/landing-e/hvac-demo-4x5.mp4           1080x1350 H.264 High   39.87 s   3,565,096 B   cap 4 MB
  public/landing-e/hvac-demo-4x5.webm          1080x1350 VP9          39.87 s   2,429,454 B   cap 3 MB
  public/landing-e/hvac-demo-poster-16x9.webp  the 17.7 s frame (05, the unit picked), q60, 58,448 B   cap 60 KB
  public/landing-e/hvac-demo-poster-4x5.webp   the 15.7 s frame (05, the unit picked), q75, 45,732 B   cap 50 KB
  No audio stream in any of the four; in both MP4s moov comes right after ftyp (before mdat).
  Full size kept in both formats (the 1080p text reads; no 1440x810 / 864x1080 needed).
  out/hvac-demo-<fmt>-master.mkv — the lossless renders (FFV1, RGB), gitignored.

The two shapes:
  16:9 — viewport 1920x1080 at deviceScaleFactor 1, the desktop layout; the sidebar is hidden by
         CSS in the Playwright context (aside.sb + the layout's grid), not in the project, so the
         estimator takes the full width. A pointer (drawn by the film) moves and clicks.
  4:5  — the real handheld layout: viewport 390x488 (4:5 of 1080x1350), isMobile + touch, an iPhone
         UA, deviceScaleFactor 1080/390 = 2.769 → 1080x1351 frames, the film shows the top 1350.
         The mobile shell (header with menu/+/bell), the sticky step rail and the estimate's
         sticky summary bar, the inline row + sheet of the inventory, the phone builder, the
         client's phone page. A finger mark (drawn by the film) shows each tap and each swipe.
         Chosen over 390x844-in-a-frame: at 844 the phone would be shown at 1.6x and its 13 px text
         lands at ~8 px on a 390-px-wide feed; at 488 tall it is 2.77x, the page's own size on a phone.
  The landing's hvac2 demo-media.ts already points at these six names (READY); its label says
  "in 40 seconds".

The captions (film-demo.html; texts from the delivered edit, figures this house's as the page
printed them), by second — each plate fades in over 0.35 s from its start and out over the last
0.18 s; the end card cross-fades in over 0.5 s:
  16:9 (centred lower third, x 420–1500, y 916–1048; the page's working area is kept above it)
   0.00– 2.17  01 · The job        Pick the job
   2.17– 8.85  02 · The house      Type the address. The house comes back.
   8.85–12.72  03 · The details    The house, from the record
  12.72–16.11  04 · The load       Manual J-based, on the county's design day
  16.11–19.04  05 · The equipment  Sized by Manual S — real model numbers
  19.04–24.60  06 · The price      Every line priced
  24.60–32.02  07 · Your inventory Your units, your costs
  32.02–38.27  08 · The client     One click: a proposal they can sign
  38.27–41.27  end card            JobFlex · HVAC estimator — Size it. Price it. Send it. — Start your free trial
  4:5 (full width; over the estimate's summary bar at the bottom, moved to the top while the bottom
  holds what is being used: the suggestion list 1.84–7.77, the inventory row/sheet 24.87–29.56,
  Save & send and its answer 33.53–35.23)
   0.00– 1.84  01   ·   1.84– 7.77  02   ·   7.77–12.03  03   ·  12.03–14.77  04
  14.77–18.31  05   ·  18.31–22.97  06   ·  22.97–30.55  07   ·  30.55–36.86  08
  36.86–39.87  end card
  The sub-lines:
   01  Full system, outdoor unit, furnace, heat pump, ductless or a service call — each asks only what it needs.
   02  One lookup: the county record, the footprint, the elevation and the design day. No record? Enter it by hand.
   03  2,380 sq ft, 2 storeys, built 1997, King County's 84° / 26° design day — type over anything you see on site.
   04  27,000 BTU/h cooling · 39,000 heating at 84° / 26° — not a guess by the square foot.
   05  The unit covers 111% of the cooling load (Manual S 90–115%). Good or better — pick one.
   06  Equipment, materials, labor, permit, disposal — every line yours to edit.
   07  626 units in the price book. Type what you pay — every estimate prices from your book.
   08  Every line and the total — sent to the homeowner, on her phone, with a PDF to keep.
  (The delivered edit's 03 "Type what you see on site" is about typing windows in; this cut shows
  the looked-up details instead, so its line is the house's record. Its 05 said "good, better,
  best": this house gets two tiers. Its 08 said "the deposit": this proposal has one full payment.)

The walk (record.js, the same in both shapes; real pace — T runs with the wall clock while the
page is live; a scroll is stepped frame by frame; a page load is cut with a 0.3–0.45 s dissolve):
  01  the empty estimator, Full system preselected → Continue
  02  the address typed ("12629 NE 100th Pl, Kirk", 14 keys/s) → Google's suggestions → the house
      → Look up the house (≈0.6 s live on the stand; past 2.5 s the wait would be cut) → the page
      moves on by itself
  03  back to The house on the rail: the four sources found (King County Assessor parcel, footprint
      2,066 sq ft at the pin, USGS 3DEP 279 ft, King County 84° / 26°) and the figures
  04  The design on the rail: cooling 27,000 BTU/h, heating 39,000, 2.5 ton, 1,010 CFM
  05  System (Air conditioner $12,106 · Heat pump $12,478), Good Carrier 26SCA530W003 $10,507 ·
      Better Trane 5TTR6030A1000A $12,106 (picked), the unit card, cooling fit 111% (Manual S 90–115%)
  06  The estimate: every line, down to the subtotal $12,105.83
  07  HVAC inventory (626 units): the line set row of the rate card's materials → its cost $9 → 8.40
      → Save to company (filmed first, so the estimate's line set already prices from it:
      25 ft × $10.50 = $262.50)
  08  Convert to proposal → the builder (02 The client: Jenna Brooks) → Save & send → "PRO-xxxx was
      sent to jenna.brooks@example.com" → the client's own link (no contractor session): prepared
      for Jenna Brooks, $12,892.71 with tax, valid until Nov 2, 2026, Accept proposal
  Not in the film: no step was missing from the app. Two things are kept out on purpose:
  • the unit's own shop cost — saving a US-catalog unit from the inventory drawer drops its tier
    and family (itemJson keeps only the form's fields), and the estimate's Good · Better · Best and
    pick change (seen on the stand: the pick became York YC6-030); so the scene edits a material;
  • the "Files for <client>" chip — hidden by context CSS: on the desktop it sits under the caption,
    on a 488-px phone it floats mid-screen (84 px over the bottom). The floating Help button too.

Where the data comes from:
  • the stand: stand/rec-shoot.sh — a production build in its own dist dir (.next-hvacrec-prod,
    stand/build.sh), next start on :3492 over its own copy of dev.db (.cache/hvac-rec/rec.db,
    stand/make-db.py + stand/rec-dress.py), qa@acme.test signed in (stand/login.cjs); every take
    starts from a fresh copy (the inventory scene writes a cost);
  • the dressing: QA Co named Ridgeline Heating & Air, owner Alex Morgan, Enterprise (manual), its
    test leads marked lost, its placeholder "Starter" catalog rows removed; one client, Jenna Brooks
    at the filmed house ((425) 555-0193, jenna.brooks@example.com — the fictional exchange and the
    reserved domain); the estimate is filed to her the way the estimator picker does (jf_file_to);
  • the house is real (12629 NE 100th Pl, Kirkland, WA 98033); the lookup ran live on the stand
    with the local keys (Google geocoder/Places, King County Assessor, OSM/Regrid footprints,
    USGS 3DEP, the design-day table). The landing fixtures (landing-e/hvac-estimator-demo) were not
    needed and are not recordings: their 4418 NE 97th St does not exist. ReportAll is blanked (the
    local key is expired); Stripe, mail, SMS, Meta, PostHog are blanked — so "was sent" is the app's
    own answer, and no mail left the machine;
  • the load, the units, the prices, the lines and the totals are the engine's and the ledger's.

Frames: frames/16x9/tNN.jpg (960 px wide) and frames/4x5/tNN.jpg (540 px wide) — one frame of the
delivered MP4 at every whole second (16:9 0–41, 4:5 0–39).
The 4:5 frames are captured at device pixels (a CDP clip at scale 2.769 from the visual viewport:
a plain capture comes back in CSS px and would be upscaled).

Re-recording and re-rendering (from the repo root; NODE_PATH must reach playwright-core, system
Chrome; FFMPEG=<path> if ffmpeg is not on PATH — this was ffmpeg-static 5.2.0, ffmpeg 6.0):
    DIST=.next-hvacrec-prod STAND=.cache/hvac-rec bash advertisement/hvac/stand/build.sh   # when the app changed
    bash advertisement/hvac/stand/rec-shoot.sh 16x9      # → advertisement/hvac/rec/16x9/ (frames + tape.json)
    bash advertisement/hvac/stand/rec-shoot.sh 4x5
    node advertisement/hvac/render-demo.js 16x9          # → out/ master, public/landing-e files, frames/16x9/
    node advertisement/hvac/render-demo.js 4x5
    node advertisement/hvac/preview-demo.js 16x9 "3,9,17"   # stills → frames/pv-16x9-*.png (gitignored)
  A take is about 2 minutes; a render (frames + two-pass H.264 + two-pass VP9) about 2.5 minutes.
  Each take spends one Google Places session + geocode and the free county/OSM/USGS lookups
  (QA Co's 30 lookups an hour).
  The film is film-demo.html: every frame is a function of t (open it with ?fmt=16x9&t=17 —
  preview-demo.js and render-demo.js open it in Chrome with --allow-file-access-from-files).

The delivered 40 s edit this replaces on the landing (reference only now):
  source/jobflex-hvac-demo-40-16x9.mp4, source/jobflex-hvac-demo-40-4x5.mp4 — its scenario and
  plate texts were the brief; its windows are cropped. (encode.sh, which re-encoded it to the
  public names, is gone: it would overwrite these files.)

═══ 2 · The ?industry=hvac hero film (45 s, rendered here from the real app) ═══

Files (all 45 s, 30 fps, no audio track — the landing plays them muted):
  public/landing-e/hvac-demo-169.mp4    1920x1080 H.264, two-pass, under 6 MB
  public/landing-e/hvac-demo-169.webm   1920x1080 VP9, two-pass, under 4 MB
  public/landing-e/hvac-demo-916.mp4    1080x1920 H.264, two-pass, under 6 MB
  public/landing-e/hvac-demo-poster.webp the 16:9 frame at 24 s (the results: Good · Better · Best on the design)

Scenes (same timing in both formats; captions on screen, no voice, no music):
   0.0–8.0  01 ENTER THE ADDRESS
            0.4–2.1 the address is typed; 2.3 the suggestion list; 3.1 the house is picked;
            4.0 Look up the house; 4.3 the lookup has answered (it took 0.6–0.8 s on the stand);
            4.75–7.6 the four sources light up one by one, each with a card: parcel record
            (area · storeys · year built, King County Assessor), footprint (at the pin),
            elevation (USGS 3DEP), the county's design day (84° / 26°)
   8.0–18.0 02 REVIEW THE INPUTS
            8.6–11.8 the three plate photos are read (3–4 s on the stand); 12.0–13.7 the reads,
            one card each (outdoor unit, furnace, panel); 13.8–15.4 the Confirm section: area,
            attic insulation, tightness, each marked read / default / stated;
            15.4–16.0 the contractor's one correction: Windows double pane → double, low-E;
            16.05–18 the field turns "stated" and the price re-figures ($12,125 → $9,466)
  18.0–30.0 03 CHECK THE RESULTS
            18–21.3 the block load on the design day (cooling and heating BTU/h);
            21.0 Heat pump is picked; 21.5–24.6 the size and Good · Better · Best with prices;
            24.6–26.3 the heat pump's capacity chart against the heating load, balance point;
            26.3–30 a state rule opened: Washington's Manual J / Manual S check with its source
            (2021 WSEC-R R403.7)
  30.0–42.0 04 CREATE THE PROPOSAL
            30–33 the lines; 33–35.2 the subtotal, 34.5 Convert to proposal;
            35.2–37.4 the drafted HVAC proposal in the builder; 37.4–42 the client's copy on the
            desk, then on the phone, Accept proposal pulsing
  42.0–45.0 end card: JobFlex — Size it from the load. Quote it today. — jobflex.app

Where every frame comes from:
  • Each screen is a screenshot of the real app (assets/*.png, 1440x1300 CSS px at 2x; the client's
    copy at 1280x900 and 390x844) taken by capture.js on a local build of JobFlex. Nothing on the
    screens is drawn over except the cursor, the highlight boxes, the cards and the captions.
  • The house is a real address: 12629 NE 100th Pl, Kirkland, WA 98033. The lookup ran live on the
    stand — Google geocoder/Places, the King County Assessor's open data, the building footprints
    (OpenStreetMap / Regrid), USGS 3DEP elevation, the ENERGY STAR design-day table. The stand runs
    without the local ReportAll key (it is expired, 401): with it the page prints that 401 as a note.
  • The three nameplate photos are the landing demo's drawn example plates (plates.ts renders them
    to assets/plate-*.png; each is stamped EXAMPLE). The real nameplate reader read them on the stand
    (OpenAI vision, OPENAI_API_KEY from .env.local) — the reads in the film are its answers.
  • The load, the size, the units, the prices, the checks, the lines and the totals are the engine's
    and the ledger's, computed on the stand from the shop's catalog and the default rate card.
  • The card texts are not typed into the film: capture.js reads them off the page into
    assets/facts.json and assets/film-data.js, and film-hvac.html prints those.
  • The shop is QA Co (qa@acme.test, the agents' test account) in the stand's own copy of dev.db,
    dressed for the film: named "Ridgeline Heating & Air", owner "Alex Morgan", Enterprise plan
    (manual), its test leads marked lost, its placeholder "Starter" catalog rows removed so the
    estimate runs on the real-brand US list. The dressing script is stand/make-db.py
    (the copy itself stays in .cache/hvac-ad, gitignored).
  • Not claimed: no duct diagram; state rules exist for CA, WA, OR, FL, TX and NY only (the caption
    says so); the load is "Manual J-based", estimating grade, as the page itself says.

Re-rendering (from this folder; NODE_PATH must reach a node_modules with playwright-core, Chrome
installed; FFMPEG=<path> if ffmpeg is not on PATH — the shoot used ffmpeg-static 5.2.0):
    node render.js 169     # → the 16:9 MP4, the WebM and the poster in public/landing-e/
    node render.js 916     # → the 9:16 MP4
    node preview.js "1,4.6,7,11,16.8,19.5,23,25.5,28,34.5,40,43.5"     # stills → frames/pv-*.png
    PHONE=1 node preview.js …   # also each 9:16 still at 390 px wide (frames/pv-916-*-390.png)
  The film is film-hvac.html: every frame is a function of t (open it with ?w=1080&h=1920&t=24 to
  look at one frame). Each render takes about a minute of frames and several minutes of
  two-pass encoding (VP9 is the slow one).

Re-shooting the screens (only when the app changed):
  1. A production build in its own dist dir:  bash advertisement/hvac/stand/build.sh   (JOBFLEX_DIST_DIR=.next-hvacad-prod)
  2. bash advertisement/hvac/stand/shoot.sh — stops :3488, makes .cache/hvac-ad/hvac-ad.db from prisma/dev.db
     (make-db.py), starts next start on :3488 over it (serve.cjs), signs qa@acme.test in (login.cjs,
     password QA_PASS_OWNER from .env.local), runs capture.js.
  capture.js walks the estimator exactly as a contractor would: job (Full system) → type the
  address → pick it from the suggestions → Look up the house → Plate photos (three uploads) →
  Windows → Double, low-E → Continue to the design → Heat pump → open the passed checks and the
  Washington rule → Continue to the estimate → Convert to proposal → the portal on desk and phone.
  Each run spends one Google geocode/Places session, the free county/OSM/USGS lookups and three
  nameplate reads on the OpenAI key.
