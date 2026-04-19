import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import {
  buildArticleDossier,
  type ClusteredArticleDossier,
  type ClusteredProductDossier,
} from "@/lib/manex-case-clustering";
import { getTeamArticleDossierRecord } from "@/lib/manex-case-clustering-state";
import { capabilities, env } from "@/lib/env";
import { stringifyUnicodeSafe } from "@/lib/json-unicode";
import {
  completeHypothesisCaseRun,
  createHypothesisCaseRun,
  failHypothesisCaseRun,
  getLatestHypothesisCaseRun,
  listActiveHypothesisCaseRuns,
  listHypothesisArticleClusterCards,
  listHypothesisCaseCandidatesForProduct,
  listHypothesisCaseCandidatesForRun,
  replaceHypothesisCaseCandidatesForRun,
  updateHypothesisCaseRunStage,
  type HypothesisArticleClusterCard,
  type HypothesisCaseBatchArticleResult,
  type HypothesisCaseCandidatePriority,
  type HypothesisCaseCandidateRecord,
  type HypothesisCaseRunSummary,
} from "@/lib/manex-hypothesis-case-clustering-state";
import { queryPostgres } from "@/lib/postgres";
import {
  buildHypothesisNarrativeSystemPrompt,
  buildHypothesisNarrativeUserPrompt,
  MANEX_HYPOTHESIS_CASE_CLUSTERING_PROMPT_VERSION,
} from "@/prompts/manex-hypothesis-case-clustering";
import { generateStructuredObjectWithRepair } from "@/lib/openai-resilience";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

const HYP_LOCAL_INVENTORY_SCHEMA_VERSION = "manex.hyp_case_inventory.v1";
const HYP_GLOBAL_INVENTORY_SCHEMA_VERSION = "manex.hyp_global_inventory.v1";
const HYP_RUN_REVIEW_SCHEMA_VERSION = "manex.hyp_case_pipeline_review.v1";
const HYP_CASE_PAYLOAD_SCHEMA_VERSION = "manex.hyp_case_payload.v1";
const HYP_PROMPT_VERSION = MANEX_HYPOTHESIS_CASE_CLUSTERING_PROMPT_VERSION;

const readPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const HYP_NARRATIVE_CONCURRENCY = readPositiveInt(
  process.env.MANEX_HYP_NARRATIVE_CONCURRENCY,
  /mini/i.test(env.OPENAI_MODEL) ? 6 : 4,
);
const HYP_MODEL_CALL_MAX_ATTEMPTS = readPositiveInt(
  process.env.MANEX_HYP_MODEL_CALL_MAX_ATTEMPTS,
  4,
);
const HYP_NARRATIVE_MAX_OUTPUT_TOKENS = readPositiveInt(
  process.env.MANEX_HYP_NARRATIVE_MAX_OUTPUT_TOKENS,
  1600,
);
const HYP_REASONING_EFFORT =
  (process.env.MANEX_HYP_REASONING_EFFORT as
    | "none"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | undefined) ?? "low";
const HYP_ARTICLE_PIPELINE_CONCURRENCY = readPositiveInt(
  process.env.MANEX_HYP_ARTICLE_PIPELINE_CONCURRENCY,
  4,
);
const CASE_SCORE_THRESHOLD = readPositiveInt(process.env.MANEX_HYP_CASE_SCORE_THRESHOLD, 10);
const WATCHLIST_SCORE_THRESHOLD = readPositiveInt(
  process.env.MANEX_HYP_WATCHLIST_SCORE_THRESHOLD,
  6,
);
const GLOBAL_CASE_EDGE_THRESHOLD = readPositiveInt(
  process.env.MANEX_HYP_GLOBAL_CASE_EDGE_THRESHOLD,
  2,
);
const GLOBAL_KEEP_CONFIDENCE_THRESHOLD = 0.62;
const CASE_OVERLAP_MARGIN = readPositiveInt(process.env.MANEX_HYP_CASE_OVERLAP_MARGIN, 3);
const LEADING_INDICATOR_THRESHOLD = readPositiveInt(
  process.env.MANEX_HYP_LEADING_INDICATOR_THRESHOLD,
  4,
);
const STOPPED_PIPELINE_MESSAGE = "Pipeline stopped by user.";

const prioritySchema = z.enum(["low", "medium", "high", "critical"]);

const hypothesisNarrativeSchema = z.object({
  title: z.string().trim().min(8).max(180),
  summary: z.string().trim().min(20).max(1000),
  suspectedCommonRootCause: z.string().trim().min(8).max(320),
  strongestEvidence: z.array(z.string().trim().min(1).max(220)).min(2).max(8),
  conflictingEvidence: z.array(z.string().trim().min(1).max(220)).max(8),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(220)).max(8),
  oneLineWhyGrouped: z.string().trim().min(12).max(240),
  oneLineWhyExcluded: z.string().trim().min(12).max(240),
  recommendedActions: z.array(z.string().trim().min(1).max(220)).max(6),
});

const localInventoryCaseSchema = z.object({
  caseTempId: z.string().trim().min(1).max(48),
  family: z.enum([
    "supplier_batch",
    "process_window",
    "latent_design",
    "handling_cluster",
  ]),
  anchorKey: z.string().trim().min(1).max(180),
  anchorLabel: z.string().trim().min(1).max(220),
  title: z.string().trim().min(8).max(180),
  summary: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  includedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(96),
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(400),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).min(1).max(10),
  conflictingEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(240)).max(10),
  score: z.number(),
  fingerprintTokens: z.array(z.string().trim().min(1).max(180)).max(32),
});

const localInventoryIncidentSchema = z.object({
  incidentTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  family: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  productId: z.string().trim().min(1).max(80),
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(180),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(240)).max(8),
});

const localInventoryWatchlistSchema = z.object({
  watchlistTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  family: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(96),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(260),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
});

const localLeadingIndicatorSchema = z.object({
  indicatorTempId: z.string().trim().min(1).max(48),
  indicatorKind: z.enum(["near_limit", "marginal_drift", "screening_echo"]),
  title: z.string().trim().min(8).max(180),
  summary: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(96),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(260),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
});

const localInventoryNoiseSchema = z.object({
  noiseTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  family: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1200),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).max(96),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(260),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
});

const localInventoryRejectedSchema = z.object({
  rejectedTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  family: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(240),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).max(96),
});

const hypothesisEvaluationRowSchema = z.object({
  truthId: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(180),
  family: z.string().trim().min(1).max(80),
  expectedKind: z.string().trim().min(1).max(80),
  applicable: z.boolean(),
  surfaced: z.boolean(),
  rankPosition: z.number().int().positive().nullable(),
  matchedCandidateId: z.string().trim().min(1).max(80).nullable(),
  matchedTitle: z.string().trim().min(1).max(180).nullable(),
  matchedAnchor: z.string().trim().min(1).max(220).nullable(),
  falseMergeCount: z.number().int().min(0),
  falseNeighborCount: z.number().int().min(0),
  topEvidence: z.array(z.string().trim().min(1).max(240)).max(6),
  notes: z.array(z.string().trim().min(1).max(240)).max(8),
});

const hypothesisEvaluationSummarySchema = z.object({
  applicableTruthCount: z.number().int().min(0),
  surfacedTruthCount: z.number().int().min(0),
  leadingIndicatorCount: z.number().int().min(0),
  falseMergeCount: z.number().int().min(0),
  falseNeighborCount: z.number().int().min(0),
  summaryLine: z.string().trim().min(1).max(320),
  rows: z.array(hypothesisEvaluationRowSchema).max(12),
});

const hypothesisLocalInventorySchema = z.object({
  contractVersion: z.literal(HYP_LOCAL_INVENTORY_SCHEMA_VERSION),
  reviewSummary: z.string().trim().min(1).max(1400),
  cases: z.array(localInventoryCaseSchema).max(40),
  incidents: z.array(localInventoryIncidentSchema).max(80),
  watchlists: z.array(localInventoryWatchlistSchema).max(40),
  leadingIndicators: z.array(localLeadingIndicatorSchema).max(40).default([]),
  noise: z.array(localInventoryNoiseSchema).max(40),
  rejectedCases: z.array(localInventoryRejectedSchema).max(32),
  unassignedProducts: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(1).max(240),
      }),
    )
    .max(120),
  globalObservations: z.array(z.string().trim().min(1).max(240)).max(20),
  caseMergeLog: z.array(z.string().trim().min(1).max(240)).max(24),
  evaluationSummary: hypothesisEvaluationSummarySchema.optional(),
});

const hypothesisGlobalInventoryItemSchema = z.object({
  inventoryTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  inventoryKind: z.enum(["validated_case", "watchlist", "noise_bucket", "rejected_case"]),
  caseTypeHint: z.enum(["supplier", "process", "design", "handling", "watchlist", "noise"]),
  oneLineExplanation: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(1200),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  articleIds: z.array(z.string().trim().min(1).max(80)).max(24),
  linkedCandidateIds: z.array(z.string().trim().min(1).max(80)).max(64),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
});

const hypothesisGlobalInventorySchema = z.object({
  contractVersion: z.literal(HYP_GLOBAL_INVENTORY_SCHEMA_VERSION),
  inventorySummary: z.string().trim().min(1).max(1400),
  validatedCases: z.array(hypothesisGlobalInventoryItemSchema).max(40),
  watchlists: z.array(hypothesisGlobalInventoryItemSchema).max(40),
  leadingIndicators: z.array(hypothesisGlobalInventoryItemSchema).max(40).default([]),
  noiseBuckets: z.array(hypothesisGlobalInventoryItemSchema).max(40),
  rejectedCases: z.array(hypothesisGlobalInventoryItemSchema).max(40),
  caseMergeLog: z.array(z.string().trim().min(1).max(240)).max(24),
  confidenceNotes: z.array(z.string().trim().min(1).max(240)).max(16),
});

type HypothesisNarrative = z.infer<typeof hypothesisNarrativeSchema>;
type HypothesisLocalInventory = z.infer<typeof hypothesisLocalInventorySchema>;
type HypothesisLocalIncident = z.infer<typeof localInventoryIncidentSchema>;
type HypothesisLocalWatchlist = z.infer<typeof localInventoryWatchlistSchema>;
type HypothesisLocalLeadingIndicator = z.infer<typeof localLeadingIndicatorSchema>;
type HypothesisLocalNoise = z.infer<typeof localInventoryNoiseSchema>;
type HypothesisGlobalInventory = z.infer<typeof hypothesisGlobalInventorySchema>;
export type HypothesisGlobalInventoryItem = z.infer<typeof hypothesisGlobalInventoryItemSchema>;
type HypothesisEvaluationSummary = z.infer<typeof hypothesisEvaluationSummarySchema>;

type HypothesisReviewPayload = {
  contractVersion: typeof HYP_RUN_REVIEW_SCHEMA_VERSION;
  localInventory: HypothesisLocalInventory;
  globalInventory: HypothesisGlobalInventory;
};

type HypothesisFamily =
  | "supplier_batch"
  | "process_window"
  | "latent_design"
  | "handling_cluster"
  | "noise_watchlist";
type HypothesisKind = "case" | "watchlist" | "noise" | "incident" | "rejected";

type ScoreBreakdown = {
  impact: number;
  coherence: number;
  causalSupport: number;
  uplift: number;
  specificityBonus: number;
  noisePenalty: number;
  negativeEvidencePenalty: number;
  overlapPenalty: number;
  total: number;
};

type TextFeatureTags = {
  symptomTags: string[];
  timingTags: string[];
  dispositionTags: string[];
};

type ThreadFacts = {
  productId: string;
  thread: ClusteredProductDossier;
  nonActionSignalIds: string[];
  signalIds: string[];
  defectCodes: string[];
  testKeys: string[];
  reportedParts: string[];
  bomFindNumbers: string[];
  supplierBatches: string[];
  orderId: string | null;
  reworkUsers: string[];
  occurrenceSections: string[];
  detectedSections: string[];
  firstFactorySignalWeek: string | null;
  lastFactorySignalWeek: string | null;
  claimLagBucket: "none" | "same_week" | "short" | "medium" | "long";
  hasClaimOnlyLag: boolean;
  marginalOnly: boolean;
  falsePositive: boolean;
  serviceDocumentation: boolean;
  cosmeticOnly: boolean;
  lowSeverityOnly: boolean;
  fieldImpactPresent: boolean;
  detectionBias: boolean;
  lowVolumeRisk: boolean;
  nearLimitSignals: string[];
  buildWeek: string | null;
  defectCount: number;
  claimCount: number;
  badTestCount: number;
  marginalTestCount: number;
  textTags: TextFeatureTags;
};

type HypothesisSeed = {
  tempId: string;
  family: HypothesisFamily;
  kind: HypothesisKind;
  caseTypeHint: "supplier" | "process" | "design" | "handling" | "watchlist" | "noise";
  anchorKey: string;
  anchorLabel: string;
  titleSeed: string;
  summarySeed: string;
  includedProductIds: string[];
  includedSignalIds: string[];
  strongestEvidence: string[];
  conflictingEvidence: string[];
  recommendedNextTraceChecks: string[];
  fingerprintTokens: string[];
  score: ScoreBreakdown;
  articleWideAnchorRisk: boolean;
  recommendedActionType: string;
};

type PersistableHypothesisCandidate = {
  id: string;
  title: string;
  lifecycleStatus: "proposed";
  caseKind: string;
  summary: string;
  suspectedCommonRootCause: string;
  confidence: number;
  priority: HypothesisCaseCandidatePriority;
  strongestEvidence: string[];
  conflictingEvidence: string[];
  recommendedNextTraceChecks: string[];
  includedProductIds: string[];
  includedSignalIds: string[];
  payload: unknown;
  members: Array<{
    id: string;
    memberType: "product" | "signal";
    entityId: string;
    productId?: string | null;
    signalId?: string | null;
    signalType?: string | null;
    rationale?: string | null;
  }>;
};

export type HypothesisArticleCaseboardReadModel = {
  articleId: string;
  articleName: string | null;
  dashboardCard: HypothesisArticleClusterCard | null;
  dossier: ClusteredArticleDossier | null;
  latestRun: HypothesisCaseRunSummary | null;
  proposedCases: HypothesisCaseCandidateRecord[];
  incidents: HypothesisLocalIncident[];
  watchlists: HypothesisLocalWatchlist[];
  leadingIndicators: HypothesisLocalLeadingIndicator[];
  noise: HypothesisLocalNoise[];
  unassignedProducts: Array<{
    productId: string;
    reason: string;
  }>;
  globalObservations: string[];
  globalInventory: HypothesisGlobalInventory | null;
  evaluationSummary: HypothesisEvaluationSummary | null;
};

export type HypothesisProposedCasesDashboardReadModel = {
  articles: HypothesisArticleClusterCard[];
  activeRuns: HypothesisCaseRunSummary[];
  articleQueues: Array<{
    articleId: string;
    articleName: string | null;
    proposedCaseCount: number;
    affectedProductCount: number;
    highestPriority: "low" | "medium" | "high" | "critical" | null;
    topConfidence: number | null;
    summary: string | null;
    leadingCaseTitle: string | null;
    latestRun: HypothesisCaseRunSummary | null;
  }>;
  latestGlobalRun: HypothesisCaseRunSummary | null;
  globalInventory: HypothesisGlobalInventory | null;
};

type HypothesisTruthDefinition = {
  truthId: string;
  label: string;
  family: HypothesisFamily | "leading_indicator";
  expectedKind: HypothesisKind | "leading_indicator";
  articleId: string | null;
  anchorTokens: string[];
  notes: string;
};

type LatestCompletedHypothesisRunRow = {
  run_id: string;
  article_id: string;
  article_name: string | null;
  review_payload: unknown;
  completed_at: string | null;
};

type HypothesisCaseClusteringBatchResult = HypothesisCaseBatchArticleResult;

const openai = capabilities.hasAi && env.OPENAI_API_KEY ? createOpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeNullableText(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

function trimPreview(value: string | null | undefined, max = 220) {
  const text = normalizeNullableText(value) ?? "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeNullableText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function clampScore(value: number, min = 0, max = 24) {
  return Math.max(min, Math.min(max, value));
}

function rate(count: number, total: number) {
  return total > 0 ? count / total : 0;
}

function scoreRateUplift(observed: number, baseline: number) {
  const stabilizedObserved = observed + 0.02;
  const stabilizedBaseline = baseline + 0.02;
  const ratio = stabilizedObserved / stabilizedBaseline;

  if (!Number.isFinite(ratio) || ratio <= 1.05) {
    return 0;
  }

  return clampScore(Math.round(Math.log2(ratio) * 3), 0, 6);
}

function scoreSpecificity(sharedAnchorCount: number, productCount: number, articleProductCount: number) {
  if (productCount <= 0 || articleProductCount <= 0) {
    return 0;
  }

  const concentration = productCount / Math.max(1, articleProductCount);

  if (concentration >= 0.75) {
    return 0;
  }

  return clampScore(Math.min(sharedAnchorCount, 3) + (concentration <= 0.4 ? 2 : 1), 0, 5);
}

function estimateSmallSamplePenalty(productCount: number) {
  if (productCount >= 6) {
    return 0;
  }

  if (productCount >= 4) {
    return 1;
  }

  return 2;
}

function matchesAnyPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function extractTextTags(thread: ClusteredProductDossier): TextFeatureTags {
  const texts = [
    ...thread.claims.flatMap((item) => [item.complaintText, item.notes]),
    ...thread.rework.map((item) => item.actionText),
    ...thread.defects.map((item) => item.notes),
    ...thread.tests.map((item) => item.notes),
  ]
    .map((value) => normalizeNullableText(value)?.toLowerCase() ?? "")
    .filter(Boolean);

  const symptomTags = uniqueValues([
    texts.some((text) => matchesAnyPattern(text, [/totalausfall|total failure|complete failure/i]))
      ? "total_failure"
      : null,
    texts.some((text) => matchesAnyPattern(text, [/drift|schleichender ausfall/i])) ? "drift" : null,
    texts.some((text) => matchesAnyPattern(text, [/temperatur|thermal|hot/i])) ? "thermal" : null,
    texts.some((text) => matchesAnyPattern(text, [/vib|vibration/i])) ? "vibration" : null,
    texts.some((text) => matchesAnyPattern(text, [/scratch|label|cosmetic|surface|appearance/i]))
      ? "cosmetic"
      : null,
  ]);
  const timingTags = uniqueValues([
    texts.some((text) => matchesAnyPattern(text, [/few weeks|wochen|after weeks|8-12/i]))
      ? "after_weeks"
      : null,
    texts.some((text) => matchesAnyPattern(text, [/immediate|sofort|upon start/i])) ? "immediate" : null,
    texts.some((text) => matchesAnyPattern(text, [/intermittent|sporadic|gelegentlich/i]))
      ? "intermittent"
      : null,
  ]);
  const dispositionTags = uniqueValues([
    texts.some((text) => matchesAnyPattern(text, [/false positive|false alarm|kein fehler/i]))
      ? "false_positive"
      : null,
    texts.some((text) => matchesAnyPattern(text, [/schraubmoment|torque/i])) ? "torque_adjust" : null,
    texts.some((text) => matchesAnyPattern(text, [/label|relabel/i])) ? "relabel" : null,
    texts.some((text) => matchesAnyPattern(text, [/cosmetic only|rein optisch/i]))
      ? "cosmetic_only"
      : null,
  ]);

  return {
    symptomTags,
    timingTags,
    dispositionTags,
  };
}

const HYPOTHESIS_TRUTH_DEFINITIONS: HypothesisTruthDefinition[] = [
  {
    truthId: "story_supplier_batch",
    label: "Story 1 supplier batch",
    family: "supplier_batch",
    expectedKind: "case",
    articleId: null,
    anchorTokens: ["supplier_batch:SB-00007", "part:PM-00008", "defect:SOLDER_COLD"],
    notes: "Bad capacitor batch should surface as a supplier/material case.",
  },
  {
    truthId: "story_process_window",
    label: "Story 2 process drift",
    family: "process_window",
    expectedKind: "case",
    articleId: null,
    anchorTokens: ["occurrence:Montage Linie 1", "test:VIB_TEST", "defect:VIB_FAIL"],
    notes: "Contained vibration failures should stay process-window specific.",
  },
  {
    truthId: "story_latent_design",
    label: "Story 3 latent design",
    family: "latent_design",
    expectedKind: "case",
    articleId: "ART-00001",
    anchorTokens: ["part:PM-00015", "bom:R33", "claim_lag:medium", "claim_lag:long"],
    notes: "Claim-only field lag on ART-00001 should stay article-local unless traceability proves otherwise.",
  },
  {
    truthId: "story_handling_cluster",
    label: "Story 4 handling cluster",
    family: "handling_cluster",
    expectedKind: "case",
    articleId: null,
    anchorTokens: [
      "order:PO-00012",
      "order:PO-00018",
      "order:PO-00024",
      "user:user_042",
      "defect:VISUAL_SCRATCH",
      "defect:LABEL_MISALIGN",
    ],
    notes: "Cosmetic handling pattern should be distinct from process and supplier stories.",
  },
  {
    truthId: "story_detection_bias",
    label: "Noise: detected-section hotspot",
    family: "noise_watchlist",
    expectedKind: "noise",
    articleId: null,
    anchorTokens: ["detected:Pruefung Linie 2"],
    notes: "Detected-section hotspots should stay suppressed as noise, not validated cases.",
  },
  {
    truthId: "story_leading_indicator",
    label: "Leading indicator: near-limit tests",
    family: "leading_indicator",
    expectedKind: "leading_indicator",
    articleId: null,
    anchorTokens: ["leading_indicator:near_limit"],
    notes: "Near-limit tests should surface as leading indicators instead of cases.",
  },
];

function createPipelineStopError(reason = STOPPED_PIPELINE_MESSAGE) {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

function isPipelineStopError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfPipelineAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw createPipelineStopError(
      typeof abortSignal.reason === "string" && abortSignal.reason
        ? abortSignal.reason
        : STOPPED_PIPELINE_MESSAGE,
    );
  }
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
  abortSignal?: AbortSignal,
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      throwIfPipelineAborted(abortSignal);
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()),
  );

  return results;
}

function weekDistance(left: string | null, right: string | null) {
  if (!left || !right) {
    return null;
  }

  const leftDate = new Date(left);
  const rightDate = new Date(right);

  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return null;
  }

  return Math.abs(rightDate.getTime() - leftDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
}

function jaccardIndex(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  let shared = 0;

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      shared += 1;
    }
  }

  return union.size ? shared / union.size : 0;
}

function toPriority(score: number): HypothesisCaseCandidatePriority {
  if (score >= 18) {
    return "critical";
  }

  if (score >= 14) {
    return "high";
  }

  if (score >= 9) {
    return "medium";
  }

  return "low";
}

function toConfidence(score: number) {
  return Math.max(0.18, Math.min(0.96, 0.24 + score / 24));
}

function buildThreadFacts(thread: ClusteredProductDossier): ThreadFacts {
  const signalIds = thread.signals.map((signal) => signal.signalId);
  const nonActionSignalIds = thread.signals
    .filter((signal) => signal.signalType !== "product_action")
    .map((signal) => signal.signalId);
  const textTags = extractTextTags(thread);

  return {
    productId: thread.productId,
    thread,
    signalIds,
    nonActionSignalIds,
    defectCodes: thread.summaryFeatures.defectCodesPresent,
    testKeys: thread.summaryFeatures.testKeysMarginalFail,
    reportedParts: thread.summaryFeatures.reportedPartNumbers,
    bomFindNumbers: thread.summaryFeatures.bomFindNumbers,
    supplierBatches: thread.summaryFeatures.supplierBatches,
    orderId: thread.orderId,
    reworkUsers: thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers.map(
      (item) => item.userId,
    ),
    occurrenceSections:
      thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.map(
        (item) => item.value,
      ),
    detectedSections:
      thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections.map(
        (item) => item.value,
      ),
    firstFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek,
    lastFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.lastFactorySignalWeek,
    claimLagBucket: thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
    hasClaimOnlyLag:
      thread.summaryFeatures.fieldClaimWithoutFactoryDefect &&
      thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket !== "none",
    marginalOnly: thread.mechanismEvidence.confounderEvidence.marginalOnlySignals,
    falsePositive: thread.summaryFeatures.falsePositiveMarkers.length > 0,
    serviceDocumentation:
      thread.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.length > 0,
    cosmeticOnly: thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals,
    lowSeverityOnly: thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly,
    fieldImpactPresent: thread.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent,
    detectionBias:
      thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.length > 0,
    lowVolumeRisk: thread.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.length > 0,
    nearLimitSignals: thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.slice(0, 8),
    buildWeek: thread.mechanismEvidence.temporalProcessEvidence.buildWeek,
    defectCount: thread.sourceCounts.defects,
    claimCount: thread.sourceCounts.claims,
    badTestCount: thread.sourceCounts.badTests,
    marginalTestCount: thread.sourceCounts.marginalTests,
    textTags,
  };
}

function buildFactsLookup(dossier: ClusteredArticleDossier) {
  return new Map(dossier.productThreads.map((thread) => [thread.productId, buildThreadFacts(thread)]));
}

function collectProducts(
  productIds: string[],
  factsByProduct: Map<string, ThreadFacts>,
): ThreadFacts[] {
  return uniqueValues(productIds)
    .map((productId) => factsByProduct.get(productId))
    .filter((item): item is ThreadFacts => Boolean(item));
}

function buildScore(input: {
  products: ThreadFacts[];
  coherence: number;
  causalSupport: number;
  uplift?: number;
  specificityBonus?: number;
  negativeEvidencePenalty?: number;
  overlapPenalty?: number;
}) {
  const productCount = input.products.length;
  const claimProducts = input.products.filter((product) => product.claimCount > 0).length;
  const failureProducts = input.products.filter(
    (product) => product.defectCount > 0 || product.badTestCount > 0,
  ).length;
  const noiseFlags = input.products.reduce(
    (total, product) =>
      total +
      (product.falsePositive ? 1 : 0) +
      (product.marginalOnly ? 1 : 0) +
      (product.detectionBias ? 1 : 0) +
      (product.lowVolumeRisk ? 1 : 0),
    0,
  );

  const uplift = input.uplift ?? 0;
  const specificityBonus = input.specificityBonus ?? 0;
  const negativeEvidencePenalty = input.negativeEvidencePenalty ?? 0;
  const impact = clampScore(
    productCount + claimProducts + failureProducts + Math.ceil(uplift / 2) + specificityBonus,
    0,
    10,
  );
  const noisePenalty = clampScore(noiseFlags + estimateSmallSamplePenalty(productCount), 0, 8);
  const overlapPenalty = input.overlapPenalty ?? 0;
  const total =
    input.coherence +
    input.causalSupport +
    uplift +
    specificityBonus +
    impact -
    noisePenalty -
    negativeEvidencePenalty -
    overlapPenalty;

  return {
    impact,
    coherence: input.coherence,
    causalSupport: input.causalSupport,
    uplift,
    specificityBonus,
    noisePenalty,
    negativeEvidencePenalty,
    overlapPenalty,
    total,
  } satisfies ScoreBreakdown;
}

function makeSeed(input: {
  family: HypothesisFamily;
  kind: HypothesisKind;
  caseTypeHint: HypothesisSeed["caseTypeHint"];
  anchorKey: string;
  anchorLabel: string;
  titleSeed: string;
  summarySeed: string;
  products: ThreadFacts[];
  strongestEvidence: Array<string | null | undefined>;
  conflictingEvidence: Array<string | null | undefined>;
  recommendedNextTraceChecks: Array<string | null | undefined>;
  coherence: number;
  causalSupport: number;
  uplift?: number;
  specificityBonus?: number;
  negativeEvidencePenalty?: number;
  articleWideAnchorRisk?: boolean;
  fingerprintTokens: Array<string | null | undefined>;
  recommendedActionType: string;
}) {
  const includedProductIds = uniqueValues(input.products.map((product) => product.productId));
  const includedSignalIds = uniqueValues(
    input.products.flatMap((product) =>
      input.kind === "noise" ? product.signalIds : product.nonActionSignalIds,
    ),
  );
  const score = buildScore({
    products: input.products,
    coherence: input.coherence,
    causalSupport: input.causalSupport,
    uplift: input.uplift,
    specificityBonus: input.specificityBonus,
    negativeEvidencePenalty: input.negativeEvidencePenalty,
  });

  return {
    tempId: createId("HYP"),
    family: input.family,
    kind:
      input.kind === "case" && (includedProductIds.length < 2 || score.total < CASE_SCORE_THRESHOLD)
        ? includedProductIds.length === 1
          ? "incident"
          : score.total >= WATCHLIST_SCORE_THRESHOLD
            ? "watchlist"
            : "rejected"
        : input.kind,
    caseTypeHint: input.caseTypeHint,
    anchorKey: input.anchorKey,
    anchorLabel: input.anchorLabel,
    titleSeed: input.titleSeed,
    summarySeed: input.summarySeed,
    includedProductIds,
    includedSignalIds,
    strongestEvidence: uniqueValues(input.strongestEvidence).slice(0, 8),
    conflictingEvidence: uniqueValues(input.conflictingEvidence).slice(0, 8),
    recommendedNextTraceChecks: uniqueValues(input.recommendedNextTraceChecks).slice(0, 8),
    fingerprintTokens: uniqueValues(input.fingerprintTokens).slice(0, 32),
    score,
    articleWideAnchorRisk: Boolean(input.articleWideAnchorRisk),
    recommendedActionType: input.recommendedActionType,
  } satisfies HypothesisSeed;
}

function generateSupplierBatchSeeds(
  dossier: ClusteredArticleDossier,
  factsByProduct: Map<string, ThreadFacts>,
) {
  return dossier.crossProductSummaries.sharedSupplierBatches
    .filter((entry) => entry.productIds.length >= 2)
    .map((entry) => {
      const products = collectProducts(entry.productIds, factsByProduct);
      const productIds = new Set(products.map((product) => product.productId));
      const outsideProducts = [...factsByProduct.values()].filter((product) => !productIds.has(product.productId));
      const corroboratingParts = uniqueValues([
        ...entry.partNumbers,
        ...products.flatMap((product) => product.reportedParts),
      ]).slice(0, 4);
      const corroboratingFinds = uniqueValues([
        ...entry.findNumbers,
        ...products.flatMap((product) => product.bomFindNumbers),
      ]).slice(0, 4);
      const claimLagProducts = products.filter((product) => product.hasClaimOnlyLag).length;
      const affectedProducts = products.filter(
        (product) => product.defectCount > 0 || product.badTestCount > 0 || product.claimCount > 0,
      ).length;
      const outsideAffected = outsideProducts.filter(
        (product) => product.defectCount > 0 || product.badTestCount > 0 || product.claimCount > 0,
      ).length;
      const observedRate = rate(affectedProducts, products.length);
      const baselineRate = rate(outsideAffected, outsideProducts.length);
      const uplift = scoreRateUplift(observedRate, baselineRate);
      const specificityBonus = scoreSpecificity(
        corroboratingParts.length + corroboratingFinds.length,
        products.length,
        dossier.article.productCount,
      );
      const coherence =
        5 +
        Math.min(2, corroboratingParts.length) +
        Math.min(2, corroboratingFinds.length) +
        (products.some((product) => product.defectCodes.length > 0) ? 1 : 0);
      const causalSupport =
        3 +
        Math.min(2, claimLagProducts) +
        (products.some((product) => product.badTestCount > 0) ? 1 : 0) +
        (products.some((product) => product.claimCount > 0) ? 1 : 0) +
        (products.some((product) => product.textTags.symptomTags.includes("total_failure")) ? 1 : 0);
      const articleWideAnchorRisk =
        products.length >= Math.max(4, Math.ceil(dossier.article.productCount * 0.7));
      const defectConsistencyPenalty =
        uniqueValues(products.flatMap((product) => product.defectCodes)).length > 4 ? 2 : 0;
      const negativeEvidencePenalty =
        (articleWideAnchorRisk ? 2 : 0) +
        (corroboratingParts.length === 0 ? 2 : 0) +
        defectConsistencyPenalty +
        (products.every((product) => product.claimCount === 0 && product.badTestCount === 0) ? 1 : 0);

      return makeSeed({
        family: "supplier_batch",
        kind: "case",
        caseTypeHint: "supplier",
        anchorKey: `supplier_batch:${entry.batchRef}`,
        anchorLabel: `${entry.batchRef}${corroboratingParts[0] ? ` / ${corroboratingParts[0]}` : ""}`,
        titleSeed: `Supplier batch hypothesis around ${entry.batchRef}`,
        summarySeed: `${products.length} products share supplier batch ${entry.batchRef}.`,
        products,
        strongestEvidence: [
          `${products.length} products share supplier batch ${entry.batchRef}.`,
          `Affected-product rate is ${Math.round(observedRate * 100)}% versus ${Math.round(baselineRate * 100)}% outside the batch anchor.`,
          corroboratingParts.length
            ? `Repeated material anchors: ${corroboratingParts.join(", ")}.`
            : "Traceability points back to the same batch family.",
          corroboratingFinds.length
            ? `BOM overlap stays concentrated at ${corroboratingFinds.join(", ")}.`
            : null,
          claimLagProducts
            ? `${claimLagProducts} products also show claim-lag behavior after build.`
            : null,
        ],
        conflictingEvidence: [
          articleWideAnchorRisk
            ? "This batch anchor may be broad enough to need extra corroboration."
            : null,
          products.some((product) => product.falsePositive)
            ? "Some linked products still carry false-positive markers."
            : null,
          defectConsistencyPenalty
            ? "Defect signatures are broader than expected for one material mechanism."
            : null,
          products.every((product) => product.claimCount === 0 && product.badTestCount === 0)
            ? "Factory defects dominate without strong field or test corroboration."
            : null,
        ],
        recommendedNextTraceChecks: [
          `Trace all installs carrying batch ${entry.batchRef}.`,
          corroboratingParts[0]
            ? `Compare incoming inspection and supplier history for ${corroboratingParts[0]}.`
            : "Check whether the suspect batch travels with one dominant part family.",
          "Compare field-claim lag against unaffected products from neighboring batches.",
        ],
        coherence,
        causalSupport,
        uplift,
        specificityBonus,
        negativeEvidencePenalty,
        articleWideAnchorRisk,
        fingerprintTokens: [
          `family:supplier_batch`,
          `supplier_batch:${entry.batchRef}`,
          ...corroboratingParts.map((value) => `part:${value}`),
          ...corroboratingFinds.map((value) => `bom:${value}`),
          ...uniqueValues(products.flatMap((value) => value.defectCodes)).slice(0, 3).map((value) => `defect:${value}`),
        ],
        recommendedActionType: "supplier_containment",
      });
    });
}

function clusterProcessProducts(products: ThreadFacts[]) {
  const sorted = [...products].sort((left, right) =>
    (left.firstFactorySignalWeek ?? "").localeCompare(right.firstFactorySignalWeek ?? ""),
  );
  const clusters: ThreadFacts[][] = [];

  for (const product of sorted) {
    const current = clusters[clusters.length - 1];

    if (!current) {
      clusters.push([product]);
      continue;
    }

    const previous = current[current.length - 1];
    const delta = weekDistance(previous.firstFactorySignalWeek, product.firstFactorySignalWeek);

    if (delta !== null && delta <= 4) {
      current.push(product);
      continue;
    }

    clusters.push([product]);
  }

  return clusters;
}

function generateProcessWindowSeeds(
  dossier: ClusteredArticleDossier,
  factsByProduct: Map<string, ThreadFacts>,
) {
  const bySection = new Map<string, ThreadFacts[]>();

  for (const facts of factsByProduct.values()) {
    const section = facts.occurrenceSections[0];

    if (!section || !facts.firstFactorySignalWeek) {
      continue;
    }

    const current = bySection.get(section) ?? [];
    current.push(facts);
    bySection.set(section, current);
  }

  const seeds: HypothesisSeed[] = [];

  for (const [section, products] of bySection.entries()) {
    for (const cluster of clusterProcessProducts(products)) {
      if (cluster.length < 2) {
        continue;
      }

      const sharedDefectCodes = uniqueValues(cluster.flatMap((product) => product.defectCodes)).slice(
        0,
        4,
      );
      const sharedTestKeys = uniqueValues(cluster.flatMap((product) => product.testKeys)).slice(0, 4);
      const earliestWeek = cluster[0]?.firstFactorySignalWeek;
      const latestWeek = cluster[cluster.length - 1]?.lastFactorySignalWeek;
      const detectionOnlyRisk = cluster.every((product) => product.occurrenceSections.length === 0);
      const clusterIds = new Set(cluster.map((product) => product.productId));
      const sectionOutsideWindow = products.filter((product) => !clusterIds.has(product.productId));
      const clusterFailureRate = rate(
        cluster.filter((product) => product.defectCount > 0 || product.badTestCount > 0).length,
        cluster.length,
      );
      const outsideFailureRate = rate(
        sectionOutsideWindow.filter((product) => product.defectCount > 0 || product.badTestCount > 0).length,
        sectionOutsideWindow.length,
      );
      const uplift = scoreRateUplift(clusterFailureRate, outsideFailureRate);
      const specificityBonus = scoreSpecificity(
        sharedDefectCodes.length + sharedTestKeys.length + 1,
        cluster.length,
        dossier.article.productCount,
      );
      const coherence =
        5 +
        Math.min(2, sharedDefectCodes.length) +
        Math.min(2, sharedTestKeys.length) +
        (earliestWeek && latestWeek && weekDistance(earliestWeek, latestWeek) !== null &&
        weekDistance(earliestWeek, latestWeek)! <= 6
          ? 2
          : 0);
      const causalSupport =
        3 +
        (cluster.some((product) => product.badTestCount > 0) ? 2 : 0) +
        (cluster.some((product) => product.thread.mechanismEvidence.temporalProcessEvidence.postWindowQuietHints.length > 0)
          ? 2
          : 0) +
        (cluster.some((product) => product.textTags.symptomTags.includes("vibration")) ? 1 : 0) +
        (cluster.some((product) => product.textTags.dispositionTags.includes("torque_adjust")) ? 1 : 0);
      const negativeEvidencePenalty =
        (detectionOnlyRisk ? 2 : 0) +
        (cluster.every((product) => product.cosmeticOnly || product.lowSeverityOnly) ? 2 : 0) +
        (earliestWeek && latestWeek && (weekDistance(earliestWeek, latestWeek) ?? 999) > 8 ? 2 : 0);

      seeds.push(
        makeSeed({
          family: "process_window",
          kind: "case",
          caseTypeHint: "process",
          anchorKey: `process:${section}:${earliestWeek ?? "unknown"}`,
          anchorLabel: `${section}${earliestWeek ? ` / ${earliestWeek}` : ""}`,
          titleSeed: `Process-window hypothesis in ${section}`,
          summarySeed: `${cluster.length} products cluster inside a narrow process window in ${section}.`,
          products: cluster,
          strongestEvidence: [
            `${cluster.length} products share the same occurrence section ${section}.`,
            earliestWeek && latestWeek
              ? `Factory signals stay contained between ${earliestWeek} and ${latestWeek}.`
              : "Factory signals stay temporally concentrated.",
            `Failure/test rate in the window is ${Math.round(clusterFailureRate * 100)}% versus ${Math.round(outsideFailureRate * 100)}% outside the same section window.`,
            sharedDefectCodes.length
              ? `Recurring defect signatures: ${sharedDefectCodes.join(", ")}.`
              : null,
            sharedTestKeys.length ? `Related test echoes: ${sharedTestKeys.join(", ")}.` : null,
          ],
          conflictingEvidence: [
            detectionOnlyRisk ? "The pattern leans heavily on detected-section evidence." : null,
            cluster.some((product) => product.falsePositive)
              ? "Some linked products still carry false-positive notes."
              : null,
            cluster.every((product) => product.claimCount === 0)
              ? "No field claims are reinforcing this process-window signal yet."
              : null,
          ],
          recommendedNextTraceChecks: [
            `Compare setup, calibration, and maintenance logs for ${section}.`,
            "Check whether the anomaly disappears outside the narrow factory time window.",
            sharedTestKeys[0]
              ? `Re-run the dominant test path around ${sharedTestKeys[0]}.`
              : "Compare test and defect signatures inside and outside the suspect window.",
          ],
          coherence,
          causalSupport,
          uplift,
          specificityBonus,
          negativeEvidencePenalty,
          articleWideAnchorRisk: false,
          fingerprintTokens: [
            `family:process_window`,
            `occurrence:${section}`,
            earliestWeek ? `week:${earliestWeek}` : null,
            ...sharedDefectCodes.map((value) => `defect:${value}`),
            ...sharedTestKeys.map((value) => `test:${value}`),
          ],
          recommendedActionType: "verify_fix",
        }),
      );
    }
  }

  return seeds;
}

function generateLatentDesignSeeds(
  dossier: ClusteredArticleDossier,
  factsByProduct: Map<string, ThreadFacts>,
) {
  const grouped = new Map<string, ThreadFacts[]>();

  for (const facts of factsByProduct.values()) {
    if (!facts.hasClaimOnlyLag) {
      continue;
    }

    const anchor =
      facts.reportedParts[0] ??
      facts.bomFindNumbers[0] ??
      facts.thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts[0]?.value ??
      facts.thread.mechanismEvidence.fieldLeakEvidence.dominantClaimBomPositions[0]?.value;

    if (!anchor) {
      continue;
    }

    const current = grouped.get(anchor) ?? [];
    current.push(facts);
    grouped.set(anchor, current);
  }

  return [...grouped.entries()]
    .filter(([, products]) => products.length >= 2)
    .map(([anchor, products]) => {
      const lagBuckets = uniqueValues(products.map((product) => product.claimLagBucket));
      const bomFinds = uniqueValues(products.flatMap((product) => product.bomFindNumbers)).slice(0, 4);
      const claimOnlyArticleRate = rate(
        [...factsByProduct.values()].filter((product) => product.hasClaimOnlyLag).length,
        factsByProduct.size,
      );
      const observedRate = rate(products.filter((product) => product.hasClaimOnlyLag).length, products.length);
      const uplift = scoreRateUplift(observedRate, claimOnlyArticleRate);
      const specificityBonus = scoreSpecificity(
        1 + bomFinds.length + (lagBuckets.length === 1 ? 1 : 0),
        products.length,
        dossier.article.productCount,
      );
      const coherence = 6 + Math.min(2, bomFinds.length) + Math.min(2, lagBuckets.length === 1 ? 2 : 1);
      const causalSupport =
        5 +
        Math.min(2, products.filter((product) => product.claimCount > 0).length) +
        (products.every((product) => product.defectCount === 0 && product.badTestCount === 0) ? 2 : 0) +
        (products.some((product) => product.textTags.symptomTags.includes("drift")) ? 1 : 0) +
        (products.some((product) => product.textTags.symptomTags.includes("thermal")) ? 1 : 0);
      const negativeEvidencePenalty =
        (products.some((product) => product.defectCount > 0 || product.badTestCount > 0) ? 2 : 0) +
        (lagBuckets.length > 2 ? 1 : 0) +
        (products.some((product) => product.serviceDocumentation) ? 1 : 0);

      return makeSeed({
        family: "latent_design",
        kind: "case",
        caseTypeHint: "design",
        anchorKey: `design:${anchor}`,
        anchorLabel: anchor,
        titleSeed: `Latent design hypothesis around ${anchor}`,
        summarySeed: `${products.length} products share claim-lag behavior around ${anchor}.`,
        products,
        strongestEvidence: [
          `${products.length} products show field claims without a prior factory failure trail.`,
          `Shared claim anchor: ${anchor}.`,
          `Claim-only lag rate is ${Math.round(observedRate * 100)}% for this anchor versus ${Math.round(claimOnlyArticleRate * 100)}% across the article.`,
          lagBuckets.length ? `Lag pattern stays in ${lagBuckets.join(", ")} bucket(s).` : null,
          bomFinds.length ? `Repeated BOM positions: ${bomFinds.join(", ")}.` : null,
        ],
        conflictingEvidence: [
          products.some((product) => product.defectCount > 0 || product.badTestCount > 0)
            ? "A stronger in-factory failure trail exists on part of the cluster."
            : null,
          products.some((product) => product.serviceDocumentation)
            ? "Some claim notes still look service- or documentation-heavy."
            : null,
          products.some((product) => product.falsePositive)
            ? "A subset of linked products still carries false-positive markers."
            : null,
        ],
        recommendedNextTraceChecks: [
          `Stress-check the design path around ${anchor} over the field-lag horizon.`,
          "Compare claimed units with unaffected units from the same build periods.",
          "Review whether in-factory tests are too short to expose the latent failure mode.",
        ],
        coherence,
        causalSupport,
        uplift,
        specificityBonus,
        negativeEvidencePenalty,
        articleWideAnchorRisk: false,
        fingerprintTokens: [
          `family:latent_design`,
          `part:${anchor}`,
          ...bomFinds.map((value) => `bom:${value}`),
          ...lagBuckets.map((value) => `claim_lag:${value}`),
        ],
        recommendedActionType: "initiate_8d",
      });
    });
}

function generateHandlingSeeds(
  dossier: ClusteredArticleDossier,
  factsByProduct: Map<string, ThreadFacts>,
) {
  const grouped = new Map<string, ThreadFacts[]>();

  for (const facts of factsByProduct.values()) {
    if ((!facts.cosmeticOnly && !facts.lowSeverityOnly) || facts.fieldImpactPresent) {
      continue;
    }

    const anchor = facts.reworkUsers[0] ?? facts.orderId;

    if (!anchor) {
      continue;
    }

    const current = grouped.get(anchor) ?? [];
    current.push(facts);
    grouped.set(anchor, current);
  }

  return [...grouped.entries()]
    .filter(([, products]) => products.length >= 2)
    .map(([anchor, products]) => {
      const orders = uniqueValues(products.map((product) => product.orderId)).slice(0, 4);
      const cosmeticCodes = uniqueValues(products.flatMap((product) => product.defectCodes)).slice(0, 4);
      const productIds = new Set(products.map((product) => product.productId));
      const outsideProducts = [...factsByProduct.values()].filter((product) => !productIds.has(product.productId));
      const articleWideAnchorRisk =
        products.length >= Math.max(4, Math.ceil(dossier.article.productCount * 0.7));
      const observedCosmeticRate = rate(
        products.filter((product) => product.cosmeticOnly || product.lowSeverityOnly).length,
        products.length,
      );
      const baselineCosmeticRate = rate(
        outsideProducts.filter((product) => product.cosmeticOnly || product.lowSeverityOnly).length,
        outsideProducts.length,
      );
      const uplift = scoreRateUplift(observedCosmeticRate, baselineCosmeticRate);
      const specificityBonus = scoreSpecificity(
        cosmeticCodes.length + (products.some((product) => product.reworkUsers.length > 0) ? 1 : 0),
        products.length,
        dossier.article.productCount,
      );
      const coherence = 5 + Math.min(2, orders.length) + Math.min(2, cosmeticCodes.length);
      const causalSupport =
        3 +
        (products.every((product) => product.claimCount === 0) ? 2 : 0) +
        (products.some((product) => product.reworkUsers.length > 0) ? 2 : 0) +
        (products.some((product) => product.textTags.dispositionTags.includes("relabel")) ? 1 : 0);
      const negativeEvidencePenalty =
        (articleWideAnchorRisk ? 2 : 0) +
        (products.some((product) => product.badTestCount > 0 || product.fieldImpactPresent) ? 2 : 0) +
        (products.some((product) => product.supplierBatches.length > 0 && product.claimCount > 0) ? 1 : 0);

      return makeSeed({
        family: "handling_cluster",
        kind: "case",
        caseTypeHint: "handling",
        anchorKey: `handling:${anchor}`,
        anchorLabel: anchor,
        titleSeed: `Handling hypothesis around ${anchor}`,
        summarySeed: `${products.length} low-severity products concentrate around ${anchor}.`,
        products,
        strongestEvidence: [
          `${products.length} low-severity or cosmetic threads concentrate around ${anchor}.`,
          `Cosmetic/low-severity concentration is ${Math.round(observedCosmeticRate * 100)}% versus ${Math.round(baselineCosmeticRate * 100)}% outside the anchor.`,
          cosmeticCodes.length
            ? `Repeated cosmetic signatures: ${cosmeticCodes.join(", ")}.`
            : "The pattern stays cosmetic or low-severity rather than functional.",
          orders.length ? `The same production orders repeat: ${orders.join(", ")}.` : null,
        ],
        conflictingEvidence: [
          articleWideAnchorRisk
            ? "The operational anchor is broad enough that it could over-group unrelated products."
            : null,
          products.some((product) => product.claimCount > 0)
            ? "Some linked products also have field impact, which weakens a pure handling story."
            : null,
        ],
        recommendedNextTraceChecks: [
          `Review operator, handling, and packaging steps around ${anchor}.`,
          "Compare cosmetic-only products against unaffected orders from the same window.",
          "Check whether the pattern disappears when the dominant operator or order family changes.",
        ],
        coherence,
        causalSupport,
        uplift,
        specificityBonus,
        negativeEvidencePenalty,
        articleWideAnchorRisk,
        fingerprintTokens: [
          `family:handling_cluster`,
          factsByProduct.size && anchor.startsWith("ORD-") ? `order:${anchor}` : `user:${anchor}`,
          ...orders.map((value) => `order:${value}`),
          ...cosmeticCodes.map((value) => `defect:${value}`),
        ],
        recommendedActionType: "corrective",
      });
    });
}

function generateLeadingIndicators(factsByProduct: Map<string, ThreadFacts>) {
  const grouped = new Map<string, ThreadFacts[]>();

  for (const facts of factsByProduct.values()) {
    if (!facts.marginalOnly && facts.nearLimitSignals.length === 0) {
      continue;
    }

    const anchor = facts.testKeys[0] ?? facts.detectedSections[0] ?? "near-limit";
    const key = facts.nearLimitSignals.length > 0 ? `near_limit:${anchor}` : `marginal:${anchor}`;
    const current = grouped.get(key) ?? [];
    current.push(facts);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, products]) => {
      const linkedSignalIds = uniqueValues(products.flatMap((product) => product.nonActionSignalIds)).slice(
        0,
        260,
      );
      const strongestEvidence = uniqueValues([
        products.some((product) => product.nearLimitSignals.length > 0)
          ? "Near-limit test evidence repeats without enough closure for a case."
          : null,
        products.some((product) => product.marginalOnly)
          ? "Marginal-only tests are recurring and may become an early warning signal."
          : null,
        ...products.flatMap((product) => product.nearLimitSignals.slice(0, 2)),
      ]).slice(0, 8);
      const confidence = Math.max(
        0.28,
        Math.min(0.76, 0.3 + products.length * 0.08 + strongestEvidence.length * 0.03),
      );

      return {
        indicatorTempId: createId("LIND"),
        indicatorKind: key.startsWith("near_limit:") ? "near_limit" : key.startsWith("marginal:") ? "marginal_drift" : "screening_echo",
        title: key.startsWith("near_limit:") ? `Near-limit indicator ${key.replace("near_limit:", "")}` : `Marginal drift indicator ${key.replace("marginal:", "")}`,
        summary: `${products.length} products share near-limit or marginal test evidence without enough causal closure for a case.`,
        confidence,
        linkedProductIds: uniqueValues(products.map((product) => product.productId)),
        linkedSignalIds,
        strongestEvidence,
      } satisfies HypothesisLocalLeadingIndicator;
    })
    .filter((indicator) => indicator.linkedProductIds.length >= 2 || indicator.strongestEvidence.length >= LEADING_INDICATOR_THRESHOLD);
}

function generateNoiseSeeds(factsByProduct: Map<string, ThreadFacts>) {
  const grouped = new Map<string, ThreadFacts[]>();

  for (const facts of factsByProduct.values()) {
    if (
      !facts.falsePositive &&
      !facts.marginalOnly &&
      !facts.detectionBias &&
      !facts.lowVolumeRisk &&
      !facts.serviceDocumentation
    ) {
      continue;
    }

    const anchor =
      (facts.detectionBias ? facts.detectedSections[0] : null) ??
      facts.testKeys[0] ??
      facts.thread.summaryFeatures.falsePositiveMarkers[0] ??
      facts.reportedParts[0] ??
      facts.productId;
    const key = `${facts.detectionBias ? "section" : facts.falsePositive ? "marker" : "test"}:${anchor}`;
    const current = grouped.get(key) ?? [];
    current.push(facts);
    grouped.set(key, current);
  }

  return [...grouped.entries()].map(([anchorKey, products]) => {
    const titleSeed = products.some((product) => product.detectionBias)
      ? "Detection hotspot watchlist"
      : products.some((product) => product.falsePositive)
        ? "False-positive watchlist"
        : "Screening noise watchlist";

    return makeSeed({
      family: "noise_watchlist",
      kind: products.some((product) => product.falsePositive || product.detectionBias) ? "noise" : "watchlist",
      caseTypeHint: products.some((product) => product.falsePositive || product.detectionBias)
        ? "noise"
        : "watchlist",
      anchorKey,
      anchorLabel: anchorKey.split(":").slice(1).join(":"),
      titleSeed,
      summarySeed: `${products.length} products carry the same low-confidence or noisy pattern.`,
      products,
      strongestEvidence: [
        products.some((product) => product.detectionBias)
          ? "The signal is dominated by detected-section concentration rather than occurrence evidence."
          : null,
        products.some((product) => product.falsePositive)
          ? "False-positive markers repeat across the linked products."
          : null,
        products.some((product) => product.marginalOnly)
          ? "Marginal-only tests inflate the cluster without clear failures."
          : null,
        products.some((product) => product.lowVolumeRisk)
          ? "Low production volume could be exaggerating the apparent spike."
          : null,
      ],
      conflictingEvidence: [
        products.some((product) => product.claimCount > 0)
          ? "Some products still have field signals, so this cannot be fully suppressed."
          : null,
      ],
      recommendedNextTraceChecks: [
        "Compare detected-section counts against occurrence-section evidence.",
        "Review notes for false-positive, inspection-only, or service/documentation clues.",
        "Monitor the pattern instead of opening a full investigation unless stronger anchors emerge.",
      ],
      coherence: 3,
      causalSupport: 1,
      uplift: 0,
      specificityBonus: products.some((product) => product.detectionBias) ? 2 : 1,
      negativeEvidencePenalty: 0,
      articleWideAnchorRisk: false,
      fingerprintTokens: [
        `family:noise_watchlist`,
        anchorKey,
        ...uniqueValues(products.flatMap((product) => product.detectedSections)).map((value) => `detected:${value}`),
        ...uniqueValues(products.flatMap((product) => product.testKeys)).map((value) => `test:${value}`),
      ],
      recommendedActionType: "verify_fix",
    });
  });
}

function buildFallbackIncident(facts: ThreadFacts): HypothesisLocalIncident {
  const family =
    facts.hasClaimOnlyLag
      ? "latent_design"
      : facts.supplierBatches[0]
        ? "supplier_batch"
        : facts.occurrenceSections[0]
          ? "process_window"
          : facts.reworkUsers[0] || facts.orderId
            ? "handling_cluster"
            : "single_product";

  const strongestEvidence = uniqueValues([
    facts.supplierBatches[0] ? `Supplier batch ${facts.supplierBatches[0]} is locally dominant.` : null,
    facts.reportedParts[0] ? `Reported part ${facts.reportedParts[0]} recurs inside the product thread.` : null,
    facts.hasClaimOnlyLag ? `Field claims arrive in the ${facts.claimLagBucket} lag bucket without prior factory defects.` : null,
    facts.occurrenceSections[0]
      ? `Factory evidence concentrates in ${facts.occurrenceSections[0]}.`
      : facts.detectedSections[0]
        ? `Detected section ${facts.detectedSections[0]} is the main observed hotspot.`
        : null,
  ]).slice(0, 6);

  return {
    incidentTempId: createId("INC"),
    title: `Single-product ${family.replaceAll("_", " ")}`,
    family,
    summary: trimPreview(facts.thread.stage1Synthesis.productSummary, 280),
    confidence: 0.44,
    priority: facts.claimCount > 0 || facts.badTestCount > 0 ? "medium" : "low",
    productId: facts.productId,
    includedSignalIds: facts.nonActionSignalIds.slice(0, 120),
    strongestEvidence,
    recommendedNextTraceChecks: uniqueValues([
      facts.supplierBatches[0] ? `Trace neighboring installs sharing ${facts.supplierBatches[0]}.` : null,
      facts.occurrenceSections[0] ? `Check recent setup changes in ${facts.occurrenceSections[0]}.` : null,
      facts.reportedParts[0] ? `Compare the product against unaffected units carrying ${facts.reportedParts[0]}.` : null,
    ]).slice(0, 6),
  };
}

function convertSeedToWatchlist(seed: HypothesisSeed, note?: string): HypothesisLocalWatchlist {
  return {
    watchlistTempId: seed.tempId,
    title: seed.titleSeed,
    family: seed.family,
    summary: trimPreview([seed.summarySeed, note].filter(Boolean).join(" "), 320),
    confidence: toConfidence(seed.score.total),
    priority: toPriority(seed.score.total),
    linkedProductIds: seed.includedProductIds,
    linkedSignalIds: seed.includedSignalIds,
    strongestEvidence: seed.strongestEvidence.slice(0, 6),
  };
}

function convertSeedToNoise(seed: HypothesisSeed, note?: string): HypothesisLocalNoise {
  return {
    noiseTempId: seed.tempId,
    title: seed.titleSeed,
    family: seed.family,
    summary: trimPreview([seed.summarySeed, note].filter(Boolean).join(" "), 320),
    linkedProductIds: seed.includedProductIds,
    linkedSignalIds: seed.includedSignalIds,
    strongestEvidence: seed.strongestEvidence.slice(0, 6),
  };
}

function seedAnchorSpecificity(seed: HypothesisSeed) {
  const tokens = new Set(seed.fingerprintTokens);
  let specificity = seed.score.specificityBonus;

  if (tokens.has("family:supplier_batch")) {
    specificity +=
      (Array.from(tokens).some((token) => token.startsWith("supplier_batch:")) ? 3 : 0) +
      (Array.from(tokens).some((token) => token.startsWith("part:") || token.startsWith("bom:"))
        ? 2
        : 0);
  }

  if (tokens.has("family:process_window")) {
    specificity +=
      (Array.from(tokens).some((token) => token.startsWith("occurrence:")) ? 3 : 0) +
      (Array.from(tokens).some((token) => token.startsWith("week:")) ? 2 : 0);
  }

  if (tokens.has("family:latent_design")) {
    specificity +=
      (Array.from(tokens).some((token) => token.startsWith("claim_lag:")) ? 3 : 0) +
      (Array.from(tokens).some((token) => token.startsWith("part:") || token.startsWith("bom:"))
        ? 2
        : 0);
  }

  if (tokens.has("family:handling_cluster")) {
    specificity +=
      (Array.from(tokens).some((token) => token.startsWith("order:") || token.startsWith("user:"))
        ? 3
        : 0) +
      (Array.from(tokens).some((token) => token.startsWith("defect:")) ? 1 : 0);
  }

  return specificity - (seed.articleWideAnchorRisk ? 2 : 0);
}

function compareSeedStrength(left: HypothesisSeed, right: HypothesisSeed) {
  const specificityDelta = seedAnchorSpecificity(left) - seedAnchorSpecificity(right);

  if (specificityDelta !== 0) {
    return specificityDelta;
  }

  const upliftDelta = left.score.uplift - right.score.uplift;

  if (upliftDelta !== 0) {
    return upliftDelta;
  }

  return left.score.total - right.score.total;
}

function resolveLocalInventory(input: {
  dossier: ClusteredArticleDossier;
  factsByProduct: Map<string, ThreadFacts>;
  seeds: HypothesisSeed[];
}) {
  const caseSeeds: HypothesisSeed[] = [];
  const watchlists: HypothesisLocalWatchlist[] = [];
  const leadingIndicators = generateLeadingIndicators(input.factsByProduct);
  const noise: HypothesisLocalNoise[] = [];
  const rejectedCases: HypothesisLocalInventory["rejectedCases"] = [];
  const caseMergeLog: string[] = [];

  const rankedSeeds = [...input.seeds].sort(
    (left, right) => right.score.total - left.score.total || left.anchorKey.localeCompare(right.anchorKey),
  );

  for (const seed of rankedSeeds) {
    if (seed.kind === "watchlist") {
      watchlists.push(convertSeedToWatchlist(seed));
      continue;
    }

    if (seed.kind === "noise") {
      noise.push(convertSeedToNoise(seed));
      continue;
    }

    if (seed.kind === "rejected") {
      rejectedCases.push({
        rejectedTempId: seed.tempId,
        title: seed.titleSeed,
        family: seed.family,
        reason: "Score stayed below the current article-case threshold.",
        linkedProductIds: seed.includedProductIds,
      });
      continue;
    }

    const strongerOverlap = caseSeeds.find((existing) => {
      const overlap = jaccardIndex(existing.includedProductIds, seed.includedProductIds);
      const sharedTokens = uniqueValues(
        existing.fingerprintTokens.filter((token) => seed.fingerprintTokens.includes(token)),
      ).filter((token) => !token.startsWith("family:"));

      return overlap >= 0.75 || sharedTokens.length >= 2;
    });

    if (strongerOverlap) {
      const relativeStrength = compareSeedStrength(seed, strongerOverlap);

      if (
        relativeStrength <= 0 &&
        (strongerOverlap.family === seed.family ||
          strongerOverlap.score.total - seed.score.total >= CASE_OVERLAP_MARGIN ||
          strongerOverlap.score.specificityBonus >= seed.score.specificityBonus ||
          seed.articleWideAnchorRisk)
      ) {
        watchlists.push(
          convertSeedToWatchlist(
            seed,
            `Overlaps strongly with more specific case ${strongerOverlap.anchorLabel}.`,
          ),
        );
        caseMergeLog.push(
          `${seed.titleSeed} was demoted behind stronger hypothesis ${strongerOverlap.titleSeed}.`,
        );
        continue;
      }

      if (relativeStrength > 0) {
        const previousIndex = caseSeeds.findIndex((existing) => existing.tempId === strongerOverlap.tempId);

        if (previousIndex >= 0) {
          const displaced = caseSeeds.splice(previousIndex, 1)[0];
          watchlists.push(
            convertSeedToWatchlist(
              displaced,
              `A more specific overlapping hypothesis ${seed.anchorLabel} replaced it during arbitration.`,
            ),
          );
          caseMergeLog.push(
            `${seed.titleSeed} displaced ${displaced.titleSeed} because its causal anchor was more specific.`,
          );
        }
      } else if (
        seed.articleWideAnchorRisk
      ) {
        watchlists.push(convertSeedToWatchlist(seed, "The anchor remained too article-wide during arbitration."));
        continue;
      }
    }

    if (seed.includedProductIds.length < 2) {
      continue;
    }

    if (seed.score.total >= CASE_SCORE_THRESHOLD) {
      caseSeeds.push(seed);
      continue;
    }

    if (seed.score.total >= WATCHLIST_SCORE_THRESHOLD) {
      watchlists.push(convertSeedToWatchlist(seed));
      continue;
    }

    rejectedCases.push({
      rejectedTempId: seed.tempId,
      title: seed.titleSeed,
      family: seed.family,
      reason: "The hypothesis remained too weak after scoring and overlap resolution.",
      linkedProductIds: seed.includedProductIds,
    });
  }

  const assignedProducts = new Set(caseSeeds.flatMap((seed) => seed.includedProductIds));
  const typedProducts = new Set([
    ...watchlists.flatMap((item) => item.linkedProductIds),
    ...leadingIndicators.flatMap((item) => item.linkedProductIds),
    ...noise.flatMap((item) => item.linkedProductIds),
  ]);

  const incidents = [...input.factsByProduct.values()]
    .filter(
      (facts) =>
        facts.signalIds.length > 0 &&
        !assignedProducts.has(facts.productId) &&
        !typedProducts.has(facts.productId),
    )
    .map((facts) => buildFallbackIncident(facts));

  const incidentProductIds = new Set(incidents.map((incident) => incident.productId));
  const unassignedProducts = [...input.factsByProduct.values()]
    .filter(
      (facts) =>
        facts.signalIds.length > 0 &&
        !assignedProducts.has(facts.productId) &&
        !typedProducts.has(facts.productId) &&
        !incidentProductIds.has(facts.productId),
    )
    .map((facts) => ({
      productId: facts.productId,
      reason: "No hypothesis family cleared the current investigation threshold.",
    }));

  const localInventory = hypothesisLocalInventorySchema.parse({
    contractVersion: HYP_LOCAL_INVENTORY_SCHEMA_VERSION,
    reviewSummary: caseSeeds.length
      ? `${caseSeeds.length} investigation cases cleared the mechanism-specific hypothesis thresholds.`
      : "No multi-product hypothesis cleared the current case threshold.",
    cases: caseSeeds.map((seed) => ({
      caseTempId: seed.tempId,
      family: seed.family,
      anchorKey: seed.anchorKey,
      anchorLabel: seed.anchorLabel,
      title: seed.titleSeed,
      summary: seed.summarySeed,
      confidence: toConfidence(seed.score.total),
      priority: toPriority(seed.score.total),
      includedProductIds: seed.includedProductIds,
      includedSignalIds: seed.includedSignalIds,
      strongestEvidence: seed.strongestEvidence.slice(0, 8),
      conflictingEvidence: seed.conflictingEvidence.slice(0, 8),
      recommendedNextTraceChecks: seed.recommendedNextTraceChecks.slice(0, 8),
      score: seed.score.total,
      fingerprintTokens: seed.fingerprintTokens,
    })),
    incidents,
    watchlists,
    leadingIndicators,
    noise,
    rejectedCases,
    unassignedProducts,
    globalObservations: uniqueValues([
      caseSeeds.length ? `${caseSeeds.length} case hypotheses survived local ranking.` : null,
      watchlists.length ? `${watchlists.length} weaker patterns remain on watchlist.` : null,
      leadingIndicators.length
        ? `${leadingIndicators.length} leading indicators stayed separate from active cases.`
        : null,
      noise.length ? `${noise.length} patterns were classified as noise or detection artifacts.` : null,
    ]).slice(0, 12),
    caseMergeLog: uniqueValues(caseMergeLog).slice(0, 24),
  });

  return { localInventory, caseSeeds };
}

function deterministicNarrative(seed: HypothesisSeed): HypothesisNarrative {
  const familyTitle =
    seed.family === "supplier_batch"
      ? "Supplier batch"
      : seed.family === "process_window"
        ? "Process window"
        : seed.family === "latent_design"
          ? "Latent design"
          : "Handling";

  return {
    title: `${familyTitle} hypothesis: ${seed.anchorLabel}`,
    summary: trimPreview(
      `${seed.summarySeed} ${seed.strongestEvidence[0] ?? ""} ${seed.conflictingEvidence[0] ?? ""}`,
      900,
    ),
    suspectedCommonRootCause:
      seed.family === "supplier_batch"
        ? `A shared material or supplier-batch issue around ${seed.anchorLabel} is the leading hypothesis.`
        : seed.family === "process_window"
          ? `A bounded process drift around ${seed.anchorLabel} is the leading hypothesis.`
          : seed.family === "latent_design"
            ? `A latent field-exposed weakness around ${seed.anchorLabel} is the leading hypothesis.`
            : `A handling or order/user-specific pattern around ${seed.anchorLabel} is the leading hypothesis.`,
    strongestEvidence: seed.strongestEvidence.slice(0, 6),
    conflictingEvidence: seed.conflictingEvidence.slice(0, 6),
    recommendedNextTraceChecks: seed.recommendedNextTraceChecks.slice(0, 6),
    oneLineWhyGrouped: seed.strongestEvidence[0] ?? seed.summarySeed,
    oneLineWhyExcluded:
      seed.conflictingEvidence[0] ??
      "Similar records were excluded when they lacked the same mechanism-specific anchors.",
    recommendedActions: [
      `Recommended workflow lane: ${seed.recommendedActionType}.`,
      seed.family === "supplier_batch"
        ? "Compare suspect installs against unaffected neighboring batches."
        : seed.family === "process_window"
          ? "Review setup or calibration changes in the suspect window."
          : seed.family === "latent_design"
            ? "Request an engineering stress review over the field-lag horizon."
            : "Review operator, packaging, and handling steps around the anchor.",
    ],
  };
}

async function generateNarrative(seed: HypothesisSeed, abortSignal?: AbortSignal) {
  if (!openai || !env.OPENAI_MODEL) {
    return deterministicNarrative(seed);
  }

  const payload = {
    family: seed.family,
    caseTypeHint: seed.caseTypeHint,
    anchor: {
      key: seed.anchorKey,
      label: seed.anchorLabel,
    },
    groupedProducts: seed.includedProductIds,
    groupedSignalCount: seed.includedSignalIds.length,
    strongestEvidence: seed.strongestEvidence,
    conflictingEvidence: seed.conflictingEvidence,
    recommendedNextTraceChecks: seed.recommendedNextTraceChecks,
    score: seed.score,
    articleWideAnchorRisk: seed.articleWideAnchorRisk,
  };

  try {
    throwIfPipelineAborted(abortSignal);
    return await generateStructuredObjectWithRepair({
      model: openai.responses(env.OPENAI_MODEL),
      schema: hypothesisNarrativeSchema,
      schemaName: "manex_hypothesis_narrative",
      schemaDescription: "Narrative summary for one deterministic hypothesis case seed.",
      system: buildHypothesisNarrativeSystemPrompt(),
      prompt: buildHypothesisNarrativeUserPrompt(payload),
      maxOutputTokens: HYP_NARRATIVE_MAX_OUTPUT_TOKENS,
      abortSignal,
      abortMessage: STOPPED_PIPELINE_MESSAGE,
      createAbortError: createPipelineStopError,
      isStopError: isPipelineStopError,
      maxAttempts: HYP_MODEL_CALL_MAX_ATTEMPTS,
      providerOptions: {
        openai: {
          reasoningEffort: HYP_REASONING_EFFORT,
        },
      },
    });
  } catch (lastError) {
    console.warn(
      `[manex-hypothesis:narrative-fallback] ${stringifyUnicodeSafe({
        anchorKey: seed.anchorKey,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      })}`,
    );
  }

  return deterministicNarrative(seed);
}

async function buildPersistableCandidates(input: {
  caseSeeds: HypothesisSeed[];
  factsByProduct: Map<string, ThreadFacts>;
  abortSignal?: AbortSignal;
}) {
  const narratives = await mapWithConcurrency(
    input.caseSeeds,
    HYP_NARRATIVE_CONCURRENCY,
    (seed) => generateNarrative(seed, input.abortSignal),
    input.abortSignal,
  );

  return input.caseSeeds.map((seed, index) => {
    const narrative = narratives[index] ?? deterministicNarrative(seed);
    const confidence = toConfidence(seed.score.total);
    const priority = toPriority(seed.score.total);

    const payload = {
      contractVersion: HYP_CASE_PAYLOAD_SCHEMA_VERSION,
      family: seed.family,
      kind: seed.kind,
      caseTypeHint: seed.caseTypeHint,
      anchorKey: seed.anchorKey,
      anchorLabel: seed.anchorLabel,
      score: seed.score,
      fingerprintTokens: seed.fingerprintTokens,
      oneLineWhyGrouped: narrative.oneLineWhyGrouped,
      oneLineWhyExcluded: narrative.oneLineWhyExcluded,
      recommendedActions: narrative.recommendedActions,
      recommendedActionType: seed.recommendedActionType,
      articleWideAnchorRisk: seed.articleWideAnchorRisk,
    };

    return {
      id: createId("HCAND"),
      title: narrative.title,
      lifecycleStatus: "proposed" as const,
      caseKind: seed.family.replaceAll("_", " "),
      summary: narrative.summary,
      suspectedCommonRootCause: narrative.suspectedCommonRootCause,
      confidence,
      priority,
      strongestEvidence: narrative.strongestEvidence,
      conflictingEvidence: narrative.conflictingEvidence,
      recommendedNextTraceChecks: narrative.recommendedNextTraceChecks,
      includedProductIds: seed.includedProductIds,
      includedSignalIds: seed.includedSignalIds,
      payload,
      members: [
        ...seed.includedProductIds.map((productId) => ({
          id: createId("HCMEM"),
          memberType: "product" as const,
          entityId: productId,
          productId,
          signalId: null,
          signalType: null,
          rationale: narrative.oneLineWhyGrouped,
        })),
        ...seed.includedSignalIds.map((signalId) => {
          const signalOwner = seed.includedProductIds.find((productId) =>
            input.factsByProduct.get(productId)?.signalIds.includes(signalId),
          );
          const signalType =
            signalOwner &&
            input.factsByProduct
              .get(signalOwner)
              ?.thread.signals.find((signal) => signal.signalId === signalId)?.signalType;

          return {
            id: createId("HCMEM"),
            memberType: "signal" as const,
            entityId: signalId,
            productId: signalOwner ?? null,
            signalId,
            signalType: signalType ?? null,
            rationale: null,
          };
        }),
      ],
    } satisfies PersistableHypothesisCandidate;
  });
}

function parseHypothesisReviewPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as { localInventory?: unknown; globalInventory?: unknown };
  const localInventory = hypothesisLocalInventorySchema.safeParse(candidate.localInventory);
  const globalInventory = hypothesisGlobalInventorySchema.safeParse(candidate.globalInventory);

  if (!localInventory.success || !globalInventory.success) {
    return null;
  }

  return {
    localInventory: localInventory.data,
    globalInventory: globalInventory.data,
  };
}

function extractFingerprintTokens(candidate: HypothesisCaseCandidateRecord) {
  if (candidate.payload && typeof candidate.payload === "object") {
    const payload = candidate.payload as { fingerprintTokens?: unknown };

    if (Array.isArray(payload.fingerprintTokens)) {
      return uniqueValues(
        payload.fingerprintTokens.map((value) => (typeof value === "string" ? value : String(value))),
      );
    }
  }

  return [] as string[];
}

function candidateCaseTypeHint(candidate: HypothesisCaseCandidateRecord) {
  if (candidate.payload && typeof candidate.payload === "object") {
    const payload = candidate.payload as { caseTypeHint?: unknown };

    if (
      payload.caseTypeHint === "supplier" ||
      payload.caseTypeHint === "process" ||
      payload.caseTypeHint === "design" ||
      payload.caseTypeHint === "handling" ||
      payload.caseTypeHint === "watchlist" ||
      payload.caseTypeHint === "noise"
    ) {
      return payload.caseTypeHint;
    }
  }

  if (/supplier/i.test(candidate.caseKind)) {
    return "supplier";
  }

  if (/process/i.test(candidate.caseKind)) {
    return "process";
  }

  if (/design|latent/i.test(candidate.caseKind)) {
    return "design";
  }

  if (/handling/i.test(candidate.caseKind)) {
    return "handling";
  }

  return "watchlist";
}

function buildGlobalItem(input: {
  inventoryKind: HypothesisGlobalInventoryItem["inventoryKind"];
  caseTypeHint: HypothesisGlobalInventoryItem["caseTypeHint"];
  title: string;
  oneLineExplanation: string;
  summary: string;
  confidence: number;
  priority: HypothesisCaseCandidatePriority;
  articleIds: string[];
  linkedCandidateIds: string[];
  strongestEvidence: string[];
}) {
  return {
    inventoryTempId: createId("HINV"),
    inventoryKind: input.inventoryKind,
    caseTypeHint: input.caseTypeHint,
    title: trimPreview(input.title, 180),
    oneLineExplanation: trimPreview(input.oneLineExplanation, 240) || "Investigation hypothesis remains active.",
    summary: trimPreview(input.summary, 1200) || input.oneLineExplanation,
    confidence: Math.max(0.12, Math.min(0.98, input.confidence)),
    priority: input.priority,
    articleIds: uniqueValues(input.articleIds),
    linkedCandidateIds: uniqueValues(input.linkedCandidateIds),
    strongestEvidence: uniqueValues(input.strongestEvidence).slice(0, 8),
  } satisfies HypothesisGlobalInventoryItem;
}

function buildCandidateEdgeCount(left: HypothesisCaseCandidateRecord, right: HypothesisCaseCandidateRecord) {
  const leftTokens = extractFingerprintTokens(left).filter((token) => !token.startsWith("family:"));
  const rightTokens = new Set(extractFingerprintTokens(right).filter((token) => !token.startsWith("family:")));
  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

function sharedTokens(left: HypothesisCaseCandidateRecord, right: HypothesisCaseCandidateRecord, prefix: string) {
  const rightTokens = new Set(extractFingerprintTokens(right).filter((token) => token.startsWith(prefix)));
  return extractFingerprintTokens(left).filter(
    (token) => token.startsWith(prefix) && rightTokens.has(token),
  );
}

function canMergeGlobalCandidates(left: HypothesisCaseCandidateRecord, right: HypothesisCaseCandidateRecord) {
  const leftType = candidateCaseTypeHint(left);
  const rightType = candidateCaseTypeHint(right);

  if (leftType !== rightType) {
    return false;
  }

  const edgeCount = buildCandidateEdgeCount(left, right);

  if (edgeCount < GLOBAL_CASE_EDGE_THRESHOLD) {
    return false;
  }

  const sameArticle = left.articleId === right.articleId;
  const sharedSupplierBatches = sharedTokens(left, right, "supplier_batch:");
  const sharedParts = [...sharedTokens(left, right, "part:"), ...sharedTokens(left, right, "bom:")];
  const sharedOccurrence = sharedTokens(left, right, "occurrence:");
  const sharedWeeks = sharedTokens(left, right, "week:");
  const sharedDiagnostics = [...sharedTokens(left, right, "defect:"), ...sharedTokens(left, right, "test:")];
  const sharedLag = sharedTokens(left, right, "claim_lag:");
  const sharedHandling = [...sharedTokens(left, right, "order:"), ...sharedTokens(left, right, "user:")];

  if (leftType === "supplier") {
    return sharedSupplierBatches.length > 0 && sharedParts.length > 0;
  }

  if (leftType === "process") {
    return sharedOccurrence.length > 0 && sharedWeeks.length > 0 && sharedDiagnostics.length > 0;
  }

  if (leftType === "design") {
    return sharedParts.length > 0 && sharedLag.length > 0 && (sameArticle || sharedParts.length > 1);
  }

  if (leftType === "handling") {
    return sameArticle && sharedHandling.length > 0 && sharedDiagnostics.length > 0;
  }

  return sameArticle && edgeCount >= GLOBAL_CASE_EDGE_THRESHOLD + 1;
}

async function loadLatestCompletedHypothesisRuns() {
  const rows =
    (await queryPostgres<LatestCompletedHypothesisRunRow>(
      `
        SELECT DISTINCT ON (article_id)
          run_id,
          article_id,
          article_name,
          review_payload,
          completed_at
        FROM team_hyp_case_run
        WHERE status = 'completed'
        ORDER BY article_id, completed_at DESC NULLS LAST, started_at DESC
      `,
    )) ?? [];

  return rows;
}

async function getLatestHypothesisGlobalRunWithInventory() {
  const rows =
    (await queryPostgres<LatestCompletedHypothesisRunRow>(
      `
        SELECT
          run_id,
          article_id,
          article_name,
          review_payload,
          completed_at
        FROM team_hyp_case_run
        WHERE status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, started_at DESC
        LIMIT 12
      `,
    )) ?? [];

  for (const row of rows) {
    const parsed = parseHypothesisReviewPayload(row.review_payload);

    if (!parsed) {
      continue;
    }

    const latestRun = await getLatestHypothesisCaseRun(row.article_id);

    if (latestRun && latestRun.id === row.run_id) {
      return {
        latestGlobalRun: latestRun,
        globalInventory: parsed.globalInventory,
      };
    }

    return {
      latestGlobalRun: {
        id: row.run_id,
        articleId: row.article_id,
        articleName: row.article_name,
        model: env.OPENAI_MODEL,
        status: "completed" as const,
        schemaVersion: HYP_LOCAL_INVENTORY_SCHEMA_VERSION,
        promptVersion: HYP_PROMPT_VERSION,
        productCount: 0,
        signalCount: 0,
        issueCount: 0,
        candidateCount: 0,
        startedAt: row.completed_at ?? new Date().toISOString(),
        completedAt: row.completed_at,
        errorMessage: null,
        currentStage: "completed" as const,
        stageDetail: null,
        stageUpdatedAt: row.completed_at,
      },
      globalInventory: parsed.globalInventory,
    };
  }

  return {
    latestGlobalRun: null,
    globalInventory: null,
  };
}

async function runHypothesisGlobalReconciliation(input: {
  currentArticleId: string;
  currentCandidates: HypothesisCaseCandidateRecord[];
  currentReviewPayload: HypothesisLocalInventory;
  abortSignal?: AbortSignal;
}) {
  throwIfPipelineAborted(input.abortSignal);
  const latestRuns = await loadLatestCompletedHypothesisRuns();
  const allCaseEntries: Array<{
    articleId: string;
    candidate: HypothesisCaseCandidateRecord;
  }> = [];
  const localWatchlists: HypothesisLocalWatchlist[] = [...input.currentReviewPayload.watchlists];
  const localLeadingIndicators: HypothesisLocalLeadingIndicator[] = [
    ...input.currentReviewPayload.leadingIndicators,
  ];
  const localNoise: HypothesisLocalNoise[] = [...input.currentReviewPayload.noise];
  const localRejected: HypothesisLocalInventory["rejectedCases"] = [...input.currentReviewPayload.rejectedCases];

  for (const candidate of input.currentCandidates) {
    allCaseEntries.push({
      articleId: input.currentArticleId,
      candidate,
    });
  }

  for (const row of latestRuns) {
    if (row.article_id === input.currentArticleId) {
      continue;
    }

    const parsed = parseHypothesisReviewPayload(row.review_payload);

    if (!parsed) {
      continue;
    }

    const candidates = await listHypothesisCaseCandidatesForRun(row.run_id);

    for (const candidate of candidates) {
      allCaseEntries.push({
        articleId: row.article_id,
        candidate,
      });
    }

    localWatchlists.push(...parsed.localInventory.watchlists);
    localLeadingIndicators.push(...parsed.localInventory.leadingIndicators);
    localNoise.push(...parsed.localInventory.noise);
    localRejected.push(...parsed.localInventory.rejectedCases);
  }

  const visited = new Set<string>();
  const validatedCases: HypothesisGlobalInventoryItem[] = [];
  const caseMergeLog: string[] = [];

  for (const entry of allCaseEntries) {
    if (visited.has(entry.candidate.id)) {
      continue;
    }

    const queue = [entry];
    const component: typeof allCaseEntries = [];
    visited.add(entry.candidate.id);

    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);

      for (const neighbor of allCaseEntries) {
        if (visited.has(neighbor.candidate.id)) {
          continue;
        }

        const edgeCount = buildCandidateEdgeCount(current.candidate, neighbor.candidate);

        if (edgeCount < GLOBAL_CASE_EDGE_THRESHOLD) {
          continue;
        }

        if (!canMergeGlobalCandidates(current.candidate, neighbor.candidate)) {
          continue;
        }

        visited.add(neighbor.candidate.id);
        queue.push(neighbor);
      }
    }

    const articleIds = uniqueValues(component.map((item) => item.articleId));
    const linkedCandidateIds = uniqueValues(component.map((item) => item.candidate.id));
    const strongestEvidence = uniqueValues(
      component.flatMap((item) => item.candidate.strongestEvidence),
    ).slice(0, 8);
    const confidence =
      component.reduce((total, item) => total + (item.candidate.confidence ?? 0.3), 0) /
      Math.max(1, component.length);
    const priority = component
      .map((item) => item.candidate.priority)
      .sort((left, right) => {
        const rank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
        return rank[right] - rank[left];
      })[0] as HypothesisCaseCandidatePriority;
    const lead = [...component].sort(
      (left, right) =>
        (right.candidate.confidence ?? 0) - (left.candidate.confidence ?? 0) ||
        left.candidate.title.localeCompare(right.candidate.title),
    )[0]!;
    const caseTypeHint = candidateCaseTypeHint(lead.candidate);

    if (component.length > 1) {
      caseMergeLog.push(
        `${lead.candidate.title} merged ${component.length} article-local hypotheses through shared anchor tokens.`,
      );
    }

    validatedCases.push(
      buildGlobalItem({
        inventoryKind: "validated_case",
        caseTypeHint:
          caseTypeHint === "watchlist" || caseTypeHint === "noise" ? "supplier" : caseTypeHint,
        title: lead.candidate.title,
        oneLineExplanation:
          articleIds.length > 1
            ? `${articleIds.length} articles share the same traceability- or mechanism-specific anchor set.`
            : "This article-level hypothesis remains strong in the latest snapshot.",
        summary: lead.candidate.summary,
        confidence: Math.max(confidence, GLOBAL_KEEP_CONFIDENCE_THRESHOLD),
        priority,
        articleIds,
        linkedCandidateIds,
        strongestEvidence,
      }),
    );
  }

  const groupedWatchlists = localWatchlists.slice(0, 24).map((item) =>
    buildGlobalItem({
      inventoryKind: "watchlist",
      caseTypeHint: "watchlist",
      title: item.title,
      oneLineExplanation: item.strongestEvidence[0] ?? item.summary,
      summary: item.summary,
      confidence: item.confidence,
      priority: item.priority,
      articleIds: [],
      linkedCandidateIds: [],
      strongestEvidence: item.strongestEvidence,
    }),
  );
  const groupedLeadingIndicators = localLeadingIndicators.slice(0, 24).map((item) =>
    buildGlobalItem({
      inventoryKind: "watchlist",
      caseTypeHint: "watchlist",
      title: item.title,
      oneLineExplanation: item.strongestEvidence[0] ?? item.summary,
      summary: item.summary,
      confidence: item.confidence,
      priority: "low",
      articleIds: [],
      linkedCandidateIds: [],
      strongestEvidence: item.strongestEvidence,
    }),
  );
  const groupedNoise = localNoise.slice(0, 24).map((item) =>
    buildGlobalItem({
      inventoryKind: "noise_bucket",
      caseTypeHint: "noise",
      title: item.title,
      oneLineExplanation: item.strongestEvidence[0] ?? item.summary,
      summary: item.summary,
      confidence: 0.38,
      priority: "low",
      articleIds: [],
      linkedCandidateIds: [],
      strongestEvidence: item.strongestEvidence,
    }),
  );
  const groupedRejected = localRejected.slice(0, 24).map((item) =>
    buildGlobalItem({
      inventoryKind: "rejected_case",
      caseTypeHint: "noise",
      title: item.title,
      oneLineExplanation: item.reason,
      summary: item.reason,
      confidence: 0.22,
      priority: "low",
      articleIds: [],
      linkedCandidateIds: [],
      strongestEvidence: [item.reason],
    }),
  );

  return hypothesisGlobalInventorySchema.parse({
    contractVersion: HYP_GLOBAL_INVENTORY_SCHEMA_VERSION,
    inventorySummary: `${validatedCases.length} validated hypotheses, ${groupedWatchlists.length} watchlists, ${groupedLeadingIndicators.length} leading indicators, and ${groupedNoise.length} noise buckets are visible in the latest snapshot.`,
    validatedCases: validatedCases.slice(0, 40),
    watchlists: groupedWatchlists.slice(0, 40),
    leadingIndicators: groupedLeadingIndicators.slice(0, 40),
    noiseBuckets: groupedNoise.slice(0, 40),
    rejectedCases: groupedRejected.slice(0, 40),
    caseMergeLog: uniqueValues(caseMergeLog).slice(0, 24),
    confidenceNotes: [
      "The hypothesis engine now keeps cases article-local by default unless physical traceability or family-specific closure supports a broader merge.",
      "Supplier, process, latent-field, and handling families are scored separately before any narrative is generated.",
      "Leading indicators, watchlists, and noise remain visible so detection hotspots and marginal-only artifacts do not inflate active cases.",
    ],
  });
}

function buildArticleTokenUniverse(input: {
  dossier: ClusteredArticleDossier;
  factsByProduct: Map<string, ThreadFacts>;
  localInventory: HypothesisLocalInventory;
}) {
  return new Set(
    uniqueValues([
      ...input.dossier.crossProductSummaries.sharedSupplierBatches.map(
        (item) => `supplier_batch:${item.batchRef}`,
      ),
      ...input.dossier.crossProductSummaries.sharedReportedPartNumbers.map(
        (item) => `part:${item.partNumber}`,
      ),
      ...input.dossier.crossProductSummaries.sharedBomFindNumbers.map(
        (item) => `bom:${item.findNumber}`,
      ),
      ...input.dossier.crossProductSummaries.sharedOccurrenceSections.map(
        (item) => `occurrence:${item.section}`,
      ),
      ...input.dossier.crossProductSummaries.sharedSections.map((item) => `detected:${item.section}`),
      ...input.dossier.crossProductSummaries.sharedTestHotspots.map((item) => `test:${item.testKey}`),
      ...[...input.factsByProduct.values()].flatMap((facts) => [
        ...facts.defectCodes.map((value) => `defect:${value}`),
        ...facts.reworkUsers.map((value) => `user:${value}`),
        ...(facts.orderId ? [`order:${facts.orderId}`] : []),
        ...(facts.claimLagBucket !== "none" ? [`claim_lag:${facts.claimLagBucket}`] : []),
        ...(facts.nearLimitSignals.length > 0 ? ["leading_indicator:near_limit"] : []),
      ]),
      ...input.localInventory.leadingIndicators.map((indicator) =>
        indicator.indicatorKind === "near_limit"
          ? "leading_indicator:near_limit"
          : indicator.indicatorKind === "marginal_drift"
            ? "leading_indicator:marginal_drift"
            : "leading_indicator:screening_echo",
      ),
    ]),
  );
}

function deriveNoiseTokens(item: HypothesisLocalNoise) {
  return new Set(
    uniqueValues([
      item.family === "noise_watchlist" ? "family:noise_watchlist" : null,
      ...item.strongestEvidence
        .filter((line) => /detected-section|detected section|hotspot/i.test(line))
        .flatMap(() => [`detected:${item.title.replace(/^[^:]*\s/, "")}`]),
      ...item.strongestEvidence
        .filter((line) => /false-positive/i.test(line))
        .map(() => "noise:false_positive"),
      ...item.strongestEvidence
        .filter((line) => /marginal/i.test(line))
        .map(() => "leading_indicator:marginal_drift"),
      ...item.strongestEvidence
        .flatMap((line) => (line.match(/[A-Z]+[_-][A-Z0-9-]+/g) ?? []).map((token) => `test:${token}`)),
    ]),
  );
}

function deriveLeadingIndicatorTokens(item: HypothesisLocalLeadingIndicator) {
  return new Set(
    uniqueValues([
      item.indicatorKind === "near_limit"
        ? "leading_indicator:near_limit"
        : item.indicatorKind === "marginal_drift"
          ? "leading_indicator:marginal_drift"
          : "leading_indicator:screening_echo",
      ...item.strongestEvidence
        .flatMap((line) => (line.match(/[A-Z]+[_-][A-Z0-9-]+/g) ?? []).map((token) => `test:${token}`)),
    ]),
  );
}

function evaluateHypothesisRun(input: {
  dossier: ClusteredArticleDossier;
  factsByProduct: Map<string, ThreadFacts>;
  persistedCandidates: HypothesisCaseCandidateRecord[];
  localInventory: HypothesisLocalInventory;
}) {
  const candidateRanks = sortCandidatesForArticleQueue(input.persistedCandidates);
  const tokenUniverse = buildArticleTokenUniverse(input);
  const rows = HYPOTHESIS_TRUTH_DEFINITIONS.map((truth) => {
    const applicable =
      (truth.articleId ? truth.articleId === input.dossier.article.articleId : true) &&
      truth.anchorTokens.some((token) => tokenUniverse.has(token));
    const matchingCandidate = candidateRanks.find((candidate) =>
      truth.expectedKind === "case"
        ? truth.anchorTokens.filter((token) => extractFingerprintTokens(candidate).includes(token)).length >=
          Math.min(2, truth.anchorTokens.length)
        : false,
    );
    const matchingNoise =
      truth.expectedKind === "noise"
        ? input.localInventory.noise.find((item) =>
            truth.anchorTokens.some((token) => deriveNoiseTokens(item).has(token)),
          )
        : null;
    const matchingIndicator =
      truth.expectedKind === "leading_indicator"
        ? input.localInventory.leadingIndicators.find((item) =>
            truth.anchorTokens.some((token) => deriveLeadingIndicatorTokens(item).has(token)),
          )
        : null;
    const surfaced = Boolean(matchingCandidate || matchingNoise || matchingIndicator);
    const rankPosition = matchingCandidate
      ? candidateRanks.findIndex((candidate) => candidate.id === matchingCandidate.id) + 1
      : null;
    const falseNeighbors = candidateRanks.filter((candidate) => {
      if (matchingCandidate?.id === candidate.id) {
        return false;
      }

      return (
        truth.anchorTokens.some((token) => extractFingerprintTokens(candidate).includes(token)) &&
        candidateCaseTypeHint(candidate) !==
          (truth.family === "latent_design"
            ? "design"
            : truth.family === "process_window"
              ? "process"
              : truth.family === "supplier_batch"
                ? "supplier"
                : truth.family === "handling_cluster"
                  ? "handling"
                  : "noise")
      );
    }).length;
    const falseMerges =
      matchingCandidate && matchingCandidate.includedProductIds.length > 10 && truth.family !== "supplier_batch"
        ? 1
        : 0;

    return hypothesisEvaluationRowSchema.parse({
      truthId: truth.truthId,
      label: truth.label,
      family: truth.family,
      expectedKind: truth.expectedKind,
      applicable,
      surfaced,
      rankPosition,
      matchedCandidateId: matchingCandidate?.id ?? null,
      matchedTitle: matchingCandidate?.title ?? matchingNoise?.title ?? matchingIndicator?.title ?? null,
      matchedAnchor:
        (matchingCandidate?.payload &&
        typeof matchingCandidate.payload === "object" &&
        typeof (matchingCandidate.payload as { anchorLabel?: unknown }).anchorLabel === "string"
          ? ((matchingCandidate.payload as { anchorLabel: string }).anchorLabel ?? null)
          : null) ??
        matchingNoise?.title ??
        matchingIndicator?.title ??
        null,
      falseMergeCount: falseMerges,
      falseNeighborCount: falseNeighbors,
      topEvidence:
        matchingCandidate?.strongestEvidence.slice(0, 3) ??
        matchingNoise?.strongestEvidence.slice(0, 3) ??
        matchingIndicator?.strongestEvidence.slice(0, 3) ??
        [],
      notes: uniqueValues([
        applicable && !surfaced ? `Expected pattern was applicable but did not surface for ${truth.label}.` : null,
        falseNeighbors > 0 ? `${falseNeighbors} nearby candidates reused the truth anchors with the wrong family.` : null,
        falseMerges > 0 ? "Matched case still looks broader than the canonical story should be." : null,
      ]).slice(0, 6),
    });
  });
  const applicableTruthCount = rows.filter((row) => row.applicable).length;
  const surfacedTruthCount = rows.filter((row) => row.applicable && row.surfaced).length;
  const falseMergeCount = rows.reduce((sum, row) => sum + row.falseMergeCount, 0);
  const falseNeighborCount = rows.reduce((sum, row) => sum + row.falseNeighborCount, 0);

  return hypothesisEvaluationSummarySchema.parse({
    applicableTruthCount,
    surfacedTruthCount,
    leadingIndicatorCount: input.localInventory.leadingIndicators.length,
    falseMergeCount,
    falseNeighborCount,
    summaryLine: `${surfacedTruthCount}/${Math.max(1, applicableTruthCount)} applicable benchmark stories surfaced; ${falseNeighborCount} false neighbors and ${falseMergeCount} false merges remain.`,
    rows,
  });
}

async function persistHypothesisEvaluation(input: {
  runId: string;
  articleId: string;
  summary: HypothesisEvaluationSummary;
}) {
  for (const truth of HYPOTHESIS_TRUTH_DEFINITIONS) {
    await queryPostgres(
      `
        INSERT INTO team_hyp_eval_case_truth (
          truth_id,
          label,
          family,
          expected_kind,
          article_id,
          anchor_tokens,
          notes,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
        ON CONFLICT (truth_id)
        DO UPDATE SET
          label = EXCLUDED.label,
          family = EXCLUDED.family,
          expected_kind = EXCLUDED.expected_kind,
          article_id = EXCLUDED.article_id,
          anchor_tokens = EXCLUDED.anchor_tokens,
          notes = EXCLUDED.notes,
          updated_at = NOW()
      `,
      [
        truth.truthId,
        truth.label,
        truth.family,
        truth.expectedKind,
        truth.articleId,
        stringifyUnicodeSafe(truth.anchorTokens),
        truth.notes,
      ],
    );
  }

  await queryPostgres(`DELETE FROM team_hyp_eval_case_prediction WHERE run_id = $1`, [input.runId]);

  for (const row of input.summary.rows) {
    await queryPostgres(
      `
        INSERT INTO team_hyp_eval_case_prediction (
          prediction_id,
          run_id,
          article_id,
          truth_id,
          applicable,
          surfaced,
          rank_position,
          matched_candidate_id,
          matched_title,
          matched_anchor,
          false_merge_count,
          false_neighbor_count,
          top_evidence,
          notes
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb
        )
      `,
      [
        createId("HEVAL"),
        input.runId,
        input.articleId,
        row.truthId,
        row.applicable,
        row.surfaced,
        row.rankPosition,
        row.matchedCandidateId,
        row.matchedTitle,
        row.matchedAnchor,
        row.falseMergeCount,
        row.falseNeighborCount,
        stringifyUnicodeSafe(row.topEvidence),
        stringifyUnicodeSafe(row.notes),
      ],
    );
  }

  await queryPostgres(
    `
      INSERT INTO team_hyp_eval_case_metrics (
        run_id,
        article_id,
        applicable_truth_count,
        surfaced_truth_count,
        leading_indicator_count,
        false_merge_count,
        false_neighbor_count,
        summary,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (run_id)
      DO UPDATE SET
        applicable_truth_count = EXCLUDED.applicable_truth_count,
        surfaced_truth_count = EXCLUDED.surfaced_truth_count,
        leading_indicator_count = EXCLUDED.leading_indicator_count,
        false_merge_count = EXCLUDED.false_merge_count,
        false_neighbor_count = EXCLUDED.false_neighbor_count,
        summary = EXCLUDED.summary,
        updated_at = NOW()
    `,
    [
      input.runId,
      input.articleId,
      input.summary.applicableTruthCount,
      input.summary.surfacedTruthCount,
      input.summary.leadingIndicatorCount,
      input.summary.falseMergeCount,
      input.summary.falseNeighborCount,
      stringifyUnicodeSafe(input.summary),
    ],
  );
}

function toPersistableCaseKind(seed: HypothesisSeed) {
  if (seed.family === "supplier_batch") {
    return "supplier batch";
  }

  if (seed.family === "process_window") {
    return "process window";
  }

  if (seed.family === "latent_design") {
    return "latent design";
  }

  return "handling cluster";
}

function sortCandidatesForArticleQueue(candidates: HypothesisCaseCandidateRecord[]) {
  const priorityRank: Record<HypothesisCaseCandidatePriority, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };

  return [...candidates].sort((left, right) => {
    const priorityDelta = priorityRank[right.priority] - priorityRank[left.priority];

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const confidenceDelta = (right.confidence ?? -1) - (left.confidence ?? -1);

    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

export async function runHypothesisArticleCaseClustering(
  articleId: string,
  options?: { abortSignal?: AbortSignal },
) {
  if (!capabilities.hasPostgres) {
    throw new Error("Hypothesis case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Hypothesis case clustering requires OPENAI_API_KEY.");
  }

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();
  throwIfPipelineAborted(options?.abortSignal);
  const preloadedDossierRecord = await getTeamArticleDossierRecord<ClusteredArticleDossier>(
    normalizedArticleId,
  );
  const preloadedDossier =
    preloadedDossierRecord?.payload ??
    (await buildArticleDossier(normalizedArticleId, undefined, options).catch(() => null));

  if (!preloadedDossier) {
    throw new Error(`No products found for article ${normalizedArticleId}.`);
  }

  const runId = createId("HCRUN");
  await createHypothesisCaseRun({
    id: runId,
    articleId: normalizedArticleId,
    articleName: preloadedDossier.article.articleName,
    model: env.OPENAI_MODEL,
    schemaVersion: HYP_LOCAL_INVENTORY_SCHEMA_VERSION,
    promptVersion: HYP_PROMPT_VERSION,
    productCount: preloadedDossier.article.productCount,
    signalCount: preloadedDossier.article.totalSignals,
    currentStage: "stage1_loading",
    stageDetail: "Loading shared Stage 1 dossier for the hypothesis engine.",
    requestPayload: {
      articleId: normalizedArticleId,
      productCount: preloadedDossier.article.productCount,
      totalSignals: preloadedDossier.article.totalSignals,
    },
  });

  try {
    const dossier =
      preloadedDossierRecord?.payload ??
      (await buildArticleDossier(
        normalizedArticleId,
        async (stage, detail) => {
          await updateHypothesisCaseRunStage({
            id: runId,
            currentStage: stage,
            stageDetail: detail,
          });
        },
        options,
      ));

    await updateHypothesisCaseRunStage({
      id: runId,
      currentStage: "stage1_synthesis",
      stageDetail: `Built shared dossier with ${dossier.article.totalSignals} signals.`,
      productCount: dossier.article.productCount,
      signalCount: dossier.article.totalSignals,
    });

    throwIfPipelineAborted(options?.abortSignal);
    await updateHypothesisCaseRunStage({
      id: runId,
      currentStage: "stage1_issue_extraction",
      stageDetail: `Generating mechanism-specific hypotheses across ${dossier.article.productCount} products.`,
    });

    const factsByProduct = buildFactsLookup(dossier);
    const seeds = [
      ...generateSupplierBatchSeeds(dossier, factsByProduct),
      ...generateProcessWindowSeeds(dossier, factsByProduct),
      ...generateLatentDesignSeeds(dossier, factsByProduct),
      ...generateHandlingSeeds(dossier, factsByProduct),
      ...generateNoiseSeeds(factsByProduct),
    ];

    await updateHypothesisCaseRunStage({
      id: runId,
      currentStage: "stage2_grouping",
      stageDetail: `Scoring ${seeds.length} hypothesis-family candidates.`,
      issueCount: seeds.length,
    });

    const { localInventory, caseSeeds } = resolveLocalInventory({
      dossier,
      factsByProduct,
      seeds,
    });

    await updateHypothesisCaseRunStage({
      id: runId,
      currentStage: "stage2_final_judge",
      stageDetail: `Generating bounded narratives for ${caseSeeds.length} ranked investigations.`,
      issueCount: seeds.length,
    });

    const persistableCandidates = (
      await buildPersistableCandidates({
        caseSeeds,
        factsByProduct,
        abortSignal: options?.abortSignal,
      })
    ).map((candidate, index) => ({
      ...candidate,
      caseKind: toPersistableCaseKind(caseSeeds[index]),
    }));

    await updateHypothesisCaseRunStage({
      id: runId,
      currentStage: "stage2_persisting",
      stageDetail: `Persisting ${persistableCandidates.length} hypothesis-backed investigations.`,
      issueCount: seeds.length,
    });

    await replaceHypothesisCaseCandidatesForRun({
      runId,
      articleId: dossier.article.articleId,
      candidates: persistableCandidates,
    });

    const persistedCandidates = await listHypothesisCaseCandidatesForRun(runId);

    await updateHypothesisCaseRunStage({
      id: runId,
      currentStage: "stage3_reconciliation",
      stageDetail: "Reconciling hypothesis cases, watchlists, and noise globally.",
      issueCount: seeds.length,
    });

    const globalInventory = await runHypothesisGlobalReconciliation({
      currentArticleId: dossier.article.articleId,
      currentCandidates: persistedCandidates,
      currentReviewPayload: localInventory,
      abortSignal: options?.abortSignal,
    });

    const evaluationSummary = evaluateHypothesisRun({
      dossier,
      factsByProduct,
      persistedCandidates,
      localInventory,
    });
    const enrichedLocalInventory = hypothesisLocalInventorySchema.parse({
      ...localInventory,
      globalObservations: uniqueValues([
        ...localInventory.globalObservations,
        evaluationSummary.summaryLine,
      ]).slice(0, 20),
      evaluationSummary,
    });

    await persistHypothesisEvaluation({
      runId,
      articleId: dossier.article.articleId,
      summary: evaluationSummary,
    });

    const reviewPayload: HypothesisReviewPayload = {
      contractVersion: HYP_RUN_REVIEW_SCHEMA_VERSION,
      localInventory: enrichedLocalInventory,
      globalInventory,
    };

    await completeHypothesisCaseRun({
      id: runId,
      issueCount: seeds.length,
      candidateCount: persistedCandidates.length,
      proposalPayload: {
        contractVersion: HYP_LOCAL_INVENTORY_SCHEMA_VERSION,
        seedCount: seeds.length,
        caseSeedCount: caseSeeds.length,
        leadingIndicatorCount: enrichedLocalInventory.leadingIndicators.length,
        seeds: seeds.map((seed) => ({
          tempId: seed.tempId,
          family: seed.family,
          kind: seed.kind,
          anchorKey: seed.anchorKey,
          score: seed.score,
          includedProductIds: seed.includedProductIds,
        })),
      },
      reviewPayload,
      stageDetail: `Finished with ${persistedCandidates.length} ranked investigation cases.`,
    });

    const latestRun = await getLatestHypothesisCaseRun(dossier.article.articleId);

    return {
      articleId: dossier.article.articleId,
      dossier,
      latestRun,
      proposedCases: persistedCandidates,
      globalInventory,
    };
  } catch (error) {
    await failHypothesisCaseRun({
      id: runId,
      errorMessage:
        error instanceof Error ? error.message : "The hypothesis engine failed unexpectedly.",
      stageDetail: "Hypothesis engine failed before completion.",
    });
    throw error;
  }
}

export async function runHypothesisArticleCaseClusteringBatch(input?: {
  articleIds?: string[];
  abortSignal?: AbortSignal;
  onStart?: (input: {
    requestedArticleIds: string[];
    concurrency: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
  onArticleComplete?: (input: {
    result: HypothesisCaseClusteringBatchResult;
    okCount: number;
    errorCount: number;
    completedCount: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
}) {
  if (!capabilities.hasPostgres) {
    throw new Error("Hypothesis case clustering requires DATABASE_URL.");
  }

  const targetArticleIds =
    input?.articleIds?.length
      ? uniqueValues(input.articleIds)
      : (
          await queryPostgres<{ article_id: string }>(
            `
              SELECT article_id
              FROM article
              ORDER BY article_id
            `,
          )
        )?.map((row) => row.article_id) ?? [];

  await input?.onStart?.({
    requestedArticleIds: targetArticleIds,
    concurrency: HYP_ARTICLE_PIPELINE_CONCURRENCY,
    totalArticleCount: targetArticleIds.length,
  });

  let okCount = 0;
  let errorCount = 0;
  let completedCount = 0;

  const results = await mapWithConcurrency(
    targetArticleIds,
    HYP_ARTICLE_PIPELINE_CONCURRENCY,
    async (articleId) => {
      let result: HypothesisCaseClusteringBatchResult;

      try {
        const articleResult = await runHypothesisArticleCaseClustering(articleId, {
          abortSignal: input?.abortSignal,
        });
        result = {
          articleId,
          ok: true,
          runId: articleResult.latestRun?.id ?? null,
          issueCount: articleResult.latestRun?.issueCount ?? 0,
          caseCount: articleResult.proposedCases.length,
          validatedCount: articleResult.globalInventory.validatedCases.length,
          watchlistCount: articleResult.globalInventory.watchlists.length,
          noiseCount: articleResult.globalInventory.noiseBuckets.length,
          error: null,
          completedAt: new Date().toISOString(),
        };
      } catch (error) {
        result = {
          articleId,
          ok: false,
          runId: null,
          issueCount: 0,
          caseCount: 0,
          validatedCount: 0,
          watchlistCount: 0,
          noiseCount: 0,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString(),
        };
      }

      completedCount += 1;

      if (result.ok) {
        okCount += 1;
      } else {
        errorCount += 1;
      }

      await input?.onArticleComplete?.({
        result,
        okCount,
        errorCount,
        completedCount,
        totalArticleCount: targetArticleIds.length,
      });

      return result;
    },
    input?.abortSignal,
  );

  const latestGlobalSnapshot = await getLatestHypothesisGlobalRunWithInventory();

  return {
    requestedArticleIds: targetArticleIds,
    concurrency: HYP_ARTICLE_PIPELINE_CONCURRENCY,
    okCount,
    errorCount,
    results,
    latestGlobalRun: latestGlobalSnapshot.latestGlobalRun,
    globalInventory: latestGlobalSnapshot.globalInventory,
  };
}

export const getHypothesisProposedCasesDashboard = memoizeWithTtl(
  "hypothesis-proposed-cases-dashboard",
  15_000,
  () => "dashboard",
  async (): Promise<HypothesisProposedCasesDashboardReadModel> => {
    if (!capabilities.hasPostgres) {
      return {
        articles: [],
        activeRuns: [],
        articleQueues: [],
        latestGlobalRun: null,
        globalInventory: null,
      };
    }

    const [articles, activeRuns, globalSnapshot] = await Promise.all([
      listHypothesisArticleClusterCards(),
      listActiveHypothesisCaseRuns(),
      getLatestHypothesisGlobalRunWithInventory(),
    ]);

    const priorityRank: Record<HypothesisCaseCandidatePriority, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };

    const articleQueues = (
      await Promise.all(
        articles
          .filter(
            (article) =>
              article.proposedCaseCount > 0 &&
              article.latestRun?.status === "completed" &&
              article.latestRun.id,
          )
          .map(async (article) => {
            const candidates = await listHypothesisCaseCandidatesForRun(article.latestRun!.id);
            const sorted = sortCandidatesForArticleQueue(candidates);
            const leadingCase = sorted[0] ?? null;
            const affectedProductCount = new Set(
              candidates.flatMap((candidate) => candidate.includedProductIds),
            ).size;

            return {
              articleId: article.articleId,
              articleName: article.articleName,
              proposedCaseCount: article.proposedCaseCount,
              affectedProductCount,
              highestPriority: leadingCase?.priority ?? null,
              topConfidence: leadingCase?.confidence ?? null,
              summary: leadingCase?.summary ?? null,
              leadingCaseTitle: leadingCase?.title ?? null,
              latestRun: article.latestRun,
            };
          }),
      )
    ).sort((left, right) => {
      const leftRank = left.highestPriority ? priorityRank[left.highestPriority] : -1;
      const rightRank = right.highestPriority ? priorityRank[right.highestPriority] : -1;

      if (rightRank !== leftRank) {
        return rightRank - leftRank;
      }

      const confidenceDelta = (right.topConfidence ?? -1) - (left.topConfidence ?? -1);

      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      return left.articleId.localeCompare(right.articleId);
    });

    return {
      articles,
      activeRuns,
      articleQueues,
      latestGlobalRun: globalSnapshot.latestGlobalRun,
      globalInventory: globalSnapshot.globalInventory,
    };
  },
);

export const getHypothesisArticleCaseboard = memoizeWithTtl(
  "hypothesis-article-caseboard",
  15_000,
  (articleId: string) => articleId,
  async (articleId: string): Promise<HypothesisArticleCaseboardReadModel | null> => {
    if (!capabilities.hasPostgres) {
      return null;
    }

    const normalizedArticleId =
      normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();

    const [dashboardCards, latestRun, persistedDossier] = await Promise.all([
      listHypothesisArticleClusterCards(),
      getLatestHypothesisCaseRun(normalizedArticleId),
      getTeamArticleDossierRecord<ClusteredArticleDossier>(normalizedArticleId),
    ]);
    const dossier =
      persistedDossier?.payload ??
      (await buildArticleDossier(normalizedArticleId).catch(() => null));
    const dashboardCard =
      dashboardCards.find((item) => item.articleId === normalizedArticleId) ?? null;
    const proposedCases =
      latestRun?.status === "completed"
        ? await listHypothesisCaseCandidatesForRun(latestRun.id)
        : [];
    const parsedReview = parseHypothesisReviewPayload(latestRun?.reviewPayload);

    if (!dashboardCard && !latestRun && !dossier) {
      return null;
    }

    return {
      articleId: normalizedArticleId,
      articleName:
        dashboardCard?.articleName ??
        latestRun?.articleName ??
        dossier?.article.articleName ??
        null,
      dashboardCard,
      dossier,
      latestRun,
      proposedCases,
      incidents: parsedReview?.localInventory.incidents ?? [],
      watchlists: parsedReview?.localInventory.watchlists ?? [],
      leadingIndicators: parsedReview?.localInventory.leadingIndicators ?? [],
      noise: parsedReview?.localInventory.noise ?? [],
      unassignedProducts: parsedReview?.localInventory.unassignedProducts ?? [],
      globalObservations: parsedReview?.localInventory.globalObservations ?? [],
      globalInventory: parsedReview?.globalInventory ?? null,
      evaluationSummary: parsedReview?.localInventory.evaluationSummary ?? null,
    };
  },
);

export const getHypothesisProposedCasesForProduct = memoizeWithTtl(
  "hypothesis-product-proposed-cases",
  15_000,
  (productId: string) => productId,
  async (productId: string) => {
    if (!capabilities.hasPostgres) {
      return [] as HypothesisCaseCandidateRecord[];
    }

    const normalizedProductId =
      normalizeUiIdentifier(productId) ?? productId.replace(/\s+/g, "").trim().toUpperCase();
    return listHypothesisCaseCandidatesForProduct(normalizedProductId);
  },
);
