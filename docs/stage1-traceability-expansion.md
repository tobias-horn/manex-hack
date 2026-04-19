# Stage 1 Traceability Expansion

This note documents the Stage 1 traceability expansion added on 2026-04-19.

## Why

Stage 1 already computed strong deterministic traceability evidence, but most of
it was still exposed as hints rather than first-class structured outputs.

The goal of this pass was to make the most diagnostic traceability geometry
available directly inside each product dossier and the downstream Stage 2
cluster cards, without sending raw traceability payloads back into Stage 2.

## New Stage 1 traceability outputs

`src/lib/manex-traceability-evidence.ts` now emits these additional compact
structures inside `ProductTraceabilityEvidence`:

- `partBatchAnchors`
  Top combined `part_number@batch` anchors with supplier and BOM-position
  context.
- `traceabilityNeighborhood`
  Nearby products in the current article scope that share the strongest current
  anchors.
- `anchorSpecificity`
  Whether a given anchor is product-specific, a local cluster signal, or
  article-wide context that should be down-weighted.
- `cooccurringAnchorBundles`
  Repeated combined bundles like `part + batch + BOM position`.
- `blastRadiusSuspects`
  Compact suspect summaries derived from the widest traceability fan-out hints.

## Where they flow now

The new fields are available in three places:

1. Deterministic Stage 1 traceability evidence inside each product dossier:
   `thread.mechanismEvidence.traceabilityEvidence`
2. Trimmed Stage 1 prompt payloads sent to the product synthesis model
3. Trimmed Stage 2 product cluster cards used for article-local clustering

## What stayed compact

To avoid reopening the Stage 2 context-window problem:

- the persisted dossier keeps the compact structured outputs
- Stage 1 prompt payloads only get trimmed subsets
- Stage 2 cards only get trimmed subsets
- no new raw traceability arrays are shipped into Stage 2

## Schema and prompt version bumps

- prompt version: `2026-04-19.case-clustering.v8`
- product dossier schema: `manex.product_dossier.v4`
- article dossier schema: `manex.article_dossier.v4`

## Main code touchpoints

- `src/lib/manex-traceability-evidence.ts`
- `src/lib/manex-case-clustering.ts`
- `src/prompts/manex-case-clustering.ts`
