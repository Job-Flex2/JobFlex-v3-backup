// A COMPANY'S OWN TEXTING NUMBER — the words and the rules, pure (2026-10-02).
//
// Twilio verifies a toll-free number for ONE business: the business the
// person being texted knows (errors 30474, 30478). So a contractor's texts to
// its own clients and crew go out from a number JobFlex buys on its own
// Twilio account (JobFlex pays) and registers with the contractor's business
// details. The server half is registration.ts; the settings card and the QA
// check read this file, so it imports nothing that touches the server.

export type SmsBusinessType = "PRIVATE_PROFIT" | "SOLE_PROPRIETOR" | "NON_PROFIT";

/** What Twilio asks about the business, as the contractor types it. */
export type SmsRegistrationDetails = {
  /** As registered with the IRS / the state: "Ridgeline Roofing LLC". */
  legalName: string;
  /** The name clients know, when it differs: "Ridgeline Roofing". */
  dba: string;
  businessType: SmsBusinessType;
  /** "12-3456789". A sole proprietor without one leaves it empty. */
  ein: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  contactFirst: string;
  contactLast: string;
  contactEmail: string;
  contactPhone: string;
  /** A public Facebook, Instagram, Google Business or Yelp page — extra proof for a business with no website (optional). */
  social: string;
  /** Show the contact email on the company's booking page — Twilio takes a Gmail or Yahoo address only when the
   *  business's website lists it (30482), and with no website of its own the booking page IS the website. */
  showEmail: boolean;
};

export type SmsRegistrationStage = "none" | "pending" | "approved" | "rejected" | "failed";

/** One company's registration, as kept in SyncState `smsreg:<orgId>`. */
export type SmsRegistrationState = {
  stage: SmsRegistrationStage;
  /** The toll-free number bought for the company (E.164); kept across a resubmission. */
  number?: string | null;
  numberSid?: string | null;
  verificationSid?: string | null;
  submittedAt?: string | null;
  checkedAt?: string | null;
  approvedAt?: string | null;
  reasons?: { code: number | null; reason: string }[];
  /** A rejected submission can be corrected until then (Twilio's edit window). */
  editUntil?: string | null;
  editAllowed?: boolean;
  /** Our own step that failed (buying the number, sending the form), in words. */
  error?: string | null;
  details?: SmsRegistrationDetails | null;
};

export const BUSINESS_TYPES: readonly { value: SmsBusinessType; label: string }[] = [
  { value: "PRIVATE_PROFIT", label: "LLC or corporation" },
  { value: "SOLE_PROPRIETOR", label: "Sole proprietor" },
  { value: "NON_PROFIT", label: "Non-profit" },
];

export const EMPTY_DETAILS: SmsRegistrationDetails = {
  legalName: "", dba: "", businessType: "PRIVATE_PROFIT", ein: "", street: "", street2: "", city: "", state: "", zip: "",
  website: "", contactFirst: "", contactLast: "", contactEmail: "", contactPhone: "", social: "", showEmail: false,
};

const STAGES: readonly SmsRegistrationStage[] = ["none", "pending", "approved", "rejected", "failed"];

/** The stored JSON back as a state; anything unreadable is "none". */
export function parseRegistration(json: string | null | undefined): SmsRegistrationState {
  if (!json) return { stage: "none" };
  try {
    const raw = JSON.parse(json) as Partial<SmsRegistrationState>;
    const stage = STAGES.includes(raw.stage as SmsRegistrationStage) ? (raw.stage as SmsRegistrationStage) : "none";
    // Details saved before `social` / `showEmail` existed read as their empty values.
    return { ...raw, stage, ...(raw.details ? { details: { ...EMPTY_DETAILS, ...raw.details } } : {}) };
  } catch {
    return { stage: "none" };
  }
}

/** Twilio's verification status → ours. */
export function stageFor(status: string | null | undefined): SmsRegistrationStage {
  if (status === "TWILIO_APPROVED") return "approved";
  if (status === "TWILIO_REJECTED") return "rejected";
  if (status === "PENDING_REVIEW" || status === "IN_REVIEW") return "pending";
  return "failed";
}

/** Mailboxes Twilio will not take as a business's own (error 30482) unless the website lists them. */
export function isFreeMailbox(email: string): boolean {
  return /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|gmx|zoho)\.[a-z.]+$/i.test(email.trim());
}

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

/** Ten US digits, or null. */
export function usDigits(phone: string): string | null {
  const d = phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  return /^[2-9]\d{9}$/.test(d) ? d : null;
}

/** Field → what is wrong with it; an empty object means the form can go. */
export function registrationProblems(d: SmsRegistrationDetails): Partial<Record<keyof SmsRegistrationDetails, string>> {
  const p: Partial<Record<keyof SmsRegistrationDetails, string>> = {};
  const t = (s: string) => s.replace(/\s+/g, " ").trim();
  if (t(d.legalName).length < 2) p.legalName = "The business's legal name, as registered.";
  if (!BUSINESS_TYPES.some((b) => b.value === d.businessType)) p.businessType = "Pick the kind of business.";
  const ein = d.ein.replace(/\D/g, "");
  if (d.businessType !== "SOLE_PROPRIETOR" && ein.length !== 9) p.ein = "The nine-digit EIN, like 12-3456789.";
  if (d.businessType === "SOLE_PROPRIETOR" && ein && ein.length !== 9) p.ein = "Nine digits, or leave it empty.";
  if (t(d.street).length < 3) p.street = "The street address.";
  if (t(d.city).length < 2) p.city = "The city.";
  if (!US_STATES.has(t(d.state).toUpperCase())) p.state = "The two-letter state, like WA.";
  if (!/^\d{5}(-\d{4})?$/.test(t(d.zip))) p.zip = "The five-digit ZIP.";
  if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(t(d.website))) p.website = "The website, starting with https://.";
  if (t(d.contactFirst).length < 1) p.contactFirst = "Who Twilio can contact.";
  if (t(d.contactLast).length < 1) p.contactLast = "Their last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t(d.contactEmail))) p.contactEmail = "A working email address.";
  if (!usDigits(d.contactPhone)) p.contactPhone = "A US phone number.";
  if (t(d.social ?? "") && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(t(d.social))) p.social = "The page's address, starting with https://.";
  return p;
}

/** The details trimmed, the EIN as 12-3456789, the state upper-cased. */
export function tidyDetails(d: SmsRegistrationDetails): SmsRegistrationDetails {
  const t = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();
  const ein = (d.ein ?? "").replace(/\D/g, "");
  return {
    legalName: t(d.legalName).slice(0, 120),
    dba: t(d.dba).slice(0, 120),
    businessType: d.businessType,
    ein: ein.length === 9 ? `${ein.slice(0, 2)}-${ein.slice(2)}` : "",
    street: t(d.street).slice(0, 120),
    street2: t(d.street2).slice(0, 60),
    city: t(d.city).slice(0, 60),
    state: t(d.state).toUpperCase().slice(0, 2),
    zip: t(d.zip).slice(0, 10),
    website: t(d.website).slice(0, 200),
    contactFirst: t(d.contactFirst).slice(0, 60),
    contactLast: t(d.contactLast).slice(0, 60),
    contactEmail: t(d.contactEmail).toLowerCase().slice(0, 120),
    contactPhone: t(d.contactPhone).slice(0, 30),
    social: t(d.social ?? "").slice(0, 200),
    showEmail: Boolean(d.showEmail),
  };
}

/** Twilio caps the free-text fields at 500 characters. */
export const TWILIO_TEXT_MAX = 500;
const cap = (s: string) => (s.length <= TWILIO_TEXT_MAX ? s : `${s.slice(0, TWILIO_TEXT_MAX - 1).trimEnd()}…`);

/** The opt-in picture the first registrations showed (a demo company's booking page) — kept for the old URL only. */
export const BOOKING_OPT_IN_IMAGE = "https://www.jobflex.app/twilio/opt-in-booking.png";

// WHAT TWILIO CHECKS, AND WHERE IT FINDS IT (2026-10-12). A toll-free review looks at the END business, not JobFlex:
// its opt-in in its own name (30506), a public terms page with the SMS disclosures (30493 — required since
// 2026-09-15), a public privacy policy that keeps opt-in data from third parties (30519, 30477, 30521), a live website
// that shows the business (30473, 30492), a HELP reply (30531). Each company gets those pages from JobFlex, under its
// own booking page, in its own name — so a registration goes in complete the first time.
const SITE = "https://www.jobflex.app";
/** The company's public pages Twilio is given. */
export function smsPagesFor(slug: string): { booking: string; terms: string; privacy: string; optInImage: string } {
  const base = `${SITE}/book/${encodeURIComponent(slug)}`;
  return { booking: base, terms: `${base}/texting`, privacy: `${base}/privacy`, optInImage: `${base}/opt-in.png` };
}

/** The booking page's texting checkbox, word for word — the live page and the picture Twilio sees both use it. */
export function bookingConsentText(company: string): { lead: string; rest: string } {
  return {
    // "Ridgeline Roofing Co." already ends the sentence.
    lead: `Text me about my visit and estimate from ${company}${/[.!?]$/.test(company.trim()) ? "" : "."}`,
    rest: "Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Agreeing is not a condition of booking.",
  };
}

/** The job titles a company's sample texts use, by its first trade — a fence company's samples talk about fences. */
export function sampleJobsFor(trades: readonly string[]): { visit: string; job: string } {
  const by: Record<string, { visit: string; job: string }> = {
    Roofing: { visit: "Roof inspection", job: "Roof replacement" },
    Fencing: { visit: "Fence estimate", job: "Fence installation" },
    Decking: { visit: "Deck estimate", job: "Deck build" },
    HVAC: { visit: "AC check-up", job: "Heat pump installation" },
    Plumbing: { visit: "Plumbing visit", job: "Water heater replacement" },
    Electrical: { visit: "Electrical visit", job: "Panel upgrade" },
    Painting: { visit: "Painting estimate", job: "Exterior painting" },
    Siding: { visit: "Siding estimate", job: "Siding replacement" },
    Windows: { visit: "Window estimate", job: "Window replacement" },
    Flooring: { visit: "Flooring estimate", job: "Floor installation" },
    Tile: { visit: "Tile estimate", job: "Tile installation" },
    Countertops: { visit: "Countertop measure", job: "Countertop installation" },
    "Kitchen & Bath": { visit: "Remodel estimate", job: "Bathroom remodel" },
    Landscaping: { visit: "Yard estimate", job: "Landscape install" },
    Concrete: { visit: "Concrete estimate", job: "Driveway pour" },
    Drywall: { visit: "Drywall estimate", job: "Drywall repair" },
    Insulation: { visit: "Insulation check", job: "Attic insulation" },
    Carpentry: { visit: "Carpentry estimate", job: "Trim carpentry" },
    Demolition: { visit: "Demolition estimate", job: "Interior demolition" },
  };
  for (const t of trades) if (by[t]) return by[t];
  return { visit: "Estimate visit", job: "Home repair" };
}

/**
 * Everything Twilio's toll-free verification asks, for one contractor, in the
 * Twilio library's names. `samples` are the company's own texts, made by the
 * templates themselves (registration.ts builds them).
 */
export function verificationFields(input: { details: SmsRegistrationDetails; companyName: string; samples: string[]; bookingUrl: string; slug: string; helpText: string }) {
  const d = input.details;
  const name = (d.dba || input.companyName || d.legalName).slice(0, 60);
  const ein = d.ein.replace(/\D/g, "");
  const pages = smsPagesFor(input.slug);
  return {
    businessName: d.legalName,
    ...(d.dba && d.dba !== d.legalName ? { doingBusinessAs: d.dba } : {}),
    businessWebsite: d.website,
    notificationEmail: "support@jobflex.app",
    useCaseCategories: ["ACCOUNT_NOTIFICATIONS", "CUSTOMER_CARE"],
    useCaseSummary: cap(
      `${name} is a home-improvement contractor. It texts its own clients and crew through JobFlex, its business software, from this number, which is used by ${name} only. A client who books a visit on its JobFlex booking page and ticks "Text me about my visit and estimate" gets the visit details, a reminder the evening before and the proposal they asked for; crew members get their job schedule. No marketing.`,
    ),
    productionMessageSample: cap(input.samples.filter(Boolean).join("\n")),
    // The company's own booking form, in its name (30506), checkbox shown unticked (30475/30505).
    optInImageUrls: [pages.optInImage],
    optInType: "WEB_FORM" as const,
    messageVolume: "1,000",
    businessStreetAddress: d.street,
    ...(d.street2 ? { businessStreetAddress2: d.street2 } : {}),
    businessCity: d.city,
    businessStateProvinceRegion: d.state,
    businessPostalCode: d.zip,
    businessCountry: "US",
    businessType: d.businessType,
    ...(ein.length === 9 ? { businessRegistrationNumber: `${ein.slice(0, 2)}-${ein.slice(2)}`, businessRegistrationAuthority: "EIN" as const, businessRegistrationCountry: "US" } : {}),
    businessContactFirstName: d.contactFirst,
    businessContactLastName: d.contactLast,
    businessContactEmail: d.contactEmail,
    businessContactPhone: `+1${usDigits(d.contactPhone) ?? ""}`,
    additionalInformation: cap(
      `Submitted by JobFlex (ISV) for its customer ${d.legalName}; this number serves this one business only. Opt-in: on its booking page (${input.bookingUrl}) the client ticks "Text me about my visit and estimate from ${name}", with frequency, rates and STOP/HELP (image: the same form). Crew give their own mobile for job schedules.${d.showEmail ? ` Its contact email is listed on that page.` : ""}${d.social ? ` Also online: ${d.social}` : ""}`,
    ),
    // Its own public pages: SMS terms (30493) and privacy policy (30519), and the HELP reply it sends (30531).
    termsAndConditionsUrl: pages.terms,
    privacyPolicyUrl: pages.privacy,
    helpMessageSample: cap(input.helpText),
    ageGatedContent: false,
  };
}

/** The settings card's words for each stage. */
export const REGISTRATION_COPY = {
  title: "Your texting number",
  sub: "A number of your own, registered with the carriers in your business's name — JobFlex prepares it, files it and pays for it. Every text to your team, your clients and your crew goes out from it.",
  // What JobFlex does so the contractor doesn't have to (owner, 2026-10-13: "say JobFlex will prepare your number … to give us more value").
  // Each line is something the code really does: registration.ts buys + files, book/[slug] pages, sampleJobsFor, the approval check.
  doneTitle: "JobFlex sets it up for you",
  done: [
    "Gets a toll-free number in your company's name — JobFlex pays for it",
    "Prepares your carrier registration and sends it to Twilio for you",
    "Makes your texting terms and privacy pages, and the “Text me” checkbox on your booking page",
    "Writes your sample texts for your trade",
    "Watches for the approval and turns your texts on by itself",
  ],
  doneYou: "You fill in one short form — what JobFlex already knows is filled in for you.",
  get: "Get your texting number",
  paidOnly: "Your own texting number comes with a paid plan.",
  notConfigured: "Texting is not set up on this platform yet.",
  formIntro: "Twilio checks every line against public records. Write the legal name, EIN and address exactly as on your IRS EIN letter (CP 575) or your state registration — the suite too (\"Ste L\" is not \"Suite I\").",
  website: "Your own website is best. Without one, use your JobFlex booking page — it shows your name and phone.",
  bookingOff: "Turn on online booking first (Settings → Online booking). Your booking page is where clients agree to your texts, and Twilio looks at it.",
  whatTwilioSees: "Twilio also gets, in your name: your booking page with the texting checkbox, your texting terms and privacy pages, and three sample texts.",
  freeMail: "Twilio refuses free mailboxes (Gmail, Yahoo…) unless your website lists the address — tick “Show this email on my booking page” below, or use an address on your own domain.",
  showEmail: "Show this email on my booking page",
  showEmailWhy: "Twilio accepts a Gmail or Yahoo address only when your website lists it. Without a website of your own, your booking page is your website.",
  social: "No website? Add your Facebook, Instagram, Google Business or Yelp page — an active one helps Twilio see your business is real.",
  submit: "Register my number",
  resubmit: "Fix and send again",
  pending: "JobFlex sent your registration to Twilio and is watching for the answer — usually within 3 business days. Texts start by themselves once it's approved; until then your team gets the same alerts by email and in the app.",
  approved: "Approved. Texts to your team, clients and crew go out from this number, with your name.",
  rejected: "Twilio sent it back. Fix what it asks below and send it again.",
  rejectedClosed: "Twilio sent it back and the time to correct it has passed. Release the number and start again.",
  failed: "Something went wrong on the way to Twilio.",
  check: "Check now",
  release: "Release this number",
  consent: "Clients get texts only after they tick “Text me about my visit and estimate” when they book online.",
  legacy: "This number was bought before registration existed, so carriers will not deliver its texts to clients. Release it, then get your registered number.",
} as const;

/** The form's first values: what JobFlex already knows about the company and the person filling it in. */
export function prefillDetails(
  company: { name: string; website: string | null; address: string | null; phone: string | null; slug: string },
  person: { name: string | null; email: string | null },
): SmsRegistrationDetails {
  const parts = (company.address ?? "").split(/,|\n/).map((x) => x.trim()).filter(Boolean);
  // "13620 NE 20th St, Suite I, Bellevue, WA 98005" → street, street2, city, state, zip
  const tail = parts.length ? parts[parts.length - 1] : "";
  const stZip = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(tail);
  const city = stZip && parts.length >= 3 ? parts[parts.length - 2] : "";
  const streets = stZip ? parts.slice(0, Math.max(0, parts.length - (city ? 2 : 1))) : parts.slice(0, 1);
  const [first, ...rest] = (person.name ?? "").trim().split(/\s+/);
  return {
    ...EMPTY_DETAILS,
    legalName: company.name,
    dba: company.name,
    // No website of its own: the booking page — its name, its phone, and the texting checkbox Twilio looks for.
    website: company.website?.trim() || smsPagesFor(company.slug).booking,
    street: streets[0] ?? "",
    street2: streets.slice(1).join(", "),
    city,
    state: stZip ? stZip[1].toUpperCase() : "",
    zip: stZip ? stZip[2] : "",
    contactFirst: first ?? "",
    contactLast: rest.join(" "),
    contactEmail: person.email ?? "",
    contactPhone: company.phone ?? "",
    // No website of its own and a free mailbox: the booking page lists the email, or Twilio refuses it (30482).
    showEmail: !company.website?.trim() && isFreeMailbox(person.email ?? ""),
  };
}

/** What the settings card shows: the state in words, never the Twilio ids. */
export type SmsRegistrationView = {
  stage: SmsRegistrationStage;
  /** The company's number, pretty, once bought. */
  number: string | null;
  reasons: string[];
  editUntil: string | null;
  /** Rejected, and Twilio still takes a correction. */
  canEdit: boolean;
  error: string | null;
  /** A paid plan: the only companies that can get a number. */
  paying: boolean;
  /** A number bought before registration existed (the old instant button): release it first. */
  legacy: boolean;
  /** Online booking is on — the page where clients agree to texts; a registration waits for it. */
  bookingOn: boolean;
  /** The company's public pages Twilio is given (smsPagesFor). */
  pages: { booking: string; terms: string; privacy: string; optInImage: string };
  details: SmsRegistrationDetails;
};
