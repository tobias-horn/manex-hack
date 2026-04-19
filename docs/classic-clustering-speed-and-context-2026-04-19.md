# Classic Clustering Speed + Context Pass (2026-04-19)

## What Was Actually Regressing

The classic pipeline slowdown was not primarily caused by the shared `500 RPM` gate.

The real regressions were:

1. Stage 2 prompt instructions had drifted away from the real payload.
   The prompt talked about deterministic candidate families, but the classic pipeline still sends `articleContext + productClusterCards`.

2. Stage 1 was still sending too much raw text.
   Sampled defects, claims, tests, rework rows, and action rows still carried large free-text note blobs.

3. The structured-output schema had grown before the architecture was wired.
   Classic Stage 2 cases were carrying many family-scoring fields that are not consumed yet, which inflated the schema sent with `generateObject(...)`.

## Changes Made

### Throughput

- Raised classic local concurrency in `.env.local`
  - `MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY=10`
  - `MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY=6`
  - `MANEX_ARTICLE_PIPELINE_CONCURRENCY=5`
- Raised reproducible defaults in `.env.example`
- Raised code defaults in `src/lib/manex-case-clustering.ts`

### Context Trimming

- Reduced Stage 1 sampled evidence windows
  - timeline `16 -> 12`
  - defects `10 -> 6`
  - claims `8 -> 4`
  - tests `10 -> 6`
  - rework `8 -> 4`
  - actions `8 -> 4`
  - installed parts `20 -> 12`

- Reduced Stage 1 mechanism-evidence slices across traceability / temporal / field-leak / operator / confounder lanes

- Replaced long raw note fields in Stage 1 payloads with trimmed previews

- Lowered Stage 1 output cap from `1800 -> 1400`

- Lowered Stage 2 review evidence product default from `10 -> 8`

### Schema Cleanup

- Removed unused Stage 1 output fields:
  - `strongestExplanation`
  - `strongestCompetingExplanation`

- Removed unused classic Stage 2 case fields that were bloating the response schema:
  - `requiredEvidencePresent`
  - `requiredEvidenceMissing`
  - `dominantAnchor`
  - `discriminativeScore`
  - `backgroundPrevalencePenalty`
  - `bestCompetingFamily`
  - `shouldValidate`
  - `strongestCounterevidence`
  - `affectedProductCount`
  - `articleBackgroundCount`
  - `lift`
  - `weekConcentrationScore`
  - `orderConcentrationScore`
  - `reworkUserConcentrationScore`
  - `claimOnlyRatio`
  - `preClaimFactoryDefectRatio`
  - `detectedVsOccurrenceMismatchRate`
  - `sourceCandidateFamilyIds`

- Removed unused extra incident/watchlist/noise counterevidence-family fields from the classic proposal schema

## Architecture Alignment

The classic prompt pack now matches the current classic payload again:

- Stage 2 Pass A reasons from compact product cluster cards
- Stage 2 Pass B reasons from compact cluster cards plus validation packets
- The prompt still asks for a closest `family` label on proposed cases, but no longer pretends the full candidate-family architecture is live in classic

## Liveness Fix

The runner could look stuck even while work was still progressing for two separate reasons:

1. The UI polls `/api/articles/cluster-all` every `1.5s` while a batch is active.
   That polling is expected and is not a sign that new model work is being re-enqueued.

2. The batch summary row was stale.
   `team_case_batch.last_updated_at` only moved when an article finished, so the batch card could look frozen even while individual `team_case_run.stage_updated_at` values were moving.

3. Long Stage 2 review and Stage 3 calls had no heartbeat.
   A single long `generateStructuredObject(...)` request could hold a run in one visible stage for a while without refreshing `stageUpdatedAt`.

Changes made:

- `src/app/api/articles/cluster-all/route.ts`
  - batch status now derives `lastUpdatedAt` from the freshest active run stage timestamp when a batch is still running
  - recovered live status now uses the earliest active-run start and latest active-run update instead of relying on list ordering

- `src/lib/manex-case-clustering.ts`
  - added a best-effort heartbeat during Stage 2 review and Stage 3 reconciliation so long model calls keep refreshing visible liveness without affecting the underlying run result

## Verification

- `npx eslint src/lib/manex-case-clustering.ts src/prompts/manex-case-clustering.ts`
- `npx tsc --pretty false --noEmit`
