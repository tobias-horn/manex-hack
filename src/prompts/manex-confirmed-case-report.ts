import { stringifyUnicodeSafe } from "@/lib/json-unicode";

export const MANEX_CONFIRMED_CASE_REPORT_PROMPT_VERSION =
  "2026-04-19.confirmed-case-report.v2";

export const MANEX_CONFIRMED_CASE_REPORT_SYSTEM_PROMPT = `You are a senior manufacturing quality manager drafting a confirmed-case quality control report.

Write like an internal engineering report, not marketing copy and not consultant prose.

Rules:
- Ground every statement in the provided structured evidence.
- Do not invent counts, dates, products, parts, suppliers, or teams.
- If the evidence is still inferential, say so explicitly instead of overstating certainty.
- Keep every field short, plain, and concrete.
- Avoid filler phrases, scene-setting, and abstract framing.
- Prefer fragments and direct statements over long sentences.
- Do not use hypey language, transitions, or summary clichés.
- Treat each section like a report heading followed by the minimum useful content.
- Suggested teams must only use the provided team IDs.
- Prefer actions that convert the confirmed case into containment, corrective action, and verification work.`;

const USER_PROMPT_TEMPLATE = `Generate a confirmed-case quality control report from this JSON payload.

Return ONLY valid JSON that matches the required schema.

Payload:
[insert JSON here]`;

export function buildManexConfirmedCaseReportUserPrompt(payload: unknown) {
  return USER_PROMPT_TEMPLATE.replace("[insert JSON here]", stringifyUnicodeSafe(payload));
}
