# Classic Family Prior Alignment (2026-04-19)

## Why this pass exists

The challenge repo makes the benchmark shape explicit:

- supplier/material story
- process-window story
- latent design-escape story
- operator/handling story

The classic pipeline already had deterministic heuristics for these families,
but those heuristics were mostly trapped in internal helper functions.
Stage 2 still asked the model to infer too much from compact product cards
without seeing the best deterministic family priors directly.

This pass fixes that mismatch without hardcoding the four planted stories.

## Challenge repo observations

Source repo examined:

- `/tmp/Thinc-Hackathon-2026-Manex/README.md`
- `/tmp/Thinc-Hackathon-2026-Manex/docs/DATA_PATTERNS.md`
- `/tmp/Thinc-Hackathon-2026-Manex/docs/SCHEMA.md`
- `/tmp/Thinc-Hackathon-2026-Manex/data-generation/generate.py`

Important takeaway:

- the benchmark is about pattern families, not exact identifiers
- the live seed can differ from the prose examples by identifier offset
- for example, the supplier-material shape in the live data currently surfaces
  as the same kind of `PM-00008 / C12 / ElektroParts` story, but the dominant
  batch id in the live dataset is not guaranteed to match the markdown handout

That means hardcoding `SB-00007`, `R33`, `user_042`, or similar labels into the
classic pipeline would be the wrong fix. The right fix is to make the pipeline
rank discriminative patterns better.

## Implemented changes

### 1. Persist and hydrate deterministic family hints

Each product thread now carries deterministic `hypothesisSignals` all the way
into the classic dossier used by Stage 2. These hints were already derivable
from the evidence model; they are now surfaced consistently instead of staying
implicit.

### 2. Surface compact candidate-family priors in Stage 2

`articleContext` now includes a compact `candidateFamilies` digest with:

- family
- dominant anchor
- intended disposition
- required evidence present / missing
- competing families
- lift
- background prevalence penalty
- concentration and claim-only ratios

This gives Pass A and Pass B the discriminative math directly, instead of
making the model reconstruct it from scattered product cards.

### 3. Keep Stage 2 chunking closer to mechanism families

Chunk planning now prioritizes products that participate in the same candidate
family or strongest family vote, so chunked Stage 2 is less likely to split one
story across unrelated product slices.

### 4. Trim lower-value Stage 2 card detail

To avoid growing prompt size unnecessarily, the Stage 2 product cards now trim:

- some Stage 1 open questions / noise flags
- several traceability-neighborhood and bundle fields
- some claim-lag detail

The new deterministic family priors replace noisier card detail rather than
simply piling more context on top.

## Expected effect

This should help the classic pipeline recover the seeded stories more
reliably by:

- penalizing broad, article-wide anchors
- promoting claim-only long-lag design escapes
- keeping process-window stories centered on occurrence section plus timing
- preserving operator/order/user concentration patterns as their own family

The change is intentionally small in architecture terms:

- no new paid model stage
- no hardcoded benchmark ids
- no dependency on the challenge repo at runtime
- no schema change to the proposal output contract
