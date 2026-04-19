# Seeded Dummy Run Mode

## Why this exists

The clustering pipelines are still in motion, but the UI work on `/articles`,
`/articles/[articleId]`, and `/products/[productId]` benefits from having a
finished run shape available right now.

This mode gives the team a read-only, already-completed run so we can keep
building:

- article list inventory
- article caseboard detail states
- global watchlist / noise / leading-indicator surfaces
- product drill-down links that still show proposed cases

## Entry point

Use the new top toggle:

- `Seeded dummy run`

It is available on:

- `/articles`
- `/articles/[articleId]`
- `/products/[productId]`

## What it does

The mode does **not** execute any pipeline or mutate persisted state.

Instead it returns seeded read models that mimic a completed hypothesis-style
run:

- completed article runs
- a completed batch snapshot
- proposed cases
- watchlists
- leading indicators
- noise buckets
- global reconciliation notes

## Story mapping

The seeded data mirrors the four published hackathon stories:

1. Supplier batch incident
2. Process drift / calibration
3. Latent thermal design weakness
4. Operator / handling cluster

It also keeps the known caution stories visible:

- detection hotspot at `Pruefung Linie 2`
- near-limit tests as leading indicators
- false positives / seasonal dip as noise or rejected evidence

## Implementation notes

- Mode token lives in `src/lib/manex-clustering-mode.ts`
- Seeded read models live in `src/lib/manex-dummy-clustering.ts`
- Runners were extended with read-only support so the UI still looks like a
  finished run, but cannot launch or reset anything in this mode

## Intent

This is a UI acceleration tool for the hackathon, not a replacement for the
live clustering engines.

When the real pipelines are ready again, the team can switch back to the live
engines with the same top toggle and compare the surfaces directly.
