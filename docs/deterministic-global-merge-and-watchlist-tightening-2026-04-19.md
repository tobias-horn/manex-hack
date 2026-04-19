# Deterministic Global Merge And Watchlist Tightening

This note documents the follow-up deterministic clustering pass added on
2026-04-19 after the first neighbor-scoring upgrade.

## Main fixes

### 1. Article-local cases now need a clear lane winner

Before a deterministic article-local candidate becomes a case, the pipeline now
aggregates separate component-level scores for:

- material / traceability
- process / temporal
- latent field
- handling / operational

The winning lane must beat the runner-up by `MANEX_DET_CASE_LANE_MARGIN`
(default `5`). If the lane race stays ambiguous, the candidate is downgraded to
watchlist or incident instead of being finalized as a case.

This directly prevents broad supplier anchors from winning too early when the
same cluster also carries meaningful process, latent-field, or handling
evidence.

### 1. Broad-anchor global validation is now blocked

Cross-article validation no longer happens from broad overlap alone.

Global merges now require:

- same dominant mechanism lane
- plus one strong structural basis:
  - material / traceability: shared part+batch plus bundle/part/batch support
  - process / temporal: shared occurrence section plus overlapping time window
  - latent field: shared claim lag plus repeated part/BOM/family support
  - handling / operational: shared order or rework user plus handling family support

This specifically prevents bad global merges such as a generic position-led case
being validated across articles.

### 2. Material cases now require closure evidence

Material / traceability cases no longer validate from anchor concentration
alone.

They now need:

- concentrated part+batch anchors
- plus bundle / neighborhood support
- plus closure evidence from recurring defect/test behavior or lagged
  claim-pattern support

So a batch anchor by itself is not enough anymore. The cluster needs some
observable behavior around that anchor.

### 3. Process and latent lanes are stricter

Process / temporal candidates now need:

- repeated occurrence-section evidence
- a tight time-window structure
- supporting fail / defect / test / rework behavior

Latent-field candidates now need:

- claim-only threads
- no prior factory defect
- medium or long lag
- recurring reported part or BOM anchors

This makes the deterministic scorer preserve the intended absence-plus-lag
pattern instead of hoping Stage 3 recovers it later.

### 4. Real watchlists are restored

The deterministic local stage now treats these as watchlist-like rather than
forcing them into incidents or noise:

- latent-field claim-only / no-prior-defect / lag threads
- low-severity handling / operational patterns
- marginal or near-limit early-warning threads that still have real structure

### 5. Hotspot noise is narrower

Detection-bias and marginal-only noise now require the absence of stronger
structural evidence. If a thread has real occurrence-section, traceability,
claim-lag, or handling concentration evidence, it no longer falls into hotspot
noise by default.

### 6. Labels are more mechanism-led

Cluster titles now prefer:

- supplier-batch / part+batch labels
- occurrence-section + week-window labels
- claim-only latent drift labels
- order / rework-user handling labels

instead of broad position-led names.

### 7. Benchmark-style coverage notes are emitted

The deterministic local inventory now adds benchmark-oriented coverage notes to
`globalObservations`, so each run reports whether it surfaced:

- a material / traceability object
- a process / temporal object
- a latent field object
- a handling / operational object

These are evaluation notes, not hardcoded outputs.

## Verification

- `npx eslint src/lib/manex-deterministic-case-clustering.ts src/prompts/manex-deterministic-case-clustering.ts`
- `npx tsc --noEmit`
