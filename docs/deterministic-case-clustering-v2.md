# Deterministic Case Clustering V2

Date: 2026-04-19

This note documents the new deterministic clustering pipeline added alongside
the existing `src/lib/manex-case-clustering.ts` flow.

## Intent

The original three-stage pipeline asks the LLM to reason over article-wide and
global payloads. That gives good flexibility, but it is also the main source of:

- prompt budget pressure
- context-window failures
- brittle chunk/review behavior
- inconsistent case boundaries

The new pipeline keeps the same broad product -> article -> global shape, but
changes where the LLM is used:

- LLM: bounded per-product issue extraction only
- deterministic logic: article grouping and global reconciliation

That keeps the model where it is strongest, local dossier interpretation, while
moving cluster formation into explicit code.

## New files

- `src/lib/manex-deterministic-case-clustering.ts`
  Main orchestration and deterministic grouping logic.
- `src/lib/manex-deterministic-case-clustering-state.ts`
  Separate persistence under `team_det_*` tables.
- `src/prompts/manex-deterministic-case-clustering.ts`
  Small per-product issue extraction prompt.
- `src/app/api/articles/[articleId]/cluster-deterministic/route.ts`
  Run/poll endpoint for the new system.

Shared dependency:

- `src/lib/manex-case-clustering.ts`
  The new pipeline reuses the exported `buildArticleDossier(...)` Stage 1 builder.

## Runtime shape

### Layer 1: shared Stage 1 dossier build

The deterministic pipeline reuses the existing article dossier builder:

- deterministic joins
- traceability evidence
- mechanism evidence
- Stage 1 product synthesis

This means the new system shares the same evidence foundation as the current
pipeline and does not fork the product-dossier semantics.

### Layer 2: per-product issue extraction

For each product thread, the new system calls the LLM with a compact payload and
asks for at most 3 issue cards.

Each issue card contains:

- title
- issue kind
- scope hint
- confidence and priority
- included signal IDs
- strongest evidence
- reasons against clustering
- recommended checks
- structured anchor summary

The anchor summary is the critical piece. It explicitly captures:

- reported parts
- BOM/find numbers
- supplier batches and suppliers
- test keys and defect codes
- occurrence/detected sections
- order IDs and rework users
- claim lag bucket
- first/last factory signal week
- product anchor candidates
- confounder flags

Fallback behavior:

- if the product-level issue extraction fails, the system falls back to a small
  deterministic issue derived from the Stage 1 dossier

So the run can still finish even when a small model call fails.

### Layer 3: deterministic article grouping

Article-local grouping no longer uses article-wide clustering prompts.

Instead, issue cards are paired and scored deterministically using exact anchor
overlap:

- product anchor candidates
- supplier batches
- part numbers
- BOM positions
- production orders
- rework users
- occurrence sections
- defect codes
- test keys
- overlapping factory time windows
- matching claim-lag buckets

Penalties are applied for:

- false-positive / screening-noise issues
- marginal-only issues
- detection-bias signals

Only strong pairs form graph edges. Connected components then become:

- `cases`
  Multi-product clusters with strong anchors.
- `incidents`
  Local product issues that stay isolated.
- `watchlists`
  Recurring but weak/service/cosmetic patterns.
- `noise`
  False positives and screening artifacts.

Only `cases` are materialized into deterministic candidate tables.

## Global reconciliation

Global reconciliation is also deterministic.

The code loads the latest completed deterministic run per article and compares
persisted case candidates by fingerprint tokens such as:

- `candidate:<anchor_type>:<anchor_value>`
- `supplier_batch:<value>`
- `part:<value>`
- `bom:<value>`
- `order:<value>`
- `occurrence:<value>`
- `kind:<value>`
- `claim_lag:<bucket>`

Cross-article merges therefore require explicit shared anchors rather than
semantic similarity.

The output keeps the same conceptual buckets as the current pipeline:

- `validatedCases`
- `watchlists`
- `noiseBuckets`
- `rejectedCases`

## Persistence

The deterministic system uses separate tables so it can coexist with the current
pipeline without overwriting its state:

- `team_det_case_run`
- `team_det_case_candidate`
- `team_det_case_candidate_member`

The current pipeline tables remain untouched.

## API

Single-article endpoint:

- `GET /api/articles/[articleId]/cluster-deterministic`
  Poll latest deterministic run status.
- `POST /api/articles/[articleId]/cluster-deterministic`
  Start a deterministic run if none is active for that article.

Batch endpoint:

- `GET /api/articles/cluster-all-deterministic`
  Poll deterministic batch and active-run status.
- `POST /api/articles/cluster-all-deterministic`
  Run the deterministic pipeline across every article.
- `DELETE /api/articles/cluster-all-deterministic`
  Reset deterministic persisted state only.

## App integration

The final app now exposes both pipelines side by side instead of replacing the
original one.

- `/articles`
  Has a large pipeline toggle at the top and switches both the global dashboard
  read model and the batch runner route.
- `/articles/[articleId]`
  Uses the same toggle and swaps the article caseboard plus runner route.
- `/products/[productId]`
  Preserves the chosen pipeline when opening the article caseboard and shows the
  matching proposed-case list for that product.

Important coexistence rule:

- current pipeline UI talks only to `team_case_*` routes/state
- deterministic UI talks only to `team_det_*` routes/state
- the only intentional shared layer is the persisted Stage 1 article dossier,
  which both pipelines use as the same evidence foundation

## Environment knobs

Added to `.env.example`:

- `MANEX_DET_ISSUE_EXTRACTION_CONCURRENCY`
- `MANEX_DET_ISSUE_MAX_OUTPUT_TOKENS`
- `MANEX_DET_MODEL_CALL_MAX_ATTEMPTS`
- `MANEX_DET_REASONING_EFFORT`

## Current limitations

- Global reconciliation is deterministic and conservative by design, which makes
  it more stable but less flexible than a high-context LLM review pass.
- The article caseboard UI is shared, so a few explanatory panels use fallback
  text when the deterministic candidate payload does not have the classic
  pipeline's `suspectedCommonRootCause` or `conflictingEvidence` fields.

## Why this is safer

The new system removes the two most failure-prone prompt shapes:

- article-wide clustering prompts
- global reconciliation prompts

The only LLM step left is product-local issue extraction, where:

- the input is naturally bounded
- the failure blast radius is one product, not the whole article
- a deterministic fallback can be used without destroying the run
