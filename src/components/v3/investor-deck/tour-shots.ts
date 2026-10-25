// THE PLATFORM TOUR'S SCREENS (owner, 2026-10-25: "a slideshow of the platform — the tools, how it looks, deck, fence,
// roofing, CRM, calendar, schedule, dashboard, financials, the home portal"). Real JobFlex screens, filmed on test
// copies of the app for the ads (advertisement/*/source/assets/cap) and on the QA stand: every company, person, address
// and phone number on them is made up. Images in public/investors/tour, 1600 wide (desk) or 640 (phone).
// The words say what the screen shows and what the product does today — nothing it does not.

export type TourChapter = "win" | "estimate" | "sell" | "run" | "company";

export const TOUR_CHAPTERS: Array<{ key: TourChapter; label: string; line: string }> = [
  { key: "win", label: "Win the work", line: "Homeowners ask, the AI desk answers, the lead arrives." },
  { key: "estimate", label: "Estimate", line: "Priced from the office — an address, a map, a sentence, a plan set." },
  { key: "sell", label: "Sell", line: "A link the client reads, signs and changes — on a phone." },
  { key: "run", label: "Run the work", line: "The calendar, the crews and every day on site." },
  { key: "company", label: "Run the company", line: "The owner's view: money, team, reputation." },
];

export interface TourShot {
  slug: string;
  chapter: TourChapter;
  title: string;
  text: string;
  kind: "desk" | "phone";
  w: number;
  h: number;
  /** Where a desk screen is cropped from when it is taller than the frame (CSS object-position). */
  focus?: string;
}

export const TOUR_SHOTS: TourShot[] = [
  { slug: "homeowner-portal", chapter: "win", kind: "desk", w: 1600, h: 1000, title: "The homeowner portal", text: "A homeowner describes the project in their own words — typed, spoken or with photos — and JobFlex turns it into a scope a contractor can price. Free for homeowners, no account." },
  { slug: "lead-offer", chapter: "win", kind: "desk", w: 1600, h: 1111, title: "A lead, offered to a local pro", text: "The scoped request lands in the contractor's Leads, ready to accept or pass — homeowner demand on one side, contractors on the other." },
  { slug: "ai-desk", chapter: "win", kind: "desk", w: 1600, h: 1111, title: "The AI desk", text: "An AI receptionist answers every call with the company's name, asks what the trade needs to know and books the visit. Set up in four steps; it answers around the clock." },
  { slug: "ai-desk-booked", chapter: "win", kind: "desk", w: 1600, h: 1111, title: "Booked while the crew was on a roof", text: "The visit the AI desk booked by phone is on the calendar, on the right person's row, with the caller's notes." },

  { slug: "roof-estimator", chapter: "estimate", kind: "desk", w: 1600, h: 1444, title: "Roof estimator", text: "From an address: area, squares, pitch, facets, eaves and ridges, measured from the air." },
  { slug: "roof-build", chapter: "estimate", kind: "desk", w: 1600, h: 1444, title: "The roof, priced", text: "Roof type, system and waste on the company's own rates — and a total the office can send the same hour." },
  { slug: "fence-studio", chapter: "estimate", kind: "desk", w: 1600, h: 1278, title: "Fence Studio", text: "Draw the fence on the satellite map — gates, sides of the lot, the house — and get Good, Better and Best prices at once." },
  { slug: "fence-3d", chapter: "estimate", kind: "desk", w: 1600, h: 1889, focus: "center 62%", title: "The fence in 3D, on the lot's own slope", text: "The ground comes from public elevation data and the fence steps down the slope — the picture the homeowner sees before saying yes." },
  { slug: "hvac-design", chapter: "estimate", kind: "desk", w: 1600, h: 1000, title: "HVAC estimator", text: "A Manual J-style heating and cooling load, the unit sized to it, three equipment options and the checks an inspector will ask about." },
  { slug: "deck-studio", chapter: "estimate", kind: "desk", w: 1600, h: 1111, title: "Deck Studio", text: "Design the deck in 3D, choose Good, Better or Best, and the railing and lumber follow the rules of the job's state." },
  { slug: "deck-roof-3d", chapter: "estimate", kind: "desk", w: 1600, h: 1111, title: "Built before it is built", text: "Covered decks, hip roofs, stairs and railings, framed piece by piece in 3D — with a permit set drawn from the same design." },
  { slug: "deck-lumber-list", chapter: "estimate", kind: "desk", w: 1600, h: 1111, title: "The list for the lumber yard", text: "Every board, post and bolt by length, ready for a quote request." },
  { slug: "smart-proposal", chapter: "estimate", kind: "desk", w: 1600, h: 1000, title: "Smart Proposal", text: "Describe the job in a sentence — or with photos — and get priced lines: materials, labor and the scope, ready to send." },
  { slug: "blueprint", chapter: "estimate", kind: "desk", w: 1600, h: 1111, title: "Blueprint estimator", text: "Upload the plans, ask for the job, and get it measured and priced from the sheets, page by page." },

  { slug: "proposals", chapter: "sell", kind: "desk", w: 1600, h: 1111, title: "Proposals", text: "Every proposal with its status and views, Send in one tap, and the payment schedule on the same row." },
  { slug: "client-proposal", chapter: "sell", kind: "desk", w: 1600, h: 1444, title: "The client's proposal", text: "A link, not an attachment: the roof seen from the air, the price, and accept by typing a name." },
  { slug: "client-phone", chapter: "sell", kind: "phone", w: 640, h: 1385, title: "On the client's phone", text: "Total, valid-until and a PDF — read and accepted on a phone." },
  { slug: "client-designs-deck", chapter: "sell", kind: "phone", w: 640, h: 1385, title: "The client designs the deck", text: "Send a link: the client changes the size, stairs, railing and boards — even by talking — and sends it back, priced." },
  { slug: "change-order", chapter: "sell", kind: "phone", w: 640, h: 1385, title: "Change orders", text: "Extra work priced and signed in writing, added to the contract the client already accepted." },
  { slug: "home-dashboard", chapter: "sell", kind: "phone", w: 640, h: 1385, title: "The homeowner's home", text: "Every project on the house in one place — proposals, contractors, what was done and what is planned. No account, no password." },

  { slug: "calendar", chapter: "run", kind: "desk", w: 1600, h: 1309, title: "The calendar", text: "Jobs, estimates and appointments for the whole company — by month, by week and by crew." },
  { slug: "dispatch", chapter: "run", kind: "desk", w: 1600, h: 1309, title: "Dispatch by crew", text: "Who is where this week, and the jobs still waiting to be dragged onto a day." },
  { slug: "job", chapter: "run", kind: "desk", w: 1600, h: 1111, title: "A job, start to finish", text: "Status, crew, client and expenses on one page, every change logged." },
  { slug: "on-site", chapter: "run", kind: "desk", w: 1600, h: 1111, title: "Day by day on site", text: "The crew opens and closes each day from a phone and adds photos and videos; the office sees it as it happens." },
  { slug: "crew-portal", chapter: "run", kind: "phone", w: 640, h: 1384, title: "The crew's own page", text: "The jobs sent their way, directions, start and finish — no login needed." },

  { slug: "overview", chapter: "company", kind: "desk", w: 1600, h: 1111, title: "The owner's overview", text: "Revenue, pipeline, what happened today and this week's jobs on one screen." },
  { slug: "crm-office", chapter: "company", kind: "desk", w: 1600, h: 1111, title: "CRM · the office", text: "Money collected and owed, win rate, jobs in motion, and the funnel from lead to paid." },
  { slug: "financials", chapter: "company", kind: "desk", w: 1600, h: 1111, title: "Financials", text: "Revenue against expenses and the margin, receipts read off a photo, invoices and change orders." },
  { slug: "team-activity", chapter: "company", kind: "desk", w: 1600, h: 1309, title: "Every member's trail", text: "Who did what and when — owners, managers, sales reps and crews, each with their own view of the app." },
  { slug: "reviews", chapter: "company", kind: "desk", w: 1600, h: 1111, title: "Reviews", text: "Review requests after the job, the score and a public page." },
];

export const tourSrc = (slug: string) => `/investors/tour/${slug}.webp`;
