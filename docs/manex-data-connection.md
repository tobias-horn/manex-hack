# Manex Data Connection Notes

This project now has a single shared smoke-test layer for the hackathon dataset.

## Supported access paths

- REST / PostgREST with API key
  - Preferred env vars: `MANEX_REST_API_URL`, `MANEX_REST_API_KEY`
  - Compatibility fallback: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Direct Postgres
  - Env var: `DATABASE_URL`
- SQL editor for debugging
  - Optional env var: `MANEX_STUDIO_URL`
  - Use the handout's Studio login in the browser when ad-hoc SQL is faster than REST filters

## Smoke test contract

The shared smoke test lives in `src/lib/manex-dataset.ts` and is reused by:

- `/` for the visible UI proof
- `/api/data-connection` for a machine-readable health result

It always attempts to read from `v_defect_detail` and returns:

- row count
- up to five sample rows
- per-connection status for REST and Postgres
- optional Studio metadata

## Useful debug behavior

- REST failures log the API URL plus the provider error message
- Postgres failures log a redacted `DATABASE_URL` plus the client error message
- Missing env is treated separately from failed auth/network so setup issues are obvious

## Hackathon context

The upstream hackathon repo documents the same three access paths:

- `docs/QUICKSTART.md`
- `docs/API_REFERENCE.md`
- `docs/SCHEMA.md`

The key view for the first connection test is `v_defect_detail`, which joins defect records with product, article, section, and reported-part context.
