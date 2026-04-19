# Agent Chat Approval Flow

This integrates the new "Ask the Agent" pull request into the current workspace without depending on the old home page layout.

## What was added

- A floating `AskTheAgent` client component mounted once in the root layout.
- A streaming `/api/agent` route backed by the AI SDK and the Manex forensic system prompt.
- Read-only investigation tools for defects, claims, tests, installed parts, weekly summaries, rework, and existing actions.
- Proposal-style write tools that return pending approvals instead of mutating data immediately.
- An `/api/agent/execute` route that persists approved product actions, assignments, and 8D-style reports through `createManexDataAccess()`.

## Integration choices on current `main`

- The original PR added entry points to the home and cases pages. The current app now redirects `/` immediately, so the agent is mounted globally instead.
- The floating agent is only rendered when AI plus either Postgres or REST data access is configured.
- The execute route now follows the existing action API's ID generation style and normalizes product, section, and defect identifiers before writing.

## UX and safety model

- The assistant is expected to gather evidence first and only then return a proposal.
- The UI renders proposal outputs with approve and deny controls.
- Deny is a local UI state change only.
- Approve posts the proposal payload to `/api/agent/execute`.
- Server writes are guarded by zod schemas and lightly sanitize optional `sectionId` and `defectId` fields before persistence.

## Dependency changes

- Added `react-markdown` for Markdown rendering in chat responses.
- Added `remark-gfm` so the model can return readable lists and tables.

## Validation notes

- This feature depends on `OPENAI_API_KEY` plus either `DATABASE_URL` or `MANEX_REST_API_URL` with `MANEX_REST_API_KEY`.
- The old clustering-side helper fixes from the PR are already present in the current workspace, so they were not re-applied.
