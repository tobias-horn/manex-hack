# QUICKSTART

Get from zero to first query in under 5 minutes.

## 1. Your credentials

You received a handout that looks like this:

```
Team Alpha
===========================================================

REST API:     http://<vm>:8001/
Studio UI:    http://<vm>:8401/
Studio Login: team_alpha / <studio-password>
PostgreSQL:   postgres://team_writer_alpha:<pw>@<vm>:5431/hackathon

API Key (apikey header):
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Three access paths — pick whichever fits your stack.

## 2. REST API (fastest smoke test)

```bash
export API="http://<vm>:8001"
export KEY="eyJhbGci..."

# Row count:
curl -H "apikey: $KEY" "$API/defect?select=count"

# Top 5 defects with context:
curl -H "apikey: $KEY" "$API/v_defect_detail?limit=5"
```

## 3. Supabase Studio (web UI + SQL editor)

Open `http://<vm>:8401/` in your browser. The SQL Editor tab accepts any
Postgres SQL — window functions, CTEs, recursive queries, the whole
toolkit. Use this when REST query shapes get painful.

Studio is protected with HTTP Basic Auth. Use the `Studio Login` credentials
from your handout before you can access the dashboard.

## 4. Direct Postgres ´

```bash
psql "postgres://team_writer_alpha:<pw>@<vm>:5431/hackathon"
```

Works with any standard client: `psycopg2`, `asyncpg`, `pg` (node), Prisma,
SQLAlchemy, Polars `read_database`, etc. You have full SELECT on every
table and can INSERT/UPDATE `product_action` and `rework`, plus
`CREATE TABLE` for your own entities.

## 5. Defect images

Shared nginx container on port 9000:

```
http://<vm>:9000/defect_images/defect_01_cold_solder.jpg
```

`image_url` columns in `defect` and `field_claim` point at these. Usable
as relative paths (example: `/defect_images/defect_01_cold_solder.jpg`).
Build full URLs by prepending the handout host and assets port:

```text
full_image_url = http://<vm>:9000 + image_url
```

Use the full URL in `<img src>` tags to display them in your UI.

## 6. Writing data back

The Pillar 3 (closed-loop workflow) write targets:

```bash
# Create an initiative (product_action row):
curl -X POST -H "apikey: $KEY" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  "$API/product_action" \
  -d '{
    "action_id": "PA-00101",
    "product_id": "PRD-00042",
    "ts": "2026-04-13T10:00:00Z",
    "action_type": "initiate_8d",
    "status": "open",
    "user_id": "user_alpha",
    "defect_id": "DEF-00007"
  }'
```

Seed tables are protected — you cannot `DELETE FROM product` or
`TRUNCATE defect`. Good. It stops you from accidentally burning the
dataset mid-demo.

## 7. Extending the schema

Teams are free to create their own tables:

```sql
CREATE TABLE team_alpha_fmea_entries (
  id         TEXT PRIMARY KEY,
  defect_id  TEXT REFERENCES defect(defect_id),
  severity   INT,
  occurrence INT,
  detection  INT,
  rpn        INT GENERATED ALWAYS AS (severity * occurrence * detection) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

PostgREST auto-exposes new tables at `/<table_name>` once created.

## 8. LLM access

Use your own API key (OpenAI / Anthropic / Gemini). If you don't have one,
ask the organizers for a shared key — we set a modest budget aside.

## 9. If something breaks

- Seed data looks wrong? Ask organizers to run `./scripts/reset-team.sh <slug>`.
- Schema is yours to extend — just don't delete seed tables (you can't anyway).
- API returning 401? Check you're passing `apikey: <your-team-key>`.

Now go read [DATA_PATTERNS.md](DATA_PATTERNS.md) — the four stories in the
data define the challenge.
