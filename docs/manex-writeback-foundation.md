# Manex Write-Back Foundation

Prompt 7 adds the first stable workflow write-back layer.

## Scope

This slice is intentionally narrow:

- create a `product_action`
- update its status later
- return the persisted row immediately

It does not try to build full workflow orchestration yet.

## Allowed write targets

The foundation stays inside the hackathon's allowed write surface:

- `product_action`
- `rework` remains available in the data layer for later stages

Seed tables are not written to.

## Data layer

`src/lib/manex-data-access.ts` now supports:

- `workflow.recordAction(...)`
- `workflow.updateAction(...)`
- `workflow.recordRework(...)`

Insert and update both follow the same REST-first, Postgres-fallback transport policy.

## API layer

`src/app/api/actions/route.ts` now supports:

- `POST` to create an action
- `PATCH` to update action status

Both paths validate payloads and return the persisted row so the UI can update immediately.

## UI surface

`src/app/workflow/page.tsx` is the first explicit write-back screen.

It uses `src/components/action-workbench.tsx` to:

- create one action from the app
- show clear success and error states
- update a saved action's status later

## Why this matters

Later stages can build on this without rethinking transport, validation, or allowed write boundaries.
