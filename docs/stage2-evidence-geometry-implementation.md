# Stage 2 Evidence Geometry Implementation

Date: 2026-04-18

## What changed

The three-stage clustering pipeline was tightened to preserve the evidence invariants that matter for the Manex challenge instead of relying on loose label similarity.

## Stage 1

`src/lib/manex-case-clustering.ts`

Stage 1 deterministic `mechanismEvidence` is now richer before the LLM runs:

- `traceabilityEvidence`
  - dominant trace anchors
  - concentration hints
  - supplier / part / BOM / batch emphasis
- `temporalProcessEvidence`
  - first / last factory signal week
  - dominant FAIL vs MARGINAL test bands
  - temporal containment hints
  - occurrence vs detected mismatch
- `fieldLeakEvidence`
  - claim lag stats
  - claim-only / no-prior-defect preservation
- `operatorHandlingEvidence`
  - order cluster hints
  - rework-user concentration hints
- `confounderEvidence`
  - near-limit marginal test hints
  - low-volume / detection-bias / service-documentation markers

The Stage 1 prompt was also tightened so the model preserves anchors and contradictions instead of inventing mechanisms.

## Stage 2

Stage 2 now treats article-local outputs as typed objects:

- `cases`
- `incidents`
- `watchlists`
- `noise`

Cases are still the only objects materialized into `team_case_candidate`. The other types stay in the reviewed Stage 2 payload and are available to later reasoning and the read model.

The compact Stage 2 product cluster cards now carry the stronger deterministic evidence lanes above, including:

- traceability concentration
- temporal containment
- claim lag stats
- order / rework-user concentration
- marginal-vs-fail hints
- confounder markers

## Prompt-budget safety

Stage 2 chunking is now prompt-budget-aware instead of product-count-only:

- single-pass decision uses estimated Stage 2 proposal prompt size
- chunk planning uses a prompt char budget and max chunk size together
- Stage 2 review payload is trimmed back toward budget by shrinking evidence packets and oversized digests

Configured knobs are documented in `.env.example`:

- `MANEX_STAGE2_PRODUCT_CHUNK_SIZE`
- `MANEX_STAGE2_SINGLE_PASS_PROMPT_CHAR_BUDGET`
- `MANEX_STAGE2_CHUNK_PROMPT_CHAR_BUDGET`
- `MANEX_STAGE2_REVIEW_PROMPT_CHAR_BUDGET`

## Stage 3

Stage 3 remains the calibration layer, but it now receives better article-local structure and richer weekly volume context:

- production volume by week
- defect / claim / rework rates per built unit
- article-local incidents / watchlists / noise alongside cases

This should make it easier for Stage 3 to down-rank seasonal or low-volume artifacts instead of rescuing weak Stage 2 outputs.
