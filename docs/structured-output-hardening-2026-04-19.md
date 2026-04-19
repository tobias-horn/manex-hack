# Structured Output Hardening

Date: 2026-04-19

This note records the root-cause fix for intermittent JSON parse failures such
as:

- `Expected ',' or ']' after array element in JSON ...`

## Root cause

The failure was not article-specific. It came from the structured-output
fallback boundary itself.

Before this change:

- the classic three-stage pipeline retried `generateObject(...)`
- if the SDK reported a parse failure, it fell back to `generateText(...)`
- that text fallback then used a naive extractor that sliced from the first
  `{` or `[` to the last `}` or `]`

That meant one malformed bracket sequence, trailing prose block, or partial JSON
array could still bubble up as a raw `JSON.parse(...)` failure even after the
pipeline had already entered its "repair" path.

The deterministic and hypothesis pipelines were also weaker than the classic
pipeline because they relied on `generateObject(...)` directly and did not share
the classic repair fallback.

## Fix

Implemented in `src/lib/openai-resilience.ts`.

### 1. Shared balanced JSON extraction

- model text is now sanitized first
- we attempt to parse the full payload directly
- if that fails, we scan for the first balanced JSON object or array while
  respecting quoted strings and escape sequences
- we no longer assume "first bracket" to "last bracket" is safe

### 2. Shared structured-output repair helper

All clustering executions that expect structured JSON now use
`generateStructuredObjectWithRepair(...)`:

- `src/lib/manex-case-clustering.ts`
- `src/lib/manex-deterministic-case-clustering.ts`
- `src/lib/manex-hypothesis-case-clustering.ts`

Behavior:

- attempt `generateObject(...)`
- on structured parse failure, fall back to `generateText(...)`
- parse the repair output with the balanced JSON extractor
- if the repair output is still invalid, retry with the invalid JSON included in
  the next repair prompt
- preserve abort behavior and retry with exponential backoff

### 3. Shared request pacing

All OpenAI requests that go through the new helper now share one in-process
request gate. The default is:

- `MANEX_OPENAI_REQUESTS_PER_MINUTE=5000`

This does not reduce concurrency to one worker. It only spaces request starts so
bursty article and product fan-out does not exceed the available account RPM in
one process.

The `investigate` route now uses the same pacing and balanced JSON parser for
its free-text JSON response.

## Why this should not recur

The same brittle parsing boundary used to exist in multiple execution paths.
Now:

- all clustering pipelines share one repair implementation
- malformed repair JSON no longer fails because of naive bracket slicing
- bursts across concurrent runs are smoothed against the shared 5000 RPM budget

If a model response is truly unrecoverable, the error should now surface as a
structured helper failure rather than a raw low-level JSON parse exception.
