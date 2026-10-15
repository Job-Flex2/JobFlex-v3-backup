# scripts/qa → qa/

The QA scripts that lived here moved on 2026-10-14 into the QA Lab (`qa/`, see `qa/README.md`):

- the checks and page passes → `qa/tests/<suite>/` (the table: `qa/config/legacy.yaml`, `qa/MIGRATION.md`);
- the shared helpers (`_qa.js`, `_world.js`, `_prod-server.ts`, `_actionHarness.ts`, …) → `qa/tests/_lib/`;
- duplicates and dead scripts → `qa/tests/_archive/`; utilities without assertions → `qa/tools/legacy/`.

The files left here are forwarders, so `scripts/billing/*` and local harnesses that still
`require("scripts/qa/_qa")` keep working. New checks go to `qa/tests/<suite>/`; run everything with `npm run qa`.
