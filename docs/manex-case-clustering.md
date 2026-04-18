# Manex Case Clustering

Prompt 11 adds the first article-level clustering engine on top of the existing
signal inbox, traceability helpers, dossier view, and case-state layer.

## What this adds

- an article dashboard at `src/app/articles/page.tsx`
- an article caseboard at `src/app/articles/[articleId]/page.tsx`
- a clustering trigger route at `src/app/api/articles/[articleId]/cluster/route.ts`
- a deterministic dossier builder and LLM orchestration layer in
  `src/lib/manex-case-clustering.ts`
- persisted clustering state in `src/lib/manex-case-clustering-state.ts`

## High-level flow

1. static article filter
2. deterministic product-thread dossier build
3. deterministic article dossier build
4. GPT case proposal pass
5. GPT review/refinement pass
6. persist proposed candidates for human review

The model is not asked to inspect raw SQL rows directly.
Instead, it receives a structured dossier:

- article overview and summary metrics
- product threads with ordered signals, parts, tests, rework, and actions
- cross-product trace summaries
- compact raw evidence appendix

## Persisted schema

The clustering layer owns these app-specific objects:

- `team_signal_inbox`
  Unified read view for defects, field claims, bad tests, and marginal tests.
- `team_product_dossier`
  One deterministic dossier payload per product.
- `team_article_dossier`
  One deterministic dossier payload per article.
- `team_case_run`
  Audit log for clustering runs, prompt/schema versions, and run status.
- `team_case_candidate`
  Persisted proposed case clusters.
- `team_case_candidate_member`
  Links proposed candidates back to products and signal IDs.

## Dossier contract

Current schema versions:

- article dossier: `manex.article_dossier.v1`
- product dossier: `manex.product_dossier.v1`
- case proposal set: `manex.case_proposal_set.v1`

The article dossier includes:

- article metadata and counts
- top defect codes, parts, BOM positions, sections, batches, and orders
- field-claim-only and test-hotspot summaries
- cross-product link summaries
- full product threads
- raw evidence appendix

Each product dossier includes:

- metadata like product, article, build, and order
- ordered signal timeline
- defects, claims, tests, rework, and actions
- installed parts with batch and supplier context
- weekly quality snippets
- evidence frames
- traceability snapshot
- summary features for later clustering and RCA

## LLM behavior

The clustering pass is intentionally constrained:

- it proposes case candidates, not final RCA conclusions
- it may leave products unassigned
- it keeps cosmetic, service, false-positive, process, supplier, and likely
  functional clusters separate when the evidence supports it
- it returns strict JSON so the output is persistable and forward-compatible

Chunking is built in for larger article families:

- pass A proposes cases per chunk of product threads
- pass B reviews and refines the combined draft proposals

## UI expectations

- `/articles` is the dashboard entry point
- `/articles/[articleId]` shows the current dossier-backed proposed cases
- `/products/[productId]` now surfaces proposed case membership for that product

## Notes for later stages

- promotion from `team_case_candidate` into the human-owned `cases` workflow can
  be added later without changing the clustering contract
- the persisted run and dossier tables are meant to support later reviewer flows,
  LLM explanations, and case acceptance/rejection state
- the prompt payload is intentionally more compact than the persisted dossier so
  the demo remains responsive while the stored evidence stays complete
