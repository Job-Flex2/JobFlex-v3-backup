// WHAT THE HOMEOWNER GETS, AND WHY JOBFLEX (owner, 2026-10-28: "say they can pre-estimate what it will cost; that
// if they submit to JobFlex, contractors who already work on JobFlex will contact them; make the client understand
// how it works — attractive, convenient, clear"). One set of words for the desk page and the phone page: the four
// steps, the comparison with the usual way, the questions. Every line is true of the portal as built:
//   · the price is a range from JobFlex's own estimators (lib/home/portalPrice), not a quote — a pro confirms on site;
//   · a request goes to ONE local pro at a time, 24 hours each, then the next (lib/leadCenter/route);
//   · the pro gets the contact details only on Accept (leads-behavior: "the offer has none");
//   · the homeowner is told the pro's name and phone ("You're matched", lib/notify) — the pro gets in touch;
//   · what was priced opens in the pro's estimator (lib/webHandoff, the roof's measurement row) — PRO_IS;
//   · "Find me another contractor" any time on the request page; the home dashboard comes with the first project.
// No ratings, no licence or insurance checks, no counts of pros, no response-time promises: none of those exist.
// Pure.

export interface StoryStep {
  n: string;
  title: string;
  body: string;
}

export function storySteps(house: boolean): StoryStep[] {
  return [
    { n: "01", title: "Tell us what you want", body: "Type it, say it, or tap Roof, Deck, Fence… Plain words are perfect." },
    {
      n: "02",
      title: "See your price first",
      body: house
        ? "Roofs, decks, fences, heating & cooling and remodels: a range for your house in about a minute. Anything else becomes a written scope."
        : "Roofs: a range for your house in about a minute, measured from the sky. Anything else becomes a written scope a pro can price.",
    },
    { n: "03", title: "A JobFlex pro takes it", body: "Send it once. A local contractor who runs their business on JobFlex takes your project and gets in touch." },
    { n: "04", title: "Proposal, then the job", body: "They confirm the details and send a line-item proposal. Accept it online — your home dashboard keeps it all." },
  ];
}

export interface StoryRow {
  topic: string;
  usual: string;
  jobflex: string;
}

export const STORY_ROWS: StoryRow[] = [
  { topic: "The price", usual: "You find out after the visits.", jobflex: "A range for your house in about a minute, before anyone comes out." },
  { topic: "Finding a pro", usual: "Call around and tell your story to each company.", jobflex: "Send it once. One local pro who runs their business on JobFlex takes it — 24 hours each, then the next." },
  { topic: "Your phone number", usual: "Often shared with several companies at once.", jobflex: "Goes only to the pro who takes your project." },
  { topic: "The quote", usual: "Every company measures and starts from zero.", jobflex: "What you priced opens in the pro's own estimator, just as you left it." },
  { topic: "Keeping track", usual: "Quotes in texts, emails and paper.", jobflex: "Proposals, messages, visits and payments in your home dashboard." },
];

export interface StoryQuestion {
  q: string;
  a: string;
}

export function storyQuestions(house: boolean): StoryQuestion[] {
  return [
    {
      q: "What can I price here?",
      a: house
        ? "Roofs (measured from the sky), decks (designed in 3D on your lot), fences (drawn on your lot), heating & cooling (sized to your house), and kitchens, baths and other remodels from your words and photos. Anything else: describe it, and a pro prices it."
        : "Roofs, measured from the sky for your house. Anything else: describe it in your words, and a pro prices it.",
    },
    { q: "Is the price a quote?", a: "No — it's an estimate range for your house, from JobFlex's own estimators and local prices. The pro confirms it on site and sends the real proposal before you agree to anything." },
    {
      q: "Who will contact me?",
      a: "One local contractor who runs their business on JobFlex. When they take your project, we tell you who they are and how to reach them, and they get in touch about it. Each pro has 24 hours to take it; if they pass, it goes to the next local pro.",
    },
    { q: "Who sees my phone number and email?", a: "Only the pro who takes your project. Before that, a pro sees the project — not how to reach you." },
    { q: "What if the pro isn't right for me?", a: "Ask for another contractor from your request page, any time. Your project and your price go with it." },
    { q: "What does it cost me?", a: "Nothing. Pricing, sending your project and your home dashboard are free for homeowners. You pay only the contractor you hire, for the proposal you accept." },
    { q: "Do I need an account?", a: "No. Your first project comes with your own home dashboard — one private link, no password. We email it to you." },
  ];
}
