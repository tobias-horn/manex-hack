# API Reference

Three access layers:

1. **PostgREST REST API** — auto-generated REST for every table and view.
2. **Supabase Studio SQL Editor** — arbitrary SQL in a browser UI.
3. **Direct Postgres** — any Postgres client library.

## Authentication

REST calls need the `Authorization` header:

```
Authorization: Bearer <your-team-anon-key>
```

Postgres connections use the user/password from your handout.

## Tables

Every table in `supabase/migrations/00001_create_schema.sql` is exposed at
`/<table_name>`. PostgREST conventions:

- `?select=col1,col2`                     — column projection
- `?limit=10&offset=20`                   — pagination
- `?order=ts.desc`                        — sorting
- `?defect_code=eq.SOLDER_COLD`           — equality filter
- `?ts=gte.2026-02-01`                    — range
- `?defect_code=in.(SOLDER_COLD,VIB_FAIL)` — IN
- `?select=*,product(*)`                  — embed related table

Full PostgREST docs: https://postgrest.org/

## Convenience views (always start here)

| Endpoint              | Returns                                                |
|-----------------------|--------------------------------------------------------|
| `/v_defect_detail`    | defects enriched with product, article, sections, part |
| `/v_product_bom_parts`| full BOM-position + batch + supplier per installed part|
| `/v_field_claim_detail`| claims enriched with mapped defect and product        |
| `/v_quality_summary`  | weekly rollup per article                              |

## Examples

### curl

```bash
export API="https://api-<team>.<domain>"
export KEY="eyJhbGci..."

# All defects for a specific product
curl -H "Authorization: Bearer $KEY" \
  "$API/v_defect_detail?product_id=eq.PRD-00042&order=defect_ts.desc"

# BOM-level traceability: what parts with which batch are installed in this product?
curl -H "Authorization: Bearer $KEY" \
  "$API/v_product_bom_parts?product_id=eq.PRD-00042"

# Defects clustered by part number, newest first
curl -H "Authorization: Bearer $KEY" \
  "$API/v_defect_detail?select=defect_id,defect_ts,defect_code,reported_part_title&order=defect_ts.desc&limit=20"

# Create an initiative
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  "$API/product_action" \
  -d '{"action_id":"PA-00101","product_id":"PRD-00042","ts":"2026-04-13T10:00:00Z","action_type":"corrective","status":"open","user_id":"team","defect_id":"DEF-00007","comments":"Containment at supplier level"}'
```

### JavaScript (`@supabase/supabase-js`)

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://api-<team>.<domain>',    // your team's API URL
  '<your-anon-key>'
)

// Read
const { data: defects } = await supabase
  .from('v_defect_detail')
  .select('*')
  .eq('defect_code', 'SOLDER_COLD')
  .order('defect_ts', { ascending: false })
  .limit(10)

// Write
await supabase.from('product_action').insert({
  action_id: 'PA-00101',
  product_id: 'PRD-00042',
  ts: new Date().toISOString(),
  action_type: 'corrective',
  status: 'open',
  user_id: 'team',
  defect_id: 'DEF-00007'
})
```

### Python

```python
import requests

API = "https://api-<team>.<domain>"
HDR = {"Authorization": "Bearer <your-anon-key>"}

# Read
resp = requests.get(
    f"{API}/v_defect_detail",
    headers=HDR,
    params={"defect_code": "eq.SOLDER_COLD", "limit": 20},
)
defects = resp.json()

# Write
resp = requests.post(
    f"{API}/product_action",
    headers={**HDR, "Content-Type": "application/json",
             "Prefer": "return=representation"},
    json={
        "action_id": "PA-00101",
        "product_id": "PRD-00042",
        "ts": "2026-04-13T10:00:00Z",
        "action_type": "corrective",
        "status": "open",
        "user_id": "team",
        "defect_id": "DEF-00007",
    },
)
```

### Python — direct Postgres (recommended for analysis)

```python
import pandas as pd
from sqlalchemy import create_engine

engine = create_engine(
  "postgresql://team_writer_<slug>:<pw>@<vm>:<port>/hackathon"
)

# Full SQL, no REST limits
df = pd.read_sql("""
  SELECT article_name, week_start, defect_count
  FROM v_quality_summary
  WHERE week_start >= '2026-01-01'
  ORDER BY article_name, week_start
""", engine)
```

## Supabase Studio (SQL Editor)

URL: `https://studio-<team>.<domain>/`

Use it for:
- Ad-hoc SQL (window functions, recursive CTEs, complex joins).
- Browsing rows table by table.
- Inspecting foreign keys and indexes.

Every query you can write in psql also works here.

## What you cannot do

- DELETE / TRUNCATE / UPDATE on seed tables (401 / 42501 permission denied).
- Read another team's data — your API key works only on your stack.

## What you can do

- SELECT on every table and view.
- INSERT / UPDATE / DELETE on `product_action`, `rework`.
- CREATE TABLE / VIEW / MATERIALIZED VIEW in `public` schema.
- Call arbitrary SQL via SQL Editor or psql using your team-writer creds.
