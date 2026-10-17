# JobFlex — current Blueprint design

This is the single design specification for JobFlex, for Codex, Claude,
Impeccable and agents with no conversation history. Updated September 23, 2026.
Use it for new work and restyling. Update this file when an owner-approved
design decision changes; do not maintain a second theme specification.

## Intent and hierarchy

JobFlex serves small US contracting businesses, at a desk, on a jobsite and
in front of clients. A surface should reveal its purpose, current state and
next action at a glance. Keep working data and actions visible. Use short,
specific copy; move secondary explanations into an accessible disclosure.

The current Blueprint is a crisp engineering sheet: drafting-paper background,
white surfaces, ink frames, strong uppercase headings and restrained blue
actions. Structure comes from alignment, spacing and continuous rules.
No soft SaaS cards, rounded pills, glass, gradients, blurred shadows, grain
over text, ornamental drawing numbers or decorative metrics.

## Authority and working examples

1. This specification defines the design intent.
2. [globals.css](src/app/globals.css) defines the shared token values.
3. These maintained components demonstrate the current treatment:
   - [Meta connection](src/components/v3/settings-blueprint/meta-connection.tsx)
     and its [styles](src/components/v3/settings-blueprint/meta-connection.module.css):
     framed card, status stamp, annotation labels, section rules and action row.
   - [Roofing inventory desktop](src/components/v3/roofing-inventory/roofing-inventory-desktop.tsx)
     and [styles](src/components/v3/roofing-inventory/roofing-inventory-desktop.module.css):
     dense working tables, filters, clear item hierarchy and management actions.
   - [Roofing inventory mobile](src/components/v3/roofing-inventory/roofing-inventory-mobile.tsx)
     and [styles](src/components/v3/roofing-inventory/roofing-inventory-mobile.module.css):
     a dedicated handheld composition of the same functionality.

Examples show patterns, not a template to copy into every page. A quiet table
label or text action need not become a stamp. Match each element's role.
Existing components outside this list are implementation context, not automatic
approval of every visual choice. Prior prototypes and historical notes do not
override this specification. If code and this document conflict, flag the
specific discrepancy rather than silently selecting another theme.

## Tokens and surfaces

Use CSS custom properties; do not paste a palette into new components.

| Purpose | Existing token |
| --- | --- |
| Drafting-paper background | `--paper` |
| White surface | `--paper-deep`; `--sheet` in mobile scopes that define it |
| Main text and frames | `--ink` |
| Body / secondary text | `--ink-soft` / `--ink-muted` |
| Quiet repeated row separators | `--ink-line` |
| Primary blue / hover / soft fill | `--accent` / `--accent-ink` / `--accent-soft` |
| Success / warning / error | `--emerald` / `--amber` / `--rose` |
| Sans / annotation type | `--font-sans` / `--font-mono` |
| Near-square corners | `--r-sm` (2px) |
| Motion | `--ease-out`, `--ease-soft`, `--ease-draw` |

Some existing mobile scopes give `--paper-deep` a recessed-paper meaning.
Inspect the consuming scope; use `var(--sheet, var(--paper-deep))` for a shared
white card where appropriate. Do not globally repurpose a token to fix one card.
Use existing semantic status tones where available; otherwise derive a soft
fill from the status token. Status color conveys state, not decoration.
One owner-approved exception (September 26, 2026): where the estimators sit
side by side as choices (the lead page's Estimate this job), each wears one
identity hue on its card edge and icon plate — Smart Proposal `--blueprint`,
roof `--danger`, fence `--success`, HVAC `--sky`, manual proposal `--ink`.
Amber stays reserved there for what an estimator still needs.
A second (owner, 2026-10-17, overriding the 2026-10-16 entry that made them
ordinary rows): the sidebar's Estimating tools, desk and drawer, give each
tool one colour from `--tool-smart`, `--tool-plan`, `--tool-roof`,
`--tool-fence`, `--tool-video`, `--tool-hvac`, `--tool-deck` (globals.css).
A tool row is one line: a white icon square in an ink frame on a hard offset
shadow in the tool's colour, the square filled with that colour while the
tool is open; then the name (no caption under it), "Soon" beside it when it
is coming. The tools sit in one bay with no frame and no grid. A subpage
toggle is a small white square in a 1.5px ink frame with a down arrow (up
when open); a subpage row (an inventory) has the same ink, size and weight
as the rows above it, indented on a guide line. Nothing else reads `--tool-*`.
The AI desk (owner, 2026-10-16): its two tabs, Calls | AI desk setup, are one
framed switch, the open tab filled with ink. The setup is a checklist card —
a full-width row per step (numbered square, name, status stamp, an
"Open"/"Close" control with a chevron), the open step's part unfolding under
its own row.

Light mode only. Keep the existing drafting grid behind content, never over
type. Resting cards have no shadow (`--shadow-sm` and `--shadow-md` are `none`).
An existing hard ink hover treatment may be retained on interactive controls;
do not give static cards decorative elevation. One owner-approved exception
(2026-09-26): the subscription plan cards on the landing pricing section and
on signup step 3 are white with a hard offset shadow, no blur: ink on every
plan, blueprint blue on the "Most picked" one. The offset is 3px, 4px under
a pointer (owner, 2026-10-12), on every one of those cards.
Subscription overview exception (owner, 2026-10-16; reworked 2026-10-17):
plan cards show their first four features, the rest behind one toggle that
opens every card of the row at once, sliding open (grid rows 0fr → 1fr).
Usage lists only what the plan caps — the first three rows in view, the rest
behind the same kind of fold; a resource with no cap is not listed. Other plan
surfaces keep their lists open.

Plan cards, everywhere a customer sees them (owner, 2026-10-12): one
Monthly | Annual switch over the row ([PlanTermSwitch](src/components/billing/PlanTermSwitch.tsx)),
never per-card term buttons; its Annual half always wears a sticker on its
bottom-right corner — filled `--emerald`, the "Most picked" type, a 2px hard
offset, 9px past the switch's edge — "2–3 months free" (the range of whole
free months), or "Save up to $N" when none is whole. On Annual a card's head
carries a filled `--emerald` "3 MONTHS FREE" stamp (the "Most picked" size,
whole months only) at its right edge, on the plan name's line; the price
stands alone, and under it one line "You save $135 a year", `--emerald`,
bold, 15px; "Billed yearly" when the year saves nothing. On Monthly a quiet
"Billed monthly" and nothing about the year, the stamp's place kept so no
card moves on the switch. Never a percentage or a struck price. Lists are always open (no "Show all"),
the cards of a row are one subgrid so prices and first rows align, and the
row has as many columns as cards, each capped, centred. On a desk the signup
plan step fits the window from 800px tall without a scroll, and the sheet is
the row's width: logo, steps, head, cards and terms share one left and one
right edge.
The sign-in pages (register, login, forgot, reset, invite, worker invite,
phone login) carry the real product mark ([ProductMark](src/components/brand/ProductMark.tsx),
the sidebar's and the landing's `/jobflex-mark.png`), not a drawn "J" square:
24px of ink beside a 20px "JobFlex" (22px on a phone), 8px apart, centred on
the letters. The custom plan is a card in the row on the plan step and the
upgrade page; on the landing and /pricing it stays the wide "Build your plan"
plate under the row.
The signup plan step on a phone (≤768px, owner 2026-10-14; it replaced the
two-to-a-row grid of 2026-10-12) is one swiped row of full cards with scroll
snap: one card in the middle (81–84% of a 360–430px screen, capped at 420px
on a tablet), its neighbours showing 24px at either edge, square dots under
the row (one per card, the middle one filled, 44px targets). It opens on the
most-picked plan, or on the plan the link or the tab names (a cancelled
Checkout), centred before the first paint. The card in the middle is the
choice (the blue frame); a tap on a card chooses it and brings it to the
middle. The cards stay one subgrid in columns, so every card is the row's
height and neither the switch nor a swipe moves anything; the page scrolls
down, nothing scrolls inside a card. Every card keeps its own whole list and
its own start button at its foot. There the year's stamp is the "Most
picked" plate's size at the name's right edge, and the saving or "Billed
monthly" is one 12px line (weight 600) under the price.

## Typography

- Keep Inter through `--font-sans`; do not choose a new font per page.
- Page and card headings: weight 800–900, uppercase, compact line height.
  Large headings use tight tracking; small section titles can use slight
  positive tracking. Typical working sizes: page 28–32px, card 16–20px,
  key entity 22–24px, section 12–14px. Fit the page's existing hierarchy.
- Body and user data stay readable, typically 13–16px, with normal casing.
  Do not uppercase paragraphs, editable input values or whole tables.
- Use JetBrains Mono only for short annotations, units and technical labels,
  usually 10–12px with measured tracking. Do not make navigation, paragraphs
  or large amounts monospace.
- Amounts use Inter with tabular numerals; important totals use weight 800–900.
- Status stamps: near-square frame, 10–11px, weight 800, uppercase, tracking
  about .1em, a semantic border and soft fill. Always include readable text.
- Keep the global font-rendering settings; no page-specific smoothing reset.
- Owner-approved (2026-10-10), the passwordless sign-up and the sign-in code
  form: field labels 12px JetBrains Mono caps, about .05em tracking, ink;
  notes under fields 12.5px Inter in `--ink-soft`; inputs white. The older
  9.5–10.5px mono labels read badly on a phone; new auth forms use this.
  An emailed code (owner, 2026-10-12) is always six white upright boxes, one
  per digit — 44×58, 6px apart, a 2px ink frame and no shadow, the next box
  framed blue with a caret, all six red on an error — drawn over ONE real field
  ([OtpCodeField](src/components/auth/otp-code-field.tsx)); no copy of it.

## Layout, frames and controls

- Main card frames: 1.5–2px ink. Major internal boundaries: 1px ink,
  edge-to-edge within the frame. Use quieter separators for repeated rows.
  Adjacent borders must not double in thickness or cross labels or links.
- Use a 4px spacing scale. Start with 24px desktop card padding and 20px
  mobile padding; 8px within a label/value group, 16–24px between groups.
  Adapt density to the task rather than filling unused space with copy.
- Keep one clear primary action per task group: blue surface, white text,
  visible ink border, near-square corners and a concise verb label.
  The Meta card's primary actions use bold uppercase text; quieter secondary
  actions may use normal casing as in the inventory reference.
- Controls must have visible focus, hover, disabled and busy states. Disabled
  styling must not be mistaken for an available action. Minimum mobile hit
  area is 44×44px; labelled full-width actions are useful on narrow cards.
- Use existing Lucide icons at consistent sizes; decorative icons are hidden
  from assistive technology, icon-only controls have accessible names.
- Preserve all existing actions, validation, units, permissions and data
  states during a redesign. Do not fabricate metrics, statuses or success.
- Reuse the live shared sidebar, navigation map and responsive shell.
  Sidebar subpage toggles are separate buttons with hover and expanded state;
  nested links retain consistent type and a clear indentation guide.

## Mobile and motion

Use the existing viewport switch at **≤768px** and its dynamically imported
mobile component. Exactly one layout tree mounts. Reuse shared logic and data;
compose the mobile surface for handheld use. No UA detection, new zoom system,
copied standalone HTML shell or alternate mobile palette.

Keep lists visible while filtering, selecting and editing. No opacity-zero
entrance dependency or MutationObserver that replays the whole list. Use
short state transitions: about 120–180ms for hover and 200–350ms for a panel.
Support `prefers-reduced-motion`. Loading feedback follows actual work and
keeps the layout stable. Never delay usable content for an animation.

Handheld frames and sheets have one geometry (2026-10-04): a fixed frame is
pinned by its edges and sized 100%, never in `vh`/`dvh`; a bottom sheet hangs
from a box that states its size and reads every number — ceiling, grab, head
and foot padding, scrim, safe area — from the `--msheet-*` table in
`globals.css`. Its body scrolls; its foot stays on screen above the home
indicator. Page-root resets step around nested components (`data-mnav`,
`data-nest`). Details and the guard check: [mobile notes](docs/design/mobile.md).

Long names must wrap or have an accessible way to view the full value. Use
`min-width: 0` on flex/grid children and `overflow-wrap: anywhere` where needed.
Keep key mobile data available; do not hide functionality to make a layout fit.

## Implementation and review

Read [implementation notes](docs/design/implementation.md) when editing an
existing interactive surface, and [mobile notes](docs/design/mobile.md) for
handheld work. These describe code hazards, not alternative visual themes.

Before delivery, verify the changed surface in its actual shell at desktop
width and 390×844. Check long content, focus, overflow, touch targets, loading,
empty/error/connected states as applicable, and all preserved actions. Use
relevant existing lint/type checks. Report what was actually verified; a
redirect or compilation alone is not visual verification. Do not create test
scaffolding, change the data layer, commit or publish unless authorized.
