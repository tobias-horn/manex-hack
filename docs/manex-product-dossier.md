# Manex Single Product Dossier

Prompt 9 adds the first integrated product screen at `src/app/products/[productId]/page.tsx`.

## Purpose

This page proves the whole data spine works together for one product:

- defects
- field claims
- installed parts with batch and supplier context
- relevant evidence images
- weekly quality summary snippets
- write-back into `product_action`

## Data shape

The screen does not query tables inside components.

Instead it uses `src/lib/manex-product-dossier.ts`, which composes the existing
domain-oriented services:

- `investigation.findDefectsForProduct(...)`
- `investigation.findClaims({ productId })`
- `investigation.findTestSignalsForProduct(...)`
- `traceability.findInstalledPartsForProduct(...)` through `getProductTraceability(...)`
- `quality.findWeeklySummariesForArticle(...)`
- `workflow.findActionsForProduct(...)`

## Why this matters

This is the first screen that feels like a usable product instead of a set of
separate technical proofs.

It is still intentionally factual:

- no AI conclusions
- no hidden joins in UI code
- no case clustering yet

That keeps it safe as the seed for the future caseboard.
