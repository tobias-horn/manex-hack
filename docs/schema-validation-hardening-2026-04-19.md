# Schema Validation Hardening (2026-04-19)

## Root Cause

`generateStructuredObjectWithRepair(...)` in `src/lib/openai-resilience.ts` handled malformed JSON and malformed Unicode, but it did **not** treat schema-validation failures as recoverable structured-output errors.

That left a gap for responses that were valid JSON but the wrong shape, for example:

```json
[
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [],
    "message": "Invalid input: expected object, received array"
  }
]
```

In that case the SDK/Zod layer could throw a root-level `ZodError`, and the pipeline would surface the raw issue array string instead of:

1. classifying it as a repairable structured-output failure
2. retrying through the text-repair path
3. normalizing the final error message if retries still fail

## Fix

`src/lib/openai-resilience.ts` now:

- treats `z.ZodError` schema mismatches as structured-output repair candidates
- includes schema-validation summaries in repair prompts
- retries schema-shape failures through the same repair loop as parse failures
- wraps exhausted schema failures in a readable error instead of leaking the raw Zod issues array

## Extra Stabilization

While validating the fix, `src/lib/manex-case-clustering.ts` still had intermediate refactor drift:

- missing `uniqueBy(...)`
- fallback Stage 1 synthesis no longer matched the expanded schema
- deterministic incident-promotion output still used the pre-family case shape

Those mismatches were repaired so the project typechecks again.

## Verification

- `npx tsc --pretty false --noEmit`
- `npx eslint src/lib/openai-resilience.ts src/lib/manex-case-clustering.ts`
- targeted smoke check with `schema.parse([])` confirmed `isStructuredParseError(...) === true` for the exact `expected object, received array` failure shape
