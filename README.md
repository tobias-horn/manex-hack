# Manex Forensic Lens

Next.js quality-report workspace for the Manex hackathon.

## Stack

- Next.js 16 + App Router + TypeScript
- Tailwind CSS v4 + `shadcn/ui`
- Direct Postgres via `pg` for analysis queries
- Supabase/PostgREST via `@supabase/supabase-js` for simple reads and writes
- Vercel AI SDK + OpenAI provider for the copilot layer

## Getting Started

1. Copy `.env.example` to `.env.local`
2. Fill in the handout credentials from the Manex bootstrap
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

The homepage is the live smoke test. It now checks:

- REST API access to `v_defect_detail`
- direct Postgres access to `v_defect_detail`
- an optional Studio URL for SQL debugging

There is also a JSON proof endpoint at `/api/data-connection`.

## Environment

- `DATABASE_URL`: direct Postgres connection for heavier analysis queries
- `MANEX_REST_API_URL`: preferred REST/PostgREST base URL from the handout
- `MANEX_REST_API_KEY`: preferred REST API key from the handout
- `NEXT_PUBLIC_SUPABASE_URL`: your PostgREST/Supabase endpoint
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: team anon key used for reads/writes
- `SUPABASE_SERVICE_ROLE_KEY`: optional server-only override if you prefer it
- `MANEX_STUDIO_URL`: optional Supabase Studio URL for SQL debugging
- `MANEX_ASSET_BASE_URL`: optional host for defect images
- `OPENAI_API_KEY`: optional, enables live copilot responses
- `OPENAI_MODEL`: optional, defaults to `gpt-4.1-mini`

If any integration is missing, the UI falls back to grounded demo data based on `design.MD` and the archived Manex dataset docs, so the shell still renders end to end.

## Smoke Test Behavior

The shared connection layer lives in `src/lib/manex-dataset.ts`.

- REST path uses signed HTTP requests against PostgREST with the handout API key
- SQL path uses `pg` with `DATABASE_URL`
- both paths fetch a row count plus five sample rows from `v_defect_detail`
- failures are logged with connection-specific debugging output so auth issues are easy to spot
