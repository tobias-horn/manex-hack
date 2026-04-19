import { stringifyUnicodeSafe } from "@/lib/json-unicode";

export const MANEX_DETERMINISTIC_CASE_CLUSTERING_PROMPT_VERSION =
  "2026-04-19.det-case-clustering.v4";

export function buildDeterministicIssueExtractionSystemPrompt() {
  return [
    "You are reviewing one product-level manufacturing dossier.",
    "",
    "Your job is to extract a small number of structured issue cards that can be grouped later by deterministic logic.",
    "You are not clustering across products.",
    "You must preserve anchors and uncertainty instead of inventing a root cause.",
    "",
    "Important rules:",
    "- emit at most 3 issue cards",
    "- each issue card should represent one coherent issue thread on this product",
    "- prefer splitting clearly different mechanisms rather than collapsing them together",
    "- use scope_hint to tell the downstream deterministic system whether the issue looks like a candidate_case, incident, watchlist, or noise",
    "- explicit false positives, marginal-only screening patterns, service/documentation complaints, and cosmetic-only handling patterns should not be presented as candidate_case unless there is very strong contradictory evidence",
    "- detected section is weak evidence by itself; preserve occurrence sections and traceability anchors explicitly",
    "- preserve negative evidence explicitly: claim-only behavior, no prior factory defect, delayed field lag, low-severity-only cosmetic handling, and detection bias all matter downstream",
    "- if evidence is weak or contradictory, keep confidence lower and explain the reasons against clustering",
    "",
    "Focus on bounded structured extraction:",
    "- strongest shared anchors inside this product thread",
    "- whether an anchor is narrow, local-cluster, or article-wide",
    "- whether a part+batch anchor or co-occurring anchor bundle is present",
    "- whether traceability neighbors strengthen or weaken the issue",
    "- exact traceability anchors",
    "- temporal window",
    "- field lag pattern",
    "- process or handling clues",
    "- confounders",
    "- normalized clues already present in the payload",
    "",
    "Return strict JSON only.",
  ].join("\n");
}

export function buildDeterministicIssueExtractionUserPrompt(payload: unknown) {
  return [
    "Extract issue cards from this single-product dossier.",
    "",
    "Desired behavior:",
    "- preserve only the few most important issue threads",
    "- make the anchor_summary useful for deterministic grouping later",
    "- prefer concrete normalized anchors over narrative phrasing",
    "- keep broad anchors like a common BOM position weak unless there is additional structural evidence",
    "- preserve claim-only latent failures explicitly when field claims exist without prior factory defects and lag is delayed",
    "- preserve operator/order handling clues explicitly when low-severity cosmetic issues concentrate on the same order or rework user",
    "- include reasons_against_clustering when the evidence is noisy, single-product, contradictory, cosmetic, service-oriented, marginal-only, or detection-biased",
    "- use strongest_evidence for concrete facts, not speculation",
    "",
    stringifyUnicodeSafe(payload),
  ].join("\n");
}

export function buildDeterministicFinalJudgeSystemPrompt() {
  return [
    "You are the final judge for deterministic manufacturing-quality candidates.",
    "",
    "You are not allowed to invent new candidates, merge candidates, or re-cluster the article.",
    "You may only review the shortlisted candidates you are given and decide whether each one should stay as-is, be downgraded, or be relabeled.",
    "",
    "Your output is a strict structured review over compact fingerprints only.",
    "",
    "Important rules:",
    "- prefer deterministic evidence over narrative wording",
    "- broad article-wide anchors are weak evidence by themselves",
    "- a material case needs both diagnostic traceability anchors and closure behavior",
    "- a process case needs occurrence-section plus time-window structure",
    "- a latent-field case needs claim-only or claim-dominant behavior, no prior factory defect, and lag recurrence",
    "- a handling case needs order or rework-user concentration with low field impact",
    "- if the lane race is ambiguous, do not validate; prefer watchlist or incident",
    "- do not upgrade a weaker candidate into a stronger class",
    "- keep titles mechanism-led and compact",
    "",
    "Return strict JSON only.",
  ].join("\n");
}

export function buildDeterministicFinalJudgeUserPrompt(payload: unknown) {
  return [
    "Review these shortlisted deterministic candidates.",
    "",
    "Desired behavior:",
    "- decide whether each candidate should keep its current class, downgrade, or be relabeled",
    "- preserve the strongest alternative explanation when the current winning lane looks overstated",
    "- use only the compact evidence provided",
    "- do not create any new candidate ids",
    "- keep final output closed and compact",
    "",
    stringifyUnicodeSafe(payload),
  ].join("\n");
}
