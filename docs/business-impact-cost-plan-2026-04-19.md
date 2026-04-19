# Business Impact Plan

Date: 2026-04-19

## Why this note exists

The hackathon judges explicitly score **Business Impact** as:

- plausible reduction of time-to-resolution
- real value for the factory floor

This repo already has strong clustering and investigation logic, but the
economic signal is only used explicitly in the separate `manex-investigate`
pipeline. The main dossier, deterministic, and hypothesis flows still reason
mostly from counts, anchors, and confidence.

This note summarizes:

- what the challenge expects
- what the data actually contains
- what `cost` appears to mean in practice
- the best feature additions to make business impact visible without forcing it

## External challenge understanding

The upstream challenge is not only about finding the four hidden stories. It is
about building an interactive quality co-pilot that:

- analyzes structured manufacturing data
- gives a strong visual understanding of symptom -> cause
- turns findings into tracked actions and workflow

The upstream docs also make it clear that:

- there are four explicit root-cause stories plus deliberate noise
- the solution should help engineers and managers identify which story applies
- the solution should help draft quality reports and track actions

## Current local repo understanding

This app is already much more than a smoke-test shell. The current repo is a
Next.js quality investigation workspace with:

- a product dossier
- an inbox
- article-level clustering
- deterministic clustering
- hypothesis clustering
- an investigation route that already does cost-aware SQL rollups

The core architecture is:

- source-of-truth manufacturing data from views and seed tables
- app-owned dossier / run / candidate persistence
- multiple article-level investigation pipelines that produce candidate cases

## Important schema facts

The local schema docs show that `cost` exists directly on:

- `defect`
- `field_claim`
- `rework`

The views also expose cost-bearing rollups:

- `v_defect_detail` includes `cost`
- `v_field_claim_detail` includes `cost`
- `v_quality_summary` includes `defect_cost_sum` and `claim_cost_sum`

## What `cost` seems to mean

From the upstream seed generator, `cost` is not random decoration. It is used
to represent different economic burden depending on where the failure appears:

- factory defects are relatively cheap
- rework adds separate labor / correction cost
- field claims are much more expensive than factory defects

That means `cost` can be used as a grounded proxy for business pain, especially
when combined with:

- claim lag
- open workflow status
- recurring batch / order / section patterns

## Current gap in this repo

The data layer currently exposes:

- weekly defect and claim cost in `ManexWeeklyQualitySummary`
- rework cost in `ManexReworkRecord`

But it does **not** expose `cost` on:

- `ManexDefect`
- `ManexFieldClaim`

So the main product dossier and the main clustering pipelines cannot easily
carry forward direct unit-level defect / claim cost even though the schema has
it.

At the same time:

- `src/lib/manex-investigate.ts` already aggregates `defect_cost`,
  `rework_cost`, `claim_cost`, and `total_cost`
- the main product page shows counts and open actions, but not economic impact
- the hypothesis scoring model has an `impact` dimension, but it is currently
  count-based rather than cost-based

## Recommendation

Do **not** turn business impact into a hard gate that suppresses lower-cost but
important issues.

Instead:

- make business impact a first-class explanatory signal
- use it to rank, summarize, and recommend next actions
- keep case detection primarily evidence-led

## Ranked feature ideas

### 1. Case Impact Summary

Best hackathon option.

For each product, article case, and global candidate, compute:

- observed defect cost
- observed rework cost
- observed field-claim cost
- total observed cost
- cost per affected product
- field-share of total cost

Why it adds value:

- immediately explains why a case matters
- ties clustering output to business language
- strengthens judge-facing narrative without changing root-cause logic too much

Where to add:

- `src/lib/manex-data-access.ts`
  add `cost` to `ManexDefect` and `ManexFieldClaim`
- `src/lib/manex-case-clustering.ts`
  add `impactSummary` / `costSummary` to `ClusteredProductDossier`
- `src/lib/manex-case-clustering.ts`
  include compact impact fields in `toStage2ProductClusterCard(...)`
- `src/lib/manex-deterministic-case-clustering.ts`
  include the same summary in `buildIssueExtractionPayload(...)`
- `src/lib/manex-hypothesis-case-clustering.ts`
  add cost-aware features to `ThreadFacts`
- `src/app/products/[productId]/page.tsx`
  add visible cost cards and defect/claim cost chips
- `src/app/articles/page.tsx` and `src/app/articles/[articleId]/page.tsx`
  show total case cost and cost mix

### 2. Time-to-Resolution Risk Panel

Strong fit for the judging criterion because it speaks directly to TTR.

For each case, show:

- open action count
- oldest open action age
- whether cost is still accumulating through claims
- whether the issue is now claim-led rather than factory-led
- a simple urgency label like `contain now`, `investigate now`, `monitor`

Why it adds value:

- frames the system as a workflow accelerator, not just an analytics toy
- connects root-cause confidence with operational urgency

Where to add:

- `src/lib/manex-case-clustering.ts`
  derive action aging and unresolved-risk summaries per product / case
- `src/lib/manex-deterministic-case-clustering-state.ts`
  optionally persist derived urgency fields in candidate payload
- `src/components/action-workbench.tsx`
  surface the recommended next step with economic rationale
- `src/components/article-hypothesis-board.tsx`
  show risk / urgency next to priority

### 3. Economic Blast Radius View

Very judge-friendly and visually strong.

For anchors like supplier batch, BOM position, occurrence section, order, or
rework user, show:

- affected products
- defect count
- claim count
- total cost
- field-cost share
- likely containment leverage

Why it adds value:

- turns traceability into a business decision surface
- makes supplier and design stories especially compelling

Where to add:

- `src/lib/manex-case-clustering.ts`
  derive cost-bearing anchor summaries from installed parts + defects + claims +
  rework
- `src/lib/manex-product-dossier.ts`
  expose a small blast-radius summary for the product page
- `src/app/articles/[articleId]/page.tsx`
  add a case-level anchor economics panel
- `src/app/traceability/page.tsx`
  optionally add a dedicated economics lane

### 4. Savings If Contained Earlier

Best “wow” feature, but slightly more inferential.

Estimate a conservative savings opportunity such as:

- if this supplier batch had been quarantined after the first 3 defects
- if this process window had triggered a calibration alert one week earlier
- if claim-only design leakage had created an engineering watchlist earlier

Why it adds value:

- directly addresses business impact in management language
- creates a crisp before/after story for the demo

How to keep it honest:

- label it as an estimate
- use simple conservative heuristics
- base it only on already-observed downstream cost

Where to add:

- `src/lib/manex-case-clustering.ts`
  derive a `potentialAvoidableCost` estimate at case level
- `src/lib/manex-investigate.ts`
  optional reuse in the statistical route
- case / article UI pages
  show it as “avoidable downstream cost estimate”

## Recommended implementation order

### Phase 1

- extend data-access types to carry defect and claim cost
- add product-level `costSummary`
- add cost chips / cards in the product and article UIs

### Phase 2

- pass compact cost summaries into Stage 2 and deterministic issue extraction
- add cost-aware but non-blocking ranking adjustments

### Phase 3

- add TTR risk and avoidable-cost estimates

## Suggested scoring philosophy

Use business impact as:

- a rank booster
- a summary explainer
- an action recommender

Do **not** use it as:

- the only reason a case survives
- a replacement for evidence quality
- a way to hide lower-cost but structurally important issues

## Best single feature for the hackathon

If only one thing gets built, it should be:

- a visible **Impact Summary + TTR Risk** layer on top of existing cases

That is the smallest change with the clearest demo value:

- judges immediately see business relevance
- engineers still trust the evidence trail
- the app becomes a decision-support tool, not just a clustering demo
