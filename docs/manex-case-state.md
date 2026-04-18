# Manex Case State

Prompt 8 adds the first app-owned persistence layer for investigation workflow.

## Why this exists

The hackathon dataset gives us shared manufacturing, quality, and workflow data.
It does not give us a product-layer concept of a case.

This schema fills that gap without duplicating seed data:

- `cases`
- `case_signal_links`
- `hypotheses`
- `investigation_notes`
- `saved_filters`
- `evidence_bookmarks`

## Design rules

- store only app state, not copies of defects, claims, products, or BOM rows
- keep every case anchored to underlying repo entities through IDs like `product_id`, `article_id`, and linked signal IDs
- keep the schema minimal enough to evolve during the hackathon
- make notes and hypotheses first-class so later LLM features have a stable attachment point

## Current runtime shape

The schema lives in `src/lib/manex-case-state.ts`.

The helper does three things:

1. creates the custom tables idempotently through direct Postgres
2. exposes typed read and write helpers for cases, notes, hypotheses, bookmarks, and saved filters
3. normalizes the returned objects into stable app-facing shapes

## Why direct Postgres is used first

Creating custom tables is a Postgres concern.
Once the tables exist, the same public-schema tables are suitable for later PostgREST use if we want it.

For the first version, direct Postgres keeps the creation path deterministic and avoids depending on a second transport during setup.

## UI and API surfaces

- `src/app/cases/page.tsx`
- `src/components/case-workbench.tsx`
- `src/app/api/cases/route.ts`
- `src/app/api/cases/[caseId]/notes/route.ts`
- `src/app/api/cases/[caseId]/hypotheses/route.ts`

This gives the app a visible case concept now, while leaving room for later saved-filter, bookmark, clustering, and copilot features.
