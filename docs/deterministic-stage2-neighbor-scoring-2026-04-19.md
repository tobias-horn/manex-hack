# Deterministic Stage 2 Neighbor Scoring

This note documents the deterministic Stage 2 upgrade added on 2026-04-19 in
`src/lib/manex-deterministic-case-clustering.ts`.

## Goal

Move Stage 2 away from broad overlap heuristics and toward deterministic
neighbor-and-scoring logic built on the richer Stage 1 evidence lanes.

## Main changes

### 1. `issueFingerprint` on every deterministic issue card

Each extracted issue now carries a deterministic fingerprint with:

- dominant mechanism lane
- lane support scores
- diagnostic, local-cluster, and article-wide anchor tokens
- part+batch anchors
- co-occurring anchor bundles
- traceability neighborhood products and shared anchor values
- blast-radius anchor values
- repeated part / BOM / supplier / occurrence / order / rework anchors
- family keys for later watchlist/noise aggregation

### 2. Mechanism-lane routing

Each issue is routed into one dominant lane:

- `material_traceability`
- `process_temporal`
- `latent_field`
- `handling_operational`
- `noise_confounder`

Stage 2 pair scoring now prefers same-lane comparisons and only allows
cross-lane comparisons when there is strong traceability evidence such as shared
part+batch anchors or shared co-occurring bundles.

### 3. Deterministic neighbor graph

Pair edges are now only created when there is a concrete structural reason:

- concentrated part+batch / bundle evidence
- occurrence section plus overlapping factory window plus repeated fail signals
- claim-only / no-prior-defect / lag-based latent field evidence
- order / rework-user handling concentration
- shared diagnostic anchors with neighborhood support

Broad-only anchors are no longer enough to start a case edge.

### 4. Concentration-first scoring

Stage 2 scoring now rewards:

- shared part+batch anchors
- shared co-occurring bundles
- mutual traceability-neighborhood support
- same-lane structural signatures
- shared occurrence section with overlapping window
- shared lag bucket for latent field threads
- order / rework-user concentration for handling patterns

It now penalizes:

- article-wide / broad-only anchors
- detected-section-only similarity
- BOM-position-only overlap
- noisy / detection-biased / marginal-only threads
- weak cross-lane merges

### 5. Watchlist and noise family aggregation

Weak singleton objects are no longer left as one row per issue by default.
Instead they are grouped into deterministic families such as:

- handling families
- latent field watchlist families
- service/documentation families
- false-positive families
- marginal-only screening families
- detected-section hotspot families
- low-volume noise families

This reduces UI clutter while preserving signal.

## Prompt version

The deterministic issue-extraction prompt version was bumped to:

- `2026-04-19.det-case-clustering.v3`

The extractor now also sees the new Stage 1 traceability structures in compact
form:

- `partBatchAnchors`
- `anchorSpecificity`
- `traceabilityNeighborhood`
- `cooccurringAnchorBundles`
- `blastRadiusSuspects`

## Verification

Verified with:

- `npx eslint src/lib/manex-deterministic-case-clustering.ts src/prompts/manex-deterministic-case-clustering.ts`
- `npx tsc --noEmit`
