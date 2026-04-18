# Current Codebase Overview

This note describes the current state of the app as it exists in the repo on
2026-04-18, with extra focus on the three-stage clustering pipeline in
`src/lib/manex-case-clustering.ts`.

## High-level shape

The app is a Next.js App Router workspace for quality investigation.

The user journey is currently:

1. `/`
   Symptom intake and triage inbox across defects, field claims, and test
   outliers.
2. `/products/[productId]`
   Product-level dossier and traceability workspace.
3. `/articles`
   Global intelligence dashboard for proposed article cases plus cross-article
   watchlists/noise.
4. `/articles/[articleId]`
   Article investigation workspace centered on proposed case candidates.

The key app-owned layers are:

- `src/lib/manex-data-access.ts`
  Domain-oriented read/write access over PostgREST and direct Postgres.
- `src/lib/manex-case-clustering.ts`
  Three-stage clustering orchestration, prompt payload shaping, read models, and
  global reconciliation.
- `src/lib/manex-case-clustering-state.ts`
  App-owned persistence for dossiers, runs, and proposed candidates.
- `src/prompts/manex-case-clustering.ts`
  Prompt contracts for Stage 1 synthesis, Stage 2 clustering, and Stage 3
  reconciliation.

## Runtime entry points

The clustering pipeline is exposed through:

- `POST /api/articles/[articleId]/cluster`
  Runs one article end to end.
- `GET/POST /api/articles/cluster-all`
  Starts or polls a multi-article batch.

The main UI surfaces consuming the pipeline are:

- `src/app/articles/page.tsx`
  Global dashboard with full-pipeline runner and cross-article inventory.
- `src/app/articles/[articleId]/page.tsx`
  Article workspace showing proposed cases, unresolved leftovers, evidence
  spine, and action panel.
- `src/components/article-cluster-runner.tsx`
  Single-article trigger.
- `src/components/global-pipeline-runner.tsx`
  Full-dataset trigger plus live run-stage polling.

## Architectural split

There are three different kinds of state in play:

1. Shared source-of-truth manufacturing data
   Read through `manex-data-access.ts` from views/tables like
   `v_defect_detail`, `v_field_claim_detail`, `v_product_bom_parts`,
   `v_quality_summary`, `test_result`, `product_action`, and `rework`.
2. App-owned persisted clustering artifacts
   Stored in `team_product_dossier`, `team_article_dossier`, `team_case_run`,
   `team_case_candidate`, and `team_case_candidate_member`.
3. Derived read models for the UI
   Built in `getProposedCasesDashboard()` and `getArticleCaseboard()` with a
   15-second server cache TTL.

This means the clustering pipeline is not ephemeral. It materializes its own
intermediate and final artifacts into Postgres so the UI can reopen previous
runs without recomputing everything.

## Clustering persistence model

`src/lib/manex-case-clustering-state.ts` creates and manages the following:

- `team_signal_inbox`
  A convenience view that normalizes defects, field claims, and failed/marginal
  tests into one signal feed.
- `team_product_dossier`
  One persisted Stage 1 dossier per product.
- `team_article_dossier`
  One persisted Stage 1 article dossier per article.
- `team_case_run`
  Run metadata, stage progress, prompt/schema versions, draft proposal payload,
  and final review payload.
- `team_case_candidate`
  Materialized article-local proposed cases from Stage 2.
- `team_case_candidate_member`
  Product and signal membership edges for each proposed case.

Important detail:

- Stage 2 article proposals are materialized into dedicated tables.
- Stage 3 global reconciliation is not stored in a separate inventory table.
- Instead, Stage 3 output is embedded into `team_case_run.review_payload.stage3`
  and the latest completed run is used as the current global inventory snapshot.

## The three-stage clustering pipeline

The orchestrator is `runArticleCaseClustering(articleId)`.

Run lifecycle in `team_case_run.current_stage`:

- `stage1_loading`
- `stage1_synthesis`
- `stage2_draft`
- `stage2_review`
- `stage2_persisting`
- `stage3_reconciliation`
- `completed` or `failed`

### Stage 1: deterministic dossier construction plus product synthesis

Stage 1 is implemented primarily in `buildArticleDossier(articleId, onStageChange)`.

This stage does two jobs:

1. Build a deterministic evidence model for every product in the article.
2. Compress each product thread into a compact LLM-friendly synthesis.

Inputs loaded for the article:

- article metadata from `article`
- products from `product`
- defects via `findDefects({ articleId })`
- field claims via `findClaimsForArticle(articleId)`
- bad/marginal tests via `findTestSignals({ articleId, outcomes: ["FAIL", "MARGINAL"] })`
- weekly summaries via `findWeeklySummariesForArticle(articleId)`
- installed parts via a batch query to `v_product_bom_parts`
- actions via `product_action`
- rework via `rework`

For each product thread, Stage 1 constructs:

- `signals`
  A unified chronological timeline of defects, claims, tests, rework, and
  workflow actions.
- `traceabilitySnapshot`
  Part/batch/supplier graph summary and assembly rollups.
- `evidenceFrames`
  Up to 6 image-backed frames from defects and claims.
- `summaryFeatures`
  Compact deterministic features like defect codes, test keys, reported parts,
  BOM positions, supplier batches, sections, claim lags, and false-positive
  markers.
- `stage1Synthesis`
  An LLM-generated product summary with:
  - `productSummary`
  - `timeline`
  - `evidenceFeatures`
  - `suspiciousPatterns`
  - `possibleNoiseFlags`
  - `openQuestions`

Each product dossier is immediately upserted into `team_product_dossier`.

After that, the article dossier is assembled with:

- article summary metrics
- cross-product summaries
- all product threads
- weekly quality summaries
- raw evidence appendix

That article dossier is then upserted into `team_article_dossier`.

Cross-product summaries are still deterministic. They highlight:

- shared supplier batches
- shared reported part numbers
- shared BOM/find numbers
- similar claim keywords
- shared orders
- shared sections
- shared test hotspots

Why Stage 1 matters:

- It preserves raw evidence for later review.
- It gives Stage 2 a much smaller narrative representation per product.
- It separates deterministic feature extraction from LLM grouping.

Fallback behavior:

- If Stage 1 product synthesis fails for a product, the code falls back to a
  deterministic `buildFallbackProductThreadSynthesis(...)`.
- Older persisted dossiers missing `stage1Synthesis` are hydrated at read time
  by `hydrateArticleDossier(...)`.

### Stage 2: article-local case proposal and review

Stage 2 is implemented in `runProposalPass(dossier, onStageChange)`.

This stage operates within one article only.

Goal:

- group related products into investigation-worthy proposed cases
- keep weak products unassigned
- keep isolated signals standalone
- refine case boundaries before persistence

There are two execution modes:

- `single`
  Used when the article has at most `SINGLE_PASS_PRODUCT_LIMIT` products and the
  serialized dossier stays under `MAX_PROMPT_CHARS`.
- `chunked`
  Used when the article is too large for one prompt. Product threads are split
  into chunks of `PRODUCT_CHUNK_SIZE`.

#### Stage 2A: draft clustering

Prompt pair:

- `buildPassASystemPrompt()`
- `buildPassAUserPrompt(...)`

Output contract:

- `cases`
- `unassignedProducts`
- `standaloneSignals`
- `ambiguousLinks`
- `globalObservations`

In chunked mode, each chunk produces its own Stage 2A draft. Those chunk drafts
are merged mechanically into one synthetic draft object before review.

#### Stage 2B: review and consolidation

Prompt pair:

- `buildPassBSystemPrompt()`
- `buildPassBUserPrompt(...)`

This pass is the article-local critic. It is allowed to:

- merge duplicate cases
- split over-broad cases
- drop weak clusters
- keep products unassigned
- preserve standalone signals

The reviewed Stage 2 output is the version that gets materialized.

#### Stage 2 materialization

`materializeCaseCandidates(...)` converts the reviewed proposal JSON into
database rows.

Behavior worth knowing:

- product IDs are deduplicated and inferred from included signals when needed
- signals are only kept if they exist in the current dossier
- a case is dropped entirely if no valid product membership remains
- each persisted case gets both product members and signal members
- case lifecycle starts as `proposed`

Persistence call:

- `replaceTeamCaseCandidatesForRun({ runId, articleId, candidates })`

So Stage 2 is the only stage that creates the explicit proposal tables the UI
reads directly.

### Stage 3: cross-article reconciliation

Stage 3 is implemented in `runGlobalReconciliation(...)`.

This stage does not recluster raw products globally. Instead, it reconciles the
latest article-local Stage 2 outputs into one global inventory.

Data sources:

- the current article's reviewed Stage 2 result and persisted candidates
- the latest completed run for every other article
- each other article's persisted article dossier
- each other article's persisted case candidates

The code loads the latest completed run per article, extracts `stage2` from
`review_payload`, and rebuilds a compact article case set summary with
`buildArticleCaseSetSummary(...)`.

Then it builds a global reconciliation context using:

- article-local case sets
- global detection section distribution
- global occurrence section distribution
- false-positive pool
- marginal-only pool
- weekly volume summaries
- test result band summaries
- field-claim lag summaries

Prompt pair:

- `buildStage3SystemPrompt()`
- `buildStage3UserPrompt(...)`

Output contract:

- `validatedCases`
- `watchlists`
- `noiseBuckets`
- `rejectedCases`
- `caseMergeLog`
- `confidenceNotes`

Interpretation:

- `validatedCases`
  Cross-article or strongly supported patterns worth active investigation.
- `watchlists`
  Real but not yet strong enough patterns to keep visible.
- `noiseBuckets`
  Repeated distractors or weak recurring artifacts.
- `rejectedCases`
  Article-local proposals that should be explicitly down-ranked.

Important nuance:

- Stage 3 is recomputed as part of each article run.
- The dashboard uses the latest completed run that contains a valid Stage 3
  payload as the current global snapshot.
- There is no separate global batch table, so the "global truth" is whichever
  completed run finished most recently.

## End-to-end call flow

For one article:

1. API route validates AI/Postgres capability.
2. `runArticleCaseClustering(articleId)` creates a `team_case_run` row.
3. Stage 1 builds/persists product dossiers and the article dossier.
4. Stage 2 drafts and reviews article-local proposed cases.
5. Stage 2 candidates are materialized into proposal tables.
6. Stage 3 reconciles the current article against latest completed runs from
   other articles.
7. The run is marked completed, with:
   - `proposal_payload` = Stage 2 draft
   - `review_payload.stage2` = Stage 2 reviewed proposal
   - `review_payload.stage3` = global reconciliation output

For a full batch:

1. `POST /api/articles/cluster-all` checks there is no active batch or active
   article run.
2. `runArticleCaseClusteringBatch(...)` chooses article IDs and runs them with
   bounded concurrency.
3. `GET /api/articles/cluster-all` polls `listActiveTeamCaseRuns()` to drive the
   live stage UI.

## Dashboard read model behavior

`getProposedCasesDashboard()` builds the `/articles` page.

It returns:

- article cards from `listTeamArticleClusterCards()`
- active runs from `listActiveTeamCaseRuns()`
- article queues derived from the latest completed run per article
- latest global snapshot from the latest completed run that contains valid Stage
  3 data

`getArticleCaseboard(articleId)` builds `/articles/[articleId]`.

It returns:

- latest article dossier
- latest run
- latest persisted proposed cases for that run
- unresolved leftovers derived from reviewed Stage 2 output:
  - `unassignedProducts`
  - `standaloneSignals`
  - `ambiguousLinks`
  - `globalObservations`
- article-local view of `stage3` from the latest run

This means the article page is not showing only raw DB rows. It combines
persisted candidates with reconstructed leftovers from the Stage 2 review JSON.

## Prompt and schema versioning

Current versions in code:

- prompt version:
  `2026-04-18.case-clustering.v3`
- product dossier schema:
  `manex.product_dossier.v2`
- article dossier schema:
  `manex.article_dossier.v2`
- article case set schema:
  `manex.article_case_set.v2`
- global inventory schema:
  `manex.global_case_inventory.v1`
- review wrapper schema:
  `manex.case_pipeline_review.v1`

This is important because run rows persist both schema and prompt version, so
future migrations can reason about mixed historical runs.

## Concurrency and scaling knobs

The pipeline uses bounded async worker pools instead of unbounded parallelism.

Environment-controlled settings:

- `MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY`
- `MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY`
- `MANEX_STAGE3_ARTICLE_LOAD_CONCURRENCY`
- `MANEX_ARTICLE_PIPELINE_CONCURRENCY`

Other size controls in code:

- `SINGLE_PASS_PRODUCT_LIMIT = 18`
- `PRODUCT_CHUNK_SIZE = 12`
- `MAX_PROMPT_CHARS = 120_000`

The model default is taken from `env.OPENAI_MODEL`, with some concurrency
defaults adjusted when a `mini` model is used.

## Practical mental model

The cleanest way to think about the current pipeline is:

- Stage 1 answers:
  "What happened to each product, in a structured and compressible form?"
- Stage 2 answers:
  "Which products inside one article look like they belong to the same
  investigation case?"
- Stage 3 answers:
  "Across articles, which article-local cases are real, weak, duplicate, worth
  monitoring, or mostly noise?"

## Current caveats and implementation truths

- The UI still contains some older "two-pass clustering" wording, but the
  runtime pipeline is now clearly three-stage.
- Stage 3 depends on the latest completed Stage 2 result from each article, so
  global output quality is only as current as the last successful runs.
- Global reconciliation is snapshot-based, not an independently persisted global
  domain model.
- The current design treats article-local proposals as first-class persisted
  entities, but global outcomes are still attached to runs rather than their own
  tables.
- `getArticleCaseboard()` and `getProposedCasesDashboard()` are memoized for 15
  seconds, so recently finished runs may appear with a short delay unless the UI
  refreshes after that cache window.

## Best files to read next

If you need the fastest path back into this subsystem later, read these in
order:

1. `src/lib/manex-case-clustering.ts`
2. `src/lib/manex-case-clustering-state.ts`
3. `src/prompts/manex-case-clustering.ts`
4. `src/app/api/articles/[articleId]/cluster/route.ts`
5. `src/app/api/articles/cluster-all/route.ts`
6. `src/app/articles/page.tsx`
7. `src/app/articles/[articleId]/page.tsx`
