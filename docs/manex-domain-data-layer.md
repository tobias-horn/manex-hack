# Manex Domain Data Layer

Prompt 2 adds a stable, domain-oriented access layer in `src/lib/manex-data-access.ts`.

## Why this exists

The smoke test from Prompt 1 proves connectivity.
This layer solves the next problem: keeping product features from depending on raw SQL strings, raw PostgREST query strings, or direct table/view names.

## Design shape

The exported API is investigation-oriented:

- `investigation.findDefects(...)`
- `investigation.findDefectsForProduct(productId, ...)`
- `investigation.findClaims(...)`
- `investigation.findClaimsForArticle(articleId, ...)`
- `investigation.findTestSignals(...)`
- `investigation.findTestSignalsForProduct(productId, ...)`
- `traceability.findInstalledParts(...)`
- `traceability.findInstalledPartsForProduct(productId, ...)`
- installed-part rows now include article and build context for downstream traceability work
- `quality.findWeeklySummaries(...)`
- `quality.findWeeklySummariesForArticle(articleId, ...)`
- `workflow.findActions(...)`
- `workflow.findActionsForProduct(productId, ...)`
- `workflow.recordAction(...)`
- `workflow.updateAction(...)`
- `workflow.findRework(...)`
- `workflow.findReworkForDefect(defectId, ...)`
- `workflow.recordRework(...)`

The rest of the app should ask for product and investigation data in those terms instead of building raw transport queries.

## Transport behavior

- Reads prefer REST/PostgREST when the handout API URL and key are available.
- Reads fall back to direct Postgres automatically.
- Writes follow the same order for `product_action` and `rework`.
- Each result includes the transport that actually succeeded, which is useful for diagnostics.

## Read model policy

Convenience views are the primary read model:

- `v_defect_detail`
- `v_field_claim_detail`
- `v_product_bom_parts`
- `v_quality_summary`

Raw table names are now confined to the data layer for workflow write-back and internal transport plumbing.

## Normalization policy

- timestamps are normalized to ISO strings
- nullable text is normalized consistently
- numeric fields are converted to `number | null`
- asset paths are resolved centrally through `src/lib/manex-images.ts`
- known dataset image-path quirks are normalized in that helper before URLs reach the UI
- unresolved or malformed image paths become `null` so UI consumers can handle them safely

## Current consumers

- `src/lib/quality-workspace.ts`
- `src/app/api/actions/route.ts`

If a new feature needs data, extend the domain layer first, then consume it from the feature.

For Prompt 6, the higher-order deterministic helpers that sit on top of this layer are documented in `docs/manex-traceability.md`.

For Prompt 7, the thin workflow write-back layer is documented in `docs/manex-writeback-foundation.md`.
