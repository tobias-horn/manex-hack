# Pipeline Feedback And Rate-Limit Tuning

This note captures the April 18, 2026 changes that made the clustering pipeline
more transparent in the UI and safer on a fresh low-tier OpenAI account without
ever skipping the LLM call preemptively.

## Intent

- keep every Stage 1/2/3 model call attempted unless the stage naturally has no
  signal-bearing input
- expose live progress to users instead of long blocking waits
- stay conservative on throughput for a fresh Tier 1 account
- improve latency by shrinking prompts and lowering reasoning effort before
  increasing concurrency

## Runtime behavior

### Single article

`/api/articles/[articleId]/cluster`

- `POST` now starts the run asynchronously and returns immediately
- `GET` now returns the latest persisted run snapshot for polling
- the route keeps a small in-memory map of active article promises to avoid
  duplicate launches from the UI
- progress is derived from `team_case_run.current_stage` and `stage_detail`

`src/components/article-cluster-runner.tsx`

- polls every 1.5 seconds while a run is active
- shows stage label, progress bar, last update time, and outcome counts
- updates copy from "two-pass" to "three-stage" clustering

### Full pipeline batch

`/api/articles/cluster-all`

- batch state now tracks:
  - total article count
  - last update time
  - recent per-article results
- the batch runner receives callbacks from
  `runArticleCaseClusteringBatch(...)` for:
  - resolved target article ids
  - each completed article run

`src/components/global-pipeline-runner.tsx`

- polls every 1.5 seconds while work is active
- shows queued/running/completed/failed counts
- shows a progress bar for overall batch completion
- shows live stage distribution for currently active runs
- shows recent article-level successes and failures as they finish

## Model tuning

`src/lib/manex-case-clustering.ts`

- Stage 1, Stage 2 draft, Stage 2 review, and Stage 3 now each have their own
  `reasoningEffort` default, all overrideable by env vars
- defaults are intentionally biased toward `low` for speed and lower token burn
- retry behavior now uses exponential backoff plus jitter for retryable model
  failures like rate limits and transient overloads

## Throughput defaults

Current defaults remain conservative:

- `MANEX_ARTICLE_PIPELINE_CONCURRENCY` default: `1`
- `MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY` default: `3` on mini models
- `MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY` default: `2`

These were chosen because the real failures observed were a mix of:

- oversized Stage 1 / Stage 2 prompts
- Tier 1 rate-limit pressure on `gpt-5.4-mini`

So the safer speed path is:

1. shrink payloads
2. lower reasoning effort
3. retry with jitter
4. only then consider raising concurrency

## Guardrail

Do not reintroduce a pre-call Stage 1 shortcut that bypasses the LLM synthesis
for "large" product threads. The requested policy is to attempt the LLM call
whenever Stage 1 synthesis is supposed to happen, and only fall back after an
actual model failure.
