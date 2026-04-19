# Prompt Registry

This folder is the shared prompt registry for both runtime prompts used by the
app and non-runtime prompts that document repeatable repository workflows.

## Prompt categories

- Runtime prompts
  Imported by routes, services, or orchestration code that runs in the product.
- Non-runtime prompts
  Reference prompts for implementation, refactor, or team workflows that should
  stay versioned with the repo even when they are not executed by the app.

## Current prompt files

- `manex-case-clustering.ts`
  Runtime prompts for the multi-stage case clustering pipeline.
- `manex-deterministic-case-clustering.ts`
  Runtime prompts for the bounded deterministic clustering pipeline that uses
  small per-product issue extraction instead of article-wide clustering prompts.
- `manex-copilot.ts`
  Runtime copilot system prompt and user prompt wrapper.
- `manex-implementation-refactor.ts`
  Non-runtime implementation/refactor prompt captured from the latest task
  request so future contributors and LLMs can reuse the same working contract,
  including the tracer-to-evidence-module refactor guidance.

## Organization rules

- Keep one prompt domain per file, named `manex-<domain>.ts`.
- Export prompt constants or builder functions from this folder instead of
  keeping long prompt text inline in routes, orchestration files, or ad hoc
  task notes.
- Add a prompt version constant when reproducibility matters, especially for
  prompts that affect persisted outputs or evaluation results.
- Treat this README as the discovery layer for prompt intent, ownership, and
  runtime versus non-runtime usage.
