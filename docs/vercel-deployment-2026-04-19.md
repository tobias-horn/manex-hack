# Vercel deployment notes

Date: 2026-04-19

## Current status

- `npm run build` succeeds locally in production mode.
- The app is a standard Next.js 16 App Router project with Node.js API routes, so it is deployable on Vercel without custom build plumbing.

## Environment variable mapping

Set these in Vercel Project Settings -> Environment Variables:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, default is `gpt-5.4-mini`)
- `MANEX_ASSET_BASE_URL` (optional, for defect images)
- `MANEX_STUDIO_URL` (optional, for SQL/debug links)

For the REST layer, either of these patterns works because `src/lib/env.ts` supports fallbacks:

1. Preferred public pair
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Server-style pair
   - `MANEX_REST_API_URL`
   - `MANEX_REST_API_KEY`

Relevant fallback behavior in `src/lib/env.ts`:

- `NEXT_PUBLIC_SUPABASE_URL` falls back to `MANEX_REST_API_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` falls back to `MANEX_REST_API_KEY`
- `MANEX_REST_API_URL` falls back to `NEXT_PUBLIC_SUPABASE_URL`
- `MANEX_REST_API_KEY` falls back to `SUPABASE_SERVICE_ROLE_KEY`, then `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Secret handling

- Do not commit `.env.local` or any `.env*` file. The repo `.gitignore` already ignores them.
- Keep `DATABASE_URL`, `OPENAI_API_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Only use `NEXT_PUBLIC_*` for values that are safe to expose to the browser.

## Functional caveat

- The shell can still render with missing integrations, but the clustering and investigation routes require both `DATABASE_URL` and `OPENAI_API_KEY`.
- Some batch clustering routes are long-running. If Vercel timeouts show up in practice, add explicit `maxDuration` exports to the heavy API routes.
