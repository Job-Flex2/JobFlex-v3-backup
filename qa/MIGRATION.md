# Перенос scripts/qa → qa/ (2026-10-14)

Источник — `qa/config/legacy.yaml` (по нему же работает `qa/tests/legacy.spec.ts`). Общие помощники (`_qa.js`, `_world.js`, `_actionHarness.ts`, `_server-only.ts`, `_prod-server.ts`, `_crewWorld.ts`, `_mobile-probe.js`, `_stubs/`, `fixtures/`, `run-all.js`, README) → `qa/tests/_lib/`; в `scripts/qa/` оставлены переходники.

| Файл | Куда | Статус | Почему / заметка |
|---|---|---|---|
| qa-guard.check.js | qa/tests/smoke/ | live | the old harness's own safety net (local DB, QA identity, forbidden controls) |
| signup-dropoff.check.ts | qa/tests/signup/ | live | живой — все импорты, маршруты и селекторы есть в src |
| signup-watch.check.ts | qa/tests/signup/ | live | живой — все импорты, маршруты и селекторы есть в src |
| signup-flow.check.ts | qa/tests/signup/ | live | landing → register → plan → Checkout hand-off, every industry; own build on :3312 |
| signup-otp.check.ts | qa/tests/signup/ | live | passwordless sign-up, code squares, the return gate; own build on :3313 |
| admin-subscription.check.ts | qa/tests/billing/ | live | fails while dev.db stripe:mode=test (its Stripe mock has no products.create) — known, 2026-10-06 |
| editions.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| free-plan.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-commission.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-dispute.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-limits.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-mail.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-payout-run.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-payout.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-promo-mode.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-transfer-reversal.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-upgrade.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| lapse-reason.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| lead-purchase.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| paid-caps.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plan-change.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plan-spotlight.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| platform-admin-limits.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| refund-isolation.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| trial-board.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| trial-caps.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| trial-once-referral.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| trial-projection.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| trial-watch.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| usage-reset.check.ts | qa/tests/billing/ | live | живой — все импорты, маршруты и селекторы есть в src |
| roles.check.ts | qa/tests/roles/ | live | role × server action (the browser matrix is qa/tests/roles/access.spec.ts) |
| tenant-isolation.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| everyday-work.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| media-storage.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-brakes.check.ts | qa/tests/roles/ | live | shares qa-ses-partner@jobflex.test with -principal / -reset / -sessions: run one at a time (the legacy runner does) |
| influencer-invite.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-principal.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-reset.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| influencer-sessions.check.ts | qa/tests/roles/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ann-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-tiers-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fin-test.js | qa/tests/pages/ | live | reads receipt.png (a 1×1 fixture) from its own folder |
| messages-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| phone-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ref-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| reports-test.js | qa/tests/pages/ | live | "sheet recomputes on switch" fails in the first month of a quarter (Quarter = quarter-to-date) — not a regression |
| reviews-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| roof-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| sub-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| trade-test.js | qa/tests/pages/ | live | живой — все импорты, маршруты и селекторы есть в src |
| seed-phone.js | qa/tests/pages/ | live | seed for phone-test |
| seed-roof.js | qa/tests/pages/ | live | seed for roof-test |
| mobile-sweep.check.ts | qa/tests/visual/ | live | WebKit phone sweep; compares against QA_DEV_URL (the runner passes the dev server) |
| plan-terms.check.ts | qa/tests/visual/ | live | живой — все импорты, маршруты и селекторы есть в src |
| sidebar-motion.check.ts | qa/tests/visual/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fixpass-smoke.js | qa/tests/visual/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-zfight.check.ts | qa/tests/visual/ | live | geometry-level: no coplanar faces (3D flicker) |
| admin-mail.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| admin-tasks.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ai-desk-forwarding.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ai-desk-minutes.check.ts | qa/tests/logic/ | live | its cleanup (slug qa-aidesk*) also removes ai-desk-route's orgs — never run the two at once |
| ai-desk-overview.check.ts | qa/tests/logic/ | live | added upstream 2026-10-14 while the move was in progress |
| ai-desk-presets.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ai-desk-profile.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ai-desk-route.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ai-desk-step4.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| ai-desk-step5.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| changeOrders.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| crew-days.check.ts | qa/tests/logic/ | live | could text through Twilio if its keys were set — the runner blanks them |
| crew-onsite.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| crm-brief.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-autofix.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-brands-regional.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-client-design.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-client-flow.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-custom.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-engine.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-field-parts.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-fuzz.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-house.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-m3.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-material-list.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-permit.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-photo-fit.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-proposal-edit.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-roof-engineering.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-roof-supports.check.ts | qa/tests/logic/ | live | passes placement "freestanding", no longer a Placement value (attached|beside|detached) — its free-standing cases run as an attached deck |
| deck-roof.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-samples.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-stairs-3d.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-state-codes.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-store-prices.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-studio-smart.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-wall-highlight.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-wall-pull.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| deck-wall-shaping.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| equipment-booking.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| estimate-brief.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-3d-ground.check.ts | qa/tests/logic/ | live | failing since before 2026-10-06 (fence engine d2578453) |
| fence-build.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-convert-lines.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-house.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-package.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-scene.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| fence-terrain-check.ts | qa/tests/logic/ | live | failing since before 2026-10-06 (valley case) |
| fence-topo.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| gmail-fallback.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| gmail-tokens.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| home-portal.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-assessors.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-catalog-view.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-catalog.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-coolcalc.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-directory.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-engine.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-fieldspecs.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-fixes.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-intake.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-jobs.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-ledger.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-parcel.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-regrid.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-review.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-service-menu.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| hvac-site.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| intake-questions.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| integration-links.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| inventory-page.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| inventory-presets.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| inventory-stock-defaults.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| inventory-trade.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| inventory.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| investor-gate.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| investor-model.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| job-money.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| landing-ad-screen.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| lead-reroute-test.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| lead-scope.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| likeForLike.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| lowSlope.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| models.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| office-screen.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| overpass-fallback.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| parcels-geom-test.mjs | qa/tests/logic/ | live | was not in run-all; added |
| paymentSchedule.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| permits.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plans-ask.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plans-eagle.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plans-eagle.fixture.ts | qa/tests/logic/ | live | fixture of the plans-* checks |
| plans-pricing.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plans-read-order.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plans-specialties.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| plans-takeoff.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| portal-accept-final.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| pricing.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| procedures.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| proposal-money.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| proposal-pictures.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| remodel-method.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| roof-proposal-edit.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| roof-review.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| roofReview.check.ts | qa/tests/logic/ | live | not a duplicate of roof-review: a different review, different fixes |
| service-plans.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| sms.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| solar-houses.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| specialty-detect.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| step-prices.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| support-reply.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| traffic-analyst.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| traffic-live.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| traffic-stale.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| video-estimator.check.ts | qa/tests/logic/ | live | added upstream 2026-10-14 while the move was in progress |
| worker-expenses.check.ts | qa/tests/logic/ | live | живой — все импорты, маршруты и селекторы есть в src |
| elevation3dep.live.ts | qa/tests/logic/ | manual | real USGS calls (free, network) — by hand |
| hvac-assessors.live.ts | qa/tests/logic/ | manual | real county GIS calls (network) — by hand |
| reviews-chips.js | qa/tests/_archive/ | dup | покрыт reviews-test.js; its 5★ / 1★ / All chip assertions are reviews-test.js's (lines 72–84) |
| trade-tail.js | qa/tests/_archive/ | dup | покрыт trade-test.js; closed post: badge, no Close, reply hidden, delete — trade-test.js lines 77–106 |
| fence-remove-check.js | qa/tests/_archive/ | dup | покрыт fence-test.js; "removing a run puts the total back" is fence-test.js's; this copy hard-codes $7,200/$4,800 |
| roof-builder-shot.js | qa/tests/_archive/ | dead | #manSquares / #manPitch / #manualBtn exist nowhere in src; the roof page no longer reads ?builder= (rebuilt data-only 2026-10-01) |
| package.json | qa/tests/_archive/ | dead | scripts/qa's own playwright install; replaced by qa/package.json |
| shot.js | qa/tools/legacy/ | tool | signs in and screenshots any routes |
| debug.js | qa/tools/legacy/ | tool | prints the beige skin's CSS state on /dashboard/beige |
| fence-debug.js | qa/tools/legacy/ | tool | утилита без проверок |
| fence-probe.js | qa/tools/legacy/ | tool | "Find" on an uncached address spends one of QA Co's 30 property lookups an hour |
| roof-debug.js | qa/tools/legacy/ | tool | утилита без проверок |
| pitch-audit.ts | qa/tools/legacy/ | tool | reads c:/Projects/JobFlex-roofcore (this machine only); prints JSON, asserts nothing — was in run-all as a check that passes unless it throws |
| trade-detect-check.ts | qa/tools/legacy/ | tool | real (paid) OpenAI calls; prints, asserts nothing |

Итого: 188 файлов. smoke/live: 1 · signup/live: 4 · billing/live: 25 · roles/live: 9 · pages/live: 14 · visual/live: 5 · logic/live: 116 · logic/manual: 2 · _archive/dup: 3 · _archive/dead: 2 · tools/tool: 7
