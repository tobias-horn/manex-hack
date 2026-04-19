import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { buildArticleDossier, type ClusteredArticleDossier, type ClusteredProductDossier } from "@/lib/manex-case-clustering";
import { getTeamArticleDossierRecord } from "@/lib/manex-case-clustering-state";
import { capabilities, env } from "@/lib/env";
import {
  completeDeterministicCaseRun,
  createDeterministicCaseRun,
  failDeterministicCaseRun,
  getLatestDeterministicCaseRun,
  listActiveDeterministicCaseRuns,
  listDeterministicArticleClusterCards,
  listDeterministicCaseCandidatesForRun,
  listDeterministicCaseCandidatesForProduct,
  replaceDeterministicCaseCandidatesForRun,
  updateDeterministicCaseRunStage,
  type DeterministicArticleClusterCard,
  type DeterministicCaseBatchArticleResult,
  type DeterministicCaseCandidatePriority,
  type DeterministicCaseCandidateRecord,
  type DeterministicCaseRunSummary,
} from "@/lib/manex-deterministic-case-clustering-state";
import { queryPostgres } from "@/lib/postgres";
import {
  buildDeterministicIssueExtractionSystemPrompt,
  buildDeterministicIssueExtractionUserPrompt,
  MANEX_DETERMINISTIC_CASE_CLUSTERING_PROMPT_VERSION,
} from "@/prompts/manex-deterministic-case-clustering";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

const DET_PRODUCT_ISSUE_SCHEMA_VERSION = "manex.det_product_issue_set.v1";
const DET_ARTICLE_INVENTORY_SCHEMA_VERSION = "manex.det_article_inventory.v1";
const DET_GLOBAL_INVENTORY_SCHEMA_VERSION = "manex.det_global_inventory.v1";
const DET_RUN_REVIEW_SCHEMA_VERSION = "manex.det_case_pipeline_review.v1";
const DET_PROMPT_VERSION = MANEX_DETERMINISTIC_CASE_CLUSTERING_PROMPT_VERSION;

const readPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MINI_MODEL_CONCURRENCY_MULTIPLIER = /mini/i.test(env.OPENAI_MODEL) ? 1 : 0;
const DET_ISSUE_EXTRACTION_CONCURRENCY = readPositiveInt(
  process.env.MANEX_DET_ISSUE_EXTRACTION_CONCURRENCY,
  7 + MINI_MODEL_CONCURRENCY_MULTIPLIER,
);
const DET_ISSUE_MAX_OUTPUT_TOKENS = readPositiveInt(
  process.env.MANEX_DET_ISSUE_MAX_OUTPUT_TOKENS,
  1800,
);
const DET_MODEL_CALL_MAX_ATTEMPTS = readPositiveInt(
  process.env.MANEX_DET_MODEL_CALL_MAX_ATTEMPTS,
  4,
);
const DET_REASONING_EFFORT =
  (process.env.MANEX_DET_REASONING_EFFORT as
    | "none"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | undefined) ?? "low";
const DET_ARTICLE_PIPELINE_CONCURRENCY = readPositiveInt(
  process.env.MANEX_DET_ARTICLE_PIPELINE_CONCURRENCY,
  4,
);
const DET_CASE_PAIR_THRESHOLD = readPositiveInt(
  process.env.MANEX_DET_CASE_PAIR_THRESHOLD,
  14,
);
const DET_CASE_LANE_MARGIN = readPositiveInt(
  process.env.MANEX_DET_CASE_LANE_MARGIN,
  5,
);
const DET_GLOBAL_CASE_PAIR_THRESHOLD = readPositiveInt(
  process.env.MANEX_DET_GLOBAL_CASE_PAIR_THRESHOLD,
  16,
);

const prioritySchema = z.enum(["low", "medium", "high", "critical"]);

const issueAnchorSummarySchema = z.object({
  reportedPartNumbers: z.array(z.string().trim().min(1).max(80)).max(8),
  bomFindNumbers: z.array(z.string().trim().min(1).max(80)).max(8),
  supplierBatches: z.array(z.string().trim().min(1).max(80)).max(8),
  supplierNames: z.array(z.string().trim().min(1).max(120)).max(8),
  testKeys: z.array(z.string().trim().min(1).max(80)).max(8),
  defectCodes: z.array(z.string().trim().min(1).max(80)).max(8),
  occurrenceSections: z.array(z.string().trim().min(1).max(80)).max(6),
  detectedSections: z.array(z.string().trim().min(1).max(80)).max(6),
  orderIds: z.array(z.string().trim().min(1).max(80)).max(4),
  reworkUsers: z.array(z.string().trim().min(1).max(80)).max(4),
  claimLagBucket: z.enum(["none", "same_week", "short", "medium", "long"]),
  firstFactorySignalWeek: z.string().trim().min(1).max(80).nullable(),
  lastFactorySignalWeek: z.string().trim().min(1).max(80).nullable(),
  productAnchorCandidates: z
    .array(
      z.object({
        anchorType: z.enum(["supplier_batch", "part_number", "bom_position", "part_batch"]),
        anchorValue: z.string().trim().min(1).max(120),
      }),
    )
    .max(6),
  flags: z.object({
    claimOnlyThread: z.boolean(),
    marginalOnly: z.boolean(),
    falsePositive: z.boolean(),
    serviceDocumentation: z.boolean(),
    cosmeticOnly: z.boolean(),
    detectionBias: z.boolean(),
    lowVolumeRisk: z.boolean(),
  }),
});

const issueCardSchema = z.object({
  issueTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(160),
  issueKind: z.enum([
    "functional_failure",
    "process_drift",
    "supplier_batch",
    "design_weakness",
    "handling_issue",
    "service_issue",
    "cosmetic_issue",
    "false_positive",
    "screening_noise",
    "other",
  ]),
  scopeHint: z.enum(["candidate_case", "incident", "watchlist", "noise"]),
  summary: z.string().trim().min(20).max(900),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(80),
  strongestEvidence: z.array(z.string().trim().min(1).max(220)).min(1).max(6),
  reasonsAgainstClustering: z.array(z.string().trim().min(1).max(220)).max(6),
  recommendedChecks: z.array(z.string().trim().min(1).max(220)).max(6),
  anchorSummary: issueAnchorSummarySchema,
});

const productIssueSetSchema = z.object({
  contractVersion: z.literal(DET_PRODUCT_ISSUE_SCHEMA_VERSION),
  reviewSummary: z.string().trim().min(1).max(1000),
  issues: z.array(issueCardSchema).max(3),
});

const deterministicCaseSchema = z.object({
  caseTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  caseKind: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1400),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  includedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(96),
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(400),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).min(1).max(10),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(240)).max(10),
  fingerprintTokens: z.array(z.string().trim().min(1).max(160)).max(32),
  anchorKinds: z.array(z.string().trim().min(1).max(80)).max(16),
  firstFactorySignalWeek: z.string().trim().min(1).max(80).nullable(),
  lastFactorySignalWeek: z.string().trim().min(1).max(80).nullable(),
  sourceIssueIds: z.array(z.string().trim().min(1).max(80)).max(64),
});

const deterministicIncidentSchema = z.object({
  incidentTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  issueKind: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  productId: z.string().trim().min(1).max(80),
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(120),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(240)).max(8),
});

const deterministicWatchlistSchema = z.object({
  watchlistTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  issueKind: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(96),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(240),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
});

const deterministicNoiseSchema = z.object({
  noiseTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  issueKind: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(1200),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).max(96),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(240),
  strongestEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
});

const deterministicArticleInventorySchema = z.object({
  contractVersion: z.literal(DET_ARTICLE_INVENTORY_SCHEMA_VERSION),
  reviewSummary: z.string().trim().min(1).max(1400),
  cases: z.array(deterministicCaseSchema).max(40),
  incidents: z.array(deterministicIncidentSchema).max(80),
  watchlists: z.array(deterministicWatchlistSchema).max(40),
  noise: z.array(deterministicNoiseSchema).max(40),
  unassignedProducts: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(1).max(220),
      }),
    )
    .max(120),
  globalObservations: z.array(z.string().trim().min(1).max(240)).max(16),
});

const deterministicGlobalInventoryItemSchema = z.object({
  inventoryTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(180),
  inventoryKind: z.enum(["validated_case", "watchlist", "noise_bucket", "rejected_case"]),
  caseTypeHint: z.enum([
    "supplier",
    "process",
    "design",
    "handling",
    "service",
    "watchlist",
    "noise",
    "mixed",
    "other",
  ]),
  summary: z.string().trim().min(10).max(1200),
  oneLineExplanation: z.string().trim().min(10).max(240),
  articleIds: z.array(z.string().trim().min(1).max(80)).max(24),
  linkedCandidateIds: z.array(z.string().trim().min(1).max(80)).max(64),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).max(160),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(400),
  strongestEvidence: z.array(z.string().trim().min(1).max(220)).max(10),
  conflictingEvidence: z.array(z.string().trim().min(1).max(220)).max(10),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(220)).max(10),
  confidence: z.number().min(0).max(1),
  priority: prioritySchema,
});

const deterministicGlobalInventorySchema = z.object({
  contractVersion: z.literal(DET_GLOBAL_INVENTORY_SCHEMA_VERSION),
  inventorySummary: z.string().trim().min(1).max(1400),
  validatedCases: z.array(deterministicGlobalInventoryItemSchema).max(40),
  watchlists: z.array(deterministicGlobalInventoryItemSchema).max(40),
  noiseBuckets: z.array(deterministicGlobalInventoryItemSchema).max(40),
  rejectedCases: z.array(deterministicGlobalInventoryItemSchema).max(40),
  caseMergeLog: z.array(z.string().trim().min(1).max(240)).max(20),
  confidenceNotes: z.array(z.string().trim().min(1).max(240)).max(16),
});

type ProductIssueSet = z.infer<typeof productIssueSetSchema>;
type DeterministicArticleInventory = z.infer<typeof deterministicArticleInventorySchema>;
type DeterministicGlobalInventory = z.infer<typeof deterministicGlobalInventorySchema>;
type DeterministicCase = z.infer<typeof deterministicCaseSchema>;
type DeterministicIssueCardBase = z.infer<typeof issueCardSchema>;
type SignalType = ClusteredProductDossier["signals"][number]["signalType"];
type ClaimLagBucket = z.infer<typeof issueAnchorSummarySchema.shape.claimLagBucket>;
type DeterministicIssueSignature =
  | "supplier_material"
  | "process_window"
  | "latent_field"
  | "handling_cosmetic"
  | "noise_risk";
type DeterministicIssueMechanismLane =
  | "material_traceability"
  | "process_temporal"
  | "latent_field"
  | "handling_operational"
  | "noise_confounder";
type DeterministicAnchorStrength = "diagnostic" | "local_cluster" | "article_wide";
type DeterministicIssueTestOutcomeProfile =
  | "claim_only"
  | "marginal_only"
  | "fail_present"
  | "mixed_factory"
  | "no_factory_tests";

type DeterministicIssueProfile = {
  claimOnly: boolean;
  hasPriorFactoryDefect: boolean;
  fieldClaimWithoutFactoryDefect: boolean;
  fieldImpactPresent: boolean;
  lowSeverityOnly: boolean;
  cosmeticOnly: boolean;
  serviceDocumentation: boolean;
  falsePositive: boolean;
  marginalOnly: boolean;
  detectionBiasRisk: boolean;
  lowVolumeRisk: boolean;
  nearLimitOnly: boolean;
  dominantOccurrenceSection: string | null;
  dominantDetectedSection: string | null;
  dominantOrderId: string | null;
  dominantReworkUser: string | null;
  dominantReportedPartNumber: string | null;
  dominantBomFindNumber: string | null;
  dominantSupplierBatch: string | null;
  dominantSupplierName: string | null;
  dominantDefectCode: string | null;
  dominantTestKey: string | null;
  claimLagBucket: ClaimLagBucket;
  testOutcomeProfile: DeterministicIssueTestOutcomeProfile;
  signatureHints: DeterministicIssueSignature[];
};

type DeterministicIssueFingerprint = {
  mechanismLane: DeterministicIssueMechanismLane;
  laneScores: Record<DeterministicIssueMechanismLane, number>;
  diagnosticTokens: string[];
  localClusterTokens: string[];
  broadTokens: string[];
  partBatchAnchorValues: string[];
  cooccurringBundleKeys: string[];
  neighborhoodProductIds: string[];
  neighborhoodAnchorValues: string[];
  blastRadiusAnchorValues: string[];
  reportedPartNumbers: string[];
  bomFindNumbers: string[];
  supplierBatches: string[];
  occurrenceSections: string[];
  detectedSections: string[];
  orderIds: string[];
  reworkUsers: string[];
  claimLagBucket: ClaimLagBucket;
  claimOnly: boolean;
  fieldClaimWithoutFactoryDefect: boolean;
  hasPriorFactoryDefect: boolean;
  lowSeverityOnly: boolean;
  cosmeticOnly: boolean;
  fieldImpactPresent: boolean;
  familyKeys: string[];
};

type DeterministicIssueCard = DeterministicIssueCardBase & {
  id: string;
  productId: string;
  articleId: string;
  articleName: string | null;
  firstFactorySignalWeek: string | null;
  lastFactorySignalWeek: string | null;
  profile: DeterministicIssueProfile;
  fingerprint: DeterministicIssueFingerprint;
};

type DeterministicReviewPayload = {
  contractVersion: typeof DET_RUN_REVIEW_SCHEMA_VERSION;
  localInventory: DeterministicArticleInventory;
  globalInventory: DeterministicGlobalInventory;
};

export type DeterministicGlobalInventoryItem = z.infer<typeof deterministicGlobalInventoryItemSchema>;
export type DeterministicArticleCaseboardReadModel = {
  articleId: string;
  articleName: string | null;
  dashboardCard: DeterministicArticleClusterCard | null;
  dossier: ClusteredArticleDossier | null;
  latestRun: DeterministicCaseRunSummary | null;
  proposedCases: DeterministicCaseCandidateRecord[];
  incidents: z.infer<typeof deterministicIncidentSchema>[];
  watchlists: z.infer<typeof deterministicWatchlistSchema>[];
  noise: z.infer<typeof deterministicNoiseSchema>[];
  unassignedProducts: Array<{
    productId: string;
    reason: string;
  }>;
  globalObservations: string[];
  globalInventory: DeterministicGlobalInventory | null;
};

export type DeterministicProposedCasesDashboardReadModel = {
  articles: DeterministicArticleClusterCard[];
  activeRuns: DeterministicCaseRunSummary[];
  articleQueues: Array<{
    articleId: string;
    articleName: string | null;
    proposedCaseCount: number;
    affectedProductCount: number;
    highestPriority: "low" | "medium" | "high" | "critical" | null;
    topConfidence: number | null;
    summary: string | null;
    leadingCaseTitle: string | null;
    latestRun: DeterministicCaseRunSummary | null;
  }>;
  latestGlobalRun: DeterministicCaseRunSummary | null;
  globalInventory: DeterministicGlobalInventory | null;
};

type CandidateFingerprintPayload = {
  fingerprintTokens: string[];
  anchorKinds: string[];
  mechanismLane: DeterministicIssueMechanismLane;
  familyKeys: string[];
  firstFactorySignalWeek: string | null;
  lastFactorySignalWeek: string | null;
  sourceIssueIds: string[];
};

type LatestCompletedDeterministicRunRow = {
  run_id: string;
  article_id: string;
  article_name: string | null;
  review_payload: unknown;
  completed_at: string | null;
};

type DeterministicCaseClusteringBatchResult = DeterministicCaseBatchArticleResult;

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function trimPreview(value: string | null | undefined, max = 180) {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) {
    return "";
  }

  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeNullableText(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

function firstNonEmpty<TValue>(...values: Array<TValue | null | undefined>) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "string") {
      const normalized = normalizeNullableText(value);

      if (normalized) {
        return normalized as TValue;
      }

      continue;
    }

    return value;
  }

  return null;
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

function byOccurredAtAsc(left: { occurredAt: string }, right: { occurredAt: string }) {
  return left.occurredAt.localeCompare(right.occurredAt);
}

function clampScore(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pickValueHint(values: Array<{ value: string }> | undefined) {
  return firstNonEmpty(values?.[0]?.value);
}

function pickUserHint(values: Array<{ userId: string }> | undefined) {
  return firstNonEmpty(values?.[0]?.userId);
}

function toToken(prefix: string, value: string | null | undefined) {
  const normalized = normalizeNullableText(value);
  return normalized ? `${prefix}:${normalized}` : null;
}

function classifyAnchorStrength(input: {
  specificity: "product_specific" | "local_cluster" | "article_wide";
  relatedProductCount: number;
  concentrationRatio: number;
}): DeterministicAnchorStrength {
  if (input.specificity === "article_wide") {
    return "article_wide";
  }

  if (
    input.specificity === "product_specific" ||
    input.relatedProductCount <= 3 ||
    input.concentrationRatio <= 0.35
  ) {
    return "diagnostic";
  }

  return "local_cluster";
}

function classifyNeighborhoodStrength(relatedProductCount: number): DeterministicAnchorStrength {
  if (relatedProductCount <= 3) {
    return "diagnostic";
  }

  if (relatedProductCount <= 6) {
    return "local_cluster";
  }

  return "article_wide";
}

function pushStrengthToken(
  buckets: Record<DeterministicAnchorStrength, string[]>,
  strength: DeterministicAnchorStrength,
  token: string | null,
) {
  if (!token) {
    return;
  }

  buckets[strength].push(token);
}

function buildThreadTestOutcomeProfile(
  thread: ClusteredProductDossier,
): DeterministicIssueTestOutcomeProfile {
  const signalTypes = new Set(thread.signals.map((signal) => signal.signalType));
  const hasFieldClaim = signalTypes.has("field_claim");
  const hasMarginal = signalTypes.has("marginal_test");
  const hasFactoryFailure =
    signalTypes.has("defect") || signalTypes.has("bad_test") || signalTypes.has("rework");
  const hasAnyFactorySignal =
    hasFactoryFailure || hasMarginal || signalTypes.has("product_action");

  if (hasFieldClaim && !hasAnyFactorySignal) {
    return "claim_only";
  }

  if (hasMarginal && !hasFactoryFailure && !hasFieldClaim) {
    return "marginal_only";
  }

  if (hasFactoryFailure && (hasFieldClaim || hasMarginal)) {
    return "mixed_factory";
  }

  if (hasFactoryFailure) {
    return "fail_present";
  }

  return "no_factory_tests";
}

function buildIssueProfile(
  thread: ClusteredProductDossier,
  issue: DeterministicIssueCardBase,
): DeterministicIssueProfile {
  const signalLookup = new Map(thread.signals.map((signal) => [signal.signalId, signal]));
  const includedSignals = issue.includedSignalIds
    .map((signalId) => signalLookup.get(signalId))
    .filter((signal): signal is ClusteredProductDossier["signals"][number] => Boolean(signal));
  const signalTypes = new Set(includedSignals.map((signal) => signal.signalType));
  const hasFieldClaim = signalTypes.has("field_claim");
  const hasMarginal = signalTypes.has("marginal_test");
  const hasFactoryFailure =
    signalTypes.has("defect") || signalTypes.has("bad_test") || signalTypes.has("rework");
  const hasAnyFactorySignal =
    hasFactoryFailure || hasMarginal || signalTypes.has("product_action");
  const claimOnly = hasFieldClaim ? !hasAnyFactorySignal : issue.anchorSummary.flags.claimOnlyThread;
  const hasPriorFactoryDefect = thread.mechanismEvidence.fieldLeakEvidence.hasPriorFactoryDefect;
  const fieldClaimWithoutFactoryDefect = claimOnly && !hasPriorFactoryDefect;
  const fieldImpactPresent =
    thread.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent || hasFieldClaim;
  const lowSeverityOnly = thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly;
  const cosmeticOnly = issue.anchorSummary.flags.cosmeticOnly;
  const serviceDocumentation = issue.anchorSummary.flags.serviceDocumentation;
  const falsePositive = issue.anchorSummary.flags.falsePositive;
  const marginalOnly =
    issue.anchorSummary.flags.marginalOnly ||
    (hasMarginal && !hasFactoryFailure && !hasFieldClaim);
  const detectionBiasRisk = issue.anchorSummary.flags.detectionBias;
  const lowVolumeRisk = issue.anchorSummary.flags.lowVolumeRisk;
  const nearLimitOnly =
    thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.length > 0 &&
    !hasFactoryFailure &&
    !hasFieldClaim;
  const dominantOccurrenceSection = firstNonEmpty(
    issue.anchorSummary.occurrenceSections[0],
    pickValueHint(thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections),
  );
  const dominantDetectedSection = firstNonEmpty(
    issue.anchorSummary.detectedSections[0],
    pickValueHint(thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections),
  );
  const dominantOrderId = firstNonEmpty(
    issue.anchorSummary.orderIds[0],
    thread.mechanismEvidence.operatorHandlingEvidence.orderId,
  );
  const dominantReworkUser = firstNonEmpty(
    issue.anchorSummary.reworkUsers[0],
    pickUserHint(thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers),
  );
  const dominantReportedPartNumber = firstNonEmpty(
    issue.anchorSummary.reportedPartNumbers[0],
    thread.summaryFeatures.reportedPartNumbers[0],
  );
  const dominantBomFindNumber = firstNonEmpty(
    issue.anchorSummary.bomFindNumbers[0],
    thread.summaryFeatures.bomFindNumbers[0],
  );
  const dominantSupplierBatch = firstNonEmpty(
    issue.anchorSummary.supplierBatches[0],
    thread.summaryFeatures.supplierBatches[0],
  );
  const dominantSupplierName = firstNonEmpty(
    issue.anchorSummary.supplierNames[0],
    pickValueHint(thread.mechanismEvidence.traceabilityEvidence.dominantSuppliers),
  );
  const dominantDefectCode = firstNonEmpty(
    issue.anchorSummary.defectCodes[0],
    thread.summaryFeatures.defectCodesPresent[0],
  );
  const dominantTestKey = firstNonEmpty(
    issue.anchorSummary.testKeys[0],
    thread.summaryFeatures.testKeysMarginalFail[0],
  );
  const claimLagBucket =
    issue.anchorSummary.claimLagBucket !== "none"
      ? issue.anchorSummary.claimLagBucket
      : thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket;
  const testOutcomeProfile: DeterministicIssueTestOutcomeProfile = claimOnly
    ? "claim_only"
    : hasMarginal && !hasFactoryFailure && !hasFieldClaim
      ? "marginal_only"
      : hasFactoryFailure && (hasFieldClaim || hasMarginal)
        ? "mixed_factory"
        : hasFactoryFailure
          ? "fail_present"
          : "no_factory_tests";

  const signatureHints: DeterministicIssueSignature[] = [];

  if (
    dominantSupplierBatch &&
    (dominantReportedPartNumber ||
      dominantBomFindNumber ||
      issue.anchorSummary.productAnchorCandidates.length > 0)
  ) {
    signatureHints.push("supplier_material");
  }

  if (
    dominantOccurrenceSection &&
    issue.anchorSummary.firstFactorySignalWeek &&
    issue.anchorSummary.lastFactorySignalWeek &&
    (dominantDefectCode || dominantTestKey)
  ) {
    signatureHints.push("process_window");
  }

  if (
    fieldClaimWithoutFactoryDefect &&
    (claimLagBucket === "short" || claimLagBucket === "medium" || claimLagBucket === "long")
  ) {
    signatureHints.push("latent_field");
  }

  if (
    !fieldImpactPresent &&
    (cosmeticOnly || lowSeverityOnly) &&
    (dominantOrderId || dominantReworkUser)
  ) {
    signatureHints.push("handling_cosmetic");
  }

  if (falsePositive || marginalOnly || detectionBiasRisk || lowVolumeRisk || nearLimitOnly) {
    signatureHints.push("noise_risk");
  }

  return {
    claimOnly,
    hasPriorFactoryDefect,
    fieldClaimWithoutFactoryDefect,
    fieldImpactPresent,
    lowSeverityOnly,
    cosmeticOnly,
    serviceDocumentation,
    falsePositive,
    marginalOnly,
    detectionBiasRisk,
    lowVolumeRisk,
    nearLimitOnly,
    dominantOccurrenceSection,
    dominantDetectedSection,
    dominantOrderId,
    dominantReworkUser,
    dominantReportedPartNumber,
    dominantBomFindNumber,
    dominantSupplierBatch,
    dominantSupplierName,
    dominantDefectCode,
    dominantTestKey,
    claimLagBucket,
    testOutcomeProfile,
    signatureHints,
  };
}

function buildIssueFingerprint(
  thread: ClusteredProductDossier,
  issue: DeterministicIssueCardBase,
  profile: DeterministicIssueProfile,
): DeterministicIssueFingerprint {
  const traceability = thread.mechanismEvidence.traceabilityEvidence;
  const hasSignature = (signature: DeterministicIssueSignature) =>
    profile.signatureHints.includes(signature);
  const strengthBuckets: Record<DeterministicAnchorStrength, string[]> = {
    diagnostic: [],
    local_cluster: [],
    article_wide: [],
  };

  for (const anchor of traceability.anchorSpecificity) {
    pushStrengthToken(
      strengthBuckets,
      classifyAnchorStrength({
        specificity: anchor.specificity,
        relatedProductCount: anchor.relatedProductCount,
        concentrationRatio: anchor.concentrationRatio,
      }),
      `anchor:${anchor.anchorType}:${anchor.anchorValue}`,
    );
  }

  for (const anchor of traceability.partBatchAnchors) {
    pushStrengthToken(
      strengthBuckets,
      classifyNeighborhoodStrength(anchor.relatedProductCount),
      `part_batch:${anchor.anchorValue}`,
    );
  }

  for (const bundle of traceability.cooccurringAnchorBundles) {
    pushStrengthToken(
      strengthBuckets,
      classifyNeighborhoodStrength(bundle.relatedProductCount),
      `bundle:${bundle.bundleKey}`,
    );
  }

  for (const suspect of traceability.blastRadiusSuspects) {
    pushStrengthToken(
      strengthBuckets,
      suspect.concentrationRatio >= 0.6 ? "article_wide" : "local_cluster",
      `blast:${suspect.anchorType}:${suspect.anchorValue}`,
    );
  }

  if (profile.dominantOccurrenceSection) {
    pushStrengthToken(
      strengthBuckets,
      hasSignature("process_window") ? "diagnostic" : "local_cluster",
      toToken("occurrence", profile.dominantOccurrenceSection),
    );
  }

  if (profile.dominantDetectedSection && profile.detectionBiasRisk) {
    pushStrengthToken(
      strengthBuckets,
      "article_wide",
      toToken("detected", profile.dominantDetectedSection),
    );
  }

  if (profile.dominantOrderId) {
    pushStrengthToken(
      strengthBuckets,
      !profile.fieldImpactPresent && (profile.cosmeticOnly || profile.lowSeverityOnly)
        ? "diagnostic"
        : "local_cluster",
      toToken("order", profile.dominantOrderId),
    );
  }

  if (profile.dominantReworkUser) {
    pushStrengthToken(
      strengthBuckets,
      !profile.fieldImpactPresent && (profile.cosmeticOnly || profile.lowSeverityOnly)
        ? "diagnostic"
        : "local_cluster",
      toToken("rework_user", profile.dominantReworkUser),
    );
  }

  if (profile.fieldClaimWithoutFactoryDefect && profile.claimLagBucket !== "none") {
    pushStrengthToken(
      strengthBuckets,
      "diagnostic",
      `claim_lag:${profile.claimLagBucket}`,
    );
  }

  const materialTraceabilityScore =
    (hasSignature("supplier_material") ? 8 : 0) +
    Math.min(8, traceability.partBatchAnchors.length * 3) +
    Math.min(
      6,
      traceability.cooccurringAnchorBundles.filter((item) => item.relatedProductCount >= 2).length *
        2,
    ) +
    Math.min(
      4,
      traceability.traceabilityNeighborhood.filter((item) => item.sharedAnchorCount >= 2).length,
    ) +
    (traceability.blastRadiusSuspects.some(
      (item) => item.affectedProductCount >= 2 && item.concentrationRatio < 0.6,
    )
      ? 3
      : 0) +
    (profile.dominantSupplierBatch && (profile.dominantReportedPartNumber || profile.dominantBomFindNumber)
      ? 2
      : 0);

  const processTemporalScore =
    (hasSignature("process_window") ? 8 : 0) +
    (profile.dominantOccurrenceSection ? 4 : 0) +
    (issue.anchorSummary.firstFactorySignalWeek && issue.anchorSummary.lastFactorySignalWeek ? 3 : 0) +
    (profile.testOutcomeProfile === "fail_present" || profile.testOutcomeProfile === "mixed_factory"
      ? 3
      : 0) +
    (profile.dominantDefectCode || profile.dominantTestKey ? 2 : 0) -
    (profile.detectionBiasRisk && !profile.dominantOccurrenceSection ? 3 : 0);

  const latentFieldScore =
    (hasSignature("latent_field") ? 9 : 0) +
    (profile.fieldClaimWithoutFactoryDefect ? 6 : 0) +
    (profile.claimLagBucket !== "none" ? 3 : 0) +
    (profile.dominantReportedPartNumber ? 2 : 0) +
    (profile.dominantBomFindNumber ? 2 : 0) -
    (profile.hasPriorFactoryDefect ? 4 : 0);

  const handlingOperationalScore =
    (hasSignature("handling_cosmetic") ? 8 : 0) +
    (!profile.fieldImpactPresent && (profile.cosmeticOnly || profile.lowSeverityOnly) ? 4 : 0) +
    (profile.dominantOrderId ? 3 : 0) +
    (profile.dominantReworkUser ? 3 : 0);

  const noiseConfounderScore =
    (hasSignature("noise_risk") ? 8 : 0) +
    (profile.falsePositive ? 4 : 0) +
    (profile.marginalOnly ? 3 : 0) +
    (profile.detectionBiasRisk ? 3 : 0) +
    (profile.lowVolumeRisk ? 2 : 0) +
    (profile.nearLimitOnly ? 1 : 0) +
    (profile.serviceDocumentation ? 2 : 0);

  const laneScores: Record<DeterministicIssueMechanismLane, number> = {
    material_traceability: materialTraceabilityScore,
    process_temporal: processTemporalScore,
    latent_field: latentFieldScore,
    handling_operational: handlingOperationalScore,
    noise_confounder: noiseConfounderScore,
  };

  const dominantNonNoiseLanes: Array<
    Exclude<DeterministicIssueMechanismLane, "noise_confounder">
  > = [
    "material_traceability",
    "process_temporal",
    "latent_field",
    "handling_operational",
  ];
  const dominantNonNoiseLane = dominantNonNoiseLanes
    .slice()
    .sort(
      (left, right) =>
        laneScores[right] - laneScores[left] || left.localeCompare(right),
    )[0];
  const mechanismLane =
    noiseConfounderScore >= laneScores[dominantNonNoiseLane] + 2
      ? ("noise_confounder" as const)
      : dominantNonNoiseLane;

  const familyKeys = uniqueValues([
    profile.falsePositive ? "noise:false_positive" : null,
    profile.marginalOnly
      ? `noise:marginal_only:${
          profile.dominantTestKey ?? profile.dominantOccurrenceSection ?? "generic"
        }`
      : null,
    profile.detectionBiasRisk
      ? `noise:detection_bias:${profile.dominantDetectedSection ?? "generic"}`
      : null,
    profile.lowVolumeRisk ? "noise:low_volume" : null,
    profile.serviceDocumentation ? "watchlist:service_documentation" : null,
    profile.fieldClaimWithoutFactoryDefect
      ? `watchlist:latent_field:${profile.claimLagBucket}:${
          profile.dominantReportedPartNumber ?? profile.dominantBomFindNumber ?? "generic"
        }`
      : null,
    !profile.fieldImpactPresent && (profile.cosmeticOnly || profile.lowSeverityOnly)
      ? `watchlist:handling:${
          profile.dominantOrderId ??
          profile.dominantReworkUser ??
          profile.dominantBomFindNumber ??
          "generic"
        }`
      : null,
  ]);

  return {
    mechanismLane,
    laneScores,
    diagnosticTokens: uniqueValues(strengthBuckets.diagnostic),
    localClusterTokens: uniqueValues(strengthBuckets.local_cluster),
    broadTokens: uniqueValues(strengthBuckets.article_wide),
    partBatchAnchorValues: uniqueValues(
      traceability.partBatchAnchors.map((item) => item.anchorValue),
    ),
    cooccurringBundleKeys: uniqueValues(
      traceability.cooccurringAnchorBundles.map((item) => item.bundleKey),
    ),
    neighborhoodProductIds: uniqueValues(
      traceability.traceabilityNeighborhood.map((item) => item.productId),
    ),
    neighborhoodAnchorValues: uniqueValues(
      traceability.traceabilityNeighborhood.flatMap((item) => item.sharedAnchorValues),
    ),
    blastRadiusAnchorValues: uniqueValues(
      traceability.blastRadiusSuspects.map((item) => item.anchorValue),
    ),
    reportedPartNumbers: uniqueValues(issue.anchorSummary.reportedPartNumbers),
    bomFindNumbers: uniqueValues(issue.anchorSummary.bomFindNumbers),
    supplierBatches: uniqueValues(issue.anchorSummary.supplierBatches),
    occurrenceSections: uniqueValues(issue.anchorSummary.occurrenceSections),
    detectedSections: uniqueValues(issue.anchorSummary.detectedSections),
    orderIds: uniqueValues(issue.anchorSummary.orderIds),
    reworkUsers: uniqueValues(issue.anchorSummary.reworkUsers),
    claimLagBucket: profile.claimLagBucket,
    claimOnly: profile.claimOnly,
    fieldClaimWithoutFactoryDefect: profile.fieldClaimWithoutFactoryDefect,
    hasPriorFactoryDefect: profile.hasPriorFactoryDefect,
    lowSeverityOnly: profile.lowSeverityOnly,
    cosmeticOnly: profile.cosmeticOnly,
    fieldImpactPresent: profile.fieldImpactPresent,
    familyKeys,
  };
}

function hasIssueSignature(issue: DeterministicIssueCard, signature: DeterministicIssueSignature) {
  return issue.profile.signatureHints.includes(signature);
}

const deterministicPriorityRank: Record<z.infer<typeof prioritySchema>, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function sortByPriorityConfidence<TItem extends { priority: z.infer<typeof prioritySchema>; confidence: number; title: string }>(
  items: TItem[],
) {
  return [...items].sort((left, right) => {
    const priorityDelta =
      deterministicPriorityRank[right.priority] - deterministicPriorityRank[left.priority];

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const confidenceDelta = right.confidence - left.confidence;

    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function normalizeDeterministicLocalInventory(input: {
  reviewSummary: string;
  cases: DeterministicCase[];
  incidents: z.infer<typeof deterministicIncidentSchema>[];
  watchlists: z.infer<typeof deterministicWatchlistSchema>[];
  noise: z.infer<typeof deterministicNoiseSchema>[];
  unassignedProducts: Array<{ productId: string; reason: string }>;
  globalObservations: Array<string | null | undefined>;
}) {
  const cases = sortByPriorityConfidence(
    input.cases.map((caseItem) => ({
      ...caseItem,
      includedProductIds: uniqueValues(caseItem.includedProductIds).slice(0, 96),
      includedSignalIds: uniqueValues(caseItem.includedSignalIds).slice(0, 400),
      strongestEvidence: uniqueValues(caseItem.strongestEvidence).slice(0, 10),
      recommendedNextTraceChecks: uniqueValues(caseItem.recommendedNextTraceChecks).slice(0, 10),
      fingerprintTokens: uniqueValues(caseItem.fingerprintTokens).slice(0, 32),
      anchorKinds: uniqueValues(caseItem.anchorKinds).slice(0, 16),
      sourceIssueIds: uniqueValues(caseItem.sourceIssueIds).slice(0, 64),
    })),
  ).slice(0, 40);

  const incidents = sortByPriorityConfidence(
    input.incidents.map((incident) => ({
      ...incident,
      includedSignalIds: uniqueValues(incident.includedSignalIds).slice(0, 120),
      strongestEvidence: uniqueValues(incident.strongestEvidence).slice(0, 8),
      recommendedNextTraceChecks: uniqueValues(incident.recommendedNextTraceChecks).slice(0, 8),
    })),
  ).slice(0, 80);

  const watchlists = sortByPriorityConfidence(
    input.watchlists.map((watchlist) => ({
      ...watchlist,
      linkedProductIds: uniqueValues(watchlist.linkedProductIds).slice(0, 96),
      linkedSignalIds: uniqueValues(watchlist.linkedSignalIds).slice(0, 240),
      strongestEvidence: uniqueValues(watchlist.strongestEvidence).slice(0, 8),
    })),
  ).slice(0, 40);

  const noise = [...input.noise]
    .map((noiseItem) => ({
      ...noiseItem,
      linkedProductIds: uniqueValues(noiseItem.linkedProductIds).slice(0, 96),
      linkedSignalIds: uniqueValues(noiseItem.linkedSignalIds).slice(0, 240),
      strongestEvidence: uniqueValues(noiseItem.strongestEvidence).slice(0, 8),
    }))
    .sort((left, right) => {
      const signalDelta = right.linkedSignalIds.length - left.linkedSignalIds.length;

      if (signalDelta !== 0) {
        return signalDelta;
      }

      const productDelta = right.linkedProductIds.length - left.linkedProductIds.length;

      if (productDelta !== 0) {
        return productDelta;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, 40);

  return {
    contractVersion: DET_ARTICLE_INVENTORY_SCHEMA_VERSION,
    reviewSummary: trimPreview(input.reviewSummary, 1400) || "Deterministic inventory generated.",
    cases,
    incidents,
    watchlists,
    noise,
    unassignedProducts: input.unassignedProducts.slice(0, 120),
    globalObservations: uniqueValues(input.globalObservations).slice(0, 16),
  } satisfies DeterministicArticleInventory;
}

function normalizeDeterministicGlobalInventoryItem(
  item: z.infer<typeof deterministicGlobalInventoryItemSchema>,
) {
  return {
    ...item,
    articleIds: uniqueValues(item.articleIds).slice(0, 24),
    linkedCandidateIds: uniqueValues(item.linkedCandidateIds).slice(0, 64),
    linkedProductIds: uniqueValues(item.linkedProductIds).slice(0, 160),
    linkedSignalIds: uniqueValues(item.linkedSignalIds).slice(0, 400),
    strongestEvidence: uniqueValues(item.strongestEvidence).slice(0, 10),
    conflictingEvidence: uniqueValues(item.conflictingEvidence).slice(0, 10),
    recommendedNextTraceChecks: uniqueValues(item.recommendedNextTraceChecks).slice(0, 10),
    summary: trimPreview(item.summary, 1200),
    oneLineExplanation: trimPreview(item.oneLineExplanation, 240),
  } satisfies z.infer<typeof deterministicGlobalInventoryItemSchema>;
}

function normalizeDeterministicGlobalInventory(input: {
  inventorySummary: string;
  validatedCases: z.infer<typeof deterministicGlobalInventoryItemSchema>[];
  watchlists: z.infer<typeof deterministicGlobalInventoryItemSchema>[];
  noiseBuckets: z.infer<typeof deterministicGlobalInventoryItemSchema>[];
  rejectedCases: z.infer<typeof deterministicGlobalInventoryItemSchema>[];
  caseMergeLog: Array<string | null | undefined>;
  confidenceNotes: Array<string | null | undefined>;
}) {
  const sortInventoryItems = (
    items: z.infer<typeof deterministicGlobalInventoryItemSchema>[],
  ) =>
    [...items]
      .map(normalizeDeterministicGlobalInventoryItem)
      .sort((left, right) => {
        const priorityDelta =
          deterministicPriorityRank[right.priority] - deterministicPriorityRank[left.priority];

        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        const confidenceDelta = right.confidence - left.confidence;

        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }

        const productDelta = right.linkedProductIds.length - left.linkedProductIds.length;

        if (productDelta !== 0) {
          return productDelta;
        }

        return left.title.localeCompare(right.title);
      })
      .slice(0, 40);

  return {
    contractVersion: DET_GLOBAL_INVENTORY_SCHEMA_VERSION,
    inventorySummary:
      trimPreview(input.inventorySummary, 1400) || "Deterministic global inventory generated.",
    validatedCases: sortInventoryItems(input.validatedCases),
    watchlists: sortInventoryItems(input.watchlists),
    noiseBuckets: sortInventoryItems(input.noiseBuckets),
    rejectedCases: sortInventoryItems(input.rejectedCases),
    caseMergeLog: uniqueValues(input.caseMergeLog).slice(0, 20),
    confidenceNotes: uniqueValues(input.confidenceNotes).slice(0, 16),
  } satisfies DeterministicGlobalInventory;
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  callback: (item: TItem, index: number) => Promise<TResult>,
  abortSignal?: AbortSignal,
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      throwIfDeterministicPipelineAborted(abortSignal);
      const currentIndex = nextIndex;
      nextIndex += 1;
      throwIfDeterministicPipelineAborted(abortSignal);
      results[currentIndex] = await callback(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function isRetryableModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|429|overloaded|temporarily unavailable|timeout|timed out/i.test(message);
}

function throwIfDeterministicPipelineAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw new Error(
      typeof abortSignal.reason === "string" && abortSignal.reason
        ? abortSignal.reason
        : "Pipeline stopped by user.",
    );
  }
}

async function sleep(ms: number, abortSignal?: AbortSignal) {
  await new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(
        new Error(
          typeof abortSignal.reason === "string" && abortSignal.reason
            ? abortSignal.reason
            : "Pipeline stopped by user.",
        ),
      );
      return;
    }

    const timeout = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(
        new Error(
          typeof abortSignal?.reason === "string" && abortSignal.reason
            ? abortSignal.reason
            : "Pipeline stopped by user.",
        ),
      );
    };

    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getOpenAiClient() {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for deterministic case clustering.");
  }

  return createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
}

async function generateIssueSetObject(input: {
  articleId: string;
  productId: string;
  payload: unknown;
  abortSignal?: AbortSignal;
}) {
  const openai = getOpenAiClient();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= DET_MODEL_CALL_MAX_ATTEMPTS; attempt += 1) {
    throwIfDeterministicPipelineAborted(input.abortSignal);

    try {
      const result = await generateObject({
        model: openai.responses(env.OPENAI_MODEL),
        schema: productIssueSetSchema,
        schemaName: "manex_deterministic_product_issue_set",
        schemaDescription:
          "Deterministic-friendly issue cards extracted from one product dossier.",
        system: buildDeterministicIssueExtractionSystemPrompt(),
        prompt: buildDeterministicIssueExtractionUserPrompt(input.payload),
        maxOutputTokens: DET_ISSUE_MAX_OUTPUT_TOKENS,
        providerOptions: {
          openai: {
            reasoningEffort: DET_REASONING_EFFORT,
            store: false,
            textVerbosity: "low",
          },
        },
        abortSignal: input.abortSignal,
      });

      return result.object;
    } catch (error) {
      lastError = error;

      if (!isRetryableModelError(error) || attempt >= DET_MODEL_CALL_MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(700 * 2 ** (attempt - 1), input.abortSignal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildIssueExtractionPayload(thread: ClusteredProductDossier) {
  const recentSignals = [...thread.signals].sort(byOccurredAtAsc).slice(-12);
  const testOutcomeProfile = buildThreadTestOutcomeProfile(thread);

  return {
    product: {
      productId: thread.productId,
      articleId: thread.articleId,
      articleName: thread.articleName,
      buildTs: thread.buildTs,
      orderId: thread.orderId,
    },
    sourceCounts: thread.sourceCounts,
    stage1Summary: {
      productSummary: trimPreview(thread.stage1Synthesis.productSummary, 320),
      timeline: thread.stage1Synthesis.timeline.slice(0, 6),
      suspiciousPatterns: thread.stage1Synthesis.suspiciousPatterns.slice(0, 4),
      possibleNoiseFlags: thread.stage1Synthesis.possibleNoiseFlags.slice(0, 4),
      openQuestions: thread.stage1Synthesis.openQuestions.slice(0, 4),
    },
    summaryFeatures: {
      signalTypesPresent: thread.summaryFeatures.signalTypesPresent.slice(0, 6),
      defectCodesPresent: thread.summaryFeatures.defectCodesPresent.slice(0, 8),
      testKeysMarginalFail: thread.summaryFeatures.testKeysMarginalFail.slice(0, 8),
      reportedPartNumbers: thread.summaryFeatures.reportedPartNumbers.slice(0, 8),
      bomFindNumbers: thread.summaryFeatures.bomFindNumbers.slice(0, 8),
      supplierBatches: thread.summaryFeatures.supplierBatches.slice(0, 8),
      sectionsSeen: thread.summaryFeatures.sectionsSeen.slice(0, 8),
      ordersSeen: thread.summaryFeatures.ordersSeen.slice(0, 4),
      daysFromBuildToClaim: thread.summaryFeatures.daysFromBuildToClaim.slice(0, 6),
      falsePositiveMarkers: thread.summaryFeatures.falsePositiveMarkers.slice(0, 4),
      fieldClaimWithoutFactoryDefect: thread.summaryFeatures.fieldClaimWithoutFactoryDefect,
      reworkPresent: thread.summaryFeatures.reworkPresent,
    },
    normalizedClues: {
      traceability: {
        dominantPartNumber: thread.summaryFeatures.reportedPartNumbers[0] ?? null,
        dominantBomFindNumber: thread.summaryFeatures.bomFindNumbers[0] ?? null,
        dominantSupplierBatch: thread.summaryFeatures.supplierBatches[0] ?? null,
        dominantSupplierName:
          pickValueHint(thread.mechanismEvidence.traceabilityEvidence.dominantSuppliers) ?? null,
        dominantProductAnchor:
          thread.mechanismEvidence.traceabilityEvidence.productAnchorCandidates[0] ?? null,
        topPartBatchAnchor:
          thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors[0]
            ? {
                anchorValue:
                  thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors[0].anchorValue,
                relatedProductCount:
                  thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors[0]
                    .relatedProductCount,
              }
            : null,
        topAnchorSpecificity:
          thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity[0]
            ? {
                anchorType:
                  thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity[0].anchorType,
                anchorValue:
                  thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity[0].anchorValue,
                specificity:
                  thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity[0].specificity,
              }
            : null,
        topTraceabilityNeighbor:
          thread.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood[0]
            ? {
                productId:
                  thread.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood[0]
                    .productId,
                sharedAnchorCount:
                  thread.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood[0]
                    .sharedAnchorCount,
              }
            : null,
      },
      process: {
        buildWeek: thread.mechanismEvidence.temporalProcessEvidence.buildWeek,
        firstFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek,
        lastFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.lastFactorySignalWeek,
        dominantOccurrenceSection:
          pickValueHint(thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections),
        dominantDetectedSection:
          pickValueHint(thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections),
        dominantDefectCode: thread.summaryFeatures.defectCodesPresent[0] ?? null,
        dominantTestKey: thread.summaryFeatures.testKeysMarginalFail[0] ?? null,
        testOutcomeProfile,
      },
      field: {
        claimOnlyThread: thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread,
        hasPriorFactoryDefect: thread.mechanismEvidence.fieldLeakEvidence.hasPriorFactoryDefect,
        fieldClaimWithoutFactoryDefect: thread.summaryFeatures.fieldClaimWithoutFactoryDefect,
        claimLagBucket: thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
        claimLagStats: thread.mechanismEvidence.fieldLeakEvidence.claimLagStats,
      },
      handling: {
        orderId: thread.mechanismEvidence.operatorHandlingEvidence.orderId,
        dominantReworkUser:
          pickUserHint(thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers) ??
          null,
        lowSeverityOnly: thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly,
        cosmeticOnlySignals: thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals,
        fieldImpactPresent: thread.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent,
      },
      confounders: {
        falsePositive:
          thread.summaryFeatures.falsePositiveMarkers.length > 0 ||
          thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.length > 0,
        marginalOnlySignals: thread.mechanismEvidence.confounderEvidence.marginalOnlySignals,
        serviceDocumentation:
          thread.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.length > 0,
        detectionBias:
          thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.length > 0,
        lowVolumeRisk:
          thread.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.length > 0,
        nearLimitOnly:
          thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.length > 0 &&
          testOutcomeProfile !== "fail_present" &&
          testOutcomeProfile !== "mixed_factory",
      },
    },
    mechanismEvidence: {
      traceabilityEvidence: {
        dominantTraceAnchors: thread.mechanismEvidence.traceabilityEvidence.dominantTraceAnchors.slice(0, 5),
        productAnchorCandidates: thread.mechanismEvidence.traceabilityEvidence.productAnchorCandidates.slice(0, 5),
        partBatchAnchors: thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors
          .slice(0, 4)
          .map((item) => ({
            anchorValue: item.anchorValue,
            partNumber: item.partNumber,
            batchRef: item.batchRef,
            relatedProductCount: item.relatedProductCount,
            bomPositions: item.bomPositions.slice(0, 4),
          })),
        anchorSpecificity: thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity
          .slice(0, 5)
          .map((item) => ({
            anchorType: item.anchorType,
            anchorValue: item.anchorValue,
            specificity: item.specificity,
            relatedProductCount: item.relatedProductCount,
            reason: trimPreview(item.reason, 140),
          })),
        traceabilityNeighborhood:
          thread.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood
            .slice(0, 4)
            .map((item) => ({
              productId: item.productId,
              orderId: item.orderId,
              matchedInstallCount: item.matchedInstallCount,
              sharedAnchorTypes: item.sharedAnchorTypes,
              sharedAnchorValues: item.sharedAnchorValues.slice(0, 4),
            })),
        cooccurringAnchorBundles:
          thread.mechanismEvidence.traceabilityEvidence.cooccurringAnchorBundles
            .slice(0, 4)
            .map((item) => ({
              bundleKey: item.bundleKey,
              partNumbers: item.partNumbers,
              batchRefs: item.batchRefs,
              bomPositions: item.bomPositions,
              relatedProductCount: item.relatedProductCount,
            })),
        blastRadiusSuspects:
          thread.mechanismEvidence.traceabilityEvidence.blastRadiusSuspects
            .slice(0, 3)
            .map((item) => ({
              anchorType: item.anchorType,
              anchorValue: item.anchorValue,
              partNumber: item.partNumber,
              batchNumber: item.batchNumber,
              affectedProductCount: item.affectedProductCount,
              concentrationRatio: item.concentrationRatio,
            })),
        batchConcentrationHints: thread.mechanismEvidence.traceabilityEvidence.batchConcentrationHints.slice(0, 3),
        traceabilityConcentrationHints:
          thread.mechanismEvidence.traceabilityEvidence.traceabilityConcentrationHints.slice(0, 4),
      },
      temporalProcessEvidence: {
        buildWeek: thread.mechanismEvidence.temporalProcessEvidence.buildWeek,
        firstFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek,
        lastFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.lastFactorySignalWeek,
        dominantOccurrenceSections:
          thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.slice(0, 4),
        dominantDetectedSections:
          thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections.slice(0, 4),
        marginalVsFailHints:
          thread.mechanismEvidence.temporalProcessEvidence.marginalVsFailHints.slice(0, 4),
        temporalContainmentHints:
          thread.mechanismEvidence.temporalProcessEvidence.temporalContainmentHints.slice(0, 4),
      },
      fieldLeakEvidence: {
        claimOnlyThread: thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread,
        claimLagBucket: thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
        claimLagStats: thread.mechanismEvidence.fieldLeakEvidence.claimLagStats,
        dominantClaimReportedParts:
          thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts.slice(0, 4),
        dominantClaimBomPositions:
          thread.mechanismEvidence.fieldLeakEvidence.dominantClaimBomPositions.slice(0, 4),
        latentFailureHints:
          thread.mechanismEvidence.fieldLeakEvidence.latentFailureHints.slice(0, 4),
      },
      operatorHandlingEvidence: {
        orderId: thread.mechanismEvidence.operatorHandlingEvidence.orderId,
        dominantReworkUsers:
          thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers.slice(0, 4),
        orderClusterHints:
          thread.mechanismEvidence.operatorHandlingEvidence.orderClusterHints.slice(0, 4),
        userConcentrationHints:
          thread.mechanismEvidence.operatorHandlingEvidence.userConcentrationHints.slice(0, 4),
        handlingPatternHints:
          thread.mechanismEvidence.operatorHandlingEvidence.handlingPatternHints.slice(0, 4),
        cosmeticOnlySignals: thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals,
        lowSeverityOnly: thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly,
        fieldImpactPresent: thread.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent,
      },
      confounderEvidence: {
        falsePositiveMarkers:
          thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.slice(0, 4),
        marginalOnlySignals: thread.mechanismEvidence.confounderEvidence.marginalOnlySignals,
        detectionBiasRisk:
          thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.slice(0, 4),
        lowVolumePeriodRisk:
          thread.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.slice(0, 4),
        mixedServiceDocumentationSignals:
          thread.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.slice(0, 4),
        nearLimitTestSignals:
          thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.slice(0, 4),
      },
    },
    signals: recentSignals.map((signal) => ({
      signalId: signal.signalId,
      signalType: signal.signalType,
      occurredAt: signal.occurredAt,
      headline: signal.headline,
      section: signal.section,
      notePreview: signal.notePreview,
      sourceContext: signal.sourceContext,
    })),
  };
}

function buildFallbackIssueSet(thread: ClusteredProductDossier): ProductIssueSet {
  if (!thread.signals.length) {
    return {
      contractVersion: DET_PRODUCT_ISSUE_SCHEMA_VERSION,
      reviewSummary: "No quality signals were present for deterministic issue extraction.",
      issues: [],
    };
  }

  const falsePositive =
    thread.summaryFeatures.falsePositiveMarkers.length > 0 ||
    thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.length > 0;
  const marginalOnly = thread.mechanismEvidence.confounderEvidence.marginalOnlySignals;
  const serviceDocumentation =
    thread.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.length > 0;
  const cosmeticOnly = thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals;
  const topPart = thread.summaryFeatures.reportedPartNumbers[0] ?? thread.summaryFeatures.bomFindNumbers[0];
  const topDefect = thread.summaryFeatures.defectCodesPresent[0] ?? thread.summaryFeatures.testKeysMarginalFail[0];

  return {
    contractVersion: DET_PRODUCT_ISSUE_SCHEMA_VERSION,
    reviewSummary: "Fallback issue extraction used deterministic dossier anchors.",
    issues: [
      {
        issueTempId: createId("DIT"),
        title: topPart
          ? `Issue thread around ${topPart}`
          : topDefect
            ? `Issue thread around ${topDefect}`
            : `Issue thread on ${thread.productId}`,
        issueKind: falsePositive
          ? "false_positive"
          : cosmeticOnly
            ? "cosmetic_issue"
            : serviceDocumentation
              ? "service_issue"
              : thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread
                ? "design_weakness"
                : "functional_failure",
        scopeHint: falsePositive || marginalOnly
          ? "noise"
          : cosmeticOnly || serviceDocumentation
            ? "watchlist"
            : "incident",
        summary: trimPreview(thread.stage1Synthesis.productSummary, 320),
        confidence: falsePositive ? 0.35 : 0.55,
        priority: falsePositive ? "low" : "medium",
        includedSignalIds: thread.signals.slice(-12).map((signal) => signal.signalId),
        strongestEvidence: [
          ...thread.mechanismEvidence.traceabilityEvidence.traceabilityConcentrationHints.slice(0, 2),
          ...thread.mechanismEvidence.temporalProcessEvidence.temporalContainmentHints.slice(0, 2),
          ...thread.stage1Synthesis.suspiciousPatterns.slice(0, 2),
        ].filter(Boolean).slice(0, 4),
        reasonsAgainstClustering: [
          ...thread.stage1Synthesis.possibleNoiseFlags.slice(0, 3),
          ...(thread.signals.length < 2 ? ["Only a small local thread is present on this product."] : []),
        ].slice(0, 4),
        recommendedChecks: thread.stage1Synthesis.openQuestions.slice(0, 4),
        anchorSummary: {
          reportedPartNumbers: thread.summaryFeatures.reportedPartNumbers.slice(0, 8),
          bomFindNumbers: thread.summaryFeatures.bomFindNumbers.slice(0, 8),
          supplierBatches: thread.summaryFeatures.supplierBatches.slice(0, 8),
          supplierNames: thread.mechanismEvidence.traceabilityEvidence.dominantSuppliers
            .map((entry) => entry.value)
            .slice(0, 8),
          testKeys: thread.summaryFeatures.testKeysMarginalFail.slice(0, 8),
          defectCodes: thread.summaryFeatures.defectCodesPresent.slice(0, 8),
          occurrenceSections: thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections
            .map((entry) => entry.value)
            .slice(0, 6),
          detectedSections: thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections
            .map((entry) => entry.value)
            .slice(0, 6),
          orderIds: thread.orderId ? [thread.orderId] : [],
          reworkUsers: thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers
            .map((entry) => entry.userId)
            .slice(0, 4),
          claimLagBucket: thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
          firstFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek,
          lastFactorySignalWeek: thread.mechanismEvidence.temporalProcessEvidence.lastFactorySignalWeek,
          productAnchorCandidates:
            thread.mechanismEvidence.traceabilityEvidence.productAnchorCandidates.map((entry) => ({
              anchorType: entry.anchorType,
              anchorValue: entry.anchorValue,
            })),
          flags: {
            claimOnlyThread: thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread,
            marginalOnly,
            falsePositive,
            serviceDocumentation,
            cosmeticOnly,
            detectionBias:
              thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.length > 0,
            lowVolumeRisk:
              thread.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.length > 0,
          },
        },
      },
    ],
  };
}

async function extractIssuesForThread(
  thread: ClusteredProductDossier,
  options?: { abortSignal?: AbortSignal },
) {
  throwIfDeterministicPipelineAborted(options?.abortSignal);
  const payload = buildIssueExtractionPayload(thread);
  const issueSet = thread.signals.length
    ? await generateIssueSetObject({
        articleId: thread.articleId,
        productId: thread.productId,
        payload,
        abortSignal: options?.abortSignal,
      }).catch((error) => {
        if (options?.abortSignal?.aborted) {
          throw error;
        }

        return buildFallbackIssueSet(thread);
      })
    : buildFallbackIssueSet(thread);

  const issues: DeterministicIssueCard[] = issueSet.issues.map((issue) => ({
    ...(() => {
      const profile = buildIssueProfile(thread, issue);

      return {
        ...issue,
        id: `${thread.productId}:${issue.issueTempId}`,
        productId: thread.productId,
        articleId: thread.articleId,
        articleName: thread.articleName,
        firstFactorySignalWeek: issue.anchorSummary.firstFactorySignalWeek,
        lastFactorySignalWeek: issue.anchorSummary.lastFactorySignalWeek,
        profile,
        fingerprint: buildIssueFingerprint(thread, issue, profile),
      };
    })(),
  }));

  return {
    reviewSummary: issueSet.reviewSummary,
    issues,
  };
}

function intersect(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function scoreTemporalOverlap(left: DeterministicIssueCard, right: DeterministicIssueCard) {
  if (!left.firstFactorySignalWeek || !left.lastFactorySignalWeek || !right.firstFactorySignalWeek || !right.lastFactorySignalWeek) {
    return 0;
  }

  return left.firstFactorySignalWeek <= right.lastFactorySignalWeek &&
    right.firstFactorySignalWeek <= left.lastFactorySignalWeek
    ? 1
    : 0;
}

function issueLooksNoisy(issue: DeterministicIssueCard) {
  const hasStructuralEvidence =
    issue.fingerprint.partBatchAnchorValues.length > 0 ||
    issue.fingerprint.cooccurringBundleKeys.length > 0 ||
    (issue.fingerprint.occurrenceSections.length > 0 &&
      Boolean(issue.firstFactorySignalWeek && issue.lastFactorySignalWeek) &&
      (issue.profile.dominantDefectCode !== null || issue.profile.dominantTestKey !== null)) ||
    (issue.fingerprint.fieldClaimWithoutFactoryDefect &&
      issue.fingerprint.claimLagBucket !== "none" &&
      (issue.fingerprint.reportedPartNumbers.length > 0 ||
        issue.fingerprint.bomFindNumbers.length > 0)) ||
    (!issue.fingerprint.fieldImpactPresent &&
      (issue.fingerprint.lowSeverityOnly || issue.fingerprint.cosmeticOnly) &&
      (issue.fingerprint.orderIds.length > 0 || issue.fingerprint.reworkUsers.length > 0));

  return (
    issue.scopeHint === "noise" ||
    issue.issueKind === "false_positive" ||
    issue.issueKind === "screening_noise" ||
    issue.profile.falsePositive ||
    ((issue.profile.marginalOnly || issue.profile.nearLimitOnly) && !hasStructuralEvidence) ||
    (issue.profile.detectionBiasRisk &&
      !hasStructuralEvidence &&
      issue.fingerprint.occurrenceSections.length === 0) ||
    (issue.profile.lowVolumeRisk && !hasStructuralEvidence)
  );
}

function issueLooksWatchlistLike(issue: DeterministicIssueCard) {
  return (
    issue.scopeHint === "watchlist" ||
    issue.issueKind === "service_issue" ||
    issue.issueKind === "cosmetic_issue" ||
    issue.profile.serviceDocumentation ||
    issue.profile.cosmeticOnly ||
    hasIssueSignature(issue, "handling_cosmetic") ||
    (hasIssueSignature(issue, "latent_field") &&
      issue.profile.fieldClaimWithoutFactoryDefect &&
      issue.profile.claimLagBucket !== "none") ||
    ((issue.profile.marginalOnly || issue.profile.nearLimitOnly) &&
      !issueLooksNoisy(issue) &&
      (issue.fingerprint.occurrenceSections.length > 0 ||
        issue.fingerprint.partBatchAnchorValues.length > 0 ||
        issue.fingerprint.reportedPartNumbers.length > 0))
  );
}

function hasMutualNeighborhood(left: DeterministicIssueCard, right: DeterministicIssueCard) {
  return (
    left.fingerprint.neighborhoodProductIds.includes(right.productId) ||
    right.fingerprint.neighborhoodProductIds.includes(left.productId)
  );
}

function scoreIssuePair(left: DeterministicIssueCard, right: DeterministicIssueCard) {
  if (left.productId === right.productId) {
    return null;
  }

  const sameLane = left.fingerprint.mechanismLane === right.fingerprint.mechanismLane;
  const sharedSupplierBatches = intersect(
    left.anchorSummary.supplierBatches,
    right.anchorSummary.supplierBatches,
  );
  const sharedPartBatchAnchors = intersect(
    left.fingerprint.partBatchAnchorValues,
    right.fingerprint.partBatchAnchorValues,
  );
  const sharedBundles = intersect(
    left.fingerprint.cooccurringBundleKeys,
    right.fingerprint.cooccurringBundleKeys,
  );
  const sharedDiagnosticTokens = intersect(
    left.fingerprint.diagnosticTokens,
    right.fingerprint.diagnosticTokens,
  );
  const sharedLocalTokens = intersect(
    left.fingerprint.localClusterTokens,
    right.fingerprint.localClusterTokens,
  );
  const sharedBroadTokens = intersect(left.fingerprint.broadTokens, right.fingerprint.broadTokens);
  const sharedNeighborhoodAnchors = intersect(
    left.fingerprint.neighborhoodAnchorValues,
    right.fingerprint.neighborhoodAnchorValues,
  );
  const sharedPartCandidates = intersect(
    left.anchorSummary.productAnchorCandidates.map((item) => `${item.anchorType}:${item.anchorValue}`),
    right.anchorSummary.productAnchorCandidates.map((item) => `${item.anchorType}:${item.anchorValue}`),
  );
  const sharedParts = intersect(left.anchorSummary.reportedPartNumbers, right.anchorSummary.reportedPartNumbers);
  const sharedBom = intersect(left.anchorSummary.bomFindNumbers, right.anchorSummary.bomFindNumbers);
  const sharedOrders = intersect(left.anchorSummary.orderIds, right.anchorSummary.orderIds);
  const sharedReworkUsers = intersect(left.anchorSummary.reworkUsers, right.anchorSummary.reworkUsers);
  const sharedOccurrenceSections = intersect(
    left.anchorSummary.occurrenceSections,
    right.anchorSummary.occurrenceSections,
  );
  const sharedDetectedSections = intersect(
    left.anchorSummary.detectedSections,
    right.anchorSummary.detectedSections,
  );
  const sharedDefectCodes = intersect(left.anchorSummary.defectCodes, right.anchorSummary.defectCodes);
  const sharedTestKeys = intersect(left.anchorSummary.testKeys, right.anchorSummary.testKeys);
  const temporalOverlap = scoreTemporalOverlap(left, right);
  const sharedLagBucket =
    left.profile.claimLagBucket !== "none" &&
    left.profile.claimLagBucket === right.profile.claimLagBucket
      ? left.profile.claimLagBucket
      : null;
  const mutualNeighborhood = hasMutualNeighborhood(left, right);
  const strongCrossLane =
    sharedPartBatchAnchors.length > 0 ||
    sharedBundles.length > 0 ||
    sharedDiagnosticTokens.some((token) => token.includes("part_batch"));
  const supportingDefectOrTest =
    sharedDefectCodes.length > 0 ||
    sharedTestKeys.length > 0 ||
    left.profile.testOutcomeProfile === "fail_present" ||
    left.profile.testOutcomeProfile === "mixed_factory" ||
    right.profile.testOutcomeProfile === "fail_present" ||
    right.profile.testOutcomeProfile === "mixed_factory";
  const supportingClaimOrLag =
    Boolean(sharedLagBucket && (sharedLagBucket === "medium" || sharedLagBucket === "long")) ||
    ((left.fingerprint.fieldClaimWithoutFactoryDefect ||
      right.fingerprint.fieldClaimWithoutFactoryDefect) &&
      (sharedParts.length > 0 || sharedBom.length > 0));

  if (!sameLane && !strongCrossLane) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];
  const anchorKinds = new Set<string>();
  const materialTraceabilitySignature =
    (sameLane && left.fingerprint.mechanismLane === "material_traceability") || strongCrossLane
      ? sharedPartBatchAnchors.length > 0 &&
        (sharedBundles.length > 0 ||
          mutualNeighborhood ||
          sharedPartCandidates.length > 0 ||
          sharedParts.length > 0) &&
        (supportingDefectOrTest || supportingClaimOrLag)
      : false;
  const processWindowSignature =
    sameLane &&
    left.fingerprint.mechanismLane === "process_temporal" &&
    sharedOccurrenceSections.length > 0 &&
    temporalOverlap > 0 &&
    (sharedDefectCodes.length > 0 ||
      sharedTestKeys.length > 0 ||
      supportingDefectOrTest ||
      sharedReworkUsers.length > 0);
  const latentFieldSignature =
    sameLane &&
    left.fingerprint.mechanismLane === "latent_field" &&
    left.fingerprint.claimOnly &&
    right.fingerprint.claimOnly &&
    left.fingerprint.fieldClaimWithoutFactoryDefect &&
    right.fingerprint.fieldClaimWithoutFactoryDefect &&
    Boolean(sharedLagBucket && (sharedLagBucket === "medium" || sharedLagBucket === "long")) &&
    (sharedParts.length > 0 || sharedBom.length > 0 || sharedPartCandidates.length > 0);
  const handlingCosmeticSignature =
    sameLane &&
    left.fingerprint.mechanismLane === "handling_operational" &&
    !left.fingerprint.fieldImpactPresent &&
    !right.fingerprint.fieldImpactPresent &&
    (sharedOrders.length > 0 || sharedReworkUsers.length > 0);
  const hasCoreNeighborReason =
    materialTraceabilitySignature ||
    processWindowSignature ||
    latentFieldSignature ||
    handlingCosmeticSignature ||
    sharedDiagnosticTokens.length > 0 ||
    (mutualNeighborhood && sharedLocalTokens.length > 0);

  if (!hasCoreNeighborReason) {
    return null;
  }

  if (
    sharedBroadTokens.length > 0 &&
    sharedDiagnosticTokens.length === 0 &&
    sharedLocalTokens.length === 0 &&
    sharedPartBatchAnchors.length === 0 &&
    sharedBundles.length === 0 &&
    sharedOccurrenceSections.length === 0 &&
    sharedOrders.length === 0 &&
    sharedReworkUsers.length === 0 &&
    !sharedLagBucket
  ) {
    return null;
  }

  if (materialTraceabilitySignature) {
    score += 18;
    anchorKinds.add("signature_material_traceability");
    reasons.push(
      `Material/traceability lane is supported by concentrated part+batch anchor ${sharedPartBatchAnchors[0]}${
        sharedBundles[0] ? ` and bundle ${sharedBundles[0]}` : ""
      }.`,
    );
  }

  if (processWindowSignature) {
    score += 16;
    anchorKinds.add("signature_process_window");
    reasons.push(
      `Process-window signature aligns ${sharedOccurrenceSections[0]} with a tight overlapping factory window.`,
    );
  }

  if (latentFieldSignature) {
    score += 17;
    anchorKinds.add("signature_latent_field");
    reasons.push(
      `Delayed claim-only pattern matches without prior factory defects in lag bucket ${sharedLagBucket}.`,
    );
  }

  if (handlingCosmeticSignature) {
    score += 14;
    anchorKinds.add("signature_handling_cosmetic");
    reasons.push(
      `Low-severity handling pattern reappears on shared order/rework ownership ${sharedOrders[0] ?? sharedReworkUsers[0]}.`,
    );
  }

  if (sharedDiagnosticTokens.length > 0) {
    score += Math.min(8, sharedDiagnosticTokens.length * 3);
    anchorKinds.add("diagnostic_anchor");
    reasons.push(
      `Shared diagnostic anchors: ${sharedDiagnosticTokens
        .slice(0, 2)
        .map((token) => token.replace(/^.*?:/, ""))
        .join(", ")}.`,
    );
  }

  if (sharedLocalTokens.length > 0) {
    score += Math.min(4, sharedLocalTokens.length * 2);
    anchorKinds.add("local_cluster_anchor");
  }

  if (mutualNeighborhood) {
    score += 4;
    anchorKinds.add("traceability_neighbor");
    reasons.push("Products appear in each other's deterministic traceability neighborhood.");
  }

  if (sharedNeighborhoodAnchors.length > 0) {
    score += Math.min(3, sharedNeighborhoodAnchors.length);
    anchorKinds.add("neighbor_anchor");
  }

  if (sharedPartBatchAnchors.length > 0) {
    score += 8;
    anchorKinds.add("part_batch");
  }

  if (sharedBundles.length > 0) {
    score += 6;
    anchorKinds.add("cooccurring_bundle");
  }

  if (sharedPartCandidates.length > 0) {
    score += 2;
    anchorKinds.add("product_anchor_candidate");
    reasons.push(`Shared deterministic anchor ${sharedPartCandidates[0]}.`);
  }

  if (sharedSupplierBatches.length > 0) {
    score += materialTraceabilitySignature ? 4 : 1;
    anchorKinds.add("supplier_batch");
    reasons.push(`Shared supplier batch ${sharedSupplierBatches[0]}.`);
  }

  if (sharedParts.length > 0) {
    score += materialTraceabilitySignature || latentFieldSignature ? 4 : 1;
    anchorKinds.add("part_number");
    reasons.push(`Shared reported part ${sharedParts[0]}.`);
  }

  if (sharedBom.length > 0) {
    score += materialTraceabilitySignature || latentFieldSignature ? 3 : 0;
    anchorKinds.add("bom_position");
    reasons.push(`Shared BOM/find position ${sharedBom[0]}.`);
  }

  if (sharedOrders.length > 0) {
    score += handlingCosmeticSignature ? 5 : 1;
    anchorKinds.add("order");
    reasons.push(`Shared production order ${sharedOrders[0]}.`);
  }

  if (sharedReworkUsers.length > 0) {
    score += handlingCosmeticSignature ? 5 : 1;
    anchorKinds.add("rework_user");
    reasons.push(`Shared rework ownership via ${sharedReworkUsers[0]}.`);
  }

  if (sharedOccurrenceSections.length > 0) {
    score += processWindowSignature ? 5 : 0;
    anchorKinds.add("occurrence_section");
    reasons.push(`Shared occurrence section ${sharedOccurrenceSections[0]}.`);
  }

  if (sharedDefectCodes.length > 0) {
    score += 2;
    anchorKinds.add("defect_code");
    reasons.push(`Shared defect code ${sharedDefectCodes[0]}.`);
  }

  if (sharedTestKeys.length > 0) {
    score += 2;
    anchorKinds.add("test_key");
    reasons.push(`Shared test key ${sharedTestKeys[0]}.`);
  }

  if (temporalOverlap > 0) {
    score += processWindowSignature ? 4 : 1;
    anchorKinds.add("time_window");
    reasons.push("Factory signal windows overlap.");
  }

  if (sharedLagBucket) {
    score += latentFieldSignature ? 3 : 1;
    anchorKinds.add("claim_lag");
    reasons.push(`Shared claim lag bucket ${sharedLagBucket}.`);
  }

  if (left.issueKind === right.issueKind && left.issueKind !== "other") {
    score += 1;
  }

  let penalty = 0;

  if (issueLooksNoisy(left) || issueLooksNoisy(right)) {
    penalty += 7;
  }

  if (left.profile.detectionBiasRisk || right.profile.detectionBiasRisk) {
    penalty += 3;
  }

  if (
    sharedBom.length > 0 &&
    sharedPartBatchAnchors.length === 0 &&
    sharedBundles.length === 0 &&
    sharedSupplierBatches.length === 0 &&
    sharedParts.length === 0 &&
    sharedPartCandidates.length === 0
  ) {
    penalty += 4;
  }

  if (
    sharedDetectedSections.length > 0 &&
    sharedOccurrenceSections.length === 0
  ) {
    penalty += 5;
  }

  if (
    sharedOccurrenceSections.length > 0 &&
    temporalOverlap === 0 &&
    sharedDefectCodes.length === 0 &&
    sharedTestKeys.length === 0
  ) {
    penalty += 4;
  }

  if (
    sharedOrders.length > 0 &&
    !handlingCosmeticSignature &&
    !materialTraceabilitySignature &&
    !processWindowSignature &&
    !latentFieldSignature
  ) {
    penalty += 2;
  }

  if (!sameLane && strongCrossLane) {
    penalty += 2;
  }

  if (sharedBroadTokens.length > sharedDiagnosticTokens.length + sharedLocalTokens.length) {
    penalty += 3;
  }

  score -= penalty;

  if (
    !materialTraceabilitySignature &&
    !processWindowSignature &&
    !latentFieldSignature &&
    !handlingCosmeticSignature &&
    score < DET_CASE_PAIR_THRESHOLD
  ) {
    return null;
  }

  return {
    leftId: left.id,
    rightId: right.id,
    score,
    reasons: reasons.slice(0, 6),
    anchorKinds: [...anchorKinds],
  };
}

function buildConnectedComponents(nodes: DeterministicIssueCard[], edges: Array<{ leftId: string; rightId: string }>) {
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    adjacency.get(edge.leftId)?.add(edge.rightId);
    adjacency.get(edge.rightId)?.add(edge.leftId);
  }

  const visited = new Set<string>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const components: DeterministicIssueCard[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    const stack = [node.id];
    const component: DeterministicIssueCard[] = [];
    visited.add(node.id);

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      const current = nodeMap.get(currentId);

      if (current) {
        component.push(current);
      }

      for (const neighborId of adjacency.get(currentId) ?? []) {
        if (visited.has(neighborId)) {
          continue;
        }

        visited.add(neighborId);
        stack.push(neighborId);
      }
    }

    components.push(component);
  }

  return components;
}

function choosePriority(
  values: DeterministicCaseCandidatePriority[],
): z.infer<typeof prioritySchema> {
  if (values.includes("critical")) {
    return "critical";
  }

  if (values.includes("high")) {
    return "high";
  }

  if (values.includes("medium")) {
    return "medium";
  }

  return "low";
}

function chooseCaseKind(issues: DeterministicIssueCard[]) {
  const counts = new Map<string, number>();

  for (const issue of issues) {
    counts.set(issue.issueKind, (counts.get(issue.issueKind) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "other";
}

function getDominantClusterSignature(issues: DeterministicIssueCard[]) {
  const counts = new Map<DeterministicIssueSignature, number>();

  for (const issue of issues) {
    for (const signature of issue.profile.signatureHints) {
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function buildClusterTitle(issues: DeterministicIssueCard[], strongestAnchorTokens: string[]) {
  const dominantSignature = getDominantClusterSignature(issues);
  const anchor = strongestAnchorTokens[0];
  const firstIssue = issues[0];
  const topPartBatch = firstIssue?.fingerprint.partBatchAnchorValues[0] ?? null;
  const topOrder = firstIssue?.fingerprint.orderIds[0] ?? null;
  const topReworkUser = firstIssue?.fingerprint.reworkUsers[0] ?? null;
  const topOccurrence = firstIssue?.fingerprint.occurrenceSections[0] ?? null;
  const topPart = firstIssue?.fingerprint.reportedPartNumbers[0] ?? null;
  const topBom = firstIssue?.fingerprint.bomFindNumbers[0] ?? null;
  const firstWeek = uniqueValues(issues.map((issue) => issue.firstFactorySignalWeek))[0] ?? null;
  const lastWeek =
    uniqueValues(issues.map((issue) => issue.lastFactorySignalWeek)).at(-1) ?? null;

  if (dominantSignature === "latent_field") {
    if (topPart && topBom) {
      return `Claim-only latent drift around ${topPart} / ${topBom}`;
    }

    if (topPart) {
      return `Claim-only latent drift around ${topPart}`;
    }

    if (topBom) {
      return `Claim-only latent drift at ${topBom}`;
    }

    return "Delayed field claim pattern without prior factory defects";
  }

  if (dominantSignature === "supplier_material") {
    if (topPartBatch) {
      const [partNumber, batchRef] = topPartBatch.split("@");
      return `Supplier-batch issue around ${partNumber} / ${batchRef}`;
    }

    if (topPart && anchor?.startsWith("supplier_batch:")) {
      return `Supplier-linked issue around ${topPart} / ${anchor.replace("supplier_batch:", "")}`;
    }

    if (topPart) {
      return `Supplier-linked issue around ${topPart}`;
    }
  }

  if (dominantSignature === "process_window") {
    if (topOccurrence && firstWeek && lastWeek) {
      return `${topOccurrence} process drift, ${firstWeek.slice(0, 10)} to ${lastWeek.slice(0, 10)}`;
    }

    if (topOccurrence) {
      return `${topOccurrence} process-window drift`;
    }

    return "Contained process-window drift";
  }

  if (dominantSignature === "handling_cosmetic") {
    if (topOrder && topReworkUser) {
      return `Handling pattern on ${topOrder} with ${topReworkUser}`;
    }

    if (topOrder) {
      return `Handling pattern on ${topOrder}`;
    }

    if (topReworkUser) {
      return `Handling pattern around ${topReworkUser}`;
    }
  }

  if (anchor?.startsWith("part_batch:")) {
    const [partNumber, batchRef] = anchor.replace("part_batch:", "").split("@");
    return `Recurring supplier-batch issue ${partNumber} / ${batchRef}`;
  }

  if (anchor?.startsWith("supplier_batch:")) {
    return `Recurring supplier batch issue ${anchor.replace("supplier_batch:", "")}`;
  }

  if (anchor?.startsWith("part:")) {
    return `Recurring issue around ${anchor.replace("part:", "")}`;
  }

  if (anchor?.startsWith("bom:")) {
    return `Recurring issue at position ${anchor.replace("bom:", "")}`;
  }

  if (anchor?.startsWith("order:")) {
    return `Order-linked handling pattern ${anchor.replace("order:", "")}`;
  }

  return `${issues.length > 1 ? "Shared" : "Local"} ${chooseCaseKind(issues).replaceAll("_", " ")} pattern`;
}

function summarizeCluster(issues: DeterministicIssueCard[], productCount: number, strongestEvidence: string[]) {
  const lead = strongestEvidence[0] ?? "Multiple deterministic anchors connect these products.";
  const dominantSignature = getDominantClusterSignature(issues);

  if (dominantSignature === "latent_field") {
    return `${productCount} products show claim-only delayed issues without prior factory defects and recurring claim anchors. ${lead}`;
  }

  if (dominantSignature === "supplier_material") {
    return `${productCount} products share concentrated supplier/material anchors rather than a broad position-only pattern. ${lead}`;
  }

  if (dominantSignature === "process_window") {
    return `${productCount} products align on a tight occurrence-section process window rather than a detected-section hotspot. ${lead}`;
  }

  if (dominantSignature === "handling_cosmetic") {
    return `${productCount} products share a low-severity order/user handling pattern rather than a field failure story. ${lead}`;
  }

  return `${productCount} products are linked by deterministic evidence. ${lead}`;
}

function buildFingerprintTokens(issues: DeterministicIssueCard[]) {
  return uniqueValues(
    issues.flatMap((issue) => [
      ...issue.profile.signatureHints.map((value) => `signature:${value}`),
      `lane:${issue.fingerprint.mechanismLane}`,
      ...issue.anchorSummary.supplierBatches.map((value) => `supplier_batch:${value}`),
      ...issue.fingerprint.partBatchAnchorValues.map((value) => `part_batch:${value}`),
      ...issue.anchorSummary.reportedPartNumbers.map((value) => `part:${value}`),
      ...issue.anchorSummary.bomFindNumbers.map((value) => `bom:${value}`),
      ...issue.anchorSummary.orderIds.map((value) => `order:${value}`),
      ...issue.anchorSummary.reworkUsers.map((value) => `rework_user:${value}`),
      ...issue.anchorSummary.occurrenceSections.map((value) => `occurrence:${value}`),
      ...issue.fingerprint.cooccurringBundleKeys.map((value) => `bundle:${value}`),
      ...issue.anchorSummary.productAnchorCandidates.map(
        (value) => `candidate:${value.anchorType}:${value.anchorValue}`,
      ),
      ...issue.fingerprint.diagnosticTokens.map((value) => `diagnostic:${value}`),
      ...issue.fingerprint.localClusterTokens.map((value) => `local:${value}`),
      ...issue.fingerprint.familyKeys.map((value) => `family:${value}`),
      `kind:${issue.issueKind}`,
      issue.profile.claimLagBucket !== "none"
        ? `claim_lag:${issue.profile.claimLagBucket}`
        : null,
      issue.profile.fieldClaimWithoutFactoryDefect ? "field:no_prior_factory_defect" : null,
      issue.profile.testOutcomeProfile !== "no_factory_tests"
        ? `test_profile:${issue.profile.testOutcomeProfile}`
        : null,
    ]),
  ).slice(0, 32);
}

function buildBenchmarkCoverageNotes(input: {
  issues: DeterministicIssueCard[];
  cases: DeterministicCase[];
  watchlists: z.infer<typeof deterministicWatchlistSchema>[];
}) {
  const notes: string[] = [];
  const hasMaterialObject = input.cases.some(
    (item) =>
      item.fingerprintTokens.some((token) => token.startsWith("part_batch:")) &&
      item.fingerprintTokens.some(
        (token) =>
          token.startsWith("bundle:") ||
          token.startsWith("part:") ||
          token.startsWith("supplier_batch:"),
      ),
  );
  const hasProcessObject = input.cases.some(
    (item) =>
      item.fingerprintTokens.some((token) => token.startsWith("occurrence:")) &&
      Boolean(item.firstFactorySignalWeek && item.lastFactorySignalWeek),
  );
  const hasLatentObject =
    input.cases.some(
      (item) =>
        item.fingerprintTokens.includes("signature:latent_field") &&
        item.fingerprintTokens.some((token) => token.startsWith("claim_lag:")) &&
        item.fingerprintTokens.some(
          (token) => token.startsWith("part:") || token.startsWith("bom:"),
        ),
    ) ||
    input.watchlists.some(
      (item) =>
        /claim-only|latent/i.test(item.title) &&
        /claim|lag/i.test(item.summary),
    );
  const hasHandlingObject =
    input.cases.some(
      (item) =>
        item.fingerprintTokens.includes("signature:handling_cosmetic") &&
        item.fingerprintTokens.some(
          (token) => token.startsWith("order:") || token.startsWith("rework_user:"),
        ),
    ) ||
    input.watchlists.some((item) => /handling/i.test(item.title));

  notes.push(
    hasMaterialObject
      ? "Benchmark check: a material/traceability object is present with specific concentrated anchors."
      : "Benchmark check: no traceability-led case cleared the current threshold yet.",
  );
  notes.push(
    hasProcessObject
      ? "Benchmark check: a process/temporal object is present with occurrence-section plus time-window evidence."
      : "Benchmark check: no occurrence-section process-window object cleared the current threshold yet.",
  );
  notes.push(
    hasLatentObject
      ? "Benchmark check: a latent field object is present for claim-only / no-prior-defect lag behavior."
      : "Benchmark check: no claim-only latent-field object cleared the current threshold yet.",
  );
  notes.push(
    hasHandlingObject
      ? "Benchmark check: a handling / operational object is present with order or rework-user concentration."
      : "Benchmark check: no handling/order-user object cleared the current threshold yet.",
  );

  if (!input.issues.some((issue) => issue.fingerprint.mechanismLane === "noise_confounder")) {
    notes.push("Benchmark check: no strong noise-conflater lane dominated this article run.");
  }

  return notes;
}

type DeterministicWeakFamilySeed = {
  familyKey: string;
  issueKind: string;
  title: string;
  summary: string;
  confidence: number;
  priority: z.infer<typeof prioritySchema>;
  linkedProductIds: string[];
  linkedSignalIds: string[];
  strongestEvidence: string[];
  mechanismLane: DeterministicIssueMechanismLane;
};

function chooseWeakFamilyKey(
  issue: DeterministicIssueCard,
  familyType: "watchlist" | "noise",
) {
  const matchingKey = issue.fingerprint.familyKeys.find((key) =>
    familyType === "watchlist" ? key.startsWith("watchlist:") : key.startsWith("noise:"),
  );

  if (matchingKey) {
    return matchingKey;
  }

  if (familyType === "watchlist") {
    if (issue.fingerprint.mechanismLane === "material_traceability") {
      return `watchlist:material:${
        issue.fingerprint.partBatchAnchorValues[0] ??
        issue.profile.dominantSupplierBatch ??
        issue.profile.dominantReportedPartNumber ??
        "generic"
      }`;
    }

    if (issue.fingerprint.mechanismLane === "process_temporal") {
      return `watchlist:process:${issue.profile.dominantOccurrenceSection ?? "generic"}`;
    }

    if (issue.fingerprint.mechanismLane === "handling_operational") {
      return `watchlist:handling:${
        issue.profile.dominantOrderId ??
        issue.profile.dominantReworkUser ??
        issue.profile.dominantBomFindNumber ??
        "generic"
      }`;
    }

    if (issue.fingerprint.mechanismLane === "latent_field") {
      return `watchlist:latent_field:${issue.profile.claimLagBucket}:${
        issue.profile.dominantReportedPartNumber ??
        issue.profile.dominantBomFindNumber ??
        "generic"
      }`;
    }

    return `watchlist:${issue.fingerprint.mechanismLane}:${issue.issueKind}`;
  }

  if (issue.profile.falsePositive) {
    return "noise:false_positive";
  }

  if (issue.profile.detectionBiasRisk) {
    return `noise:detection_bias:${issue.profile.dominantDetectedSection ?? "generic"}`;
  }

  if (issue.profile.marginalOnly) {
    return `noise:marginal_only:${issue.profile.dominantTestKey ?? "generic"}`;
  }

  return `noise:${issue.fingerprint.mechanismLane}:${issue.issueKind}`;
}

function buildWeakFamilyTitle(
  familyKey: string,
  familyType: "watchlist" | "noise",
  fallbackTitle: string,
) {
  if (familyKey.startsWith("watchlist:material:")) {
    return `Material / traceability watchlist ${familyKey.replace("watchlist:material:", "")}`;
  }

  if (familyKey.startsWith("watchlist:process:")) {
    return `Process / temporal watchlist ${familyKey.replace("watchlist:process:", "")}`;
  }

  if (familyKey.startsWith("watchlist:handling:")) {
    return `Handling / operational family ${familyKey.replace("watchlist:handling:", "")}`;
  }

  if (familyKey.startsWith("watchlist:latent_field:")) {
    const [, , lagBucket, anchor] = familyKey.split(":");
    return `Delayed claim-only family ${anchor} (${lagBucket})`;
  }

  if (familyKey === "watchlist:service_documentation") {
    return "Service / documentation family";
  }

  if (familyKey === "noise:false_positive") {
    return "False-positive family";
  }

  if (familyKey.startsWith("noise:marginal_only:")) {
    return `Marginal-only screening family ${familyKey.replace("noise:marginal_only:", "")}`;
  }

  if (familyKey.startsWith("noise:detection_bias:")) {
    return `Detected-section hotspot family ${familyKey.replace("noise:detection_bias:", "")}`;
  }

  if (familyKey === "noise:low_volume") {
    return "Low-volume noise family";
  }

  return fallbackTitle;
}

function aggregateWeakFamilies(
  seeds: DeterministicWeakFamilySeed[],
  familyType: "watchlist",
): z.infer<typeof deterministicWatchlistSchema>[];
function aggregateWeakFamilies(
  seeds: DeterministicWeakFamilySeed[],
  familyType: "noise",
): z.infer<typeof deterministicNoiseSchema>[];
function aggregateWeakFamilies(
  seeds: DeterministicWeakFamilySeed[],
  familyType: "watchlist" | "noise",
) {
  const grouped = new Map<string, DeterministicWeakFamilySeed[]>();

  for (const seed of seeds) {
    const current = grouped.get(seed.familyKey) ?? [];
    current.push(seed);
    grouped.set(seed.familyKey, current);
  }

  const groups: Array<{
    familyKey: string;
    title: string;
    issueKind: string;
    summary: string;
    confidence: number;
    priority: z.infer<typeof prioritySchema>;
    linkedProductIds: string[];
    linkedSignalIds: string[];
    strongestEvidence: string[];
  }> = [...grouped.entries()]
    .map(([familyKey, familySeeds]) => {
      const linkedProductIds = uniqueValues(
        familySeeds.flatMap((seed) => seed.linkedProductIds),
      );
      const linkedSignalIds = uniqueValues(
        familySeeds.flatMap((seed) => seed.linkedSignalIds),
      );
      const strongestEvidence = uniqueValues(
        familySeeds.flatMap((seed) => seed.strongestEvidence),
      ).slice(0, 8);
      const confidence =
        familySeeds.reduce((sum, seed) => sum + seed.confidence, 0) / familySeeds.length;
      const leadSeed = [...familySeeds].sort((left, right) => {
        const priorityDelta =
          deterministicPriorityRank[right.priority] - deterministicPriorityRank[left.priority];

        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return right.confidence - left.confidence;
      })[0];
      const title = buildWeakFamilyTitle(familyKey, familyType, leadSeed?.title ?? familyKey);

      return {
        familyKey,
        title,
        issueKind: leadSeed?.issueKind ?? "other",
        summary:
          familyType === "watchlist"
            ? `${linkedProductIds.length} products share a weaker recurring ${leadSeed?.mechanismLane.replaceAll("_", " ") ?? "watchlist"} pattern. ${strongestEvidence[0] ?? leadSeed?.summary ?? ""}`.trim()
            : `${linkedProductIds.length} products fall into the same deterministic noise family. ${strongestEvidence[0] ?? leadSeed?.summary ?? ""}`.trim(),
        confidence,
        priority: choosePriority(familySeeds.map((seed) => seed.priority)),
        linkedProductIds,
        linkedSignalIds,
        strongestEvidence,
      };
    })
    .sort((left, right) => {
      const productDelta = right.linkedProductIds.length - left.linkedProductIds.length;

      if (productDelta !== 0) {
        return productDelta;
      }

      return left.title.localeCompare(right.title);
    });

  if (familyType === "watchlist") {
    return groups.map((group) => ({
      watchlistTempId: createId("DWATCH"),
      title: group.title,
      issueKind: group.issueKind,
      summary: group.summary,
      confidence: clampScore(group.confidence, 0.2, 0.9),
      priority: group.priority,
      linkedProductIds: group.linkedProductIds,
      linkedSignalIds: group.linkedSignalIds,
      strongestEvidence: group.strongestEvidence,
    })) satisfies z.infer<typeof deterministicWatchlistSchema>[];
  }

  return groups.map((group) => ({
    noiseTempId: createId("DNOISE"),
    title: group.title,
    issueKind: group.issueKind,
    summary: group.summary,
    linkedProductIds: group.linkedProductIds,
    linkedSignalIds: group.linkedSignalIds,
    strongestEvidence: group.strongestEvidence,
  })) satisfies z.infer<typeof deterministicNoiseSchema>[];
}

type DeterministicCandidateLane =
  Exclude<DeterministicIssueMechanismLane, "noise_confounder">;

type DeterministicClusterLaneValidation = {
  winningLane: DeterministicCandidateLane;
  runnerUpLane: DeterministicCandidateLane;
  winnerScore: number;
  runnerUpScore: number;
  winnerMargin: number;
  classification: "case" | "watchlist" | "incident";
  familyKey: string | null;
  rationale: string[];
};

function countValueFrequency(groups: string[][]) {
  const counts = new Map<string, number>();

  for (const group of groups) {
    for (const value of new Set(group)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return counts;
}

function repeatedValues(groups: string[][], minCount = 2) {
  return [...countValueFrequency(groups).entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value);
}

function buildClusterWatchlistFamilyKey(
  lane: DeterministicCandidateLane,
  issues: DeterministicIssueCard[],
) {
  const repeatedPartBatchAnchors = repeatedValues(
    issues.map((issue) => issue.fingerprint.partBatchAnchorValues),
  );
  const repeatedOccurrenceSections = repeatedValues(
    issues.map((issue) => issue.fingerprint.occurrenceSections),
  );
  const repeatedParts = repeatedValues(
    issues.map((issue) => issue.fingerprint.reportedPartNumbers),
  );
  const repeatedBom = repeatedValues(
    issues.map((issue) => issue.fingerprint.bomFindNumbers),
  );
  const repeatedOrders = repeatedValues(
    issues.map((issue) => issue.fingerprint.orderIds),
  );
  const repeatedReworkUsers = repeatedValues(
    issues.map((issue) => issue.fingerprint.reworkUsers),
  );
  const lagBuckets = repeatedValues(
    issues.map((issue) =>
      issue.fingerprint.claimLagBucket !== "none" ? [issue.fingerprint.claimLagBucket] : [],
    ),
  );

  if (lane === "material_traceability") {
    return `watchlist:material:${repeatedPartBatchAnchors[0] ?? repeatedParts[0] ?? "generic"}`;
  }

  if (lane === "process_temporal") {
    return `watchlist:process:${repeatedOccurrenceSections[0] ?? "generic"}`;
  }

  if (lane === "latent_field") {
    return `watchlist:latent_field:${lagBuckets[0] ?? "generic"}:${repeatedParts[0] ?? repeatedBom[0] ?? "generic"}`;
  }

  return `watchlist:handling:${repeatedOrders[0] ?? repeatedReworkUsers[0] ?? "generic"}`;
}

function validateClusterLane(input: {
  issues: DeterministicIssueCard[];
  relatedPairs: Array<{
    leftId: string;
    rightId: string;
    score: number;
    reasons: string[];
    anchorKinds: string[];
  }>;
  productCount: number;
}) {
  const laneOrder: DeterministicCandidateLane[] = [
    "material_traceability",
    "process_temporal",
    "latent_field",
    "handling_operational",
  ];
  const laneScoresBase: Record<DeterministicCandidateLane, number> = {
    material_traceability: 0,
    process_temporal: 0,
    latent_field: 0,
    handling_operational: 0,
  };

  for (const issue of input.issues) {
    for (const lane of laneOrder) {
      laneScoresBase[lane] += issue.fingerprint.laneScores[lane];
    }
  }

  const repeatedPartBatchAnchors = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.partBatchAnchorValues),
  );
  const repeatedBundles = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.cooccurringBundleKeys),
  );
  const repeatedParts = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.reportedPartNumbers),
  );
  const repeatedBom = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.bomFindNumbers),
  );
  const repeatedOrders = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.orderIds),
  );
  const repeatedReworkUsers = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.reworkUsers),
  );
  const repeatedOccurrenceSections = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.occurrenceSections),
  );
  const repeatedSupplierBatches = repeatedValues(
    input.issues.map((issue) => issue.fingerprint.supplierBatches),
  );
  const repeatedDefectCodes = repeatedValues(
    input.issues.map((issue) => issue.anchorSummary.defectCodes),
  );
  const repeatedTestKeys = repeatedValues(
    input.issues.map((issue) => issue.anchorSummary.testKeys),
  );
  const repeatedLagBuckets = repeatedValues(
    input.issues.map((issue) =>
      issue.fingerprint.claimLagBucket !== "none" ? [issue.fingerprint.claimLagBucket] : [],
    ),
  );

  const pairAnchorKinds = new Set(input.relatedPairs.flatMap((pair) => pair.anchorKinds));
  const hasTimeWindow = pairAnchorKinds.has("time_window");
  const hasOccurrencePair = pairAnchorKinds.has("occurrence_section");
  const hasMaterialPair =
    pairAnchorKinds.has("part_batch") ||
    pairAnchorKinds.has("cooccurring_bundle") ||
    pairAnchorKinds.has("signature_material_traceability");
  const hasHandlingPair =
    pairAnchorKinds.has("order") || pairAnchorKinds.has("rework_user");
  const hasLatentPair =
    pairAnchorKinds.has("claim_lag") ||
    pairAnchorKinds.has("signature_latent_field");
  const failOrMixedCount = input.issues.filter(
    (issue) =>
      issue.profile.testOutcomeProfile === "fail_present" ||
      issue.profile.testOutcomeProfile === "mixed_factory",
  ).length;
  const claimOnlyNoPriorCount = input.issues.filter(
    (issue) =>
      issue.fingerprint.claimOnly &&
      issue.fingerprint.fieldClaimWithoutFactoryDefect &&
      !issue.fingerprint.hasPriorFactoryDefect,
  ).length;
  const mediumLongLagCount = input.issues.filter((issue) =>
    issue.fingerprint.claimLagBucket === "medium" || issue.fingerprint.claimLagBucket === "long",
  ).length;
  const lowSeverityHandlingCount = input.issues.filter(
    (issue) =>
      !issue.fingerprint.fieldImpactPresent &&
      (issue.fingerprint.lowSeverityOnly || issue.fingerprint.cosmeticOnly),
  ).length;

  const laneScores: Record<DeterministicCandidateLane, number> = {
    material_traceability:
      laneScoresBase.material_traceability +
      repeatedPartBatchAnchors.length * 6 +
      repeatedBundles.length * 4 +
      repeatedSupplierBatches.length * 2 +
      (hasMaterialPair ? 5 : 0) +
      (failOrMixedCount >= 2 || repeatedDefectCodes.length > 0 || repeatedTestKeys.length > 0 ? 5 : 0) +
      (claimOnlyNoPriorCount >= 2 && mediumLongLagCount >= 2 && (repeatedParts.length > 0 || repeatedBom.length > 0)
        ? 2
        : 0),
    process_temporal:
      laneScoresBase.process_temporal +
      repeatedOccurrenceSections.length * 7 +
      (hasOccurrencePair ? 5 : 0) +
      (hasTimeWindow ? 7 : 0) +
      (repeatedDefectCodes.length > 0 || repeatedTestKeys.length > 0 ? 4 : 0) +
      (failOrMixedCount >= 2 ? 4 : 0),
    latent_field:
      laneScoresBase.latent_field +
      claimOnlyNoPriorCount * 5 +
      mediumLongLagCount * 4 +
      (hasLatentPair ? 4 : 0) +
      (repeatedParts.length > 0 ? 4 : 0) +
      (repeatedBom.length > 0 ? 4 : 0),
    handling_operational:
      laneScoresBase.handling_operational +
      lowSeverityHandlingCount * 4 +
      repeatedOrders.length * 5 +
      repeatedReworkUsers.length * 5 +
      (hasHandlingPair ? 4 : 0),
  };

  const rankedLanes = laneOrder
    .slice()
    .sort(
      (left, right) => laneScores[right] - laneScores[left] || left.localeCompare(right),
    );
  const winningLane = rankedLanes[0];
  const runnerUpLane = rankedLanes[1];
  const winnerScore = laneScores[winningLane];
  const runnerUpScore = laneScores[runnerUpLane];
  const winnerMargin = winnerScore - runnerUpScore;
  const rationale: string[] = [];

  const materialClosureEvidence =
    repeatedPartBatchAnchors.length > 0 &&
    (repeatedBundles.length > 0 ||
      hasMaterialPair ||
      input.issues.some((issue) => issue.fingerprint.neighborhoodProductIds.length > 0)) &&
    (failOrMixedCount >= 2 ||
      repeatedDefectCodes.length > 0 ||
      repeatedTestKeys.length > 0 ||
      (claimOnlyNoPriorCount >= 2 &&
        mediumLongLagCount >= 2 &&
        (repeatedParts.length > 0 || repeatedBom.length > 0)));
  const processClosureEvidence =
    repeatedOccurrenceSections.length > 0 &&
    hasTimeWindow &&
    (repeatedDefectCodes.length > 0 ||
      repeatedTestKeys.length > 0 ||
      failOrMixedCount >= 2 ||
      input.issues.some((issue) => issue.fingerprint.reworkUsers.length > 0));
  const latentClosureEvidence =
    claimOnlyNoPriorCount >= 2 &&
    mediumLongLagCount >= 2 &&
    (repeatedLagBuckets.includes("medium") || repeatedLagBuckets.includes("long")) &&
    (repeatedParts.length > 0 || repeatedBom.length > 0);
  const handlingClosureEvidence =
    lowSeverityHandlingCount >= 2 &&
    !input.issues.some((issue) => issue.fingerprint.fieldImpactPresent) &&
    (repeatedOrders.length > 0 || repeatedReworkUsers.length > 0);

  if (winnerMargin < DET_CASE_LANE_MARGIN) {
    rationale.push(
      `Winning lane ${winningLane.replaceAll("_", " ")} only beat ${runnerUpLane.replaceAll("_", " ")} by ${winnerMargin}, below the ${DET_CASE_LANE_MARGIN}-point margin.`,
    );
  }

  if (winningLane === "material_traceability" && !materialClosureEvidence) {
    rationale.push(
      "Material / traceability evidence did not show enough closure beyond anchor concentration.",
    );
  }

  if (winningLane === "process_temporal" && !processClosureEvidence) {
    rationale.push(
      "Process / temporal evidence did not preserve both occurrence-section and tight time-window structure.",
    );
  }

  if (winningLane === "latent_field" && !latentClosureEvidence) {
    rationale.push(
      "Latent-field evidence did not recur strongly enough on claim-only, no-prior-defect, lagged part/BOM anchors.",
    );
  }

  if (winningLane === "handling_operational" && !handlingClosureEvidence) {
    rationale.push(
      "Handling / operational evidence did not show strong enough order or rework-user concentration.",
    );
  }

  const laneHasClosure =
    (winningLane === "material_traceability" && materialClosureEvidence) ||
    (winningLane === "process_temporal" && processClosureEvidence) ||
    (winningLane === "latent_field" && latentClosureEvidence) ||
    (winningLane === "handling_operational" && handlingClosureEvidence);

  if (input.productCount >= 2 && winnerMargin >= DET_CASE_LANE_MARGIN && laneHasClosure) {
    return {
      winningLane,
      runnerUpLane,
      winnerScore,
      runnerUpScore,
      winnerMargin,
      classification: "case",
      familyKey: null,
      rationale,
    } satisfies DeterministicClusterLaneValidation;
  }

  const classifyAsWatchlist =
    input.productCount >= 2 ||
    winningLane === "latent_field" ||
    winningLane === "handling_operational" ||
    input.issues.some((issue) => issueLooksWatchlistLike(issue)) ||
    (input.productCount >= 2 && laneHasClosure);

  return {
    winningLane,
    runnerUpLane,
    winnerScore,
    runnerUpScore,
    winnerMargin,
    classification: classifyAsWatchlist ? "watchlist" : "incident",
    familyKey: classifyAsWatchlist
      ? buildClusterWatchlistFamilyKey(winningLane, input.issues)
      : null,
    rationale,
  } satisfies DeterministicClusterLaneValidation;
}

function buildDeterministicArticleInventory(input: {
  dossier: ClusteredArticleDossier;
  issues: DeterministicIssueCard[];
  productReviewSummaries: string[];
}) {
  const candidateIssues = input.issues.filter((issue) => !issueLooksNoisy(issue));
  const pairScores = candidateIssues
    .flatMap((left, index) =>
      candidateIssues
        .slice(index + 1)
        .map((right) => scoreIssuePair(left, right))
        .filter((value): value is NonNullable<ReturnType<typeof scoreIssuePair>> => Boolean(value)),
    )
    .filter((pair) => pair.score >= DET_CASE_PAIR_THRESHOLD && pair.anchorKinds.length > 0);
  const caseComponents = buildConnectedComponents(
    candidateIssues,
    pairScores.map((pair) => ({ leftId: pair.leftId, rightId: pair.rightId })),
  );

  const cases: DeterministicCase[] = [];
  const incidents: z.infer<typeof deterministicIncidentSchema>[] = [];
  const watchlistSeeds: DeterministicWeakFamilySeed[] = [];
  const noiseSeeds: DeterministicWeakFamilySeed[] = [];
  const assignedIssueIds = new Set<string>();

  for (const component of caseComponents) {
    const componentProductIds = uniqueValues(component.map((issue) => issue.productId));
    const componentSignalIds = uniqueValues(component.flatMap((issue) => issue.includedSignalIds));
    const relatedPairs = pairScores.filter(
      (pair) => component.some((issue) => issue.id === pair.leftId) && component.some((issue) => issue.id === pair.rightId),
    );
    const strongestEvidence = uniqueValues(
      relatedPairs.flatMap((pair) => pair.reasons).concat(component.flatMap((issue) => issue.strongestEvidence)),
    ).slice(0, 8);
    const recommendedChecks = uniqueValues(
      component.flatMap((issue) => issue.recommendedChecks),
    ).slice(0, 8);
    const fingerprintTokens = buildFingerprintTokens(component);
    const anchorKinds = uniqueValues(relatedPairs.flatMap((pair) => pair.anchorKinds));
    const firstFactorySignalWeek =
      uniqueValues(component.map((issue) => issue.firstFactorySignalWeek))[0] ?? null;
    const lastFactorySignalWeek =
      uniqueValues(component.map((issue) => issue.lastFactorySignalWeek)).at(-1) ?? null;
    const maxPairScore = relatedPairs.length
      ? Math.max(...relatedPairs.map((pair) => pair.score))
      : 0;
    const avgIssueConfidence =
      component.reduce((total, issue) => total + issue.confidence, 0) / component.length;
    const componentConfidence = clampScore(
      avgIssueConfidence * 0.55 +
        Math.min(0.25, componentProductIds.length * 0.06) +
        Math.min(0.2, maxPairScore / 48),
      0.2,
      0.95,
    );
    const laneValidation = validateClusterLane({
      issues: component,
      relatedPairs,
      productCount: componentProductIds.length,
    });
    const watchlistLike =
      laneValidation.classification === "watchlist" ||
      component.every((issue) => issueLooksWatchlistLike(issue));
    const laneValidationEvidence = laneValidation.rationale.slice(0, 2);
    const caseConfidence = clampScore(
      componentConfidence -
        (laneValidation.winnerMargin < DET_CASE_LANE_MARGIN ? 0.06 : 0) -
        (laneValidation.rationale.length > 0 ? 0.04 : 0),
      0.2,
      0.95,
    );
    const downgradedSummary = [summarizeCluster(component, componentProductIds.length, strongestEvidence)]
      .concat(laneValidationEvidence)
      .join(" ");

    for (const issue of component) {
      assignedIssueIds.add(issue.id);
    }

    if (laneValidation.classification === "case" && componentProductIds.length >= 2 && !watchlistLike) {
      cases.push({
        caseTempId: createId("DCASE"),
        title: buildClusterTitle(component, fingerprintTokens),
        caseKind: chooseCaseKind(component),
        summary: summarizeCluster(component, componentProductIds.length, strongestEvidence),
        confidence: caseConfidence,
        priority: choosePriority(component.map((issue) => issue.priority)),
        includedProductIds: componentProductIds,
        includedSignalIds: componentSignalIds,
        strongestEvidence,
        recommendedNextTraceChecks: recommendedChecks,
        fingerprintTokens,
        anchorKinds,
        firstFactorySignalWeek,
        lastFactorySignalWeek,
        sourceIssueIds: component.map((issue) => issue.id),
      });
      continue;
    }

    const leadIssue = component[0];

    if (
      laneValidation.classification === "watchlist" ||
      watchlistLike ||
      leadIssue.scopeHint === "watchlist"
    ) {
      watchlistSeeds.push({
        familyKey:
          laneValidation.familyKey ??
          chooseWeakFamilyKey(leadIssue, "watchlist"),
        title: buildClusterTitle(component, fingerprintTokens),
        issueKind: chooseCaseKind(component),
        summary: downgradedSummary,
        confidence: clampScore(componentConfidence, 0.25, 0.88),
        priority: choosePriority(component.map((issue) => issue.priority)),
        linkedProductIds: componentProductIds,
        linkedSignalIds: componentSignalIds,
        strongestEvidence: uniqueValues(
          strongestEvidence.concat(laneValidationEvidence),
        ).slice(0, 6),
        mechanismLane: laneValidation.winningLane,
      });
      continue;
    }

    incidents.push({
      incidentTempId: createId("DINC"),
      title: leadIssue.title,
      issueKind: leadIssue.issueKind,
      summary: leadIssue.summary,
      confidence: leadIssue.confidence,
      priority: leadIssue.priority,
      productId: leadIssue.productId,
      includedSignalIds: leadIssue.includedSignalIds,
      strongestEvidence: leadIssue.strongestEvidence,
      recommendedNextTraceChecks: leadIssue.recommendedChecks,
    });
  }

  for (const issue of input.issues.filter((issue) => !assignedIssueIds.has(issue.id))) {
    if (issueLooksNoisy(issue)) {
      noiseSeeds.push({
        familyKey: chooseWeakFamilyKey(issue, "noise"),
        title: issue.title,
        issueKind: issue.issueKind,
        summary: issue.summary,
        confidence: issue.confidence,
        priority: issue.priority,
        linkedProductIds: [issue.productId],
        linkedSignalIds: issue.includedSignalIds,
        strongestEvidence: issue.strongestEvidence.slice(0, 6),
        mechanismLane: issue.fingerprint.mechanismLane,
      });
      continue;
    }

    if (issueLooksWatchlistLike(issue) || issue.scopeHint === "watchlist") {
      watchlistSeeds.push({
        familyKey: chooseWeakFamilyKey(issue, "watchlist"),
        title: issue.title,
        issueKind: issue.issueKind,
        summary: issue.summary,
        confidence: issue.confidence,
        priority: issue.priority,
        linkedProductIds: [issue.productId],
        linkedSignalIds: issue.includedSignalIds,
        strongestEvidence: issue.strongestEvidence.slice(0, 6),
        mechanismLane: issue.fingerprint.mechanismLane,
      });
      continue;
    }

    incidents.push({
      incidentTempId: createId("DINC"),
      title: issue.title,
      issueKind: issue.issueKind,
      summary: issue.summary,
      confidence: issue.confidence,
      priority: issue.priority,
      productId: issue.productId,
      includedSignalIds: issue.includedSignalIds,
      strongestEvidence: issue.strongestEvidence.slice(0, 6),
      recommendedNextTraceChecks: issue.recommendedChecks.slice(0, 6),
    });
  }

  const watchlists = aggregateWeakFamilies(watchlistSeeds, "watchlist");
  const noise = aggregateWeakFamilies(noiseSeeds, "noise");
  const benchmarkCoverageNotes = buildBenchmarkCoverageNotes({
    issues: input.issues,
    cases,
    watchlists,
  });

  const classifiedProductIds = new Set<string>([
    ...cases.flatMap((item) => item.includedProductIds),
    ...incidents.map((item) => item.productId),
    ...watchlists.flatMap((item) => item.linkedProductIds),
    ...noise.flatMap((item) => item.linkedProductIds),
  ]);

  const unassignedProducts = input.dossier.productThreads
    .filter((thread) => thread.signals.length > 0 && !classifiedProductIds.has(thread.productId))
    .map((thread) => ({
      productId: thread.productId,
      reason: "No deterministic multi-product anchor cleared the clustering threshold.",
    }));

  return deterministicArticleInventorySchema.parse(
    normalizeDeterministicLocalInventory({
      reviewSummary:
        `Deterministic grouping reviewed ${input.issues.length} extracted issue cards across ${input.dossier.article.productCount} products.`,
      cases,
      incidents,
      watchlists,
      noise,
      unassignedProducts,
      globalObservations: [
        ...input.productReviewSummaries.map((value) => trimPreview(value, 180)),
        cases.length > 0
          ? `${cases.length} multi-product case groups cleared the deterministic threshold.`
          : "No multi-product case group cleared the deterministic threshold.",
        watchlists.length > 0
          ? `${watchlists.length} weaker patterns were held back as watchlists.`
          : null,
        ...benchmarkCoverageNotes,
      ],
    }),
  );
}

function materializeDeterministicCandidates(input: {
  articleId: string;
  runId: string;
  localInventory: DeterministicArticleInventory;
  dossier: ClusteredArticleDossier;
}) {
  const productIdSet = new Set(input.dossier.productThreads.map((thread) => thread.productId));
  const signalLookup = new Map<
    string,
    { productId: string; signalType: SignalType }
  >();

  for (const thread of input.dossier.productThreads) {
    for (const signal of thread.signals) {
      signalLookup.set(signal.signalId, {
        productId: thread.productId,
        signalType: signal.signalType,
      });
    }
  }

  return input.localInventory.cases
    .map((candidate) => {
      const includedSignalIds = uniqueValues(candidate.includedSignalIds).filter((signalId) =>
        signalLookup.has(signalId),
      );
      const inferredProductIds = uniqueValues(
        includedSignalIds.map((signalId) => signalLookup.get(signalId)?.productId ?? null),
      );
      const includedProductIds = uniqueValues([
        ...candidate.includedProductIds.filter((productId) => productIdSet.has(productId)),
        ...inferredProductIds,
      ]);

      if (!includedProductIds.length) {
        return null;
      }

      const id = createId("DTCAND");
      const fingerprintPayload: CandidateFingerprintPayload = {
        fingerprintTokens: candidate.fingerprintTokens,
        anchorKinds: candidate.anchorKinds,
        mechanismLane:
          (
            candidate.fingerprintTokens.find((token) => token.startsWith("lane:")) ??
            "lane:material_traceability"
          ).replace("lane:", "") as DeterministicIssueMechanismLane,
        familyKeys: candidate.fingerprintTokens
          .filter((token) => token.startsWith("family:"))
          .map((token) => token.replace("family:", ""))
          .slice(0, 8),
        firstFactorySignalWeek: candidate.firstFactorySignalWeek,
        lastFactorySignalWeek: candidate.lastFactorySignalWeek,
        sourceIssueIds: candidate.sourceIssueIds,
      };

      return {
        id,
        title: candidate.title,
        lifecycleStatus: "proposed" as const,
        caseKind: candidate.caseKind,
        summary: candidate.summary,
        confidence: candidate.confidence,
        priority: candidate.priority,
        strongestEvidence: candidate.strongestEvidence,
        recommendedNextTraceChecks: candidate.recommendedNextTraceChecks,
        includedProductIds,
        includedSignalIds,
        payload: {
          fingerprint: fingerprintPayload,
          sourceCase: candidate,
        },
        members: [
          ...includedProductIds.map((productId) => ({
            id: createId("DTCMEM"),
            memberType: "product" as const,
            entityId: productId,
            productId,
            signalId: null,
            signalType: null,
            rationale: "Grouped by deterministic anchor overlap.",
          })),
          ...includedSignalIds.map((signalId) => ({
            id: createId("DTCMEM"),
            memberType: "signal" as const,
            entityId: signalId,
            productId: signalLookup.get(signalId)?.productId ?? null,
            signalId,
            signalType: signalLookup.get(signalId)?.signalType ?? null,
            rationale: null,
          })),
        ],
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
}

function parseDeterministicReviewPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as { localInventory?: unknown; globalInventory?: unknown };
  const localInventory = deterministicArticleInventorySchema.safeParse(record.localInventory);
  const globalInventory = deterministicGlobalInventorySchema.safeParse(record.globalInventory);

  if (!localInventory.success || !globalInventory.success) {
    return null;
  }

  return {
    localInventory: localInventory.data,
    globalInventory: globalInventory.data,
  };
}

function parseDeterministicGlobalInventoryFromReviewPayload(payload: unknown) {
  return parseDeterministicReviewPayload(payload)?.globalInventory ?? null;
}

function getCandidateFingerprint(candidate: DeterministicCaseCandidateRecord) {
  const payload =
    candidate.payload && typeof candidate.payload === "object"
      ? (candidate.payload as { fingerprint?: CandidateFingerprintPayload })
      : null;

  return payload?.fingerprint ?? null;
}

function scoreCandidatePair(
  left: DeterministicCaseCandidateRecord,
  right: DeterministicCaseCandidateRecord,
) {
  const leftFingerprint = getCandidateFingerprint(left);
  const rightFingerprint = getCandidateFingerprint(right);

  if (!leftFingerprint || !rightFingerprint) {
    return null;
  }

  if (leftFingerprint.mechanismLane !== rightFingerprint.mechanismLane) {
    return null;
  }

  const sharedTokens = intersect(leftFingerprint.fingerprintTokens, rightFingerprint.fingerprintTokens);
  const sharedPartBatch = sharedTokens.filter((token) => token.startsWith("part_batch:"));
  const sharedBundles = sharedTokens.filter((token) => token.startsWith("bundle:"));
  const sharedOccurrence = sharedTokens.filter((token) => token.startsWith("occurrence:"));
  const sharedClaimLag = sharedTokens.filter((token) => token.startsWith("claim_lag:"));
  const sharedOrders = sharedTokens.filter((token) => token.startsWith("order:"));
  const sharedReworkUsers = sharedTokens.filter((token) => token.startsWith("rework_user:"));
  const sharedParts = sharedTokens.filter((token) => token.startsWith("part:"));
  const sharedBom = sharedTokens.filter((token) => token.startsWith("bom:"));
  const sharedFamily = sharedTokens.filter((token) => token.startsWith("family:"));
  const sharedSupplierBatches = sharedTokens.filter((token) => token.startsWith("supplier_batch:"));

  if (!sharedTokens.length) {
    return null;
  }

  const temporalOverlap =
    leftFingerprint.firstFactorySignalWeek &&
    leftFingerprint.lastFactorySignalWeek &&
    rightFingerprint.firstFactorySignalWeek &&
    rightFingerprint.lastFactorySignalWeek &&
    leftFingerprint.firstFactorySignalWeek <= rightFingerprint.lastFactorySignalWeek &&
    rightFingerprint.firstFactorySignalWeek <= leftFingerprint.lastFactorySignalWeek;

  const strongStructuralBasis =
    (leftFingerprint.mechanismLane === "material_traceability" &&
      sharedPartBatch.length > 0 &&
      (sharedBundles.length > 0 || sharedParts.length > 0 || sharedSupplierBatches.length > 0)) ||
    (leftFingerprint.mechanismLane === "process_temporal" &&
      sharedOccurrence.length > 0 &&
      temporalOverlap) ||
    (leftFingerprint.mechanismLane === "latent_field" &&
      sharedClaimLag.length > 0 &&
      (sharedParts.length > 0 || sharedBom.length > 0 || sharedFamily.length > 0)) ||
    (leftFingerprint.mechanismLane === "handling_operational" &&
      (sharedOrders.length > 0 || sharedReworkUsers.length > 0) &&
      sharedFamily.length > 0);

  if (!strongStructuralBasis) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  for (const token of sharedTokens) {
    if (token.startsWith("candidate:")) {
      score += 10;
      reasons.push(`Shared deterministic anchor ${token.replace("candidate:", "")}.`);
      continue;
    }

    if (token.startsWith("part_batch:")) {
      score += 10;
      reasons.push(`Shared part+batch anchor ${token.replace("part_batch:", "")}.`);
      continue;
    }

    if (token.startsWith("bundle:")) {
      score += 8;
      reasons.push(`Shared anchor bundle ${token.replace("bundle:", "")}.`);
      continue;
    }

    if (token.startsWith("supplier_batch:")) {
      score += 4;
      reasons.push(`Shared supplier batch ${token.replace("supplier_batch:", "")}.`);
      continue;
    }

    if (token.startsWith("part:") || token.startsWith("bom:") || token.startsWith("order:")) {
      score += 4;
      reasons.push(`Shared anchor ${token.replace(/^[^:]+:/, "")}.`);
      continue;
    }

    if (token.startsWith("occurrence:")) {
      score += 5;
      reasons.push(`Shared occurrence section ${token.replace("occurrence:", "")}.`);
      continue;
    }

    if (token.startsWith("lane:")) {
      score += 2;
      continue;
    }

    if (token.startsWith("kind:")) {
      score += 1;
      continue;
    }

    if (token.startsWith("claim_lag:")) {
      score += 4;
      continue;
    }

    if (token.startsWith("rework_user:")) {
      score += 4;
      reasons.push(`Shared rework user ${token.replace("rework_user:", "")}.`);
      continue;
    }

    if (token.startsWith("family:")) {
      score += 5;
      continue;
    }
  }

  if (temporalOverlap) {
    score += 4;
  }

  if (sharedPartBatch.length === 0 && sharedBundles.length === 0 && sharedOccurrence.length === 0 && sharedClaimLag.length === 0 && sharedFamily.length === 0 && sharedReworkUsers.length === 0) {
    return null;
  }

  return {
    leftId: left.id,
    rightId: right.id,
    score,
    reasons: reasons.slice(0, 6),
  };
}

async function loadLatestCompletedDeterministicRuns() {
  return (
    (await queryPostgres<LatestCompletedDeterministicRunRow>(
      `
        SELECT DISTINCT ON (article_id)
          run_id,
          article_id,
          article_name,
          review_payload,
          completed_at
        FROM team_det_case_run
        WHERE status = 'completed'
        ORDER BY article_id, completed_at DESC NULLS LAST, started_at DESC
      `,
    )) ?? []
  );
}

async function loadAllClusterableArticleIds() {
  const rows =
    (await queryPostgres<{ article_id: string }>(
      `
        SELECT DISTINCT p.article_id
        FROM product p
        ORDER BY p.article_id ASC
      `,
    )) ?? [];

  return rows.map((row) => row.article_id);
}

async function runDeterministicGlobalReconciliation(input: {
  currentArticleId: string;
  currentArticleName: string | null;
  localInventory: DeterministicArticleInventory;
  currentCandidates: DeterministicCaseCandidateRecord[];
}) {
  const latestRuns = await loadLatestCompletedDeterministicRuns();
  const externalEntries = await Promise.all(
    latestRuns
      .filter((row) => row.article_id !== input.currentArticleId)
      .map(async (row) => {
        const parsed = parseDeterministicReviewPayload(row.review_payload);

        if (!parsed) {
          return null;
        }

        const candidates = await listDeterministicCaseCandidatesForRun(row.run_id);

        return {
          articleId: row.article_id,
          articleName: row.article_name,
          localInventory: parsed.localInventory,
          candidates,
        };
      }),
  );

  const allEntries = [
    ...externalEntries.filter((value): value is NonNullable<typeof value> => Boolean(value)),
    {
      articleId: input.currentArticleId,
      articleName: input.currentArticleName,
      localInventory: input.localInventory,
      candidates: input.currentCandidates,
    },
  ];

  const allCandidates = allEntries.flatMap((entry) => entry.candidates);
  const candidateEdges = allCandidates
    .flatMap((left, index) =>
      allCandidates
        .slice(index + 1)
        .map((right) => scoreCandidatePair(left, right))
        .filter((value): value is NonNullable<ReturnType<typeof scoreCandidatePair>> => Boolean(value)),
    )
    .filter((edge) => edge.score >= DET_GLOBAL_CASE_PAIR_THRESHOLD);
  const candidateComponents = buildConnectedComponents(
    allCandidates.map((candidate) => {
      const candidateFingerprint = getCandidateFingerprint(candidate);

      return {
        id: candidate.id,
        productId: candidate.id,
        articleId: candidate.articleId,
        articleName: null,
        issueTempId: candidate.id,
        title: candidate.title,
        issueKind: candidate.caseKind as DeterministicIssueCard["issueKind"],
        scopeHint: "candidate_case",
        summary: candidate.summary,
        confidence: candidate.confidence ?? 0.5,
        priority: candidate.priority,
        includedSignalIds: candidate.includedSignalIds,
        strongestEvidence: candidate.strongestEvidence,
        reasonsAgainstClustering: [],
        recommendedChecks: candidate.recommendedNextTraceChecks,
        anchorSummary: {
          reportedPartNumbers: [],
          bomFindNumbers: [],
          supplierBatches: [],
          supplierNames: [],
          testKeys: [],
          defectCodes: [],
          occurrenceSections: [],
          detectedSections: [],
          orderIds: [],
          reworkUsers: [],
          claimLagBucket: "none",
          firstFactorySignalWeek: null,
          lastFactorySignalWeek: null,
          productAnchorCandidates: [],
          flags: {
            claimOnlyThread: false,
            marginalOnly: false,
            falsePositive: false,
            serviceDocumentation: false,
            cosmeticOnly: false,
            detectionBias: false,
            lowVolumeRisk: false,
          },
        },
        firstFactorySignalWeek: candidateFingerprint?.firstFactorySignalWeek ?? null,
        lastFactorySignalWeek: candidateFingerprint?.lastFactorySignalWeek ?? null,
        profile: {
          claimOnly: false,
          hasPriorFactoryDefect: false,
          fieldClaimWithoutFactoryDefect: false,
          fieldImpactPresent: false,
          lowSeverityOnly: false,
          cosmeticOnly: false,
          serviceDocumentation: false,
          falsePositive: false,
          marginalOnly: false,
          detectionBiasRisk: false,
          lowVolumeRisk: false,
          nearLimitOnly: false,
          dominantOccurrenceSection: null,
          dominantDetectedSection: null,
          dominantOrderId: null,
          dominantReworkUser: null,
          dominantReportedPartNumber: null,
          dominantBomFindNumber: null,
          dominantSupplierBatch: null,
          dominantSupplierName: null,
          dominantDefectCode: null,
          dominantTestKey: null,
          claimLagBucket: "none",
          testOutcomeProfile: "no_factory_tests",
          signatureHints: [],
        },
        fingerprint: {
          mechanismLane: candidateFingerprint?.mechanismLane ?? "material_traceability",
          laneScores: {
            material_traceability: 0,
            process_temporal: 0,
            latent_field: 0,
            handling_operational: 0,
            noise_confounder: 0,
          },
          diagnosticTokens:
            candidateFingerprint?.fingerprintTokens
              .filter((token) => token.startsWith("diagnostic:"))
              .map((token) => token.replace("diagnostic:", "")) ?? [],
          localClusterTokens:
            candidateFingerprint?.fingerprintTokens
              .filter((token) => token.startsWith("local:"))
              .map((token) => token.replace("local:", "")) ?? [],
          broadTokens: [],
          partBatchAnchorValues:
            candidateFingerprint?.fingerprintTokens
              .filter((token) => token.startsWith("part_batch:"))
              .map((token) => token.replace("part_batch:", "")) ?? [],
          cooccurringBundleKeys:
            candidateFingerprint?.fingerprintTokens
              .filter((token) => token.startsWith("bundle:"))
              .map((token) => token.replace("bundle:", "")) ?? [],
          neighborhoodProductIds: [],
          neighborhoodAnchorValues: [],
          blastRadiusAnchorValues: [],
          reportedPartNumbers: [],
          bomFindNumbers: [],
          supplierBatches: [],
          occurrenceSections: [],
          detectedSections: [],
          orderIds: [],
          reworkUsers: [],
          claimLagBucket: "none",
          claimOnly: false,
          fieldClaimWithoutFactoryDefect: false,
          hasPriorFactoryDefect: false,
          lowSeverityOnly: false,
          cosmeticOnly: false,
          fieldImpactPresent: false,
          familyKeys: candidateFingerprint?.familyKeys ?? [],
        },
      };
    }),
    candidateEdges.map((edge) => ({ leftId: edge.leftId, rightId: edge.rightId })),
  );

  const candidateMap = new Map(allCandidates.map((candidate) => [candidate.id, candidate]));
  const validatedCases: z.infer<typeof deterministicGlobalInventoryItemSchema>[] = [];
  const rejectedCases: z.infer<typeof deterministicGlobalInventoryItemSchema>[] = [];

  for (const component of candidateComponents) {
    const cases = component
      .map((node) => candidateMap.get(node.id))
      .filter((value): value is DeterministicCaseCandidateRecord => Boolean(value));
    const articleIds = uniqueValues(cases.map((item) => item.articleId));
    const linkedCandidateIds = cases.map((item) => item.id);
    const linkedProductIds = uniqueValues(cases.flatMap((item) => item.includedProductIds));
    const linkedSignalIds = uniqueValues(cases.flatMap((item) => item.includedSignalIds));
    const strongestEvidence = uniqueValues(cases.flatMap((item) => item.strongestEvidence)).slice(0, 8);
    const recommendedChecks = uniqueValues(
      cases.flatMap((item) => item.recommendedNextTraceChecks),
    ).slice(0, 8);
    const confidence =
      cases.reduce((total, item) => total + (item.confidence ?? 0.5), 0) / cases.length;
    const inventoryItem = {
      inventoryTempId: createId("DGLOB"),
      title: cases[0]?.title ?? "Deterministic case",
      inventoryKind:
        articleIds.length > 1 || confidence >= 0.75 ? "validated_case" : "rejected_case",
      caseTypeHint: strongestEvidence.some((item) => /supplier batch/i.test(item))
        ? "supplier"
        : strongestEvidence.some((item) => /order|rework/i.test(item))
          ? "handling"
          : strongestEvidence.some((item) => /occurrence|factory signal window/i.test(item))
            ? "process"
            : "other",
      summary:
        `${linkedProductIds.length} products across ${articleIds.length} article(s) share deterministic case anchors.`,
      oneLineExplanation: strongestEvidence[0] ?? "Deterministic case evidence was retained.",
      articleIds,
      linkedCandidateIds,
      linkedProductIds,
      linkedSignalIds,
      strongestEvidence,
      conflictingEvidence: [],
      recommendedNextTraceChecks: recommendedChecks,
      confidence,
      priority: choosePriority(cases.map((item) => item.priority)),
    } satisfies z.infer<typeof deterministicGlobalInventoryItemSchema>;

    if (inventoryItem.inventoryKind === "validated_case") {
      validatedCases.push(inventoryItem);
    } else {
      rejectedCases.push(inventoryItem);
    }
  }

  const watchlists = allEntries
    .flatMap((entry) => entry.localInventory.watchlists.map((watchlist) => ({
      inventoryTempId: createId("DGLOB"),
      title: watchlist.title,
      inventoryKind: "watchlist" as const,
      caseTypeHint: "watchlist" as const,
      summary: watchlist.summary,
      oneLineExplanation: watchlist.strongestEvidence[0] ?? watchlist.summary,
      articleIds: [entry.articleId],
      linkedCandidateIds: [],
      linkedProductIds: watchlist.linkedProductIds,
      linkedSignalIds: watchlist.linkedSignalIds,
      strongestEvidence: watchlist.strongestEvidence,
      conflictingEvidence: [],
      recommendedNextTraceChecks: [],
      confidence: watchlist.confidence,
      priority: watchlist.priority,
    })))
    .slice(0, 40);

  const noiseBuckets = allEntries
    .flatMap((entry) => entry.localInventory.noise.map((noise) => ({
      inventoryTempId: createId("DGLOB"),
      title: noise.title,
      inventoryKind: "noise_bucket" as const,
      caseTypeHint: "noise" as const,
      summary: noise.summary,
      oneLineExplanation: noise.strongestEvidence[0] ?? noise.summary,
      articleIds: [entry.articleId],
      linkedCandidateIds: [],
      linkedProductIds: noise.linkedProductIds,
      linkedSignalIds: noise.linkedSignalIds,
      strongestEvidence: noise.strongestEvidence,
      conflictingEvidence: [],
      recommendedNextTraceChecks: [],
      confidence: 0.25,
      priority: "low" as const,
    })))
    .slice(0, 40);

  return deterministicGlobalInventorySchema.parse(
    normalizeDeterministicGlobalInventory({
      inventorySummary:
        `${validatedCases.length} validated deterministic cases, ${watchlists.length} watchlists, and ${noiseBuckets.length} noise buckets are visible in the latest snapshot.`,
      validatedCases,
      watchlists,
      noiseBuckets,
      rejectedCases,
      caseMergeLog: candidateEdges
        .filter((edge) => edge.score >= DET_GLOBAL_CASE_PAIR_THRESHOLD)
        .slice(0, 12)
        .map((edge) => `${edge.leftId} merged with ${edge.rightId} at score ${edge.score}.`),
      confidenceNotes: [
        "Global reconciliation is deterministic and now blocks broad-anchor-only validation.",
        "Cross-article merges require same-lane structural evidence such as part+batch, occurrence-window, claim-lag family, or order/rework-user concentration.",
      ],
    }),
  );
}

export async function runDeterministicArticleCaseClustering(
  articleId: string,
  options?: { abortSignal?: AbortSignal },
) {
  if (!capabilities.hasPostgres) {
    throw new Error("Deterministic case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Deterministic case clustering requires OPENAI_API_KEY.");
  }

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();
  const runId = createId("DTCRUN");

  await createDeterministicCaseRun({
    id: runId,
    articleId: normalizedArticleId,
    model: env.OPENAI_MODEL,
    schemaVersion: DET_ARTICLE_INVENTORY_SCHEMA_VERSION,
    promptVersion: DET_PROMPT_VERSION,
    productCount: 0,
    signalCount: 0,
    requestPayload: {
      articleId: normalizedArticleId,
    },
    currentStage: "stage1_loading",
    stageDetail: "Building shared Stage 1 dossier for deterministic clustering.",
  });

  try {
    throwIfDeterministicPipelineAborted(options?.abortSignal);
    const dossier = await buildArticleDossier(
      normalizedArticleId,
      async (stage, detail) => {
        await updateDeterministicCaseRunStage({
          id: runId,
          currentStage: stage,
          stageDetail: detail,
        });
      },
      {
        abortSignal: options?.abortSignal,
      },
    );

    throwIfDeterministicPipelineAborted(options?.abortSignal);
    await updateDeterministicCaseRunStage({
      id: runId,
      currentStage: "stage1_issue_extraction",
      stageDetail: `Extracting deterministic issue cards for ${dossier.article.productCount} products.`,
      productCount: dossier.article.productCount,
      signalCount: dossier.article.totalSignals,
    });

    let completedProducts = 0;
    const progressStep = Math.max(1, Math.ceil(dossier.productThreads.length / 10));
    const issueSets = await mapWithConcurrency(
      dossier.productThreads,
      DET_ISSUE_EXTRACTION_CONCURRENCY,
      async (thread) => {
        const extracted = await extractIssuesForThread(thread, {
          abortSignal: options?.abortSignal,
        });
        completedProducts += 1;

        if (
          completedProducts === dossier.productThreads.length ||
          completedProducts === 1 ||
          completedProducts % progressStep === 0
        ) {
          await updateDeterministicCaseRunStage({
            id: runId,
            currentStage: "stage1_issue_extraction",
            stageDetail:
              `Extracting deterministic issue cards (${completedProducts}/${dossier.productThreads.length}).`,
          });
        }

        return extracted;
      },
      options?.abortSignal,
    );

    throwIfDeterministicPipelineAborted(options?.abortSignal);
    const extractedIssues = issueSets.flatMap((set) => set.issues);
    const localInventory = buildDeterministicArticleInventory({
      dossier,
      issues: extractedIssues,
      productReviewSummaries: issueSets.map((set) => set.reviewSummary),
    });

    await updateDeterministicCaseRunStage({
      id: runId,
      currentStage: "stage2_grouping",
      stageDetail:
        `Grouped ${extractedIssues.length} issue cards into ${localInventory.cases.length} candidate cases.`,
      issueCount: extractedIssues.length,
    });

    const candidates = materializeDeterministicCandidates({
      articleId: dossier.article.articleId,
      runId,
      localInventory,
      dossier,
    });

    throwIfDeterministicPipelineAborted(options?.abortSignal);
    await updateDeterministicCaseRunStage({
      id: runId,
      currentStage: "stage2_persisting",
      stageDetail: `Persisting ${candidates.length} deterministic candidates.`,
      issueCount: extractedIssues.length,
    });

    await replaceDeterministicCaseCandidatesForRun({
      runId,
      articleId: dossier.article.articleId,
      candidates,
    });

    throwIfDeterministicPipelineAborted(options?.abortSignal);
    const persistedCandidates = await listDeterministicCaseCandidatesForRun(runId);

    await updateDeterministicCaseRunStage({
      id: runId,
      currentStage: "stage3_reconciliation",
      stageDetail: "Reconciling deterministic candidates across articles.",
      issueCount: extractedIssues.length,
    });

    throwIfDeterministicPipelineAborted(options?.abortSignal);
    const globalInventory = await runDeterministicGlobalReconciliation({
      currentArticleId: dossier.article.articleId,
      currentArticleName: dossier.article.articleName,
      localInventory,
      currentCandidates: persistedCandidates,
    });

    throwIfDeterministicPipelineAborted(options?.abortSignal);
    const reviewPayload: DeterministicReviewPayload = {
      contractVersion: DET_RUN_REVIEW_SCHEMA_VERSION,
      localInventory,
      globalInventory,
    };

    await completeDeterministicCaseRun({
      id: runId,
      issueCount: extractedIssues.length,
      candidateCount: persistedCandidates.length,
      proposalPayload: {
        productIssueSets: issueSets,
      },
      reviewPayload,
      stageDetail:
        `Finished deterministic clustering with ${persistedCandidates.length} candidate cases.`,
    });

    const latestRun = await getLatestDeterministicCaseRun(dossier.article.articleId);

    return {
      articleId: dossier.article.articleId,
      dossier,
      latestRun,
      proposedCases: persistedCandidates,
      localInventory,
      globalInventory,
    };
  } catch (error) {
    await failDeterministicCaseRun({
      id: runId,
      errorMessage: error instanceof Error ? error.message : String(error),
      stageDetail: "Deterministic clustering failed before completion.",
    });

    throw error;
  }
}

async function getLatestDeterministicGlobalRunWithInventory() {
  const rows =
    (await queryPostgres<LatestCompletedDeterministicRunRow>(
      `
        SELECT
          run_id,
          article_id,
          article_name,
          review_payload,
          completed_at
        FROM team_det_case_run
        WHERE status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, started_at DESC
        LIMIT 12
      `,
    )) ?? [];

  for (const row of rows) {
    const globalInventory = parseDeterministicGlobalInventoryFromReviewPayload(row.review_payload);

    if (!globalInventory) {
      continue;
    }

    const run = await getLatestDeterministicCaseRun(row.article_id);

    if (!run || run.id !== row.run_id) {
      return {
        latestGlobalRun: {
          id: row.run_id,
          articleId: row.article_id,
          articleName: row.article_name,
          model: env.OPENAI_MODEL,
          status: "completed" as const,
          schemaVersion: DET_ARTICLE_INVENTORY_SCHEMA_VERSION,
          promptVersion: DET_PROMPT_VERSION,
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
        globalInventory,
      };
    }

    return {
      latestGlobalRun: run,
      globalInventory,
    };
  }

  return {
    latestGlobalRun: null,
    globalInventory: null,
  };
}

export async function runDeterministicArticleCaseClusteringBatch(input?: {
  articleIds?: string[];
  abortSignal?: AbortSignal;
  onStart?: (payload: {
    requestedArticleIds: string[];
    concurrency: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
  onArticleComplete?: (payload: {
    result: DeterministicCaseClusteringBatchResult;
    okCount: number;
    errorCount: number;
    completedCount: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
}) {
  if (!capabilities.hasPostgres) {
    throw new Error("Deterministic case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Deterministic case clustering requires OPENAI_API_KEY.");
  }

  const requestedIds =
    input?.articleIds?.map((articleId) => normalizeUiIdentifier(articleId)).filter(Boolean) ?? [];
  const targetArticleIds = requestedIds.length
    ? uniqueValues(requestedIds)
    : await loadAllClusterableArticleIds();
  let okCount = 0;
  let errorCount = 0;
  let completedCount = 0;

  await input?.onStart?.({
    requestedArticleIds: targetArticleIds,
    concurrency: DET_ARTICLE_PIPELINE_CONCURRENCY,
    totalArticleCount: targetArticleIds.length,
  });

  const results = await mapWithConcurrency(
    targetArticleIds,
    DET_ARTICLE_PIPELINE_CONCURRENCY,
    async (articleId) => {
      throwIfDeterministicPipelineAborted(input?.abortSignal);
      let result: Omit<DeterministicCaseClusteringBatchResult, "completedAt">;

      try {
        const articleResult = await runDeterministicArticleCaseClustering(articleId, {
          abortSignal: input?.abortSignal,
        });
        result = {
          articleId,
          ok: true as const,
          runId: articleResult.latestRun?.id ?? null,
          issueCount: articleResult.latestRun?.issueCount ?? 0,
          caseCount: articleResult.proposedCases.length,
          validatedCount: articleResult.globalInventory?.validatedCases.length ?? 0,
          watchlistCount: articleResult.globalInventory?.watchlists.length ?? 0,
          noiseCount: articleResult.globalInventory?.noiseBuckets.length ?? 0,
          error: null,
        };
      } catch (error) {
        result = {
          articleId,
          ok: false as const,
          runId: null,
          issueCount: 0,
          caseCount: 0,
          validatedCount: 0,
          watchlistCount: 0,
          noiseCount: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const completedResult = {
        ...result,
        completedAt: new Date().toISOString(),
      } satisfies DeterministicCaseClusteringBatchResult;

      completedCount += 1;

      if (completedResult.ok) {
        okCount += 1;
      } else {
        errorCount += 1;
      }

      await input?.onArticleComplete?.({
        result: completedResult,
        okCount,
        errorCount,
        completedCount,
        totalArticleCount: targetArticleIds.length,
      });

      return completedResult;
    },
    input?.abortSignal,
  );

  const latestGlobalSnapshot = await getLatestDeterministicGlobalRunWithInventory();

  return {
    requestedArticleIds: targetArticleIds,
    concurrency: DET_ARTICLE_PIPELINE_CONCURRENCY,
    okCount,
    errorCount,
    results,
    latestGlobalRun: latestGlobalSnapshot.latestGlobalRun,
    globalInventory: latestGlobalSnapshot.globalInventory,
  };
}

const priorityRank: Record<"low" | "medium" | "high" | "critical", number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function sortCandidatesForArticleQueue(candidates: DeterministicCaseCandidateRecord[]) {
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

export const getDeterministicProposedCasesDashboard = memoizeWithTtl(
  "deterministic-proposed-cases-dashboard",
  15_000,
  () => "dashboard",
  async (): Promise<DeterministicProposedCasesDashboardReadModel> => {
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
      listDeterministicArticleClusterCards(),
      listActiveDeterministicCaseRuns(),
      getLatestDeterministicGlobalRunWithInventory(),
    ]);

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
            const candidates = await listDeterministicCaseCandidatesForRun(article.latestRun!.id);
            const sortedCandidates = sortCandidatesForArticleQueue(candidates);
            const leadingCase = sortedCandidates[0] ?? null;
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

export const getDeterministicArticleCaseboard = memoizeWithTtl(
  "deterministic-article-caseboard",
  15_000,
  (articleId: string) => articleId,
  async (articleId: string): Promise<DeterministicArticleCaseboardReadModel | null> => {
    if (!capabilities.hasPostgres) {
      return null;
    }

    const normalizedArticleId =
      normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();

    const [dashboardCards, latestRun, persistedDossier] = await Promise.all([
      listDeterministicArticleClusterCards(),
      getLatestDeterministicCaseRun(normalizedArticleId),
      getTeamArticleDossierRecord<ClusteredArticleDossier>(normalizedArticleId),
    ]);
    const dossier =
      persistedDossier?.payload ?? (await buildArticleDossier(normalizedArticleId).catch(() => null));

    const dashboardCard =
      dashboardCards.find((item) => item.articleId === normalizedArticleId) ?? null;
    const proposedCases =
      latestRun?.status === "completed"
        ? await listDeterministicCaseCandidatesForRun(latestRun.id)
        : [];
    const parsedReview = parseDeterministicReviewPayload(latestRun?.reviewPayload);

    if (!dashboardCard && !latestRun && !dossier) {
      return null;
    }

    return {
      articleId: normalizedArticleId,
      articleName: dashboardCard?.articleName ?? latestRun?.articleName ?? dossier?.article.articleName ?? null,
      dashboardCard,
      dossier,
      latestRun,
      proposedCases,
      incidents: parsedReview?.localInventory.incidents ?? [],
      watchlists: parsedReview?.localInventory.watchlists ?? [],
      noise: parsedReview?.localInventory.noise ?? [],
      unassignedProducts: parsedReview?.localInventory.unassignedProducts ?? [],
      globalObservations: parsedReview?.localInventory.globalObservations ?? [],
      globalInventory: parsedReview?.globalInventory ?? null,
    };
  },
);

export const getDeterministicProposedCasesForProduct = memoizeWithTtl(
  "deterministic-product-proposed-cases",
  15_000,
  (productId: string) => productId,
  async (productId: string) => {
    if (!capabilities.hasPostgres) {
      return [] as DeterministicCaseCandidateRecord[];
    }

    const normalizedProductId =
      normalizeUiIdentifier(productId) ?? productId.replace(/\s+/g, "").trim().toUpperCase();
    return listDeterministicCaseCandidatesForProduct(normalizedProductId);
  },
);
