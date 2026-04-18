# Pipeline Stop Control

Date: 2026-04-19

## What changed

The full pipeline now has a dedicated stop path that is separate from reset.

- `PATCH /api/articles/cluster-all` stops active pipeline work
- `DELETE /api/articles/cluster-all` still resets persisted clustering state, but only after no work is running

## Why

The old reset flow was not a real stop mechanism. It refused to run while the pipeline was active, which made the UI feel broken when users wanted to halt work immediately.

## New behavior

### Stop

Stopping now works cooperatively through the running pipeline:

- batch execution gets an `AbortController`
- single-article execution gets an `AbortController`
- Stage 1 / Stage 2 / Stage 3 model calls receive `abortSignal`
- concurrency workers check for abort before starting more work
- running DB state is marked as failed with `Pipeline stopped by user.`

This means stop can interrupt live model calls and prevent queued work from continuing.

### Reset

Reset remains destructive cleanup:

- remove product dossiers
- remove article dossiers
- remove case runs
- remove candidates

Reset is still blocked while work is active, but the user can now stop first and then reset safely.

## UI

`src/components/global-pipeline-runner.tsx`

The dashboard now has three separate actions:

- run complete pipeline
- stop pipeline
- reset clustering state

The UI treats `Pipeline stopped by user.` as an intentional stop, not as an unexpected runtime failure.
