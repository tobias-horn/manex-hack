export const MANEX_CASE_CLUSTERING_PROMPT_VERSION = "2026-04-18.case-clustering.v3";

export function buildStage1SystemPrompt() {
  return [
    "You are building a product-level investigation dossier for one manufactured unit.",
    "Your job is compression and structuring, not clustering and not final root-cause attribution.",
    "Preserve all relevant facts while staying compact.",
    "Highlight suspicious patterns, contradictions, and missing evidence.",
    "Distinguish confirmed failures, marginal signals, likely false positives, and service or documentation style issues.",
    "Return strict JSON only.",
  ].join("\n");
}

export function buildStage1UserPrompt(payload: unknown) {
  return [
    "You will receive one complete product thread for a single product.",
    "Consolidate it into one coherent evidence thread.",
    "Do not infer an exact root cause.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

export function buildPassASystemPrompt() {
  return [
    "You are clustering product investigation dossiers into article-level case candidates.",
    "All products belong to the same article.",
    "A case is a group of products that may share a common underlying issue and should be investigated together.",
    "You are not required to identify the exact root cause with certainty.",
    "Your goal is to propose useful investigation cases.",
    "Use all provided information: article summary, product timelines, free text, defect codes, test results, installed parts, BOM positions, supplier batches, sections, rework, actions, images, and raw evidence appendix.",
    "Prefer grouping by likely common mechanism, not just identical labels.",
    "Keep separate service or documentation complaints, cosmetic-only issues, likely functional failures, process drift, supplier-linked issues, and false positives.",
    "A product may remain unassigned if evidence is weak.",
    "A specific fault signal may remain standalone even if the product has other clusterable evidence.",
    "Use standaloneSignals when a fault appears real but not meaningfully related to any shared cluster.",
    "Return only structured JSON.",
  ].join("\n");
}

export function buildPassAUserPrompt(payload: unknown) {
  return [
    "Build proposed case clusters for this article dossier.",
    "Use product threads as the main unit of reasoning.",
    "Use the raw appendix only to confirm or sharpen the clusters.",
    "If a cluster is weak or noisy, leave products unassigned instead of forcing a grouping.",
    "If an individual defect, claim, or test should stay isolated, return it in standaloneSignals instead of forcing it into a cluster.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

export function buildPassBSystemPrompt() {
  return [
    "You are the article-local reviewer for manufacturing quality case clustering.",
    "Refine, merge, split, or reject weak draft case clusters within this article.",
    "Keep only clusters that are investigation-worthy and supported by shared evidence.",
    "Remove products that do not belong, merge duplicate cases, and keep cosmetic, service, or false-positive groups separate from likely functional or manufacturing cases.",
    "Preserve standalone signals when a fault appears isolated or not cluster-related.",
    "Return the same structured JSON contract, now representing the final reviewed proposal set.",
  ].join("\n");
}

export function buildPassBUserPrompt(payload: unknown) {
  return [
    "Review and refine these draft case proposals using the same article dossier context.",
    "The final output should be tighter than the draft: fewer duplicates, cleaner case boundaries, clearer evidence, and clearer unassigned products where confidence is weak.",
    "Keep standalone signals explicit when the evidence suggests they should not be grouped into any proposed case.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

export function buildStage3SystemPrompt() {
  return [
    "You are reconciling article-level case proposals into a final global investigation inventory.",
    "Your job is to merge duplicate or overly fragmented cases where justified, down-rank weak cases driven by noise, extract monitoring patterns as watchlists, and separate real investigation cases from noise and distractors.",
    "Do not collapse distinct mechanisms into one broad case.",
    "Prefer precision over over-grouping.",
    "If the only strong commonality is where a defect was detected, treat that as weak evidence.",
    "Distinguish validated investigation cases, watchlists, noise buckets, and rejected cases.",
    "Return strict JSON only.",
  ].join("\n");
}

export function buildStage3UserPrompt(payload: unknown) {
  return [
    "Reconcile these article-local case sets into one global inventory.",
    "Use the article-local proposals plus the provided global summaries to merge, suppress, or watch patterns without forcing a case where the evidence is weak.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}
