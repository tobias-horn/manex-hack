# Three-Layer Clustering Deep Dive

Date: 2026-04-19

This note captures the codebase as it exists in the current worktree, with
special focus on the "three-layer clustering" pipeline. In the code and UI the
system is usually called a "three-stage" pipeline; this note uses "layer" and
"stage" interchangeably.

## Short mental model

The app is a Next.js quality-investigation workspace with four main surfaces:

- `/`
  Quality inbox and triage.
- `/products/[productId]`
  Product dossier and traceability workspace.
- `/articles`
  Global clustering dashboard and batch runner.
- `/articles/[articleId]`
  Article-local investigation workspace for proposed cases.

The core clustering flow lives in:

- `src/lib/manex-case-clustering.ts`
- `src/lib/manex-case-clustering-state.ts`
- `src/prompts/manex-case-clustering.ts`

The data-source layer feeding clustering lives mainly in:

- `src/lib/manex-data-access.ts`
- `src/lib/manex-traceability-evidence.ts`

## End-to-end flow

Single-article execution starts in `runArticleCaseClustering(articleId)` in
`src/lib/manex-case-clustering.ts`.

The lifecycle is:

1. create a `team_case_run` row
2. build and persist Stage 1 dossiers
3. generate and review Stage 2 article-local clustering
4. materialize Stage 2 `cases` into candidate tables
5. run Stage 3 global reconciliation
6. complete the run with Stage 2 draft plus Stage 2/3 review payloads

Batch execution starts from `runArticleCaseClusteringBatch(...)` and is exposed
through `POST /api/articles/cluster-all`.

UI runners:

- `src/components/article-cluster-runner.tsx`
- `src/components/global-pipeline-runner.tsx`

Read models:

- `getProposedCasesDashboard()`
- `getArticleCaseboard(articleId)`
- `getProposedCasesForProduct(productId)`

## Persistence model

`src/lib/manex-case-clustering-state.ts` creates and manages the app-owned
tables/views used by clustering:

- `team_signal_inbox`
  Unified view over defects, field claims, FAIL tests, and MARGINAL tests.
- `team_product_dossier`
  Stage 1 product dossier, one row per product.
- `team_article_dossier`
  Stage 1 article dossier, one row per article.
- `team_case_run`
  Pipeline run record, stage progress, prompt/schema versions, and full JSON payloads.
- `team_case_batch`
  Batch runner state.
- `team_case_candidate`
  Materialized Stage 2 proposed `cases` only.
- `team_case_candidate_member`
  Product/signal membership edges for each materialized case.

Important boundary:

- Stage 2 `cases` are persisted as first-class rows.
- Stage 2 `incidents`, `watchlists`, `noise`, `unassignedProducts`,
  `standaloneSignals`, and `ambiguousLinks` are not materialized into separate tables.
- Stage 3 is not stored in its own table; it lives inside
  `team_case_run.review_payload.stage3`.

## Layer 1: deterministic product dossiers plus product synthesis

Main function:

- `buildArticleDossier(articleId, onStageChange)`

This layer loads article-wide source data in parallel:

- article metadata and products
- defects
- field claims
- FAIL/MARGINAL tests
- weekly quality summaries
- installed parts from `v_product_bom_parts`
- workflow actions
- rework rows

For each product, the code builds a deterministic thread:

- `buildSignalTimeline(...)`
  Unifies defects, claims, tests, rework, and actions into one chronological signal stream.
- `buildSummaryFeatures(...)`
  Extracts compact deterministic clustering features such as defect codes,
  reported parts, BOM/find numbers, supplier batches, sections, claim lags,
  false-positive markers, and flags like `fieldClaimWithoutFactoryDefect`.
- `buildProductTraceabilityEvidence(...)`
  Builds scoped trace anchors from installed parts:
  dominant parts, BOM positions, supplier batches, suppliers, anchor candidates,
  concentration hints, and blast-radius hints.
- `buildMechanismEvidence(...)`
  Organizes the deterministic reasoning lanes used later by clustering:
  - `traceabilityEvidence`
  - `temporalProcessEvidence`
  - `fieldLeakEvidence`
  - `operatorHandlingEvidence`
  - `confounderEvidence`
- `buildEvidenceFrames(...)`
  Pulls up to 6 defect/claim images.

Then the LLM compresses each product thread with Stage 1 prompts:

- system: `buildStage1SystemPrompt()`
- user: `buildStage1UserPrompt(payload)`

The Stage 1 prompt payload is deliberately truncated:

- recent timeline only
- sampled defects/claims/tests/rework/actions
- sampled installed parts
- capped mechanism evidence slices

Stage 1 output contract:

- `productSummary`
- `timeline`
- `evidenceFeatures`
- `suspiciousPatterns`
- `possibleNoiseFlags`
- `openQuestions`

Fallbacks and compatibility:

- if Stage 1 model synthesis fails, `buildFallbackProductThreadSynthesis(...)` is used
- if an older persisted dossier is loaded later, `hydrateArticleDossier(...)`
  recomputes missing `mechanismEvidence` and/or `stage1Synthesis`

Persistence behavior:

- each product thread is upserted immediately into `team_product_dossier`
- the article dossier is assembled after all product threads complete and then
  upserted into `team_article_dossier`

Why this layer matters:

- it separates deterministic evidence extraction from clustering
- it keeps traceability anchors explicit instead of asking Stage 2 to rediscover them
- it gives later stages a much smaller representation than raw source rows

## Layer 2: article-local clustering

Main function:

- `runProposalPass(dossier, onStageChange)`

This layer works within one article only.

### Stage 2 input representation

Each product thread is converted into a compact Stage 2 cluster card via
`toStage2ProductClusterCard(thread)`.

That card contains:

- compact Stage 1 summary
- strongest deterministic anchors
- traceability anchors
- temporal/process anchors
- field-leak anchors
- operator/handling anchors
- confounders
- short diagnostic timeline events
- short raw evidence snippets

This is the key compression boundary of the whole pipeline.

### Strategy selection

`chooseRunStrategy(dossier)` decides between:

- `single`
- `chunked`

The decision uses both:

- product count (`SINGLE_PASS_PRODUCT_LIMIT = 18`)
- estimated prompt size against `MANEX_STAGE2_SINGLE_PASS_PROMPT_CHAR_BUDGET`

Chunk planning uses `planStage2Chunks(dossier)` and is also prompt-budget-aware,
not just count-based.

### Stage 2A: draft clustering

Prompt pair:

- `buildPassASystemPrompt()`
- `buildPassAUserPrompt(payload)`

Draft output contract:

- `cases`
- `incidents`
- `watchlists`
- `noise`
- `unassignedProducts`
- `standaloneSignals`
- `ambiguousLinks`
- `globalObservations`

The important shift in the current code is that Stage 2 is not "cases plus
leftovers" anymore. It explicitly creates typed article-local inventory lanes.

If the dossier is chunked:

- each chunk runs an independent Stage 2A draft
- `mergeProposalOutputs(...)` concatenates those draft objects mechanically
- a single review pass then consolidates the merged draft

### Stage 2B: review and consolidation

Prompt pair:

- `buildPassBSystemPrompt()`
- `buildPassBUserPrompt(payload)`

The review payload is not the raw dossier again. It is a targeted validation
packet built by:

- `buildStage2ReviewPayload(...)`
- `selectStage2ReviewEvidenceProductIds(...)`
- `toStage2ReviewEvidencePacket(thread)`

The code ranks draft cases/incidents/watchlists, selects the most important
products, and includes only the evidence needed to confirm, split, merge, or
reject borderline clusters.

If the review payload gets too large,
`fitStage2ReviewPayloadToBudget(...)` progressively trims:

- validation evidence product packets
- case digests
- standalone signal digests

### Stage 2 materialization boundary

Only reviewed `cases` are turned into `team_case_candidate` rows by
`materializeCaseCandidates(...)`.

Materialization rules:

- signal IDs are deduped and validated against the current dossier
- product IDs are deduped and can be inferred from included signals
- a case is dropped if no valid product membership remains
- members are stored as both product edges and signal edges

The rest of Stage 2 stays inside `review_payload.stage2` and is reconstructed at
read time by `extractUnclusteredState(...)`.

That means:

- article pages read persisted `cases`
- article pages reconstruct `incidents`, `watchlists`, `noise`,
  `unassignedProducts`, `standaloneSignals`, and `ambiguousLinks`
  from the JSON review payload

## Layer 3: global reconciliation

Main function:

- `runGlobalReconciliation(...)`

This layer does not recluster raw products globally. It calibrates and reconciles
article-local Stage 2 outputs.

Inputs:

- the current article dossier
- the current article reviewed Stage 2 output
- the current article persisted candidates
- the latest completed run for every other article
- each other article's persisted dossier
- each other article's persisted candidates

The code loads the latest completed run per article, parses
`review_payload.stage2`, hydrates the persisted dossier, and converts the article
into a compact case-set summary with `buildArticleCaseSetSummary(...)`.

Then `buildGlobalReconciliationContext(...)` builds the Stage 3 context:

- article case sets
- detection-section distribution
- occurrence-section distribution
- false-positive pool
- marginal-only pool
- weekly volume summaries with rates per built unit
- test result band summaries
- field-claim lag summaries

Prompt pair:

- `buildStage3SystemPrompt()`
- `buildStage3UserPrompt(payload)`

Stage 3 output contract:

- `validatedCases`
- `watchlists`
- `noiseBuckets`
- `rejectedCases`
- `caseMergeLog`
- `confidenceNotes`

Persistence behavior:

- Stage 3 is written only into `team_case_run.review_payload.stage3`
- there is no standalone global inventory table

Read behavior:

- `/articles` uses the latest completed run that contains a valid Stage 3 payload
  as the current global snapshot

This means the "global truth" is snapshot-based and is always anchored to the
most recent completed run with valid Stage 3 output.

## Prompt and schema versions in the current source

Current constants in `src/lib/manex-case-clustering.ts` and
`src/prompts/manex-case-clustering.ts`:

- prompt version: `2026-04-18.case-clustering.v7`
- product dossier schema: `manex.product_dossier.v3`
- article dossier schema: `manex.article_dossier.v3`
- article case set schema: `manex.article_case_set.v2`
- global reconciliation schema: `manex.global_case_inventory.v1`
- review wrapper schema: `manex.case_pipeline_review.v1`

## Operational knobs

Main environment controls:

- `MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY`
- `MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY`
- `MANEX_STAGE2_PRODUCT_CHUNK_SIZE`
- `MANEX_STAGE2_SINGLE_PASS_PROMPT_CHAR_BUDGET`
- `MANEX_STAGE2_CHUNK_PROMPT_CHAR_BUDGET`
- `MANEX_STAGE2_REVIEW_PROMPT_CHAR_BUDGET`
- `MANEX_STAGE3_ARTICLE_LOAD_CONCURRENCY`
- `MANEX_ARTICLE_PIPELINE_CONCURRENCY`

Reasoning effort is configured per stage:

- Stage 1
- Stage 2 draft
- Stage 2 review
- Stage 3

Model calls share:

- structured Zod schemas
- exponential backoff with jitter on retryable failures
- abort awareness
- capped output tokens per stage

## Read-model behavior

`getProposedCasesDashboard()` returns:

- article cards
- active runs
- per-article case queues
- latest global run and global inventory snapshot

`getArticleCaseboard(articleId)` returns:

- latest article dossier
- latest run
- persisted proposed cases for the latest run
- reconstructed non-case Stage 2 lanes
- Stage 3 payload from that run

`getProposedCasesForProduct(productId)` returns all candidate memberships for one
product.

## Important implementation truths and caveats

- Older docs in `docs/` still refer to earlier prompt/schema versions; the source
  code is currently the authority.
- The codebase now clearly models three stages, but some older copy still talks
  about "two-pass" clustering in historical notes.
- `team_case_candidate` stores only article-local `cases`, not the full Stage 2
  inventory.
- The global reconciliation layer is snapshot-based, not a standalone persisted
  domain model.
- `src/lib/manex-case-clustering-runtime.ts` exists as a runtime-state helper,
  but the current API routes still use their own in-module promise maps rather
  than that helper.
- `listTeamArticleClusterCards()` counts proposed candidates by article across
  `team_case_candidate`, so article-level case counts are not explicitly scoped
  to only the latest run.

## Fastest files to reopen later

If an LLM or teammate needs to get back into this subsystem quickly, reopen
these first:

1. `src/lib/manex-case-clustering.ts`
2. `src/lib/manex-case-clustering-state.ts`
3. `src/prompts/manex-case-clustering.ts`
4. `src/lib/manex-traceability-evidence.ts`
5. `src/app/api/articles/[articleId]/cluster/route.ts`
6. `src/app/api/articles/cluster-all/route.ts`
7. `src/app/articles/page.tsx`
8. `src/app/articles/[articleId]/page.tsx`
