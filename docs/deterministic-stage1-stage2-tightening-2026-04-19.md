# Deterministic Stage 1 + Stage 2 Tightening

Date: 2026-04-19

This note captures the first quality-focused tightening pass on the deterministic clustering pipeline in `/src/lib/manex-deterministic-case-clustering.ts`.

## What changed

- Stage 1 issue extraction now carries a compact `normalizedClues` block into the LLM payload instead of relying mainly on narrative summary text.
- Deterministic issue cards now get a derived local `profile` in code after extraction. The profile normalizes:
  - claim-only behavior
  - prior factory defect presence
  - claim lag bucket
  - dominant part, BOM, supplier batch, supplier name
  - dominant occurrence and detected sections
  - dominant order and rework user
  - dominant defect code and test key
  - low-severity, cosmetic, service, false-positive, marginal-only, detection-bias, near-limit, and low-volume risk flags
  - a coarse `testOutcomeProfile`
- Stage 2 article grouping now scores for concentrated signatures instead of broad overlap:
  - `supplier_material`
  - `process_window`
  - `latent_field`
  - `handling_cosmetic`
- Broad anchors like BOM-only overlap, occurrence-only overlap without temporal support, and order overlap without a handling pattern are now explicitly penalized.
- Cluster titles, summaries, and fingerprint tokens now reflect the dominant signature so the grouped output is more legible.

## Intended effect

- Better recall on delayed field-claim stories defined partly by missing prior factory defects.
- Better precision on supplier/process clusters by requiring combined structure instead of single broad anchor matches.
- Better separation between real recurring cases and handling/watchlist/noise patterns.

## Current limitations

- Noise aggregation and stricter cross-article merge rules are still separate follow-up steps.
- The global merge layer still uses its earlier candidate-pair logic, though the richer local fingerprints are now available to support a stricter next pass.
