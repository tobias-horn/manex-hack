# Classic Clustering Context Trim

Date: 2026-04-19

This note records the investigation into why the classic three-stage clustering
pipeline was so expensive and prompt-heavy, plus the payload changes used to
bring it back under control.

## What we found

The problem was not Stage 1. The main cost explosion came from Stage 2, with a
secondary problem in Stage 3.

### Stage 2 before the trim

Manual probe target:

- article: `ART-00001`
- product count: `170`
- signal count: `325`

Measured with the existing Stage 2 payload builder before trimming:

- single-pass Stage 2 proposal prompt: about `8,874,266` chars, about
  `2.22M` tokens
- article context alone: about `75,519` chars, about `18.9k` tokens
- heaviest single product card: about `55,927` chars, about `14.0k` tokens

That made chunk planning collapse into the worst possible behavior:

- `170` chunks for `170` products
- every chunk had exactly `1` product
- the heaviest one-product Stage 2 draft prompt was about `134,277` chars,
  about `33.6k` tokens

So the pipeline was paying article-level context cost over and over again just
to classify one product at a time.

### Why the Stage 2 prompt was so large

Two payload areas dominated the prompt:

1. `articleContext`
2. `traceabilityAnchors` inside every `productClusterCard`

#### `articleContext` before

- `articleSummary`: about `35,930` chars
- `crossProductSummaries`: about `39,308` chars

These summary blocks were supposed to be compact, but they still carried large
`productIds` and `signalIds` arrays in almost every entry.

#### `traceabilityAnchors` before

Inside the heaviest product card, `traceabilityAnchors` alone was about
`46,553` chars, about `11.6k` tokens.

The biggest offenders were:

- `dominantInstalledParts`
- `dominantBomPositions`
- `dominantSupplierBatches`
- `dominantSuppliers`
- `batchConcentrationHints`

These looked innocent in code, but each item still contained long `productIds`
lists, so the same identifiers were repeated many times inside a single product
card.

### Manual model slice before

We manually ran one real Stage 2 draft call on the heaviest old one-product
chunk.

Input:

- chunk: `169 / 170`
- selected products: `1`
- prompt size: about `33.6k` tokens

Output slice:

- review summary said this was a single-product mixed thread, not a
  multi-product case
- result contained one incident and one noise item

So the system was spending a very large prompt budget to make a mostly local
classification.

## Payload changes

Implemented in `src/lib/manex-case-clustering.ts`.

### Stage 2 article context

The article-level context now keeps only compact rows such as:

- value
- count
- product count

It no longer sends large `productIds` or `signalIds` arrays in the Stage 2
prompt summaries.

### Stage 2 product cluster cards

The product cards were tightened heavily:

- removed repeated `articleId` and `articleName`
- shortened Stage 1 summary slices
- shortened timeline and hint lists
- replaced huge traceability objects with compact summaries
- removed repeated `productIds` from traceability anchor rows
- converted neighborhood and specificity detail into short hints
- compressed batch concentration hints into small summaries

The key design rule is:

- preserve clustering signal
- stop repeating identity lists that the LLM does not need for Stage 2 grouping

### Stage 3 summaries

Stage 3 was not the main cost center, but it still carried too much identifier
detail in summary lanes. We compacted:

- article summary rows
- detection / occurrence distributions
- test band summaries
- false-positive / marginal pools
- volume-by-week horizon

The candidate-level evidence stayed intact.

## Measured impact

Same manual probe target after the trim:

- article: `ART-00001`

### Stage 2 after the trim

- single-pass Stage 2 proposal prompt: about `1,301,826` chars, about
  `325k` tokens
- article context: about `4,599` chars, about `1.15k` tokens
- heaviest product card: about `10,463` chars, about `2.6k` tokens

Most importantly, chunking recovered:

- `34` chunks instead of `170`
- each chunk now has `5` products
- heaviest chunk prompt: about `56,391` chars, about `14.1k` tokens

### Stage 2 review after the trim

- Stage 2 review prompt dropped from about `75.0k` tokens to about `15.6k`
  tokens on the same article snapshot

### Stage 3 after the trim

- Stage 3 prompt dropped from about `21.3k` tokens to about `8.2k` tokens on
  the current two-article completed-run snapshot

## Manual model slice after

We manually ran one real post-trim Stage 2 draft call on the heaviest revised
chunk.

Input:

- chunk: `25 / 34`
- selected products: `5`
- prompt size: about `14.1k` tokens

Output slice:

- one clear 4-product case:
  `C12 / PM-00008 solder-cold cluster`
- one isolated incident:
  cosmetic label misalignment with unrelated firmware rework

That is the exact kind of output we want:

- more products per call
- much smaller prompt
- still enough fidelity to separate a true shared case from an isolated thread

## Why this should reduce cost materially

Before the trim, `ART-00001` forced `170` Stage 2 draft calls, each paying a
huge repeated article-context tax.

After the trim, the same article needs only `34` Stage 2 draft calls, and each
call is much smaller.

That should reduce classic-pipeline cost and runtime mainly through:

1. fewer Stage 2 draft calls
2. much smaller Stage 2 review prompt
3. smaller Stage 3 reconciliation prompt

## Next likely wins

If we want to reduce cost further without changing the clustering contract:

1. Lower Stage 2 review evidence fan-out a little more once we have confidence
   that `5` products is enough for review.
2. Revisit Stage 2 output token budgets now that the inputs are smaller.
3. Split the classic clustering file into smaller modules so payload shaping is
   easier to reason about and tune without touching orchestration logic.
