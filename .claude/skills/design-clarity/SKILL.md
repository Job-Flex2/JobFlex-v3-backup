---
name: design-clarity
description: Apply the user's UI clarity preferences whenever creating or redesigning interfaces, pages, screens, components, forms, or dashboards. Favor larger readable content and controls, clear hierarchy, purposeful color, and less unnecessary text. Use alongside implementation design skills; also use for visual clarity reviews.
---

# Design clarity

Make the purpose, current state, and next action easy to understand at a glance.
The user's default preference is larger readable elements and less clutter.
Apply this lens before designing and again before delivery, without adding a
planning or approval ceremony. Respect explicit task choices and the project's
design specification, shared tokens, and components. This is a decision guide,
not permission to replace a brand or change the entire design system.

## Design decisions

1. **Give the screen a job.** Identify the user, their immediate task, the key
   information, and the next action. Establish a clear primary action per task
   group; do not give every control the same visual emphasis.

2. **Make room for bigger essentials.** Favor comfortable body text, prominent
   key values, legible labels, and generous controls. Remove duplication and
   reflow the layout before shrinking text. Enlarge according to importance;
   making everything equally huge destroys hierarchy. Preserve useful comparison
   density in working tables. Do not add oversized empty containers.

3. **Make every line earn its place.** Ask: does this help someone decide, act,
   understand a state, or avoid an error? Keep what does; shorten repetition;
   remove filler, redundant subtitles, obvious instructions, and decorative
   labels. Put genuinely optional detail behind a clearly named disclosure.
   Keep costs, consequences, units, necessary instructions, errors, and required
   information available where the decision happens. Preserve accessible names
   when removing redundant visible text; keep persistent form labels.

4. **Use hierarchy without making text hard to read.** Distinguish heading,
   working content, and supporting detail with size, weight, placement, and
   spacing. If secondary text looks too faint, first decide whether it belongs.
   If it belongs, make it readable. Quiet is fine; illegible is not. Measure
   contrast against the actual rendered background, including translucent fills.

5. **Keep typography deliberate.** Reuse the approved font and type scale.
   Choose clearly distinct roles rather than many nearly identical sizes.
   Without a project scale, start around 16-18 CSS px for body text and
   14-16px for useful supporting text, then check the actual font and viewport.
   These are this user's starting preferences, not WCAG font-size requirements.
   Allow comfortable line spacing, wrapping, and text enlargement.

6. **Give color a job.** Use existing semantic colors consistently for actions,
   selection, and status. Avoid competing accent colors and meaningless colored
   badges. Pair status color with text or another recognizable cue. Check text
   on colored buttons and badges, not just text on the page background.

7. **Group through layout.** Align related edges; keep labels close to their
   values and leave more space between unrelated groups. Use the spacing scale.
   Add borders, cards, icons, or backgrounds when they clarify meaning or follow
   the project system, rather than wrapping every fragment in another box.

## Practical checks

- Text: at least 4.5:1 contrast for ordinary informational text, including
  secondary copy; 3:1 for large text (at least 24 CSS px regular or about
  18.67px bold). Aim above the minimum where practical.
- Controls: meaningful visual cues needed to identify a control or state need
  3:1 against adjacent colors. Keep focus and selected states distinguishable.
- Touch: prefer at least 44 x 44 CSS px hit areas for standalone controls, with
  spacing that prevents accidental taps. This preference aligns with the WCAG
  enhanced target; the AA minimum is 24 x 24 with specified exceptions.
- Layout: check the actual UI in a browser at the target viewport. For mobile,
  include 390 x 844, long content, 200% text enlargement, and reflow at 320 CSS
  px. Avoid lost actions or clipped content; genuine two-dimensional content
  such as tables may need its own scrolling region. Report checks actually run.

## Ask yourself before delivery

- What do I notice first, and is it what matters most?
- Can I understand the screen and find the next action without reading a paragraph?
- What can I remove so the useful content can be larger?
- Does every faint or tiny line need to exist? If yes, is it comfortably readable?
- Are spacing, color, and type helping me understand relationships?
- Can I still use this with long names, a small screen, zoom, and a keyboard?

Resolve issues within the requested surface; avoid unrelated redesigns. When
delivering UI work, briefly mention material clarity changes and actual
verification. Do not paste this checklist into the product or every response.

Read [research notes](references/research.md) only when source rationale,
accessibility distinctions, or a design tradeoff needs explanation.
