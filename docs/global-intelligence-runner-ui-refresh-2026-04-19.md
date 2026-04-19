# Global Intelligence Runner UI Refresh

Date: 2026-04-19

## Why this changed

The global pipeline runner lives in the right rail of `src/app/articles/page.tsx`.
That rail is only about 380px wide on large screens, but the previous control row
used viewport breakpoints (`md:grid-cols-3`) instead of adapting to the component's
actual width.

That caused the action buttons to compress into unusable columns and overflow into
each other, especially for the longer deterministic labels.

## What changed

- `src/components/global-pipeline-runner.tsx`
  - promoted the start action into a full-width primary control
  - moved stop/reset into an auto-fit secondary grid
  - allowed button labels to wrap instead of forcing single-line overflow
  - restructured progress stats into auto-fit cards
  - added clearer section hierarchy for progress, controls, live runs, and outcomes
  - moved the workflow icon into its own top row so the title and description can use the full card width

## Important implementation detail

When a component can appear inside a narrow rail, prefer auto-fit/minmax layout or
stacked controls over viewport breakpoints. The screen width can be large while the
component width is still constrained.

The same principle applies to hero cards: avoid sharing the heading row with a
decorative icon when that icon steals the text measure inside a constrained column.
