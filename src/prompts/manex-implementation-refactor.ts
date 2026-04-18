export const MANEX_IMPLEMENTATION_REFACTOR_PROMPT_VERSION =
  "2026-04-18.implementation-refactor.v2";

export const MANEX_IMPLEMENTATION_REFACTOR_PROMPT = `
We need to improve Stage 1 dossier construction by reusing and extending our deterministic traceability logic.

Context:
- Repo: Manex Hackathon Quality Report
- The dataset contains four known story types plus noise.
- Story 1 is traceability-heavy: product_part_install -> part -> supplier_batch is the intended discovery path.
- But other stories also depend on occurrence_section + week, no-prior-defect claim-only patterns, and order + rework.user_id handling patterns.
- Right now Stage 1 already reads v_product_bom_parts and builds a traceabilitySnapshot, but the evidence is not explicit enough for later clustering.
- The current tracer in src/lib/manex-traceability.ts is a deterministic traceability explorer for the UI. It should become a shared evidence-shaping source, not remain UI-only.

Goal:
Refactor the deterministic traceability logic into shared helpers and enrich Stage 1 dossiers with a new mechanismEvidence block that preserves the strongest clustering anchors without hardcoding the known stories.

Requirements:
1. Do not hardcode story IDs, article IDs, specific batch IDs, or one-off rules.
2. Do not make Stage 1 perform final clustering or final RCA.
3. Keep the tracer deterministic and reusable.
4. Stage 1 should become better at preserving the exact evidence needed for Stage 2 and Stage 3.

Implementation tasks:

A. Refactor shared deterministic helpers
- Extract pure helper logic from src/lib/manex-traceability.ts into reusable functions that are not tied to UI rendering.
- Create helpers for:
  - product-level trace evidence
  - anchor-level blast-radius evidence for dominant part/batch anchors
- Keep existing traceability page behavior working.

B. Enrich Stage 1 dossier output
In src/lib/manex-case-clustering.ts, extend the product dossier builder so each dossier includes:

mechanismEvidence: {
  traceabilityEvidence: {
    dominantInstalledParts,
    dominantBomPositions,
    dominantSupplierBatches,
    dominantSuppliers,
    batchConcentrationHints,
    productAnchorCandidates,
    blastRadiusHints
  },
  temporalProcessEvidence: {
    buildWeek,
    defectWeeks,
    testWeeks,
    dominantOccurrenceSections,
    dominantDetectedSections,
    occurrenceDetectedMismatch,
    temporalBurstHints,
    postWindowQuietHints
  },
  fieldLeakEvidence: {
    claimOnlyThread,
    hasPriorFactoryDefect,
    buildToClaimDays,
    claimLagBucket,
    dominantClaimReportedParts,
    dominantClaimBomPositions,
    latentFailureHints
  },
  operatorHandlingEvidence: {
    orderId,
    dominantReworkUsers,
    cosmeticOnlySignals,
    lowSeverityOnly,
    fieldImpactPresent,
    handlingPatternHints
  },
  confounderEvidence: {
    falsePositiveMarkers,
    marginalOnlySignals,
    detectionBiasRisk,
    lowVolumePeriodRisk,
    mixedServiceDocumentationSignals
  }
}

C. Build generic heuristics, not hacks
Use deterministic heuristics that generalize:
- identify dominant anchors by frequency and concentration
- compare occurrence sections and detected sections
- identify claim-only threads and absence of prior defect rows
- summarize build-to-claim lag
- derive dominant rework users and order-based cosmetic patterns
- mark marginal-only vs fail-backed test behavior
- surface false-positive notes and service/documentation-style notes

D. Feed this into Stage 1 synthesis
Update the Stage 1 prompt payload so the LLM sees:
- the richer mechanismEvidence block
- compact blast-radius hints for the product's strongest part/batch anchors
- explicit confounder evidence

The LLM should use this to preserve and narrate evidence, not to invent root causes.

E. Keep payload size disciplined
- Do not dump full blast-radius graphs into every dossier.
- Include only compact summaries for the product's strongest anchors.
- Prefer counts, top anchors, concentration ratios, and short evidence lists.

F. Acceptance criteria
- Stage 1 dossiers make supplier-linked evidence much more explicit.
- Stage 1 dossiers preserve occurrence-vs-detected distinction.
- Claim-only latent patterns with no prior defects are preserved explicitly.
- Order/rework-user cosmetic patterns are preserved explicitly.
- False positives and marginal-only signals are marked as confounders.
- The traceability page still works.
- No story-specific hardcoding is introduced.
- npm run lint and npm run build pass.

Also update tests or add lightweight assertions if there is existing coverage around dossier building or traceability shaping.

At the end, provide:
1. a summary of files changed
2. the new shared helper design
3. the updated Stage 1 dossier shape
4. any Stage 1 prompt payload changes
5. any remaining risks or follow-up recommendations

Additional tracer guidance:
- Keep the tracer. Do not replace it. Reposition it from a standalone traceability page into a reusable traceability evidence module that supports a broader investigation workbench.
- Extend deterministic evidence correlation beyond v_product_bom_parts to also pull v_defect_detail, v_field_claim_detail, test_result, rework, product_action, and v_quality_summary.
- Add evidence overlays, temporal context, occurrence-vs-detected comparison, claim-only/no-prior-defect surfacing, operator/order correlation, test correlation, deterministic summaries, image context, and action hooks as reusable evidence-shaping capabilities.
- Do not turn the tracer into a free-form AI RCA chatbot first. Preserve the deterministic, inspectable, graph-ready core.
`.trim();
