# Research notes — design clarity

Source rationale for the checks in SKILL.md. Read only when a tradeoff needs explaining.

## Contrast (WCAG 2.2)
- **1.4.3 Contrast (Minimum), AA:** 4.5:1 for normal text, 3:1 for large text. "Large" is at least 18 pt (24 CSS px)
  regular or 14 pt (about 18.67 CSS px) bold. Secondary/supporting copy is still text and needs 4.5:1.
- **1.4.6 Contrast (Enhanced), AAA:** 7:1 normal, 4.5:1 large — a useful target for key values.
- **1.4.11 Non-text Contrast, AA:** 3:1 for the visual information needed to identify a control and its state
  (borders of inputs, focus rings, selected states, icon-only buttons).
- Measure against the rendered background: translucent fills, overlays and images change the effective contrast.

## Targets
- **2.5.8 Target Size (Minimum), AA:** 24 × 24 CSS px, or enough spacing, with exceptions (inline links, user-agent
  controls, essential presentation).
- **2.5.5 Target Size (Enhanced), AAA:** 44 × 44 CSS px — the user's preferred default for standalone controls,
  also Apple HIG's 44 pt and Material's 48 dp guidance.

## Text and reflow
- **1.4.4 Resize Text, AA:** text enlarges to 200% without loss of content or function.
- **1.4.10 Reflow, AA:** no two-dimensional scrolling at 320 CSS px wide (except content that needs it: tables, maps).
- **1.4.12 Text Spacing, AA:** layouts survive line-height 1.5, paragraph spacing 2×, letter 0.12em, word 0.16em.
- Body text of 16–18 px is the user's starting preference, not a WCAG requirement; WCAG sets no minimum font size.

## Color and meaning
- **1.4.1 Use of Color, A:** color is not the only means of conveying information — pair status color with a word,
  an icon or a shape.

## Hierarchy and cognitive load
- Fewer, clearly distinct type roles read faster than many near-identical sizes (visual hierarchy research; NN/g on
  scanning and F/layer-cake patterns).
- Removing redundant text increases the share of attention on what remains (NN/g "concise, scannable, objective").
- Proximity and common region (Gestalt) group related items more cheaply than extra borders and boxes.
- Hick's law: more equally weighted choices slow decisions — one clear primary action per task group.
