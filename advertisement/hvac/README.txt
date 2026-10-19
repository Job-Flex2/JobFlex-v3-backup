JobFlex HVAC estimator — demo videos

═══ 1 · The hvac2 landing's demo (40 s, delivered edit) ════════════════════════

Sources (as delivered, not re-cut — source/; the 4:5 one also goes to Meta Ads):
  source/jobflex-hvac-demo-40-16x9.mp4   1920x1080, 40 s, 30 fps, H.264 High, no audio, 6,053,035 B
  source/jobflex-hvac-demo-40-4x5.mp4    1080x1350, 40 s, 30 fps, H.264 High, no audio, 5,151,642 B
  The 16:9 carries the step captions on black plates at the lower left; the 4:5 carries the same
  captions as a header on the paper at the top. Same cut, same timing.

Web files (encode.sh; two-pass so each lands under its cap; -an, +faststart, yuv420p, 30 fps):
  public/landing-e/hvac-demo-16x9.mp4          1920x1080 H.264 High, 1000 kbit/s    cap 5 MB
  public/landing-e/hvac-demo-16x9.webm         1920x1080 VP9,         650 kbit/s    cap 3.5 MB
  public/landing-e/hvac-demo-4x5.mp4           1080x1350 H.264 High,  760 kbit/s    cap 4 MB
  public/landing-e/hvac-demo-4x5.webm          1080x1350 VP9,         560 kbit/s    cap 3 MB
  public/landing-e/hvac-demo-poster-16x9.webp  the 22 s frame, 1920x1080, WebP q55  cap 60 KB
  public/landing-e/hvac-demo-poster-4x5.webp   the 22 s frame, 1080x1350, WebP q75  cap 50 KB
  Both formats keep their full size: at 1440x810 / 864x1080 the captions came out softer than
  1080p at the same size (compared on the 20.5 s plate), so no downscale.

The captions, by second (plate changes found with ffmpeg's scene filter on the caption area,
checked frame by frame; the same in both formats):
   0.2– 2.3   intro   JOBFLEX · HVAC ESTIMATOR — A full system, start to finish
   2.3– 4.4   01      The job — Pick the job
   4.4– 9.6   02      The house — Type the address. The house comes back.
   9.6–14.9   03      The details — Type what you see on site
  14.9–18.4   04      The load — Manual J-based, on the county's design day
  18.4–23.4   05      The equipment — Sized by Manual S — real model numbers
  23.4–27.6   06      The price — Every line priced
  27.6–32.2   07      Your inventory — Your units, your costs
  32.2–37.3   08      The client — One click: a proposal they can sign (on the phone)
  37.6–40.0   final   JobFlex · HVAC estimator — Size it. Price it. Send it. + Start your free trial
                      (no plate; the end card, fully in by ~38 s)
  The first frame (0.0) has no plate; the intro plate fades in over 0.1–0.4 s. Plate 08 fades
  out over 37.3–37.6 s while the end card cross-fades in.

Frames: frames/16x9/tNN.jpg and frames/4x5/tNN.jpg — one frame at every whole second 0–39
(-ss N), scaled to 640 / 432 px wide.

Re-encoding (from the repo root; FFMPEG=<path> when ffmpeg is not on PATH):
    bash advertisement/hvac/encode.sh
  The frames:
    for s in $(seq 0 39); do t=$(printf %02d $s)
      ffmpeg -v error -y -ss $s -i advertisement/hvac/source/jobflex-hvac-demo-40-16x9.mp4 -frames:v 1 -vf scale=640:-2 -q:v 4 advertisement/hvac/frames/16x9/t$t.jpg
      ffmpeg -v error -y -ss $s -i advertisement/hvac/source/jobflex-hvac-demo-40-4x5.mp4  -frames:v 1 -vf scale=432:-2 -q:v 4 advertisement/hvac/frames/4x5/t$t.jpg
    done
  The caption changes:
    ffmpeg -i advertisement/hvac/source/jobflex-hvac-demo-40-16x9.mp4 -vf "crop=960:220:40:830,select='gt(scene,0.08)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
    ffmpeg -i advertisement/hvac/source/jobflex-hvac-demo-40-4x5.mp4  -vf "crop=1080:300:0:0,select='gt(scene,0.08)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*"

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
