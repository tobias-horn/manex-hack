# Agent Chat Approval Flow

This branch adds an "Ask the Agent" entry point on the dashboard and cases page.

## What was added

- A floating `AskTheAgent` client component that opens a chat panel.
- A streaming `/api/agent` route backed by the AI SDK and the Manex forensic system prompt.
- Read-only investigation tools for defects, claims, tests, installed parts, weekly summaries, rework, and existing actions.
- Proposal-style write tools that return pending approvals instead of mutating data immediately.
- An `/api/agent/execute` route that persists approved product actions, assignments, and 8D-style reports through `createManexDataAccess()`.

## UX and safety model

- The assistant is expected to gather evidence first and only then return a proposal.
- The UI renders proposal outputs with approve/deny controls.
- Deny is a local UI state change only.
- Approve posts the proposal payload to `/api/agent/execute`.
- Server writes are guarded by zod schemas and lightly sanitize optional `sectionId` and `defectId` fields before persistence.

## Dependency changes

- Added `react-markdown` for Markdown rendering in chat responses.
- Added `remark-gfm` so the model can return readable lists and tables.

## Validation notes

- `npm run lint` passes after escaping a JSX apostrophe in the chat intro copy.
- `npm run build` was failing on this branch because `src/lib/manex-case-clustering.ts` referenced `uniqueBy` without defining it. This doc corresponds to the branch state after restoring that helper.
