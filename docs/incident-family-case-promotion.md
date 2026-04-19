# Incident Family Case Promotion

## Problem

Some article runs completed with:

- `0 proposed cases`
- many `incidents`
- few or no `watchlists`

This meant Stage 2 was being too conservative. Repeated product-level incident families were staying stranded as isolated incidents even when they shared specific anchors such as:

- repeated reported part numbers
- repeated defect/test signatures
- repeated supplier batches
- repeated order-local process patterns

## Fix

`src/lib/manex-case-clustering.ts` now includes a deterministic promotion pass that:

1. inspects the Stage 2 incident set
2. measures anchor specificity within the article
3. links incidents that share specific, non-article-wide anchors
4. promotes those recurring incident families into real `cases`

The pass runs:

- after Stage 2 draft generation
- again after Stage 2 review generation

This means the review model can see promoted case digests, and the final reviewed output still gets a deterministic safety net if the model remains over-conservative.

## Guardrails

The promotion logic intentionally ignores broad article-wide anchors and requires multi-lane support. It prefers anchors like:

- reported part + defect/test signature
- reported part + supplier batch
- defect code + test signature
- order-local repeated process anchors

It avoids promoting families based only on broad BOM overlap or generic article-wide traceability.

## Expected Effect

Articles like `ART-00001` should stop collapsing obvious repeated incident families into:

- `0 proposed cases`
- many isolated incidents

and instead surface a smaller number of actual article-local proposed cases.
