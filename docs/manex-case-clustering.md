# Manex Case Clustering

The clustering layer now follows a 3-stage pipeline that matches the hackathon
investigation flow more closely:

1. product thread construction
2. article-local case clustering
3. global reconciliation and noise extraction

The result is a simpler UI shape:

- `/` stays the symptom inbox
- `/articles` becomes the proposed-cases dashboard
- `/articles/[articleId]` becomes the investigation workspace

## What changed

- `src/lib/manex-case-clustering.ts`
  Owns the full 3-stage orchestration.
- `src/lib/manex-case-clustering-state.ts`
  Persists dossiers, runs, and article-local proposed cases.
- `src/app/articles/page.tsx`
  Shows validated cases, watchlists, and noise buckets first.
- `src/app/articles/[articleId]/page.tsx`
  Opens one article workspace with case selection, evidence spine, and action lane.
- `src/app/api/articles/[articleId]/cluster/route.ts`
  Triggers the end-to-end pipeline and returns article plus global counts.

## Stage 1

Stage 1 still starts with deterministic joins, but it now adds an LLM synthesis
layer on top of each product thread.

Each persisted `team_product_dossier` now includes:

- the full deterministic timeline
- installed parts, supplier batches, and BOM positions
- tests, claims, defects, rework, and actions
- summary features for later clustering
- `stage1Synthesis`
  - `productSummary`
  - `timeline`
  - `evidenceFeatures`
  - `suspiciousPatterns`
  - `possibleNoiseFlags`
  - `openQuestions`

This gives Stage 2 a compact “story of this unit” without losing the raw evidence.

Current schema version:

- product dossier: `manex.product_dossier.v2`

## Stage 2

Stage 2 clusters product threads inside one article.

The article dossier still contains:

- article summary metrics
- cross-product trace summaries
- enriched product threads
- raw evidence appendix

The article-local output is stored as an article case set and materialized into
`team_case_candidate` plus `team_case_candidate_member`.

Important behaviors:

- products may remain unassigned
- signals may remain standalone
- cases are still only proposed at this stage

Current schema versions:

- article dossier: `manex.article_dossier.v2`
- article case set: `manex.article_case_set.v2`

## Stage 3

Stage 3 reconciles the latest article-local case sets into one global inventory.

It uses:

- article-local case sets from completed runs
- global section distributions
- false-positive pool
- marginal-only pool
- weekly volume summaries
- test result band summaries
- field-claim lag summaries

The global output separates:

- `validatedCases`
- `watchlists`
- `noiseBuckets`
- `rejectedCases`
- `caseMergeLog`
- `confidenceNotes`

This global inventory is persisted inside the run review payload, so the app can
render the latest validated/watchlist/noise view without introducing another
storage layer.

Current schema version:

- global reconciliation: `manex.global_case_inventory.v1`

## UI notes

The UI is intentionally more opinionated now.

`/articles` is no longer just an article list. It is the main proposed-cases
dashboard, with:

- validated cases first
- watchlists second
- noise buckets third
- article workspaces in the sidebar

`/articles/[articleId]` is the workspace view, with:

- left: proposed case selection and unresolved leftovers
- center: evidence spine for the selected case
- right: strongest evidence, caution signals, and `product_action` write-back

## Compatibility

Older persisted article dossiers may still exist in the database without
`stage1Synthesis`. The read layer hydrates those payloads with a deterministic
fallback so the new workspace can render older runs safely.

## Performance notes

- The default model is `gpt-5.4-mini`.
- Stage 1 product synthesis runs with bounded concurrency.
- Prompt payloads stay more compact than the persisted dossier payloads.
