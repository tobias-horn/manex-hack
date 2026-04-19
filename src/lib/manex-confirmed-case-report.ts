import { createOpenAI } from "@ai-sdk/openai";

import type { ArticleHypothesisCardViewModel } from "@/lib/article-hypothesis-view";
import { buildArticleHypothesisBoardViewModel } from "@/lib/article-hypothesis-view";
import { listArticleHypothesisReviews } from "@/lib/article-hypothesis-review-state";
import { capabilities, env } from "@/lib/env";
import {
  QUALITY_NOTIFICATION_TEAMS,
  confirmedCaseReportSchema,
  type ConfirmedCaseReport,
  type ConfirmedCaseReportRecord,
  type ConfirmedCaseReportTeamSuggestion,
  type QualityNotificationTeamId,
} from "@/lib/manex-confirmed-case-report-schema";
import {
  getConfirmedCaseReportRecord,
  upsertConfirmedCaseReportRecord,
} from "@/lib/manex-confirmed-case-report-state";
import { loadArticleCaseboard } from "@/lib/manex-case-viewer";
import { generateStructuredObjectWithRepair } from "@/lib/openai-resilience";
import {
  buildManexConfirmedCaseReportUserPrompt,
  MANEX_CONFIRMED_CASE_REPORT_PROMPT_VERSION,
  MANEX_CONFIRMED_CASE_REPORT_SYSTEM_PROMPT,
} from "@/prompts/manex-confirmed-case-report";

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.replace(/\s+/g, " ").trim()).filter(Boolean) as string[]),
  );
}

function clipText(value: string | null | undefined, max: number) {
  const text = value?.replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

function clipRequiredText(value: string | null | undefined, max: number, fallback: string) {
  return clipText(value, max) ?? fallback;
}

function clipTextList(
  values: Array<string | null | undefined>,
  maxItemLength: number,
  maxItems: number,
  fallback?: string,
) {
  const clipped = uniqueStrings(values)
    .map((value) => clipText(value, maxItemLength))
    .filter((value): value is string => Boolean(value))
    .slice(0, maxItems);

  if (!clipped.length && fallback) {
    return [fallback];
  }

  return clipped;
}

function normalizeCaseKind(value: string) {
  return value.replace(/[_-]+/g, " ").trim().toLowerCase();
}

function inferCaseFamily(candidate: ArticleHypothesisCardViewModel) {
  const kind = normalizeCaseKind(candidate.caseKind);
  const title = `${candidate.title} ${candidate.summary} ${candidate.thesis}`.toLowerCase();

  if (
    /supplier|material|incoming|batch|capacitor|vendor/.test(kind) ||
    /supplier|batch|incoming|material|capacitor/.test(title) ||
    candidate.supplierBatches.length
  ) {
    return "supplier";
  }

  if (
    /design|thermal|latent|claim/.test(kind) ||
    /thermal|latent|field claim|drift|r33/.test(title)
  ) {
    return "design";
  }

  if (
    /operator|handling|workflow|cosmetic/.test(kind) ||
    /operator|handling|scratch|label|packaging/.test(title)
  ) {
    return "operator";
  }

  if (
    /process|calibration|assembly|line|torque/.test(kind) ||
    /process|calibration|line|torque|station|montage/.test(title)
  ) {
    return "process";
  }

  return "general";
}

function buildTeamSuggestion(
  teamId: QualityNotificationTeamId,
  rationale: string,
  urgency: ConfirmedCaseReportTeamSuggestion["urgency"],
  preselected: boolean,
) {
  return {
    teamId,
    rationale: clipRequiredText(rationale, 320, "Team involvement is recommended from the confirmed evidence trail."),
    urgency,
    preselected,
  } satisfies ConfirmedCaseReportTeamSuggestion;
}

function buildFallbackTeamSuggestions(candidate: ArticleHypothesisCardViewModel) {
  const family = inferCaseFamily(candidate);

  if (family === "supplier") {
    return [
      buildTeamSuggestion(
        "quality_management",
        "A confirmed material incident needs a formal owner for the quality escalation and closeout path.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "supplier_quality",
        "Shared supplier or batch evidence points to supplier containment and batch-level corrective action.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "procurement",
        "Incoming stock or sourcing exposure may need to be blocked or rerouted while containment runs.",
        "secondary",
        true,
      ),
      buildTeamSuggestion(
        "manufacturing_engineering",
        "The factory still needs to validate where the batch surfaced in production and whether screening should tighten.",
        "secondary",
        false,
      ),
    ];
  }

  if (family === "design") {
    return [
      buildTeamSuggestion(
        "quality_management",
        "A confirmed latent defect needs cross-functional ownership and a controlled quality response.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "design_engineering",
        "The case points to a product or BOM-position weakness that requires an engineering design decision.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "field_quality",
        "The evidence trail is driven by field behavior and service-side symptom feedback.",
        "secondary",
        true,
      ),
      buildTeamSuggestion(
        "customer_support",
        "Customer-facing communication may be needed if affected shipped units require follow-up.",
        "monitor",
        false,
      ),
    ];
  }

  if (family === "operator") {
    return [
      buildTeamSuggestion(
        "quality_management",
        "The case should still enter the formal quality loop even if the mechanism is handling or operator driven.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "operations_training",
        "The pattern points to operator handling, packaging, or work-instruction reinforcement.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "manufacturing_engineering",
        "Line-side safeguards or station-level controls may be needed to prevent recurrence.",
        "secondary",
        true,
      ),
    ];
  }

  if (family === "process") {
    return [
      buildTeamSuggestion(
        "quality_management",
        "A confirmed process failure needs a visible quality owner and tracked corrective path.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "manufacturing_engineering",
        "The evidence points to calibration, station behavior, or process controls inside the factory.",
        "primary",
        true,
      ),
      buildTeamSuggestion(
        "operations_training",
        "Process recovery often needs operator reinforcement once the technical fix is defined.",
        "secondary",
        false,
      ),
    ];
  }

  return [
    buildTeamSuggestion(
      "quality_management",
      "The confirmed case needs one central quality owner before any wider workflow starts.",
      "primary",
      true,
    ),
    buildTeamSuggestion(
      "manufacturing_engineering",
      "The current record still points back to line-side evidence and factory-side verification work.",
      "secondary",
      true,
    ),
    buildTeamSuggestion(
      "field_quality",
      "Additional external symptom collection may be useful if more customer evidence appears.",
      "monitor",
      false,
    ),
  ];
}

function buildFallbackContainmentActions(candidate: ArticleHypothesisCardViewModel) {
  const actions = clipTextList(
    [
    candidate.nextChecks[0],
    candidate.suggestedActionComment,
    candidate.actions[0]?.comments,
    ],
    240,
    4,
  );

  if (!actions.length) {
    actions.push(
      "Open containment and attach the confirmed evidence trail.",
    );
  }

  return actions.slice(0, 4);
}

function buildFallbackCorrectiveActions(candidate: ArticleHypothesisCardViewModel) {
  const actions = clipTextList(
    [
    ...candidate.nextChecks,
    candidate.actions[1]?.comments,
    candidate.actions[2]?.comments,
    ],
    240,
    4,
  );

  if (!actions.length) {
    actions.push(
      "Define permanent corrective action with owner and exit criteria.",
    );
  }

  return actions.slice(0, 4);
}

function buildFallbackValidationPlan(candidate: ArticleHypothesisCardViewModel) {
  const plan = clipTextList(
    [
    ...candidate.mustBeTrue.map((item) => `Verify assumption: ${item}`),
    ...candidate.weakensIt.map((item) => `Challenge test: ${item}`),
    ],
    240,
    4,
  );

  if (!plan.length) {
    plan.push(
      "Compare affected units against unaffected units before closure.",
    );
  }

  return plan.slice(0, 4);
}

function buildFallbackReport(input: {
  articleId: string;
  articleName: string | null;
  candidate: ArticleHypothesisCardViewModel;
}) {
  const { articleId, articleName, candidate } = input;
  const articleLabel = articleName ? `${articleId} · ${articleName}` : articleId;
  const timeline = [...candidate.timeline]
    .reverse()
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      label: clipRequiredText(item.label, 140, "Evidence event"),
      detail: clipRequiredText(item.detail, 320, "Evidence event from the confirmed case timeline."),
      timestamp: item.timestamp,
      context:
        clipText(uniqueStrings([item.productId, item.section, item.signalType]).join(" · "), 180) ??
        null,
    }));

  return confirmedCaseReportSchema.parse({
    headline: clipRequiredText(
      `${articleId} · ${candidate.title}`,
      180,
      articleId,
    ),
    executiveSummary: clipRequiredText(
      candidate.summary,
      900,
      "Confirmed case ready for follow-up.",
    ),
    problemStatement: clipRequiredText(
      `${normalizeCaseKind(candidate.caseKind)} case in ${articleLabel}. ${candidate.affectedProductCount} products and ${candidate.signalCount} supporting signals in scope.`,
      900,
      `${articleLabel} contains a confirmed quality case.`,
    ),
    confirmedMechanism: clipRequiredText(
      candidate.thesis,
      900,
      "Confirmed mechanism captured from the approved hypothesis.",
    ),
    severityAssessment: clipRequiredText(
      `Priority ${candidate.priority}. Anchor signal: ${candidate.strongestSharedSignal}.`,
      500,
      `Priority ${candidate.priority}.`,
    ),
    scope: {
      affectedProductCount: candidate.affectedProductCount,
      signalCount: candidate.signalCount,
      productIds: candidate.productIds.slice(0, 24),
      reportedParts: candidate.reportedParts.slice(0, 12),
      findNumbers: candidate.findNumbers.slice(0, 12),
      supplierBatches: candidate.supplierBatches.slice(0, 12),
      sections: candidate.sections.slice(0, 12),
    },
    evidenceHighlights: clipTextList(
      [
        ...candidate.whyItFits,
        candidate.strongestSharedSignal,
        ...candidate.memberNotes,
      ],
      240,
      6,
      "Evidence carried over from the approved hypothesis.",
    ),
    containmentActions: buildFallbackContainmentActions(candidate),
    correctiveActions: buildFallbackCorrectiveActions(candidate),
    validationPlan: buildFallbackValidationPlan(candidate),
    watchouts: clipTextList([...candidate.weakensIt, ...candidate.whyNot], 240, 4),
    timeline,
    suggestedTeams: buildFallbackTeamSuggestions(candidate),
  });
}

async function generateConfirmedCaseReport(input: {
  articleId: string;
  articleName: string | null;
  candidate: ArticleHypothesisCardViewModel;
}) {
  const fallback = buildFallbackReport(input);

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    return {
      report: fallback,
      runtimeMode: "template" as const,
      modelName: null,
    };
  }

  try {
    const openai = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    const report = await generateStructuredObjectWithRepair({
      model: openai.responses(env.OPENAI_MODEL),
      schema: confirmedCaseReportSchema,
      schemaName: "manex_confirmed_case_report",
      schemaDescription:
        "Structured confirmed-case quality report with notification suggestions for the Manex quality workspace.",
      system: MANEX_CONFIRMED_CASE_REPORT_SYSTEM_PROMPT,
      prompt: buildManexConfirmedCaseReportUserPrompt({
        articleId: input.articleId,
        articleName: input.articleName,
        confirmedCase: {
          id: input.candidate.id,
          title: input.candidate.title,
          caseKind: input.candidate.caseKind,
          priority: input.candidate.priority,
          thesis: input.candidate.thesis,
          summary: input.candidate.summary,
          strongestSharedSignal: input.candidate.strongestSharedSignal,
          affectedProductCount: input.candidate.affectedProductCount,
          signalCount: input.candidate.signalCount,
          productIds: input.candidate.productIds,
          signalIds: input.candidate.signalIds,
          reportedParts: input.candidate.reportedParts,
          findNumbers: input.candidate.findNumbers,
          supplierBatches: input.candidate.supplierBatches,
          sections: input.candidate.sections,
          whyItFits: input.candidate.whyItFits,
          mustBeTrue: input.candidate.mustBeTrue,
          weakensIt: input.candidate.weakensIt,
          nextChecks: input.candidate.nextChecks,
          whyNot: input.candidate.whyNot,
          relatedProducts: input.candidate.relatedProducts,
          recentActions: input.candidate.actions,
          timeline: input.candidate.timeline.map((item) => ({
            label: item.label,
            detail: item.detail,
            timestamp: item.timestamp,
            productId: item.productId,
            section: item.section,
            signalType: item.signalType,
          })),
        },
        availableTeams: QUALITY_NOTIFICATION_TEAMS,
        fallbackTeamSuggestions: fallback.suggestedTeams,
      }),
      maxOutputTokens: 2_500,
      maxAttempts: 2,
      providerOptions: {
        openai: {
          reasoningEffort: "medium",
          store: false,
          textVerbosity: "low",
        },
      },
    });

    return {
      report,
      runtimeMode: "live_ai" as const,
      modelName: env.OPENAI_MODEL,
    };
  } catch (error) {
    console.warn(
      `[confirmed-case-report:fallback] ${input.articleId}/${input.candidate.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return {
      report: fallback,
      runtimeMode: "template" as const,
      modelName: null,
    };
  }
}

async function loadConfirmedCaseCandidate(input: {
  articleId: string;
  candidateId: string;
  pipelineMode: ConfirmedCaseReportRecord["pipelineMode"];
}) {
  const caseboard = await loadArticleCaseboard(input.articleId, input.pipelineMode);

  if (!caseboard) {
    throw new Error("Could not load the article caseboard for this confirmed report.");
  }

  const reviews = capabilities.hasPostgres
    ? await listArticleHypothesisReviews(caseboard.articleId, input.pipelineMode)
    : [];

  const viewModel = buildArticleHypothesisBoardViewModel({
    caseboard,
    mode: input.pipelineMode,
    initialSelectedId: input.candidateId,
    reviews,
  });

  const candidate =
    viewModel.hypotheses.find((hypothesis) => hypothesis.id === input.candidateId) ?? null;

  if (!candidate) {
    throw new Error("Could not find the confirmed hypothesis in the current article snapshot.");
  }

  return {
    articleId: caseboard.articleId,
    articleName: caseboard.articleName,
    candidate,
  };
}

export function getDefaultSelectedTeamIds(report: ConfirmedCaseReport) {
  return report.suggestedTeams
    .filter((team) => team.preselected)
    .map((team) => team.teamId);
}

export async function ensureConfirmedCaseReport(input: {
  articleId: string;
  candidateId: string;
  pipelineMode: ConfirmedCaseReportRecord["pipelineMode"];
  candidateTitle?: string | null;
  force?: boolean;
}) {
  if (capabilities.hasPostgres && !input.force) {
    const existing = await getConfirmedCaseReportRecord({
      articleId: input.articleId,
      candidateId: input.candidateId,
      pipelineMode: input.pipelineMode,
    });

    if (existing && existing.promptVersion === MANEX_CONFIRMED_CASE_REPORT_PROMPT_VERSION) {
      return existing;
    }
  }

  const context = await loadConfirmedCaseCandidate(input);
  const generated = await generateConfirmedCaseReport(context);

  if (!capabilities.hasPostgres) {
    const now = new Date().toISOString();
    return {
      id: createId("QREP"),
      articleId: context.articleId,
      candidateId: context.candidate.id,
      pipelineMode: input.pipelineMode,
      candidateTitle: input.candidateTitle ?? context.candidate.title,
      runtimeMode: generated.runtimeMode,
      modelName: generated.modelName,
      promptVersion: MANEX_CONFIRMED_CASE_REPORT_PROMPT_VERSION,
      report: generated.report,
      selectedTeamIds: getDefaultSelectedTeamIds(generated.report),
      notifyRequestedAt: null,
      notifyRequestedBy: null,
      createdAt: now,
      updatedAt: now,
    } satisfies ConfirmedCaseReportRecord;
  }

  return upsertConfirmedCaseReportRecord({
    id: createId("QREP"),
    articleId: context.articleId,
    candidateId: context.candidate.id,
    pipelineMode: input.pipelineMode,
    candidateTitle: input.candidateTitle ?? context.candidate.title,
    runtimeMode: generated.runtimeMode,
    modelName: generated.modelName,
    promptVersion: MANEX_CONFIRMED_CASE_REPORT_PROMPT_VERSION,
    report: generated.report,
  });
}
