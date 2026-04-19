# Article Hypothesis Viewer

Date: 2026-04-19

This note documents the article-level case viewer redesign that shifts the UI
from evidence-first browsing to a compact hypothesis-first investigation flow.

## Product intent

The global `/articles` screen remains the triage and intake layer for surfaced
article stories.

The article route `/articles/[articleId]` is now the investigation surface for
comparing a few competing hypotheses before opening raw proof.

The main interaction model is:

1. Open article
2. Compare up to three competing hypotheses
3. Open the evidence drawer for one hypothesis
4. Mark it `Leading`, `Plausible`, `Weak`, `Ruled out`, or `Confirmed`
5. Trigger the next action or rerun analysis

## Viewer structure

The article workspace now has four zones:

1. Case shell
   Calm summary with title, issue type, priority, affected scope, strongest
   shared signal, and one-line summary.
2. Competing hypotheses
   Maximum three cards in the main board. Each card shows:
   - why it fits
   - must be true
   - what weakens it
   - next decisive check
   - a small `Why not?` strip for the selected card
3. Evidence drawer
   Proof is kept out of the main flow and opened on demand:
   - one cleaned-up timeline stream
   - only the essential event metadata needed to follow the case arc
4. Closed-loop lane
   Existing action writeback stays on the page, but is now fed from the selected
   hypothesis instead of a broader evidence wall.

## 2026-04-19 layout tuning

The case-shell hero was tightened after the first UI pass:

- the summary text now runs the full available width instead of sharing the row
  with a CTA button
- the top-level `Review hypotheses` button was removed because the hypotheses
  board is already immediately below the hero
- the five metadata tiles were regrouped into a denser responsive layout so the
  long-form fields (`Strongest shared signal`, `Scope`) get wider cards and the
  short metrics stay compact

The evidence drawer was also simplified later the same day:

- the stacked sections for evidence spine, related products, images, and notes
  were removed from the main drawer view
- the drawer now renders as one cleaner vertical timeline so operators can scan
  chronology without opening nested panels

## Normalization layer

`src/lib/article-hypothesis-view.ts` converts all article pipelines into one UI
shape:

- classic clustering
- deterministic grouping
- hypothesis engine
- statistical investigate mode
- seeded dummy mode

This keeps the route cohesive even though each engine persists slightly
different payloads.

## Operator review state

The new app-owned table is:

- `team_hypothesis_review`

It stores operator judgment per article, candidate, and pipeline mode with the
status values:

- `leading`
- `plausible`
- `weak`
- `ruled_out`
- `confirmed`

Files:

- `src/lib/article-hypothesis-review-state.ts`
  Persistence helpers and schema bootstrap.
- `src/app/api/articles/[articleId]/hypotheses/[candidateId]/review/route.ts`
  Patch endpoint for updating operator judgment.

This is intentionally separate from the clustering candidate tables so the UI
can add review state without mutating the generated candidate payloads.

## Main UI files

- `src/app/articles/[articleId]/page.tsx`
  Server route that loads the article caseboard, review state, and runner props.
- `src/components/article-hypothesis-board.tsx`
  Client component for the case shell, comparison cards, evidence drawer, and
  action lane.
- `src/app/articles/page.tsx`
  Global entry copy updated so the flow reads as “review hypotheses” instead of
  just “open article”.

## Verification

- `npm run lint -- 'src/app/articles/[articleId]/page.tsx' src/components/article-hypothesis-board.tsx src/lib/article-hypothesis-view.ts src/lib/article-hypothesis-review-state.ts 'src/app/api/articles/[articleId]/hypotheses/[candidateId]/review/route.ts' src/app/articles/page.tsx`
- `npm run build`
