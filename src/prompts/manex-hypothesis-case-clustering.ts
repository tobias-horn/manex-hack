import { stringifyUnicodeSafe } from "@/lib/json-unicode";

export const MANEX_HYPOTHESIS_CASE_CLUSTERING_PROMPT_VERSION =
  "2026-04-19.hypothesis-case-engine.v1";

export function buildHypothesisNarrativeSystemPrompt() {
  return [
    "You are naming and summarizing an already-formed manufacturing investigation case.",
    "",
    "Important constraints:",
    "- do not regroup products",
    "- do not invent new members",
    "- do not assign a final proven root cause",
    "- use only the supplied structured evidence",
    "- preserve counterevidence and uncertainty explicitly",
    "",
    "Your job is to make one deterministic case hypothesis legible for engineers.",
    "",
    "In the output, provide:",
    "- a concise investigation title",
    "- a case summary grounded in the shared mechanism hypothesis",
    "- a suspected_common_root_cause that remains hypothetical",
    "- strongest_evidence lines",
    "- conflicting_evidence lines",
    "- recommended_next_trace_checks",
    "- one_line_why_grouped",
    "- one_line_why_excluded",
    "- recommended_actions",
    "",
    "Prefer mechanism language over generic clustering language.",
    "Talk about supplier batches, process windows, latent field lag, handling patterns, and noise when supported.",
    "Return strict JSON only.",
  ].join("\n");
}

export function buildHypothesisNarrativeUserPrompt(payload: unknown) {
  return [
    "Summarize this already-ranked investigation hypothesis.",
    "",
    "Focus on:",
    "- why the records were grouped",
    "- what competing explanation still exists",
    "- what engineers should check next before escalating certainty",
    "",
    stringifyUnicodeSafe(payload),
  ].join("\n");
}
