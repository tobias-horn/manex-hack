# Concurrency Speedup Notes

Date: 2026-04-19

This note records a deliberate throughput increase for both clustering pipelines.

## Why

We observed that the app was not currently hitting OpenAI rate limits in normal
use, so the previous concurrency settings were leaving speed on the table.

The goal of this change is to improve end-to-end article and batch throughput
without changing clustering semantics.

## New defaults

Classic pipeline:

- `MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY`: `8`
- `MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY`: `4`
- `MANEX_ARTICLE_PIPELINE_CONCURRENCY`: `4`

Deterministic pipeline:

- `MANEX_DET_ISSUE_EXTRACTION_CONCURRENCY`: `8`
- `MANEX_DET_ARTICLE_PIPELINE_CONCURRENCY`: `4`

These values are reflected in:

- `.env.example`
- `src/lib/manex-case-clustering.ts`
- `src/lib/manex-deterministic-case-clustering.ts`

## Tradeoff

This makes both pipelines faster, but it also increases burstiness:

- more simultaneous per-product LLM calls
- more simultaneous article runs in batch mode
- more pressure on shared OpenAI RPM and TPM budgets

If rate limiting shows up later, the first knobs to reduce again are:

1. `MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY`
2. `MANEX_DET_ISSUE_EXTRACTION_CONCURRENCY`
3. `MANEX_ARTICLE_PIPELINE_CONCURRENCY`
4. `MANEX_DET_ARTICLE_PIPELINE_CONCURRENCY`

## Operational note

The checked-in defaults are only fallbacks. If the deployed environment defines
these env vars explicitly, those runtime values still win.
