# Stage 2 Payload Rescue

Date: 2026-04-18

This note records the emergency Stage 2 payload reduction pass after we
confirmed that the context-window failures were caused by Stage 2 article-level
prompt shape, not Stage 1 product synthesis.

## Diagnosis

Stage 1 per-product prompts were relatively small. The failures came from Stage
2 draft clustering, where each prompt previously included:

- article summary context
- cross-product summaries
- full product threads
- full raw signal arrays
- defects, claims, tests, rework, actions
- installed parts
- evidence frames
- duplicated raw evidence appendix

That meant Stage 2 was paying multiple times for the same evidence.

## Emergency fix

Implemented in `src/lib/manex-case-clustering.ts` and
`src/prompts/manex-case-clustering.ts`.

### 1. Compact Stage 2 product cluster cards

Stage 2 proposal prompts now use compact per-product cards that keep:

- product identity and build-week context
- source counts
- claim-lag summary
- Stage 1 synthesis summary
- strongest mechanism/traceability/temporal/field/handling anchors
- confounders
- top summary-feature lists
- 5 diagnostic timeline events
- 2 short raw evidence snippets

Stage 2 no longer sends full product dossier arrays by default.

### 2. Remove duplicated raw evidence from Stage 2 proposal

Proposal pass no longer sends:

- full `signals`
- full `defects`
- full `claims`
- full `tests`
- full `rework`
- full `actions`
- full `installedParts`
- full `evidenceFrames`
- duplicated `rawEvidenceAppendix`

### 3. Split proposal from validation

Stage 2 now behaves as:

- Pass A: proposal from compact cluster cards only
- Pass B: review using compact cards plus a targeted validation evidence packet
  for a bounded set of high-priority, ambiguous, or otherwise important
  products

The validation packet is intentionally small and does not re-send the whole
article dossier.

### 4. Reduce chunk size

`MANEX_STAGE2_PRODUCT_CHUNK_SIZE`

- new default: `5`
- previous default: `12`

This is intentionally conservative.

### 5. Instrument model-call sizes

Before every Stage 1, Stage 2, and Stage 3 model call, logs now include:

- stage name
- article id
- chunk id when present
- total input chars
- rough token estimate
- selected product count
- configured output budget
- top-level payload section sizes

Log prefix:

- `[manex-clustering:model-call]`

## Measured prompt-size change

Reconstructed Stage 2 proposal prompt estimates on the previously failing
articles:

### Before

- `ART-00001`: largest Stage 2 chunk about `1,133,226` chars, about `283k`
  tokens
- `ART-00002`: largest Stage 2 chunk about `678,557` chars, about `170k`
  tokens
- `ART-00003`: largest Stage 2 chunk about `630,856` chars, about `158k`
  tokens

### After

Using compact cards and 5-product chunks:

- `ART-00001`: largest Stage 2 chunk about `318,210` chars, about `79.6k`
  tokens
- `ART-00002`: largest Stage 2 chunk about `178,954` chars, about `44.7k`
  tokens
- `ART-00003`: largest Stage 2 chunk about `179,789` chars, about `44.9k`
  tokens

This is roughly a 71% to 74% reduction in the heaviest Stage 2 proposal
payloads.

## Guardrails

- Do not reintroduce full dossier + raw appendix duplication into Stage 2.
- Keep Stage 1 product synthesis attempting the LLM call unless there are
  literally no signals to summarize.
- Prefer raising compact-card quality over re-expanding raw Stage 2 payloads.
