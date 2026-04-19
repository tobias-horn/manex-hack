# Economic Blast Radius In Case Viewer

Date: 2026-04-19

## What was added

The dedicated case viewer now renders a bottom section called
`Economic blast radius`.

That same bottom section is now also rendered inside the confirmed-case
workspace, so approving a case no longer hides the economic impact view.

It summarizes the currently opened case by:

- affected product count
- observed total cost
- claim share of total cost
- grouped anchor count

The visualization now also adds a clearer decision layer:

- a `Read this first` brief that frames the overall business impact
- a cost-mix view that keeps defect, claim, and rework composition visible
- no ranked-anchor or lane-by-lane drilldown below the top summary area

Supplier-batch anchors also link into `/traceability`.

## Why the implementation is split this way

The data section is driven from a reusable helper in
`src/lib/manex-case-clustering.ts` so it can reason from the same dossier and
mechanism evidence already used by the clustering system.

The UI itself now lives in a shared component:

- `src/components/economic-blast-radius-section.tsx`

That prevents the confirmed-case screen from drifting away from the normal case
viewer and makes the bottom panel available in both states.

The helper computes anchor spread from the selected case threads, then combines
that with economic totals.

## Cost fallback behavior

Older persisted dossiers may not contain defect / claim `cost` values because
those fields were not previously carried through the normalized app types.

To avoid blank or zeroed blast-radius output on existing runs:

- the case loader now asks the clustering layer for an economic blast radius
- if selected threads are missing defect / claim cost fields, the clustering
  layer queries live per-product cost totals from `defect`, `field_claim`, and
  `rework`
- those live totals are then merged with the existing dossier anchors

This keeps the feature useful on both:

- newly generated dossiers
- older persisted case snapshots

## Files touched

- `src/components/economic-blast-radius-section.tsx`
- `src/components/case-viewer.tsx`
- `src/components/confirmed-case-workspace.tsx`
- `src/lib/manex-case-viewer.ts`

## Verification notes

Targeted lint passes for the touched files.

`npx tsc --noEmit --pretty false` passes after the shared-component and
confirmed-workspace integration changes.
