# Quality Inbox Read Model

Prompt 4 turns the front page into the first real product surface: a quality inbox.

## Goal

This screen is the intake layer for future case management.
It deliberately stops short of root-cause analysis.
The job here is to normalize incoming symptoms so the team can browse and triage what is arriving.

## Signal sources

The inbox currently merges four signal types:

- `field_claim`
- `defect`
- `bad_test`
- `marginal_test`

The read model uses:

- `v_field_claim_detail`
- `v_defect_detail`
- `test_result` joined to `product`, `article`, and `section` inside the data layer

## Filter model

The front page supports:

- time window
- article
- defect code
- signal type

Filters are URL-based, so the page stays server-rendered and shareable.

## Code shape

- `src/lib/manex-data-access.ts`
  Adds `findTestSignals(...)` so test outliers use the same transport boundary as the rest of the app.
- `src/lib/manex-images.ts`
  Resolves stored relative image paths into usable asset URLs from one shared helper.
- `src/lib/quality-inbox.ts`
  Builds the normalized `QualitySignal` list, including optional `imageUrl`, and filter facets.
- `src/app/page.tsx`
  Renders the inbox UI.
- `src/components/quality-signal-image.tsx`
  Renders safe previews and degrades cleanly when an image is missing or broken.

## Caseboard direction

Each quality signal already carries the fields later clustering work will need:

- article
- product
- timestamp
- defect code when available
- test key when available

That means later prompts can cluster signals into candidate cases without rebuilding the ingestion surface.

## Image behavior

Defect and field-claim signals can carry `imageUrl`.
The app resolves these centrally from the raw dataset `image_url` field, so UI components do not need to know about the asset host or relative-path format.
The helper also normalizes the current dataset’s stored `.jpg` paths to the live image server’s `.png` assets.
If an image is missing or the remote fetch fails, the inbox falls back to a neutral placeholder instead of breaking the card.
