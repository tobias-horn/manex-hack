# Unicode Escape Hardening

Date: 2026-04-19

## Symptom

Classic three-stage clustering could fail with:

- `unsupported Unicode escape sequence`

The failure surfaced as a hard pipeline error for article runs like `ART-00001`.

## Root Cause

We had already hardened prompt serialization and JSONB writes against broken UTF-16 surrogate pairs, but one gap remained:

- malformed JSON escape sequences from model output, especially bad `\u...` escapes, could still reach structured-output parsing
- when the SDK/parser threw `unsupported Unicode escape sequence`, our structured-output recovery logic did **not** classify it as a recoverable parse error
- that meant the run could fail before the text-repair fallback had any chance to repair the response into valid JSON

This was a different failure class from "bad Unicode characters in strings". It was a "bad JSON escape syntax" problem.

## Fix

Centralized the repair in `src/lib/json-unicode.ts` and routed all shared parsing through it:

- `repairJsonTextForParse(...)`
  - repairs malformed JSON string escapes before parsing
  - neutralizes invalid `\u` escapes by preserving them as literal text instead of letting parsing explode
  - escapes raw control characters inside JSON strings
- `parseUnicodeSafeJson(...)`
  - parses repaired JSON text
  - recursively sanitizes string values after parse

Then expanded structured-output recovery in `src/lib/openai-resilience.ts` so these parser failures are treated as recoverable:

- `unsupported Unicode escape sequence`
- bad control-character parse failures
- bad escaped-character / invalid-escape failures

Also swept the remaining server-side JSON boundaries in shared libs to use the Unicode-safe helpers instead of raw `JSON.parse(...)` / `JSON.stringify(...)`.

## Coverage

The hardening now covers:

- shared structured-output parsing for OpenAI model calls
- REST JSON response parsing in Manex data access
- dataset smoke-test parsing
- investigate-state JSONB writes
- hypothesis clustering JSONB writes and fallback logging
- remaining shared-library memoization keys

## Verification

1. Targeted parser smoke tests now successfully parse malformed JSON such as:
   - `{"text":"bad \\u{1F4A9}"}`
   - `{"text":"dangling \\u12"}`
   - `{"text":"odd \\q escape"}`
   - JSON containing raw newlines inside string values

2. Structured parse classification now returns `true` for:
   - `unsupported Unicode escape sequence`
   - `Failed to parse response`
   - `bad control character in string literal`

3. Manual live run:
   - `ART-00001`
   - completed successfully
   - `runId: TCRUN-291EDCB0`
   - `cases: 1`

4. Lint:
   - `npx eslint src/lib/json-unicode.ts src/lib/openai-resilience.ts src/lib/manex-data-access.ts src/lib/manex-dataset.ts src/lib/manex-investigate-state.ts src/lib/manex-hypothesis-case-clustering.ts src/lib/manex-traceability.ts src/lib/quality-inbox.ts`
   - passed

## Remaining Note

This fix removes the known Unicode-escape parse gap inside this app process and the shared server-side JSON helpers. If a future failure appears with a different parser message, the next place to check is the shared classifier in `src/lib/openai-resilience.ts`.
