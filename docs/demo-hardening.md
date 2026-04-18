# Demo Hardening

Prompt 10 is a cleanup pass focused on reliability and speed for the hackathon demo.

## What changed

- shared date and ID formatting now lives in `src/lib/ui-format.ts`
- route loading, error, and not-found states are handled through:
  - `src/app/loading.tsx`
  - `src/app/error.tsx`
  - `src/app/not-found.tsx`
  - `src/components/screen-state.tsx`
- seeded quick navigation links live in `src/lib/manex-demo.ts`
- hot read models are memoized with short TTLs through `src/lib/server-cache.ts`

## Cached read paths

The most frequently opened read-heavy surfaces now reuse short-lived cached results:

- `src/lib/quality-inbox.ts`
- `src/lib/manex-traceability.ts`

This keeps the demo snappy while avoiding deeper plumbing changes before Stage 2.

## Consistency pass

- date rendering is normalized through shared helpers instead of page-local formatting
- typed IDs such as `PRD-*`, `DEF-*`, and `ART-*` are normalized consistently before writes
- the old unused `src/lib/supabase.ts` helper was removed

## Demo navigation

The app now exposes a small set of seeded live jumps for:

- inbox scenarios
- traceability queries
- product dossiers

That makes it easier to recover quickly during the demo without manually rebuilding query strings.
