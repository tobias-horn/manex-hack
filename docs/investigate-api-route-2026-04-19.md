# Investigation API Route

Date: 2026-04-19

This note documents the new fourth root-cause approach added to the repo.

## The four current approaches

1. Classic three-layer clustering
   `src/lib/manex-case-clustering.ts` builds shared dossiers, drafts article
   cases with the LLM, then reconciles them into a global inventory.
2. Deterministic issue grouping
   `src/lib/manex-deterministic-case-clustering.ts` uses the LLM only for small
   per-product issue cards, then groups and reconciles cases in code.
3. Hypothesis / mechanism-family engine
   `src/lib/manex-hypothesis-case-clustering.ts` forms supplier, process,
   latent-design, handling, and noise candidates deterministically and uses the
   LLM only to narrate the ranked survivors.
4. Direct statistical anomaly investigation
   `src/app/api/investigate/route.ts` skips the persisted case-pipeline layers,
   runs six direct SQL queries against Postgres, and sends the combined payload
   to OpenAI for an independent quality-engineering readout.

## New route

- `POST /api/investigate`
  Runs six manufacturing SQL queries, combines the results into one JSON
  payload, sends that payload to OpenAI with the dedicated statistical-anomaly
  prompt, validates the returned JSON, and returns the parsed investigation.
- `POST /api/articles/[articleId]/cluster-investigate`
  Runs the same investigation scoped to one article and persists the result so
  the article workspace can treat it as a fourth toggleable engine.
- `GET/POST/PATCH/DELETE /api/articles/cluster-all-investigate`
  Adds batch-run, polling, stop, and reset behavior for the statistical
  investigation engine on the global dashboard.

## Supporting files

- `src/prompts/manex-investigate.ts`
  Stores the exact system prompt and user prompt template for this route.
- `src/prompts/README.md`
  Registers the new prompt contract in the shared prompt registry.

## Notes

- The route uses `DATABASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.
- The new toggle mode is available on `/articles`, `/articles/[articleId]`, and
  `/products/[productId]` as `pipeline=investigate`.
- The SQL is intentionally direct and read-only so the route can act as an
  independent cross-check against the three existing clustering pipelines.
- The OpenAI response is schema-validated before returning to the caller.
