# Pitch Deck Workspace

Date: 2026-04-19

## Goal

Create a pitch deck as a web route instead of a separate slide file so the team
can iterate quickly, reuse the repo's visual language, and export to PDF from
the browser.

The current pass intentionally shifts the deck away from "well-written product
doc" territory and toward a sharper hackathon pitch.

## Route

- `/pitch`

The page is intentionally separate from the main product workflow.

## Files

- `src/app/pitch/page.tsx`
  Route entry point.
- `src/components/pitch-deck.tsx`
  Slide content and reusable card/placeholder primitives.
- `src/components/pitch-deck.module.css`
  Screen and print styles, including 16:9 PDF export behavior.

## Design direction

The deck intentionally borrows the product's existing language:

- `spec-grid` blueprint background
- Manrope + Inter typography from the root layout
- cool industrial blue palette from CSS variables in `globals.css`
- glass/surface panels with hard-edged geometry

This keeps the deck visually connected to the app instead of feeling like a
generic presentation skin.

## Narrative currently covered

1. Quality teams drown in scattered evidence
2. Existing tools either visualize symptoms or document decisions
3. Tracis creates ranked investigations, not just reports
4. Operators compare explanations with evidence and confirm one
5. A dedicated AI-agent slide shows what Tracis Copilot actually does
6. AI helps inside the flow, but humans stay in control
7. Result: faster, clearer, more actionable quality work

## Core lines to preserve

- "Factories don't have a reporting problem. They have a signal-to-action problem."
- "Dashboards show symptoms. Documents track actions. Nobody closes the loop."
- "Find the signal. Prove the cause. Ship the fix."

## Copy guardrails

- Keep the main differentiator explicit:
  `Tracis starts from ranked cases, not raw tables, and turns confirmed explanations into controlled action.`
- Prefer concrete operator language over abstract platform language.
- Use `AI can recommend. Humans decide.` instead of repeating longer
  "approval-gated" phrasing.
- Keep architecture detail in support material, not in the main pitch path.
- Avoid repeating phrases like "evidence loop", "grounded copilot layer", or
  similar internal jargon across multiple slides.

## Slide intent

1. Hook:
   `From Excel Graveyard to Quality Copilot` + one-sentence problem framing.
2. Pain:
   The method exists (`8D`), but the workflow still breaks across systems.
3. Gap:
   Show the category gap and include a crisp before/after transformation.
4. Solution:
   Show the 3-part investigation flow in plain language.
5. Trust:
   Explain why the workflow is trustworthy without getting lost in pipeline
   internals.
6. User flow:
   Make the operator sequence concrete and observable.
7. AI agent:
   Keep one dedicated slide for Tracis Copilot with concrete tasks and a clear
   safety boundary.
8. Why Tracis:
   Repeat only three differentiators plus the category point.
9. Impact:
   Land on operational outcomes, not abstract innovation claims.

## Export flow

Open `/pitch` in the browser and use the built-in `Download PDF` button.

There is also a `Browser print` fallback, but the direct export is now the
preferred path because it avoids the white-margin issues caused by browser
paper sizing.

The CSS is set up so that:

- each slide can be exported directly into a PDF without depending on print UI
- browser print still renders one slide per 16:9 page
- sticky controls are hidden in print
- fixed app chrome is hidden in print

For best results in the browser print dialog:

- keep margins at none or default minimal margins
- keep background graphics enabled

## Editing notes

- Replace placeholder product surfaces with real screenshots when the demo UI is
  stable, but keep the current slide order unless the story itself changes.
- If the story changes, prefer editing the JSX in `src/components/pitch-deck.tsx`
  rather than creating ad hoc duplicate slides elsewhere.
- Do not collapse the AI agent back into generic feature bullets. Keep one
  dedicated slide that explains what the agent does in concrete workflow terms.
- If more technical detail is needed for judging, add it after slide 9 or in a
  separate appendix route rather than expanding the core pitch slides again.
