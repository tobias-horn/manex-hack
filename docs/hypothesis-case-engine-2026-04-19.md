# Hypothesis Case Engine

Date: 2026-04-19

This note documents the third investigation engine added alongside the classic
three-stage pipeline and the deterministic grouping pipeline.

## Intent

The new engine stops treating the problem as generic clustering and instead
builds explicit investigation candidates by mechanism family.

The flow is:

1. reuse the shared Stage 1 article dossier from `buildArticleDossier(...)`
2. generate deterministic candidates in hypothesis families
3. score and deduplicate them transparently
4. ask the LLM only to narrate already-ranked cases
5. reconcile the latest article outputs into a global hypothesis inventory

## Hypothesis families

The engine currently emits candidates for:

- supplier batch / material incidents
- process-window drift
- latent design / field-lag weaknesses
- handling / operator-order patterns
- noise and watchlist patterns

## Runtime files

- `src/lib/manex-hypothesis-case-clustering.ts`
  Main hypothesis engine orchestration, scoring, reconciliation, and read models.
- `src/lib/manex-hypothesis-case-clustering-state.ts`
  Separate persistence under `team_hyp_*` tables.
- `src/lib/manex-hypothesis-case-clustering-runtime.ts`
  In-memory stop/poll runtime state for article and batch execution.
- `src/prompts/manex-hypothesis-case-clustering.ts`
  Bounded narrative prompt used only after case formation.

## Persistence

The engine uses a separate namespace so it can coexist with the other two
pipelines:

- `team_hyp_case_run`
- `team_hyp_case_batch`
- `team_hyp_case_candidate`
- `team_hyp_case_candidate_member`

The shared Stage 1 dossier tables remain the same source foundation:

- `team_product_dossier`
- `team_article_dossier`

## UI integration

The new mode is exposed as a third toggle option on:

- `/articles`
- `/articles/[articleId]`
- `/products/[productId]`

Routes:

- `GET/POST /api/articles/[articleId]/cluster-hypothesis`
- `GET/POST/PATCH/DELETE /api/articles/cluster-all-hypothesis`

## Notes

- candidate formation is deterministic
- narrative generation is bounded per ranked case
- watchlists and noise stay explicit so they do not inflate active cases
- the engine is designed to surface explanation-friendly investigations, not
  maximize cluster count
