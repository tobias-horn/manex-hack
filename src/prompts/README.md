# Prompt Registry

This folder holds the active AI prompt definitions used by the app.

Current prompt files:

- `manex-case-clustering.ts`
  Stage 1, Stage 2, and Stage 3 clustering prompts.
- `manex-copilot.ts`
  Copilot system prompt and user prompt wrapper.

Application code should import prompts from this folder instead of keeping prompt
text inline in routes or orchestration files.
