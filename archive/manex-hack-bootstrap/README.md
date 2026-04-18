# Manex Hackathon — Quality Report Module

Welcome! Your challenge: build the next-generation Quality Report.
Replace static 8D/FMEA Excel documents with an interactive LLM-powered
copilot. Three pillars to explore:

1. **Intelligent generation** — let an LLM draft problem descriptions,
   root-cause hypotheses, and report content from structured factory data.
2. **Innovative visualization** — interactive fault trees, timelines,
   Pareto analyses, BOM traceability views — whatever best exposes the
   story in the data.
3. **Closed-loop workflow** — write initiatives back to the database,
   assign ownership, and track progress to close-out.

How far you take each pillar is up to you. Pick your angle, pick your stack.

## What you get

- A **PostgreSQL database** mirroring Manex production (19 tables, strict subset).
- **Synthetic but realistic data** (~7,000 rows) containing **four explicit
  root-cause stories** — documented up front, no treasure hunt.
  See [docs/DATA_PATTERNS.md](docs/DATA_PATTERNS.md).
- **Three ways to access the data** — REST, SQL editor in the browser,
  or direct Postgres from any client.
- Your **own isolated stack** — teams cannot interfere with each other.
- **Illustrative defect images** served as static files, referenced from
  the data.
- A **handout** (`team-<your-team>.txt`) with all URLs, credentials, and
  API keys you need.

## Start here

1. [docs/CASE.md](docs/CASE.md) — the challenge, evaluation criteria, and context.
2. [docs/QUICKSTART.md](docs/QUICKSTART.md) — connect in < 5 minutes.
3. [docs/API_REFERENCE.md](docs/API_REFERENCE.md) — endpoints, examples in curl / JS / Python.
4. [docs/SCHEMA.md](docs/SCHEMA.md) — entities, fields, ER diagram.
5. [docs/DATA_PATTERNS.md](docs/DATA_PATTERNS.md) — the four stories in the dataset.

## Defect images

`image_url` values in the dataset are relative paths (for example,
`/defect_images/defect_01_cold_solder.jpg`). Prepend the assets host +
port from your handout to render them, e.g.:

```text
http://<host>:9000 + image_url
```

Use the full URL in `<img src>` tags to display them in your UI.

## LLM access

Bring your own API key (OpenAI / Anthropic / Gemini). If you don't have
one, ask the organizers for a shared key — a modest budget is set aside.

## Ground rules

- Seed tables are **read-protected from deletes** — you cannot
  `DELETE FROM product` or `TRUNCATE defect`. This is a feature, not a bug.
- You **can** `INSERT`/`UPDATE` on `product_action` and `rework`
  (the closed-loop write targets).
- You **can** `CREATE TABLE` for your own entities — PostgREST will
  auto-expose them.
- If seed data looks wrong, ask an organizer to reset your stack.

## Questions?

Ask the organizers — in person, or on the hackathon chat. Good luck!

## Local smoke test

If you want a fast sanity check without waiting for Docker, run:

```bash
python3 scripts/smoke_seed.py
```

This loads `supabase/seed.sql` into an in-memory SQLite database and checks
row counts, referential integrity, the four documented data stories, and
image coverage.
