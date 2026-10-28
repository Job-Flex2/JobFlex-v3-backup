// Wisetack financing (lib/financing/prefill, 2026-10-28): the application arrives filled in with what JobFlex
// already knows about the business — never an empty string where nothing is known — and the office can switch the
// financing texts on or off like every other event.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-prefill.check.ts
import { merchantPrefill, parseAddress, readinessFacts } from "../../../src/lib/financing/prefill";
import { EMPTY_ORG_FINANCING } from "../../../src/lib/financing/state";
import { PREF_EVENTS } from "../../../src/lib/notificationPrefsShared";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const org = {
  id: "org_1",
  name: "Summit Ridge Roofing",
  phone: "+15551230000",
  website: "summitridge.example",
  address: "12 Main St, Provo, UT 84601",
  billingEmail: "office@summitridge.example",
  tradeTypesJson: '["roofing","gutters"]',
};
const owner = { name: "Jordan Lake", email: "jordan@summitridge.example" };
const rec = { ...EMPTY_ORG_FINANCING, yearStarted: 2015 };
const p = merchantPrefill(org, owner, rec, "https://www.jobflex.app/dashboard/settings?pane=payments&sub=financing");

check("the business: name, phone, billing email, the org id as the reference", p.businessName === "Summit Ridge Roofing" && p.phone === "+15551230000" && p.email === "office@summitridge.example" && p.reference === "org_1", JSON.stringify(p));
check("a bare website gets https://", p.website === "https://summitridge.example");
check("the address in parts", JSON.stringify(p.address) === JSON.stringify({ line1: "12 Main St", city: "Provo", state: "UT", zip: "84601" }), JSON.stringify(p.address));
check("the first trade, the owner, the year, the way back", p.trade === "roofing" && p.ownerName === "Jordan Lake" && p.ownerEmail === "jordan@summitridge.example" && p.yearStarted === 2015 && p.returnUrl.endsWith("sub=financing"));
const thin = merchantPrefill({ id: "org_2", name: "Ace", phone: null, website: "  ", address: null, billingEmail: null, tradeTypesJson: null }, null, EMPTY_ORG_FINANCING, "u");
check("nothing known → null, never an empty string", thin.phone === null && thin.website === null && thin.email === null && thin.trade === null && thin.ownerName === null && thin.address.line1 === null && thin.yearStarted === null, JSON.stringify(thin));
check("no billing email → the owner's", merchantPrefill({ ...org, billingEmail: null }, owner, rec, "u").email === "jordan@summitridge.example");
check("an address without a state and zip keeps the whole line", JSON.stringify(parseAddress("Unit 4, the old mill")) === JSON.stringify({ line1: "Unit 4, the old mill", city: null, state: null, zip: null }));
check("a full address with a zip+4", parseAddress("400 Oak Ave, Salt Lake City, UT 84101-1234").zip === "84101-1234");
check("junk trades JSON → no trade", merchantPrefill({ ...org, tradeTypesJson: "{x" }, owner, rec, "u").trade === null);
const f = readinessFacts(org, owner, rec);
check("the readiness facts from the same record", f.name === org.name && f.email === "office@summitridge.example" && f.website === "https://summitridge.example" && f.trade === "roofing" && f.yearStarted === 2015 && f.address === org.address);

const fin = PREF_EVENTS.filter((e) => e.key === "financing");
check("one 'Financing' event the office can text", fin.length === 1 && fin[0].smsAvailable && !fin[0].emailAvailable && fin[0].audience?.office === true, JSON.stringify(fin));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
