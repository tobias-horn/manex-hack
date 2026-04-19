# Postgres SSL Fallback

Date: 2026-04-19

## Symptom

The app-level error boundary could render the load-error screen even though the
route code itself was intact. The failing server error was:

- `The server does not support SSL connections`

This happened while read models were querying Postgres from the `/articles`
landing route.

## Root cause

`src/lib/postgres.ts` already tried to retry without SSL after a failed first
attempt, but the pool factory used `ssl: undefined` for the retry path.

That leaves room for driver/runtime defaults to keep negotiating SSL instead of
forcing a plain connection. In local hackathon environments where the database
host is not literally `localhost` but still does not support SSL, that causes
the fallback to fail repeatedly.

## Fix

- Make the non-SSL retry explicit with `ssl: false`
- Broaden the retry matcher to cover common "server does not support SSL"
  message variants

## Important detail

Do not rely only on the hostname to infer local-vs-remote behavior. Team setups
often use container aliases or LAN hosts that are still non-SSL local databases.
