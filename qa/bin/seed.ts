// npm run qa:seed — QA Co back to its known state, by hand (bin/qa.ts does it before every local run).
// Only the local database, only QA Co (lib/seed.ts says what is removed and what is put back).
import { disconnect } from "../lib/db";
import { resetQaCo, seedLine } from "../lib/seed";

resetQaCo()
  .then((r) => { console.log(seedLine(r)); return disconnect(); })
  .catch(async (e) => { console.error(`QA seed FAILED: ${(e as Error).message}`); await disconnect(); process.exit(1); });
