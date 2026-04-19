# Unicode Payload Sanitization

## Problem

Some product evidence strings can contain unpaired UTF-16 surrogate code units. When those values are serialized directly into JSON for prompt payloads or Postgres `jsonb` writes, downstream systems may reject them with errors like:

- `unsupported Unicode escape sequence`

In practice this showed up during clustering runs such as `ART-00004`, even after one earlier fix covered only part of the persistence layer.

## Fix

The shared helper in [`src/lib/json-unicode.ts`](/Users/tobiashorn/Documents/Projekte/manex-hack/src/lib/json-unicode.ts) now:

- preserves valid surrogate pairs
- replaces unpaired surrogates with `U+FFFD`
- provides `stringifyUnicodeSafe(...)` for JSON serialization

## Covered Paths

The sanitizer is now used for:

- clustering prompt payload embedding in [`src/prompts/manex-case-clustering.ts`](/Users/tobiashorn/Documents/Projekte/manex-hack/src/prompts/manex-case-clustering.ts)
- clustering metrics/log serialization in [`src/lib/manex-case-clustering.ts`](/Users/tobiashorn/Documents/Projekte/manex-hack/src/lib/manex-case-clustering.ts)
- clustering `jsonb` persistence in [`src/lib/manex-case-clustering-state.ts`](/Users/tobiashorn/Documents/Projekte/manex-hack/src/lib/manex-case-clustering-state.ts)
- saved filter `jsonb` persistence in [`src/lib/manex-case-state.ts`](/Users/tobiashorn/Documents/Projekte/manex-hack/src/lib/manex-case-state.ts)

## Expected Outcome

Malformed Unicode in raw evidence should no longer kill:

- Stage 1 dossier synthesis prompt construction
- Stage 2 or Stage 3 prompt construction
- clustering state writes to Postgres
- saved filter JSON persistence
