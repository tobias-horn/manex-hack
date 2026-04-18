# Manex Traceability Helpers

Prompt 6 adds the first deterministic traceability layer for installed parts and blast radius.

## Goal

This slice does not guess at root cause.
It makes the lineage itself easy to query and reuse:

- product to installed parts
- installed parts to supplier batch
- installed parts to BOM position
- suspect batch or part master back to related products

## Data model

The primary read surface remains `v_product_bom_parts`.

The app now enriches each installed-part row with:

- `articleId`
- `articleName`
- `orderId`
- `productBuiltAt`

That enrichment happens inside `src/lib/manex-data-access.ts`, so downstream features do not need ad hoc product or article lookups.

## Helper layer

The deterministic traceability shaping is now split in two layers:

- `src/lib/manex-traceability-evidence.ts`
  shared pure helpers for:
  - product-level trace evidence
  - assembly grouping
  - graph shaping
  - related-product grouping
  - compact anchor-level blast-radius hints
- `src/lib/manex-traceability.ts`
  runtime read helpers that consume the shared evidence layer

`src/lib/manex-traceability.ts` still exposes:

- `getProductTraceability(productId)`
- `getTraceabilityBlastRadius({ batchId?, batchNumber?, partNumber? })`
- `getTraceabilityWorkbench(filters)`

These helpers return both table-ready rows and graph-ready `nodes` / `edges`.

## UI surface

`src/app/traceability/page.tsx` is the first dedicated traceability screen.

It supports:

- tracing one product to its installed parts
- tracing one suspect batch or part back to related products
- grouping affected products into article tracks

The screen intentionally uses a light spec-grid treatment to keep the experience technical and investigation-oriented.

## Why this matters later

Later prompts can reuse the same deterministic chain for:

- blast-radius estimation
- RCA evidence assembly
- supplier incident workflows
- article-level clustering
- graph visualizations

Stage 1 dossier building now also reuses this shared traceability-evidence
module, so the case-clustering pipeline and the traceability UI no longer drift
apart on part/batch/BOM anchor logic.
