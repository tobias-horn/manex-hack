import { createOpenAI } from "@ai-sdk/openai";
import { startOfWeek } from "date-fns";
import { z } from "zod";

import {
  createManexDataAccess,
  type ManexDefect,
  type ManexFieldClaim,
  type ManexInstalledPart,
  type ManexReworkRecord,
  type ManexTestSignal,
  type ManexWeeklyQualitySummary,
  type ManexWorkflowAction,
} from "@/lib/manex-data-access";
import { capabilities, env } from "@/lib/env";
import {
  completeTeamCaseRun,
  createTeamCaseRun,
  ensureTeamCaseClusteringState,
  failTeamCaseRun,
  getLatestTeamCaseRun,
  getTeamArticleDossierRecord,
  listActiveTeamCaseRuns,
  listTeamArticleClusterCards,
  listTeamCaseCandidatesForProduct,
  listTeamCaseCandidatesForRun,
  replaceTeamCaseCandidatesForRun,
  updateTeamCaseRunStage,
  upsertTeamArticleDossier,
  upsertTeamProductDossier,
  type TeamArticleClusterCard,
  type TeamCaseCandidateRecord,
  type TeamCaseRunSummary,
} from "@/lib/manex-case-clustering-state";
import { resolveManexImageUrl } from "@/lib/manex-images";
import {
  buildProductTraceabilityEvidence,
  createTraceabilityScope,
  type ProductTraceabilityEvidence,
} from "@/lib/manex-traceability-evidence";
import { queryPostgres } from "@/lib/postgres";
import {
  buildPassASystemPrompt,
  buildPassAUserPrompt,
  buildPassBSystemPrompt,
  buildPassBUserPrompt,
  buildStage1SystemPrompt,
  buildStage1UserPrompt,
  buildStage3SystemPrompt,
  buildStage3UserPrompt,
  MANEX_CASE_CLUSTERING_PROMPT_VERSION,
} from "@/prompts/manex-case-clustering";
import { sanitizeUnicodeForJson, stringifyUnicodeSafe } from "@/lib/json-unicode";
import { generateStructuredObjectWithRepair } from "@/lib/openai-resilience";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

const ARTICLE_DOSSIER_SCHEMA_VERSION = "manex.article_dossier.v4";
const PRODUCT_DOSSIER_SCHEMA_VERSION = "manex.product_dossier.v4";
const CASE_PROPOSAL_SCHEMA_VERSION = "manex.article_case_set.v2";
const GLOBAL_RECONCILIATION_SCHEMA_VERSION = "manex.global_case_inventory.v1";
const CASE_PIPELINE_REVIEW_SCHEMA_VERSION = "manex.case_pipeline_review.v1";
const CASE_PROMPT_VERSION = MANEX_CASE_CLUSTERING_PROMPT_VERSION;
const MAX_RELATION_ROWS = 800;
const SINGLE_PASS_PRODUCT_LIMIT = 18;
const MAX_PROMPT_CHARS = 120_000;
const CHUNKED_STAGE2_PROMPT_CHARS = 90_000;

const readPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const PRODUCT_CHUNK_SIZE = readPositiveInt(
  process.env.MANEX_STAGE2_PRODUCT_CHUNK_SIZE,
  5,
);
const STAGE2_SINGLE_PASS_PROMPT_CHAR_BUDGET = readPositiveInt(
  process.env.MANEX_STAGE2_SINGLE_PASS_PROMPT_CHAR_BUDGET,
  MAX_PROMPT_CHARS,
);
const STAGE2_CHUNK_PROMPT_CHAR_BUDGET = readPositiveInt(
  process.env.MANEX_STAGE2_CHUNK_PROMPT_CHAR_BUDGET,
  CHUNKED_STAGE2_PROMPT_CHARS,
);
const MINI_MODEL_CONCURRENCY_MULTIPLIER = /mini/i.test(env.OPENAI_MODEL) ? 1 : 0;
const STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY = readPositiveInt(
  process.env.MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY,
  7 + MINI_MODEL_CONCURRENCY_MULTIPLIER,
);
const STAGE2_CHUNK_PROPOSAL_CONCURRENCY = readPositiveInt(
  process.env.MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY,
  4,
);
const STAGE3_ARTICLE_LOAD_CONCURRENCY = readPositiveInt(
  process.env.MANEX_STAGE3_ARTICLE_LOAD_CONCURRENCY,
  8,
);
const ARTICLE_PIPELINE_CONCURRENCY = readPositiveInt(
  process.env.MANEX_ARTICLE_PIPELINE_CONCURRENCY,
  4,
);
const MODEL_CALL_MAX_ATTEMPTS = readPositiveInt(
  process.env.MANEX_MODEL_CALL_MAX_ATTEMPTS,
  6,
);
const MAX_CHUNK_REVIEW_CASE_DIGESTS = readPositiveInt(
  process.env.MANEX_STAGE2_REVIEW_CASE_DIGEST_LIMIT,
  120,
);
const MAX_CHUNK_REVIEW_STANDALONE_SIGNAL_DIGESTS = readPositiveInt(
  process.env.MANEX_STAGE2_REVIEW_SIGNAL_DIGEST_LIMIT,
  80,
);
const MAX_STAGE2_DIAGNOSTIC_TIMELINE_EVENTS = readPositiveInt(
  process.env.MANEX_STAGE2_DIAGNOSTIC_TIMELINE_LIMIT,
  5,
);
const MAX_STAGE2_RAW_SNIPPETS = readPositiveInt(
  process.env.MANEX_STAGE2_RAW_SNIPPET_LIMIT,
  2,
);
const MAX_STAGE2_REVIEW_EVIDENCE_PRODUCTS = readPositiveInt(
  process.env.MANEX_STAGE2_REVIEW_EVIDENCE_PRODUCT_LIMIT,
  10,
);
const MAX_STAGE2_REVIEW_RAW_EVENTS = readPositiveInt(
  process.env.MANEX_STAGE2_REVIEW_RAW_EVENT_LIMIT,
  6,
);
const STAGE1_MAX_OUTPUT_TOKENS = readPositiveInt(
  process.env.MANEX_STAGE1_MAX_OUTPUT_TOKENS,
  1800,
);
const STAGE2_DRAFT_MAX_OUTPUT_TOKENS = readPositiveInt(
  process.env.MANEX_STAGE2_DRAFT_MAX_OUTPUT_TOKENS,
  3200,
);
const STAGE2_REVIEW_MAX_OUTPUT_TOKENS = readPositiveInt(
  process.env.MANEX_STAGE2_REVIEW_MAX_OUTPUT_TOKENS,
  3600,
);
const STAGE2_REVIEW_PROMPT_CHAR_BUDGET = readPositiveInt(
  process.env.MANEX_STAGE2_REVIEW_PROMPT_CHAR_BUDGET,
  MAX_PROMPT_CHARS,
);
const STAGE3_MAX_OUTPUT_TOKENS = readPositiveInt(
  process.env.MANEX_STAGE3_MAX_OUTPUT_TOKENS,
  4800,
);
const STAGE1_REASONING_EFFORT =
  (process.env.MANEX_STAGE1_REASONING_EFFORT as "none" | "low" | "medium" | "high" | "xhigh" | undefined) ??
  "low";
const STAGE2_DRAFT_REASONING_EFFORT =
  (process.env.MANEX_STAGE2_DRAFT_REASONING_EFFORT as
    | "none"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | undefined) ?? "low";
const STAGE2_REVIEW_REASONING_EFFORT =
  (process.env.MANEX_STAGE2_REVIEW_REASONING_EFFORT as
    | "none"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | undefined) ?? "low";
const STAGE3_REASONING_EFFORT =
  (process.env.MANEX_STAGE3_REASONING_EFFORT as "none" | "low" | "medium" | "high" | "xhigh" | undefined) ??
  "low";
const STOPPED_PIPELINE_MESSAGE = "Pipeline stopped by user.";

const productThreadSynthesisSchema = z.object({
  productSummary: z.string().trim().min(20).max(900),
  timeline: z.array(z.string().trim().min(1).max(240)).max(10),
  evidenceFeatures: z.object({
    confirmedFailures: z.array(z.string().trim().min(1).max(180)).max(8),
    marginalSignals: z.array(z.string().trim().min(1).max(180)).max(8),
    traceHighlights: z.array(z.string().trim().min(1).max(180)).max(8),
    serviceSignals: z.array(z.string().trim().min(1).max(180)).max(8),
    contradictions: z.array(z.string().trim().min(1).max(180)).max(8),
  }),
  suspiciousPatterns: z.array(z.string().trim().min(1).max(220)).max(10),
  possibleNoiseFlags: z.array(z.string().trim().min(1).max(220)).max(10),
  openQuestions: z.array(z.string().trim().min(1).max(220)).max(10),
  strongestExplanation: z.string().trim().min(10).max(240),
  strongestCompetingExplanation: z.string().trim().min(10).max(240),
});

const proposalPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
const mechanismFamilySchema = z.enum([
  "supplier_batch_material",
  "process_window_calibration",
  "latent_design_escape",
  "operator_handling_order_cluster",
  "detector_hotspot_noise",
  "false_positive_noise",
  "near_limit_leading_indicator",
]);
const proposalCaseKindSchema = z.enum([
  "functional_failure",
  "process_drift",
  "supplier_batch",
  "design_weakness",
  "service_issue",
  "cosmetic_issue",
  "false_positive",
  "mixed",
  "other",
]);
const proposalSignalTypeSchema = z.enum([
  "defect",
  "field_claim",
  "bad_test",
  "marginal_test",
  "rework",
  "product_action",
]);

const proposalCaseSchema = z.object({
  proposalTempId: z.string().trim().min(1).max(48),
  family: mechanismFamilySchema,
  title: z.string().trim().min(8).max(160),
  caseKind: proposalCaseKindSchema,
  summary: z.string().trim().min(20).max(1500),
  suspectedCommonRootCause: z.string().trim().min(10).max(1500),
  suspectedRootCauseFamily: z.string().trim().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1),
  priority: proposalPrioritySchema,
  includedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(64),
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(400),
  sharedEvidence: z.array(z.string().trim().min(1).max(280)).min(1).max(12),
  conflictingEvidence: z.array(z.string().trim().min(1).max(280)).max(12),
  strongestEvidence: z.array(z.string().trim().min(1).max(280)).min(1).max(8),
  weakestEvidence: z.array(z.string().trim().min(1).max(280)).max(8),
  recommendedNextTraceChecks: z
    .array(z.string().trim().min(1).max(280))
    .min(1)
    .max(8),
  requiredEvidencePresent: z.array(z.string().trim().min(1).max(220)).min(1).max(8),
  requiredEvidenceMissing: z.array(z.string().trim().min(1).max(220)).max(8),
  dominantAnchor: z.string().trim().min(1).max(180),
  discriminativeScore: z.number().min(0).max(1),
  backgroundPrevalencePenalty: z.number().min(0).max(1),
  bestCompetingFamily: mechanismFamilySchema.nullable(),
  shouldValidate: z.boolean(),
  strongestCounterevidence: z.array(z.string().trim().min(1).max(220)).max(6),
  affectedProductCount: z.number().int().min(1).max(512),
  articleBackgroundCount: z.number().int().min(0).max(512),
  lift: z.number().min(0).max(100),
  weekConcentrationScore: z.number().min(0).max(1),
  orderConcentrationScore: z.number().min(0).max(1),
  reworkUserConcentrationScore: z.number().min(0).max(1),
  claimOnlyRatio: z.number().min(0).max(1),
  preClaimFactoryDefectRatio: z.number().min(0).max(1),
  detectedVsOccurrenceMismatchRate: z.number().min(0).max(1),
  sourceCandidateFamilyIds: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  signalTypesPresent: z.array(z.string().trim().min(1).max(40)).max(8),
  defectCodesPresent: z.array(z.string().trim().min(1).max(80)).max(24),
  testKeysPresent: z.array(z.string().trim().min(1).max(80)).max(24),
  reportedPartNumbers: z.array(z.string().trim().min(1).max(80)).max(24),
  bomFindNumbers: z.array(z.string().trim().min(1).max(80)).max(24),
  supplierBatches: z.array(z.string().trim().min(1).max(80)).max(24),
  sections: z.array(z.string().trim().min(1).max(80)).max(24),
  orders: z.array(z.string().trim().min(1).max(80)).max(24),
  memberRationales: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80),
        rationale: z.string().trim().min(1).max(280),
      }),
    )
    .max(64),
  excludedProductHints: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(1).max(280),
      }),
    )
    .max(32),
});

const proposalIncidentSchema = z.object({
  incidentTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(160),
  incidentKind: proposalCaseKindSchema,
  summary: z.string().trim().min(20).max(1200),
  suspectedPrimaryCause: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: proposalPrioritySchema,
  productId: z.string().trim().min(1).max(80),
  includedSignalIds: z.array(z.string().trim().min(1).max(80)).max(120),
  strongestEvidence: z.array(z.string().trim().min(1).max(280)).min(1).max(8),
  conflictingEvidence: z.array(z.string().trim().min(1).max(280)).max(8),
  strongestCounterevidence: z.array(z.string().trim().min(1).max(220)).max(6),
  bestCompetingFamily: mechanismFamilySchema.nullable(),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(280)).max(8),
  reasonNotCase: z.string().trim().min(1).max(280),
  signalTypesPresent: z.array(z.string().trim().min(1).max(40)).max(8),
  defectCodesPresent: z.array(z.string().trim().min(1).max(80)).max(24),
  testKeysPresent: z.array(z.string().trim().min(1).max(80)).max(24),
  reportedPartNumbers: z.array(z.string().trim().min(1).max(80)).max(24),
  bomFindNumbers: z.array(z.string().trim().min(1).max(80)).max(24),
  supplierBatches: z.array(z.string().trim().min(1).max(80)).max(24),
  sections: z.array(z.string().trim().min(1).max(80)).max(24),
  orders: z.array(z.string().trim().min(1).max(80)).max(24),
});

const proposalWatchlistSchema = z.object({
  watchlistTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(160),
  watchlistKind: z.enum([
    "weak_recurring_pattern",
    "marginal_screening",
    "service_documentation",
    "cosmetic_handling",
    "detection_hotspot",
    "seasonal_volume",
    "other",
  ]),
  summary: z.string().trim().min(20).max(1200),
  rationale: z.string().trim().min(10).max(1200),
  confidence: z.number().min(0).max(1),
  priority: proposalPrioritySchema,
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).min(1).max(64),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(240),
  strongestEvidence: z.array(z.string().trim().min(1).max(280)).min(1).max(8),
  strongestCounterevidence: z.array(z.string().trim().min(1).max(220)).max(6),
  bestCompetingFamily: mechanismFamilySchema.nullable(),
  confounders: z.array(z.string().trim().min(1).max(280)).max(8),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(280)).max(8),
});

const proposalNoiseSchema = z.object({
  noiseTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(160),
  noiseKind: z.enum([
    "false_positive",
    "marginal_only",
    "detection_bias",
    "service_documentation",
    "cosmetic_only",
    "low_volume",
    "mixed",
    "other",
  ]),
  summary: z.string().trim().min(10).max(900),
  dismissalReason: z.string().trim().min(10).max(900),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).max(64),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(240),
  strongestEvidence: z.array(z.string().trim().min(1).max(280)).max(8),
  strongestCounterevidence: z.array(z.string().trim().min(1).max(220)).max(6),
  bestCompetingFamily: mechanismFamilySchema.nullable(),
});

const clusteringProposalSchema = z.object({
  contractVersion: z.literal(CASE_PROPOSAL_SCHEMA_VERSION),
  reviewSummary: z.string().trim().min(1).max(1500),
  cases: z.array(proposalCaseSchema).max(20),
  incidents: z.array(proposalIncidentSchema).max(40),
  watchlists: z.array(proposalWatchlistSchema).max(24),
  noise: z.array(proposalNoiseSchema).max(24),
  unassignedProducts: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(1).max(280),
      }),
    )
    .max(80),
  standaloneSignals: z
    .array(
      z.object({
        signalId: z.string().trim().min(1).max(80),
        productId: z.string().trim().min(1).max(80),
        signalType: proposalSignalTypeSchema,
        reason: z.string().trim().min(1).max(280),
      }),
    )
    .max(240),
  ambiguousLinks: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(80),
        relatedProposalTempIds: z
          .array(z.string().trim().min(1).max(48))
          .min(2)
          .max(6),
        reason: z.string().trim().min(1).max(280),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(80),
  globalObservations: z.array(z.string().trim().min(1).max(280)).max(12),
});

const globalInventoryCaseSchema = z.object({
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
  linkedCandidateIds: z.array(z.string().trim().min(1).max(80)).max(48),
  linkedProductIds: z.array(z.string().trim().min(1).max(80)).max(96),
  linkedSignalIds: z.array(z.string().trim().min(1).max(80)).max(240),
  strongestEvidence: z.array(z.string().trim().min(1).max(220)).max(10),
  conflictingEvidence: z.array(z.string().trim().min(1).max(220)).max(10),
  recommendedNextTraceChecks: z.array(z.string().trim().min(1).max(220)).max(10),
  confidence: z.number().min(0).max(1),
  priority: z.enum(["low", "medium", "high", "critical"]),
});

const globalReconciliationSchema = z.object({
  contractVersion: z.literal(GLOBAL_RECONCILIATION_SCHEMA_VERSION),
  inventorySummary: z.string().trim().min(1).max(1500),
  validatedCases: z.array(globalInventoryCaseSchema).max(24),
  watchlists: z.array(globalInventoryCaseSchema).max(24),
  noiseBuckets: z.array(globalInventoryCaseSchema).max(24),
  rejectedCases: z.array(globalInventoryCaseSchema).max(24),
  caseMergeLog: z.array(z.string().trim().min(1).max(280)).max(20),
  confidenceNotes: z.array(z.string().trim().min(1).max(280)).max(12),
});

type ArticleRow = {
  article_id: string;
  name: string | null;
};

type ProductRow = {
  product_id: string;
  article_id: string;
  order_id: string | null;
  build_ts: string | null;
};

type InstalledPartBatchRow = {
  product_id: string;
  install_id: string;
  installed_ts: string | null;
  installed_section_id: string | null;
  position_code: string | null;
  install_user_id: string | null;
  bom_node_id: string;
  find_number: string | null;
  node_type: string | null;
  parent_find_number: string | null;
  parent_node_type: string | null;
  part_number: string;
  part_title: string | null;
  commodity: string | null;
  drawing_number: string | null;
  part_id: string;
  serial_number: string | null;
  quality_status: string | null;
  manufacturer_name: string | null;
  batch_id: string | null;
  batch_number: string | null;
  supplier_name: string | null;
  supplier_id: string | null;
  batch_received_date: string | null;
};

type ActionBatchRow = {
  action_id: string;
  product_id: string;
  ts: string;
  action_type: string;
  status: string;
  user_id: string | null;
  section_id: string | null;
  comments: string | null;
  defect_id: string | null;
};

type ReworkBatchRow = {
  rework_id: string;
  defect_id: string;
  product_id: string;
  ts: string;
  rework_section_id: string | null;
  action_text: string | null;
  reported_part_number: string | null;
  user_id: string | null;
  image_url: string | null;
  time_minutes: number | string | null;
  cost: number | string | null;
};

type ProductSignalTimelineItem = {
  signalId: string;
  signalType:
    | "defect"
    | "field_claim"
    | "bad_test"
    | "marginal_test"
    | "rework"
    | "product_action";
  occurredAt: string;
  severity: string | null;
  headline: string;
  notePreview: string;
  section: string | null;
  reportedPartNumber: string | null;
  sourceContext: string | null;
};

type ProductTraceabilitySnapshot = {
  installedPartCount: number;
  uniqueBatchCount: number;
  uniqueSupplierCount: number;
  uniquePartCount: number;
  assemblies: Array<{
    assemblyLabel: string;
    partCount: number;
    uniqueBatchCount: number;
    uniqueSupplierCount: number;
  }>;
  graphSummary: {
    nodeCount: number;
    edgeCount: number;
    dominantBatches: string[];
    dominantSuppliers: string[];
  };
};

type ValueCountHint = {
  value: string;
  count: number;
};

type ProductMechanismEvidence = {
  traceabilityEvidence: Pick<
    ProductTraceabilityEvidence,
    | "dominantInstalledParts"
    | "dominantBomPositions"
    | "dominantSupplierBatches"
    | "dominantSuppliers"
    | "batchConcentrationHints"
    | "productAnchorCandidates"
    | "partBatchAnchors"
    | "traceabilityNeighborhood"
    | "anchorSpecificity"
    | "cooccurringAnchorBundles"
    | "blastRadiusHints"
    | "blastRadiusSuspects"
  > & {
    dominantTraceAnchors: Array<{
      anchorType:
        | "supplier_batch"
        | "part_number"
        | "bom_position"
        | "part_batch"
        | "supplier";
      anchorValue: string;
      count: number;
      ratio: number;
      relatedProductCount: number;
      concentrationHint: string | null;
    }>;
    traceabilityConcentrationHints: string[];
  };
  temporalProcessEvidence: {
    buildWeek: string | null;
    firstFactorySignalWeek: string | null;
    lastFactorySignalWeek: string | null;
    defectWeeks: string[];
    testWeeks: string[];
    dominantOccurrenceSections: ValueCountHint[];
    dominantDetectedSections: ValueCountHint[];
    dominantTestResults: Array<{
      result: "FAIL" | "MARGINAL";
      count: number;
      testKeys: string[];
    }>;
    occurrenceDetectedMismatch: {
      present: boolean;
      mismatchCount: number;
      examples: string[];
    };
    temporalBurstHints: string[];
    postWindowQuietHints: string[];
    temporalContainmentHints: string[];
    marginalVsFailHints: string[];
  };
  fieldLeakEvidence: {
    claimOnlyThread: boolean;
    hasPriorFactoryDefect: boolean;
    buildToClaimDays: number[];
    claimLagBucket: "none" | "same_week" | "short" | "medium" | "long";
    claimLagStats: {
      count: number;
      minDays: number | null;
      medianDays: number | null;
      maxDays: number | null;
    };
    dominantClaimReportedParts: ValueCountHint[];
    dominantClaimBomPositions: ValueCountHint[];
    latentFailureHints: string[];
  };
  operatorHandlingEvidence: {
    orderId: string | null;
    dominantReworkUsers: Array<{
      userId: string;
      count: number;
    }>;
    orderClusterHints: string[];
    userConcentrationHints: string[];
    cosmeticOnlySignals: boolean;
    lowSeverityOnly: boolean;
    fieldImpactPresent: boolean;
    handlingPatternHints: string[];
  };
  confounderEvidence: {
    falsePositiveMarkers: string[];
    marginalOnlySignals: boolean;
    detectionBiasRisk: string[];
    lowVolumePeriodRisk: string[];
    mixedServiceDocumentationSignals: string[];
    nearLimitTestSignals: string[];
  };
};

export type ProductThreadSynthesis = z.infer<typeof productThreadSynthesisSchema>;
type MechanismFamily = z.infer<typeof mechanismFamilySchema>;

type CandidateFamilyDisposition = "case" | "watchlist" | "noise" | "incident";

type ProductHypothesisSignals = {
  candidateFamilyVotes: Array<{
    family: MechanismFamily;
    score: number;
    reasons: string[];
  }>;
  negativeEvidence: string[];
  discriminativeAnchors: string[];
  broadContextAnchors: string[];
  claimLagDays: number[];
  hasFactoryDefectBeforeClaim: boolean;
  sameOrderClusterHint: boolean;
  sameReworkUserHint: boolean;
  sameOccurrenceWindowHint: boolean;
  sameBatchSamePartHint: boolean;
  detectorHotspotOnly: boolean;
  falsePositiveFlag: boolean;
  claimOnlyThread: boolean;
  occurrenceDetectedMismatch: boolean;
};

type Stage2CandidateFamily = {
  candidateFamilyId: string;
  family: MechanismFamily;
  title: string;
  shouldReviewAs: CandidateFamilyDisposition;
  dominantAnchor: string;
  supportingProductIds: string[];
  supportingSignalIds: string[];
  signalTypesPresent: string[];
  discriminativeAnchors: string[];
  broadContextAnchors: string[];
  requiredEvidencePresent: string[];
  requiredEvidenceMissing: string[];
  strongestEvidence: string[];
  strongestCounterevidence: string[];
  bestCompetingFamilies: MechanismFamily[];
  statistics: {
    affectedProductCount: number;
    articleBackgroundCount: number;
    lift: number;
    backgroundPrevalencePenalty: number;
    weekConcentrationScore: number;
    orderConcentrationScore: number;
    reworkUserConcentrationScore: number;
    claimOnlyRatio: number;
    preClaimFactoryDefectRatio: number;
    detectedVsOccurrenceMismatchRate: number;
  };
};

export type ClusteredProductDossier = {
  contractVersion: typeof PRODUCT_DOSSIER_SCHEMA_VERSION;
  productId: string;
  articleId: string;
  articleName: string | null;
  buildTs: string | null;
  orderId: string | null;
  sourceCounts: {
    defects: number;
    claims: number;
    badTests: number;
    marginalTests: number;
    rework: number;
    actions: number;
    installedParts: number;
  };
  signals: ProductSignalTimelineItem[];
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  tests: ManexTestSignal[];
  rework: ManexReworkRecord[];
  actions: ManexWorkflowAction[];
  installedParts: ManexInstalledPart[];
  weeklyQualitySnippets: ManexWeeklyQualitySummary[];
  evidenceFrames: Array<{
    id: string;
    sourceType: "defect" | "field_claim";
    sourceId: string;
    imageUrl: string;
    title: string;
    caption: string;
  }>;
  stage1Synthesis: ProductThreadSynthesis;
  traceabilitySnapshot: ProductTraceabilitySnapshot;
  mechanismEvidence: ProductMechanismEvidence;
  hypothesisSignals?: ProductHypothesisSignals;
  summaryFeatures: {
    signalTypesPresent: string[];
    defectCodesPresent: string[];
    testKeysMarginalFail: string[];
    reportedPartNumbers: string[];
    bomFindNumbers: string[];
    supplierBatches: string[];
    sectionsSeen: string[];
    ordersSeen: string[];
    daysFromBuildToClaim: number[];
    falsePositiveMarkers: string[];
    mappedDefectPresent: boolean;
    fieldClaimWithoutFactoryDefect: boolean;
    reworkPresent: boolean;
    actionPresent: boolean;
  };
  existingSurfaceContext: {
    dossierSnapshot: {
      defectCount: number;
      claimCount: number;
      installedPartCount: number;
      uniqueBatchCount: number;
      uniqueSupplierCount: number;
      openActionCount: number;
    };
    traceviewSnapshot: ProductTraceabilitySnapshot;
  };
};

export type ClusteredArticleDossier = {
  contractVersion: typeof ARTICLE_DOSSIER_SCHEMA_VERSION;
  generatedAt: string;
  article: {
    articleId: string;
    articleName: string | null;
    productCount: number;
    signaledProductCount: number;
    totalSignals: number;
    timeWindow: {
      firstSeenAt: string | null;
      lastSeenAt: string | null;
    };
  };
  articleSummary: {
    sourceCounts: {
      defects: number;
      claims: number;
      badTests: number;
      marginalTests: number;
      rework: number;
      actions: number;
      installedParts: number;
    };
    topDefectCodes: Array<{ value: string; count: number; productIds: string[] }>;
    topReportedParts: Array<{ value: string; count: number; productIds: string[] }>;
    topBomPositions: Array<{ value: string; count: number; productIds: string[] }>;
    topSections: Array<{ value: string; count: number; productIds: string[] }>;
    topSupplierBatches: Array<{ value: string; count: number; productIds: string[] }>;
    topProductionOrders: Array<{ value: string; count: number; productIds: string[] }>;
    fieldClaimOnlyPatterns: Array<{
      label: string;
      count: number;
      productIds: string[];
    }>;
    testHotspots: Array<{
      label: string;
      count: number;
      productIds: string[];
    }>;
  };
  crossProductSummaries: {
    sharedSupplierBatches: Array<{
      batchRef: string;
      supplierNames: string[];
      productIds: string[];
      partNumbers: string[];
      findNumbers: string[];
      count: number;
    }>;
    sharedReportedPartNumbers: Array<{
      partNumber: string;
      productIds: string[];
      signalIds: string[];
      count: number;
    }>;
    sharedBomFindNumbers: Array<{
      findNumber: string;
      productIds: string[];
      partNumbers: string[];
      count: number;
    }>;
    similarClaimThemes: Array<{
      keyword: string;
      productIds: string[];
      claimIds: string[];
      count: number;
    }>;
    sharedOrders: Array<{ orderId: string; productIds: string[]; count: number }>;
    sharedReworkUsers: Array<{ userId: string; productIds: string[]; count: number }>;
    sharedOccurrenceSections: Array<{ section: string; productIds: string[]; count: number }>;
    sharedSections: Array<{ section: string; productIds: string[]; count: number }>;
    sharedTestHotspots: Array<{
      testKey: string;
      productIds: string[];
      signalIds: string[];
      count: number;
    }>;
  };
  candidateFamilies?: Stage2CandidateFamily[];
  productThreads: ClusteredProductDossier[];
  weeklyQualitySummaries: ManexWeeklyQualitySummary[];
  rawEvidenceAppendix: {
    defects: ManexDefect[];
    claims: ManexFieldClaim[];
    tests: ManexTestSignal[];
    installs: ManexInstalledPart[];
    rework: ManexReworkRecord[];
    actions: ManexWorkflowAction[];
  };
};

export type ArticleCaseboardReadModel = {
  articleId: string;
  articleName: string | null;
  dashboardCard: TeamArticleClusterCard | null;
  dossier: ClusteredArticleDossier | null;
  latestRun: TeamCaseRunSummary | null;
  proposedCases: TeamCaseCandidateRecord[];
  incidents: z.infer<typeof proposalIncidentSchema>[];
  watchlists: z.infer<typeof proposalWatchlistSchema>[];
  noise: z.infer<typeof proposalNoiseSchema>[];
  unassignedProducts: Array<{
    productId: string;
    reason: string;
  }>;
  standaloneSignals: Array<{
    signalId: string;
    productId: string;
    signalType: ProductSignalTimelineItem["signalType"];
    reason: string;
  }>;
  ambiguousLinks: Array<{
    productId: string;
    relatedProposalTempIds: string[];
    reason: string;
    confidence: number;
  }>;
  globalObservations: string[];
  globalInventory: GlobalReconciliationOutput | null;
};

type ProposalOutput = z.infer<typeof clusteringProposalSchema>;
type ProposalStandaloneSignal = ProposalOutput["standaloneSignals"][number];
type ProposalIncident = ProposalOutput["incidents"][number];
type ProposalWatchlist = ProposalOutput["watchlists"][number];
type ProposalNoise = ProposalOutput["noise"][number];
export type GlobalInventoryItem = z.infer<typeof globalInventoryCaseSchema>;
export type GlobalReconciliationOutput = z.infer<typeof globalReconciliationSchema>;

export type ProposedCasesDashboardReadModel = {
  articles: TeamArticleClusterCard[];
  activeRuns: TeamCaseRunSummary[];
  articleQueues: Array<{
    articleId: string;
    articleName: string | null;
    proposedCaseCount: number;
    affectedProductCount: number;
    highestPriority: "low" | "medium" | "high" | "critical" | null;
    topConfidence: number | null;
    summary: string | null;
    leadingCaseTitle: string | null;
    latestRun: TeamCaseRunSummary | null;
  }>;
  latestGlobalRun: TeamCaseRunSummary | null;
  globalInventory: GlobalReconciliationOutput | null;
};

type CasePipelineReviewPayload = {
  contractVersion: typeof CASE_PIPELINE_REVIEW_SCHEMA_VERSION;
  stage2: ProposalOutput;
  stage3: GlobalReconciliationOutput | null;
};

type ModelCallStageName =
  | "stage1_product_synthesis"
  | "stage2_draft"
  | "stage2_review"
  | "stage3_reconciliation";

type PipelineExecutionOptions = {
  abortSignal?: AbortSignal;
};

const CLAIM_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "after",
  "under",
  "from",
  "into",
  "unit",
  "when",
  "showed",
  "shows",
  "during",
  "were",
  "was",
  "have",
  "has",
  "this",
  "there",
  "about",
  "without",
  "over",
  "only",
  "very",
  "still",
  "late",
  "field",
  "claim",
  "claims",
  "issue",
  "product",
  "products",
  "build",
  "built",
]);

const FALSE_POSITIVE_PATTERN =
  /false positive|false alarm|no defect found|screening artifact|inspection-only/i;
const SERVICE_DOCUMENTATION_PATTERN =
  /service|manual|documentation|firmware|software|configuration|config|instruction|update/i;
const COSMETIC_PATTERN =
  /cosmetic|scratch|label|surface|appearance|housing|debris|dent|scuff|bent/i;
const LOW_SEVERITY_SET = new Set(["low", "minor"]);

const normalizeText = (value: string | null | undefined) => {
  const text = value ? sanitizeUnicodeForJson(value).replace(/\s+/g, " ").trim() : "";
  return text ? text : "";
};

const normalizeNullableText = (value: string | null | undefined) => {
  const text = normalizeText(value);
  return text || null;
};

const uniqueValues = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeNullableText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const safeIso = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

const trimPreview = (value: string | null | undefined, max = 220) => {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const estimateTokensFromChars = (chars: number) => Math.ceil(chars / 4);

function summarizeTopLevelPayloadSections(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
    const serialized = stringifyUnicodeSafe(value);
    const chars = serialized.length;

    return {
      key,
      chars,
      approxTokens: estimateTokensFromChars(chars),
      itemCount: Array.isArray(value)
        ? value.length
        : value && typeof value === "object"
          ? Object.keys(value as Record<string, unknown>).length
          : null,
    };
  });
}

function logModelCallMetrics(input: {
  stageName: ModelCallStageName;
  articleId: string;
  model: string;
  system: string;
  prompt: string;
  payload: unknown;
  chunkId?: string | null;
  selectedProductCount?: number | null;
  maxOutputTokens?: number | null;
}) {
  const systemChars = input.system.length;
  const promptChars = input.prompt.length;
  const inputChars = systemChars + promptChars;

  console.info(
    `[manex-clustering:model-call] ${stringifyUnicodeSafe({
      stageName: input.stageName,
      articleId: input.articleId,
      model: input.model,
      chunkId: input.chunkId ?? null,
      selectedProductCount: input.selectedProductCount ?? null,
      systemChars,
      promptChars,
      totalInputChars: inputChars,
      approxInputTokens: estimateTokensFromChars(inputChars),
      maxOutputTokens: input.maxOutputTokens ?? null,
      payloadSections: summarizeTopLevelPayloadSections(input.payload),
    })}`,
  );
}

const byOccurredAtAsc = <T extends { occurredAt: string }>(left: T, right: T) =>
  left.occurredAt.localeCompare(right.occurredAt);

const bucketCounts = <T,>(
  items: T[],
  keyFn: (item: T) => string | null | undefined,
  productIdFn?: (item: T) => string | null | undefined,
  signalIdFn?: (item: T) => string | null | undefined,
) => {
  const buckets = new Map<
    string,
    { value: string; count: number; productIds: Set<string>; signalIds: Set<string> }
  >();

  for (const item of items) {
    const value = normalizeNullableText(keyFn(item));

    if (!value) {
      continue;
    }

    const current =
      buckets.get(value) ??
      {
        value,
        count: 0,
        productIds: new Set<string>(),
        signalIds: new Set<string>(),
      };

    current.count += 1;

    const productId = productIdFn ? normalizeNullableText(productIdFn(item)) : null;
    const signalId = signalIdFn ? normalizeNullableText(signalIdFn(item)) : null;

    if (productId) {
      current.productIds.add(productId);
    }

    if (signalId) {
      current.signalIds.add(signalId);
    }

    buckets.set(value, current);
  }

  return [...buckets.values()]
    .sort(
      (left, right) =>
        right.count - left.count || left.value.localeCompare(right.value),
    )
    .map((entry) => ({
      value: entry.value,
      count: entry.count,
      productIds: [...entry.productIds].sort((left, right) =>
        left.localeCompare(right),
      ),
      signalIds: [...entry.signalIds].sort((left, right) =>
        left.localeCompare(right),
      ),
    }));
};

const topEntries = <T extends { count: number }>(items: T[], limit = 8) =>
  items.slice(0, limit);

const groupBy = <T,>(items: T[], keyFn: (item: T) => string) =>
  items.reduce(
    (map, item) => {
      const key = keyFn(item);
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
      return map;
    },
    new Map<string, T[]>(),
  );

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
  options?: PipelineExecutionOptions,
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      throwIfPipelineAborted(options?.abortSignal);
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
      worker(),
    ),
  );

  return results;
}

function createPipelineStopError(reason = STOPPED_PIPELINE_MESSAGE) {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

function isPipelineStopError(error: unknown) {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && /stopped by user|aborted/i.test(error.message))
  );
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

function extractClaimKeywords(text: string) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !CLAIM_STOP_WORDS.has(token));

  return uniqueValues(tokens);
}

function buildSignalTimeline(input: {
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  tests: ManexTestSignal[];
  rework: ManexReworkRecord[];
  actions: ManexWorkflowAction[];
}) {
  const timeline: ProductSignalTimelineItem[] = [
    ...input.defects.map((item) => ({
      signalId: item.id,
      signalType: "defect" as const,
      occurredAt: item.occurredAt,
      severity: item.severity,
      headline: `${item.code} defect`,
      notePreview: trimPreview(item.notes || item.reportedPartTitle || item.reportedPartNumber),
      section: item.detectedSectionName ?? item.occurrenceSectionName ?? null,
      reportedPartNumber: item.reportedPartNumber,
      sourceContext: item.detectedTestName ?? item.sourceType ?? null,
    })),
    ...input.claims.map((item) => ({
      signalId: item.id,
      signalType: "field_claim" as const,
      occurredAt: item.claimedAt,
      severity: item.mappedDefectSeverity,
      headline: item.mappedDefectCode
        ? `${item.mappedDefectCode} field claim`
        : "Field claim",
      notePreview: trimPreview(item.complaintText || item.notes),
      section: item.detectedSectionName,
      reportedPartNumber: item.reportedPartNumber,
      sourceContext: item.market,
    })),
    ...input.tests.map((item) => ({
      signalId: item.id,
      signalType:
        item.overallResult === "FAIL"
          ? ("bad_test" as const)
          : ("marginal_test" as const),
      occurredAt: item.occurredAt,
      severity: item.severity,
      headline: `${item.testKey} ${item.overallResult.toLowerCase()}`,
      notePreview: trimPreview(item.notes || item.testValue || item.testKey),
      section: item.sectionName,
      reportedPartNumber: null,
      sourceContext: item.unit,
    })),
    ...input.rework.map((item) => ({
      signalId: item.id,
      signalType: "rework" as const,
      occurredAt: item.recordedAt,
      severity: null,
      headline: "Rework recorded",
      notePreview: trimPreview(item.actionText),
      section: item.sectionId,
      reportedPartNumber: item.reportedPartNumber,
      sourceContext: item.userId,
    })),
    ...input.actions.map((item) => ({
      signalId: item.id,
      signalType: "product_action" as const,
      occurredAt: item.recordedAt,
      severity: null,
      headline: `${item.actionType} action`,
      notePreview: trimPreview(item.comments),
      section: item.sectionId,
      reportedPartNumber: null,
      sourceContext: item.status,
    })),
  ];

  return timeline.sort(byOccurredAtAsc);
}

function buildTraceabilitySnapshot(
  traceabilityEvidence: ProductTraceabilityEvidence,
): ProductTraceabilitySnapshot {
  return {
    installedPartCount: traceabilityEvidence.installedPartCount,
    uniqueBatchCount: traceabilityEvidence.uniqueBatchCount,
    uniqueSupplierCount: traceabilityEvidence.uniqueSupplierCount,
    uniquePartCount: traceabilityEvidence.uniquePartCount,
    assemblies: traceabilityEvidence.assemblies,
    graphSummary: traceabilityEvidence.graphSummary,
  };
}

function buildEvidenceFrames(
  defects: ManexDefect[],
  claims: ManexFieldClaim[],
) {
  return [
    ...defects
      .filter((item) => item.imageUrl)
      .map((item) => ({
        id: `defect:${item.id}`,
        sourceType: "defect" as const,
        sourceId: item.id,
        imageUrl: item.imageUrl!,
        title: item.code,
        caption: trimPreview(
          [item.reportedPartTitle ?? item.reportedPartNumber, item.severity]
            .filter(Boolean)
            .join(" · "),
          140,
        ),
      })),
    ...claims
      .filter((item) => item.imageUrl)
      .map((item) => ({
        id: `claim:${item.id}`,
        sourceType: "field_claim" as const,
        sourceId: item.id,
        imageUrl: item.imageUrl!,
        title: item.mappedDefectCode ?? "Field claim",
        caption: trimPreview(
          [item.reportedPartTitle ?? item.reportedPartNumber, item.market]
            .filter(Boolean)
            .join(" · "),
          140,
        ),
      })),
  ].slice(0, 6);
}

function buildSummaryFeatures(input: {
  product: ProductRow;
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  tests: ManexTestSignal[];
  rework: ManexReworkRecord[];
  actions: ManexWorkflowAction[];
  installedParts: ManexInstalledPart[];
  signalTimeline: ProductSignalTimelineItem[];
}) {
  const falsePositiveMarkers = uniqueValues(
    [
      ...input.defects.map((item) => item.notes),
      ...input.claims.map((item) => item.complaintText),
      ...input.tests.map((item) => item.notes),
    ]
      .filter((value): value is string => Boolean(value))
      .filter((value) =>
        /false positive|false alarm|no defect found|cosmetic only/i.test(value),
      ),
  );

  return {
    signalTypesPresent: uniqueValues(input.signalTimeline.map((item) => item.signalType)),
    defectCodesPresent: uniqueValues(input.defects.map((item) => item.code)),
    testKeysMarginalFail: uniqueValues(input.tests.map((item) => item.testKey)),
    reportedPartNumbers: uniqueValues([
      ...input.defects.map((item) => item.reportedPartNumber),
      ...input.claims.map((item) => item.reportedPartNumber),
      ...input.rework.map((item) => item.reportedPartNumber),
    ]),
    bomFindNumbers: uniqueValues(
      input.installedParts.map((item) => item.findNumber ?? item.positionCode),
    ),
    supplierBatches: uniqueValues(
      input.installedParts.map((item) => item.batchId ?? item.batchNumber),
    ),
    sectionsSeen: uniqueValues([
      ...input.defects.map(
        (item) => item.detectedSectionName ?? item.occurrenceSectionName,
      ),
      ...input.claims.map((item) => item.detectedSectionName),
      ...input.tests.map((item) => item.sectionName),
      ...input.rework.map((item) => item.sectionId),
      ...input.actions.map((item) => item.sectionId),
    ]),
    ordersSeen: uniqueValues([input.product.order_id]),
    daysFromBuildToClaim: input.claims
      .map((item) => item.daysFromBuild)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right),
    falsePositiveMarkers,
    mappedDefectPresent: input.claims.some((item) => Boolean(item.mappedDefectId)),
    fieldClaimWithoutFactoryDefect:
      input.claims.length > 0 && input.defects.length === 0,
    reworkPresent: input.rework.length > 0,
    actionPresent: input.actions.length > 0,
  };
}

function buildValueCountHints(
  values: Array<string | null | undefined>,
  limit = 6,
): ValueCountHint[] {
  return topEntries(
    bucketCounts(
      values
        .map((value) => normalizeNullableText(value))
        .filter((value): value is string => Boolean(value))
        .map((value, index) => ({
          value,
          productId: `local-${index}`,
        })),
      (item) => item.value,
      (item) => item.productId,
    ).map((entry) => ({
      value: entry.value,
      count: entry.count,
    })),
    limit,
  );
}

function normalizeWeekStart(value: string | null | undefined) {
  return value
    ? startOfWeek(new Date(value), { weekStartsOn: 1 }).toISOString()
    : null;
}

function toSignalWeekSet(values: Array<string | null | undefined>) {
  return uniqueValues(values.map((value) => normalizeWeekStart(value)));
}

function getMedian(values: number[]) {
  if (!values.length) {
    return null;
  }

  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[midpoint]
    : (values[midpoint - 1] + values[midpoint]) / 2;
}

function classifyClaimLag(days: number[]) {
  const median = getMedian(days);

  if (median === null) {
    return "none" as const;
  }

  if (median <= 7) {
    return "same_week" as const;
  }

  if (median <= 28) {
    return "short" as const;
  }

  if (median <= 56) {
    return "medium" as const;
  }

  return "long" as const;
}

function severityLooksLow(severity: string | null | undefined) {
  return severity ? LOW_SEVERITY_SET.has(severity.toLowerCase()) : false;
}

function buildMechanismEvidence(input: {
  product: ProductRow;
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  tests: ManexTestSignal[];
  rework: ManexReworkRecord[];
  actions: ManexWorkflowAction[];
  installedParts: ManexInstalledPart[];
  weeklyQualitySnippets: ManexWeeklyQualitySummary[];
  summaryFeatures: ClusteredProductDossier["summaryFeatures"];
  traceabilityEvidence: ProductTraceabilityEvidence;
}): ProductMechanismEvidence {
  const buildWeek = normalizeWeekStart(input.product.build_ts);
  const defectWeeks = uniqueValues(input.defects.map((item) => item.defectWeekStart));
  const testWeeks = toSignalWeekSet(input.tests.map((item) => item.occurredAt));
  const dominantOccurrenceSections = buildValueCountHints(
    input.defects.map((item) => item.occurrenceSectionName),
    4,
  );
  const dominantDetectedSections = buildValueCountHints(
    [
      ...input.defects.map((item) => item.detectedSectionName),
      ...input.tests.map((item) => item.sectionName),
    ],
    4,
  );
  const occurrenceDetectedMismatches = input.defects
    .filter(
      (item) =>
        item.occurrenceSectionName &&
        item.detectedSectionName &&
        item.occurrenceSectionName !== item.detectedSectionName,
    )
    .map(
      (item) =>
        `${item.code}: ${item.occurrenceSectionName} -> ${item.detectedSectionName}`,
    );
  const weekCounts = bucketCounts(
    [
      ...input.defects.map((item) => ({
        weekStart: item.defectWeekStart,
      })),
      ...input.tests.map((item) => ({
        weekStart: normalizeWeekStart(item.occurredAt),
      })),
      ...input.rework.map((item) => ({
        weekStart: normalizeWeekStart(item.recordedAt),
      })),
      ...input.actions.map((item) => ({
        weekStart: normalizeWeekStart(item.recordedAt),
      })),
    ],
    (item) => item.weekStart,
  );
  const temporalBurstHints = weekCounts
    .filter((entry) => entry.count >= 2)
    .slice(0, 4)
    .map((entry) => `${entry.value}: ${entry.count} factory-side signals clustered.`);
  const allFactorySignalWeeks = uniqueValues(
    weekCounts.map((entry) => entry.value).filter((value): value is string => Boolean(value)),
  );
  const firstFactorySignalWeek = allFactorySignalWeeks[0] ?? null;
  const latestFactorySignalWeek = allFactorySignalWeeks.at(-1) ?? null;
  const failTests = input.tests.filter((item) => item.overallResult === "FAIL");
  const marginalTests = input.tests.filter((item) => item.overallResult === "MARGINAL");
  const dominantTestResults = [
    failTests.length > 0
      ? {
          result: "FAIL" as const,
          count: failTests.length,
          testKeys: uniqueValues(failTests.map((item) => item.testKey)).slice(0, 6),
        }
      : null,
    marginalTests.length > 0
      ? {
          result: "MARGINAL" as const,
          count: marginalTests.length,
          testKeys: uniqueValues(marginalTests.map((item) => item.testKey)).slice(0, 6),
        }
      : null,
  ].filter(
    (
      value,
    ): value is {
      result: "FAIL" | "MARGINAL";
      count: number;
      testKeys: string[];
    } => Boolean(value),
  );
  const articleWeeks = uniqueValues(input.weeklyQualitySnippets.map((item) => item.weekStart));
  const laterArticleWeeks = latestFactorySignalWeek
    ? articleWeeks.filter((week) => week > latestFactorySignalWeek)
    : [];
  const postWindowQuietHints =
    laterArticleWeeks.length >= 2
      ? [
          `Factory-side signals stop after ${latestFactorySignalWeek} while the article continues for ${laterArticleWeeks.length} later weeks.`,
        ]
      : [];
  const temporalContainmentHints = [
    firstFactorySignalWeek && latestFactorySignalWeek
      ? `Factory evidence spans ${firstFactorySignalWeek} through ${latestFactorySignalWeek}.`
      : null,
    buildWeek && firstFactorySignalWeek && buildWeek === firstFactorySignalWeek
      ? "Factory-side evidence starts in the build week."
      : null,
    dominantOccurrenceSections[0] && dominantDetectedSections[0]
      ? `Occurrence is led by ${dominantOccurrenceSections[0].value}, while detection is led by ${dominantDetectedSections[0].value}.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const marginalVsFailHints = [
    failTests.length > 0 && marginalTests.length > 0
      ? `Thread mixes ${failTests.length} FAIL and ${marginalTests.length} MARGINAL test signals.`
      : null,
    failTests.length === 0 && marginalTests.length > 0
      ? `Only MARGINAL test signals are present (${marginalTests.length}); no FAIL test is recorded.`
      : null,
    failTests.length > 0 && marginalTests.length === 0
      ? `Test evidence is FAIL-driven (${failTests.length} FAIL rows) rather than marginal-only.`
      : null,
  ].filter((value): value is string => Boolean(value));

  const claimOnlyThread = input.claims.length > 0 && input.defects.length === 0;
  const claimLagBucket = classifyClaimLag(input.summaryFeatures.daysFromBuildToClaim);
  const dominantClaimReportedParts = buildValueCountHints(
    input.claims.map((item) => item.reportedPartNumber),
    4,
  );
  const dominantClaimBomPositions = buildValueCountHints(
    input.claims.flatMap((claim) =>
      input.installedParts
        .filter((item) => item.partNumber === claim.reportedPartNumber)
        .map((item) => item.findNumber ?? item.positionCode),
    ),
    4,
  );
  const latentFailureHints = [
    claimOnlyThread
      ? "Field claims exist without any prior in-factory defect row for this product."
      : null,
    claimLagBucket === "medium" || claimLagBucket === "long"
      ? `Claim lag looks delayed (${claimLagBucket}) rather than immediate.`
      : null,
    claimOnlyThread && dominantClaimBomPositions.length > 0
      ? `Claim focus maps back to installed positions ${dominantClaimBomPositions
          .map((item) => item.value)
          .slice(0, 3)
          .join(", ")}.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const claimLagStats = {
    count: input.summaryFeatures.daysFromBuildToClaim.length,
    minDays: input.summaryFeatures.daysFromBuildToClaim[0] ?? null,
    medianDays: getMedian(input.summaryFeatures.daysFromBuildToClaim),
    maxDays:
      input.summaryFeatures.daysFromBuildToClaim[
        input.summaryFeatures.daysFromBuildToClaim.length - 1
      ] ?? null,
  };

  const dominantReworkUsers = buildValueCountHints(
    input.rework.map((item) => item.userId),
    4,
  ).map((item) => ({
    userId: item.value,
    count: item.count,
  }));
  const hasHighSeveritySignal =
    input.defects.some((item) => !severityLooksLow(item.severity)) ||
    input.claims.some(
      (item) =>
        item.mappedDefectSeverity &&
        !severityLooksLow(item.mappedDefectSeverity),
    ) ||
    input.tests.some((item) => item.overallResult === "FAIL");
  const lowSeverityOnly =
    (input.defects.length > 0 || input.claims.length > 0) && !hasHighSeveritySignal;
  const cosmeticTextSignals = uniqueValues(
    [
      ...input.defects.map((item) => item.notes),
      ...input.claims.map((item) => item.complaintText),
      ...input.claims.map((item) => item.notes),
    ].filter((value) => COSMETIC_PATTERN.test(value ?? "")),
  );
  const cosmeticOnlySignals =
    lowSeverityOnly &&
    cosmeticTextSignals.length > 0 &&
    input.tests.every((item) => item.overallResult !== "FAIL");
  const fieldImpactPresent = input.claims.length > 0;
  const orderClusterHints = [
    input.product.order_id
      ? `All factory-side events for this product sit under order ${input.product.order_id}.`
      : null,
    input.product.order_id && dominantReworkUsers.length > 0
      ? `Order ${input.product.order_id} also carries repeated rework ownership by ${dominantReworkUsers
          .slice(0, 2)
          .map((item) => item.userId)
          .join(", ")}.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const userConcentrationHints = [
    dominantReworkUsers[0] && dominantReworkUsers[0].count >= 2
      ? `Rework ownership is concentrated on ${dominantReworkUsers[0].userId} (${dominantReworkUsers[0].count} rows).`
      : null,
    dominantReworkUsers.length > 1 &&
    dominantReworkUsers[0].count >= dominantReworkUsers[1].count * 2
      ? `${dominantReworkUsers[0].userId} dominates rework activity relative to other users.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const handlingPatternHints = [
    cosmeticOnlySignals
      ? "Low-severity, cosmetic-style evidence dominates this thread."
      : null,
    input.product.order_id && dominantReworkUsers.length > 0
      ? `Order ${input.product.order_id} intersects with repeated rework ownership.`
      : null,
    !fieldImpactPresent && lowSeverityOnly && dominantReworkUsers.length > 0
      ? "Handling or late-stage correction may explain the visible signals better than field failure."
      : null,
  ].filter((value): value is string => Boolean(value));

  const dominantTraceAnchors = [
    ...input.traceabilityEvidence.dominantSupplierBatches.slice(0, 2).map((item) => ({
      anchorType: "supplier_batch" as const,
      anchorValue: item.value,
      count: item.count,
      ratio: item.ratio,
      relatedProductCount: item.relatedProductCount,
      concentrationHint:
        item.ratio >= 0.4
          ? `${item.value} accounts for ${Math.round(item.ratio * 100)}% of surfaced installs.`
          : null,
    })),
    ...input.traceabilityEvidence.dominantInstalledParts.slice(0, 2).map((item) => ({
      anchorType: "part_number" as const,
      anchorValue: item.value,
      count: item.count,
      ratio: item.ratio,
      relatedProductCount: item.relatedProductCount,
      concentrationHint:
        item.ratio >= 0.4
          ? `${item.value} is over-represented in the installed-part slice.`
          : null,
    })),
    ...input.traceabilityEvidence.dominantBomPositions.slice(0, 2).map((item) => ({
      anchorType: "bom_position" as const,
      anchorValue: item.value,
      count: item.count,
      ratio: item.ratio,
      relatedProductCount: item.relatedProductCount,
      concentrationHint:
        item.ratio >= 0.4
          ? `${item.value} recurs unusually often in the installed BOM positions.`
          : null,
    })),
    ...input.traceabilityEvidence.partBatchAnchors.slice(0, 2).map((item) => ({
      anchorType: "part_batch" as const,
      anchorValue: item.anchorValue,
      count: item.count,
      ratio: item.ratio,
      relatedProductCount: item.relatedProductCount,
      concentrationHint:
        item.ratio >= 0.25
          ? `${item.anchorValue} is a combined part+batch anchor across ${item.relatedProductCount} scoped products.`
          : null,
    })),
    ...input.traceabilityEvidence.dominantSuppliers.slice(0, 1).map((item) => ({
      anchorType: "supplier" as const,
      anchorValue: item.value,
      count: item.count,
      ratio: item.ratio,
      relatedProductCount: item.relatedProductCount,
      concentrationHint:
        item.ratio >= 0.5
          ? `${item.value} dominates the surfaced supplier footprint.`
          : null,
    })),
  ]
    .sort(
      (left, right) =>
        right.relatedProductCount - left.relatedProductCount ||
        right.count - left.count ||
        left.anchorValue.localeCompare(right.anchorValue),
    )
    .slice(0, 6);
  const traceabilityConcentrationHints = uniqueValues([
    ...input.traceabilityEvidence.batchConcentrationHints
      .filter((item) => item.ratio >= 0.35 || item.productIds.length >= 3)
      .slice(0, 3)
      .map(
        (item) =>
          `${item.batchRef} appears concentrated (${item.count} installs across ${item.productIds.length} scoped products).`,
      ),
    ...dominantTraceAnchors
      .map((item) => item.concentrationHint)
      .filter((value): value is string => Boolean(value)),
    ...input.traceabilityEvidence.anchorSpecificity
      .filter((item) => item.specificity !== "product_specific")
      .slice(0, 2)
      .map((item) => item.reason),
    ...input.traceabilityEvidence.cooccurringAnchorBundles
      .filter((item) => item.relatedProductCount >= 2)
      .slice(0, 2)
      .map((item) => item.reason),
    ...input.traceabilityEvidence.blastRadiusSuspects.slice(0, 2).map((item) => item.reason),
  ]).slice(0, 6);

  const marginalOnlySignals =
    input.tests.some((item) => item.overallResult === "MARGINAL") &&
    input.tests.every((item) => item.overallResult !== "FAIL") &&
    input.defects.length === 0 &&
    input.claims.length === 0;
  const detectionBiasRisk = [
    occurrenceDetectedMismatches.length > 0
      ? `${occurrenceDetectedMismatches.length} defect rows were detected in a different section than the stated occurrence section.`
      : null,
    dominantDetectedSections.length > 0 && dominantOccurrenceSections.length === 0
      ? "Signals are concentrated in detected sections without a matching occurrence-section trail."
      : null,
  ].filter((value): value is string => Boolean(value));
  const builtOrTriggeredWeeks = uniqueValues(
    [buildWeek, ...defectWeeks, ...testWeeks].filter((value): value is string => Boolean(value)),
  );
  const sortedWeeklyVolumes = [...input.weeklyQualitySnippets]
    .map((item) => item.productsBuilt)
    .sort((left, right) => left - right);
  const lowVolumeThreshold =
    sortedWeeklyVolumes.length > 0
      ? sortedWeeklyVolumes[Math.max(0, Math.floor((sortedWeeklyVolumes.length - 1) * 0.25))]
      : null;
  const lowVolumePeriodRisk = lowVolumeThreshold === null
    ? []
    : input.weeklyQualitySnippets
        .filter(
          (item) =>
            builtOrTriggeredWeeks.includes(item.weekStart) &&
            item.productsBuilt <= lowVolumeThreshold,
        )
        .map(
          (item) =>
            `${item.weekStart} is a low-volume week for this article (${item.productsBuilt} products built).`,
        )
        .slice(0, 4);
  const mixedServiceDocumentationSignals = uniqueValues(
    [
      ...input.claims.map((item) => item.complaintText),
      ...input.claims.map((item) => item.notes),
      ...input.defects.map((item) => item.notes),
      ...input.actions.map((item) => item.comments),
    ].filter((value) => SERVICE_DOCUMENTATION_PATTERN.test(value ?? "")),
  ).slice(0, 6);
  const nearLimitTestSignals = uniqueValues(
    input.tests
      .filter((item) => item.overallResult === "MARGINAL")
      .map((item) => `${item.testKey}${item.sectionName ? ` @ ${item.sectionName}` : ""}`),
  ).slice(0, 6);

  return {
    traceabilityEvidence: {
      dominantInstalledParts: input.traceabilityEvidence.dominantInstalledParts,
      dominantBomPositions: input.traceabilityEvidence.dominantBomPositions,
      dominantSupplierBatches: input.traceabilityEvidence.dominantSupplierBatches,
      dominantSuppliers: input.traceabilityEvidence.dominantSuppliers,
      batchConcentrationHints: input.traceabilityEvidence.batchConcentrationHints,
      productAnchorCandidates: input.traceabilityEvidence.productAnchorCandidates,
      partBatchAnchors: input.traceabilityEvidence.partBatchAnchors,
      traceabilityNeighborhood: input.traceabilityEvidence.traceabilityNeighborhood,
      anchorSpecificity: input.traceabilityEvidence.anchorSpecificity,
      cooccurringAnchorBundles: input.traceabilityEvidence.cooccurringAnchorBundles,
      blastRadiusHints: input.traceabilityEvidence.blastRadiusHints,
      blastRadiusSuspects: input.traceabilityEvidence.blastRadiusSuspects,
      dominantTraceAnchors,
      traceabilityConcentrationHints,
    },
    temporalProcessEvidence: {
      buildWeek,
      firstFactorySignalWeek,
      lastFactorySignalWeek: latestFactorySignalWeek,
      defectWeeks,
      testWeeks,
      dominantOccurrenceSections,
      dominantDetectedSections,
      dominantTestResults,
      occurrenceDetectedMismatch: {
        present: occurrenceDetectedMismatches.length > 0,
        mismatchCount: occurrenceDetectedMismatches.length,
        examples: occurrenceDetectedMismatches.slice(0, 4),
      },
      temporalBurstHints,
      postWindowQuietHints,
      temporalContainmentHints,
      marginalVsFailHints,
    },
    fieldLeakEvidence: {
      claimOnlyThread,
      hasPriorFactoryDefect: input.defects.length > 0,
      buildToClaimDays: input.summaryFeatures.daysFromBuildToClaim,
      claimLagBucket,
      claimLagStats,
      dominantClaimReportedParts,
      dominantClaimBomPositions,
      latentFailureHints,
    },
    operatorHandlingEvidence: {
      orderId: normalizeNullableText(input.product.order_id),
      dominantReworkUsers,
      orderClusterHints,
      userConcentrationHints,
      cosmeticOnlySignals,
      lowSeverityOnly,
      fieldImpactPresent,
      handlingPatternHints,
    },
    confounderEvidence: {
      falsePositiveMarkers: input.summaryFeatures.falsePositiveMarkers.filter((value) =>
        FALSE_POSITIVE_PATTERN.test(value),
      ),
      marginalOnlySignals,
      detectionBiasRisk,
      lowVolumePeriodRisk,
      mixedServiceDocumentationSignals,
      nearLimitTestSignals,
    },
  };
}

const buildCrossProductSummary = (
  productThreads: ClusteredProductDossier[],
  defects: ManexDefect[],
  claims: ManexFieldClaim[],
  tests: ManexTestSignal[],
) => {
  const installedParts = productThreads.flatMap((thread) => thread.installedParts);
  const sharedSupplierBatches = topEntries(
    [...groupBy(
      installedParts.filter((item) => item.batchId || item.batchNumber),
      (item) => normalizeNullableText(item.batchId ?? item.batchNumber) ?? "",
    ).entries()]
      .map(([batchRef, items]) => ({
        batchRef,
        supplierNames: uniqueValues(items.map((item) => item.supplierName)),
        productIds: uniqueValues(items.map((item) => item.productId)),
        partNumbers: uniqueValues(items.map((item) => item.partNumber)),
        findNumbers: uniqueValues(
          items.map((item) => item.findNumber ?? item.positionCode),
        ),
        count: items.length,
      }))
      .filter((entry) => entry.productIds.length > 1)
      .sort(
        (left, right) =>
          right.productIds.length - left.productIds.length ||
          right.count - left.count ||
          left.batchRef.localeCompare(right.batchRef),
      ),
    10,
  );

  const sharedReportedPartNumbers = topEntries(
    bucketCounts(
      [...defects, ...claims],
      (item) => item.reportedPartNumber,
      (item) => item.productId,
      (item) => item.id,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        partNumber: entry.value,
        productIds: entry.productIds,
        signalIds: entry.signalIds,
        count: entry.count,
      })),
    10,
  );

  const sharedBomFindNumbers = topEntries(
    bucketCounts(
      installedParts,
      (item) => item.findNumber ?? item.positionCode,
      (item) => item.productId,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        findNumber: entry.value,
        productIds: entry.productIds,
        partNumbers: uniqueValues(
          installedParts
            .filter(
              (item) =>
                normalizeNullableText(item.findNumber ?? item.positionCode) ===
                entry.value,
            )
            .map((item) => item.partNumber),
        ),
        count: entry.count,
      })),
    10,
  );

  const claimKeywordBuckets = new Map<
    string,
    { productIds: Set<string>; claimIds: Set<string>; count: number }
  >();

  for (const claim of claims) {
    for (const keyword of extractClaimKeywords(claim.complaintText)) {
      const current =
        claimKeywordBuckets.get(keyword) ??
        {
          productIds: new Set<string>(),
          claimIds: new Set<string>(),
          count: 0,
        };

      current.count += 1;
      current.productIds.add(claim.productId);
      current.claimIds.add(claim.id);
      claimKeywordBuckets.set(keyword, current);
    }
  }

  const similarClaimThemes = [...claimKeywordBuckets.entries()]
    .map(([keyword, value]) => ({
      keyword,
      productIds: [...value.productIds].sort((left, right) => left.localeCompare(right)),
      claimIds: [...value.claimIds].sort((left, right) => left.localeCompare(right)),
      count: value.count,
    }))
    .filter((entry) => entry.productIds.length > 1)
    .sort(
      (left, right) =>
        right.productIds.length - left.productIds.length ||
        right.count - left.count ||
        left.keyword.localeCompare(right.keyword),
    )
    .slice(0, 10);

  const sharedOrders = topEntries(
    bucketCounts(
      productThreads,
      (item) => item.orderId,
      (item) => item.productId,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        orderId: entry.value,
        productIds: entry.productIds,
        count: entry.count,
      })),
    8,
  );

  const sharedReworkUsers = topEntries(
    bucketCounts(
      productThreads.flatMap((thread) =>
        thread.rework.map((item) => ({
          userId: item.userId,
          productId: thread.productId,
        })),
      ),
      (item) => item.userId,
      (item) => item.productId,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        userId: entry.value,
        productIds: entry.productIds,
        count: entry.count,
      })),
    8,
  );

  const sharedOccurrenceSections = topEntries(
    bucketCounts(
      defects.map((item) => ({
        section: item.occurrenceSectionName,
        productId: item.productId,
      })),
      (item) => item.section,
      (item) => item.productId,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        section: entry.value,
        productIds: entry.productIds,
        count: entry.count,
      })),
    8,
  );

  const sharedSections = topEntries(
    bucketCounts(
      productThreads.flatMap((thread) =>
        thread.summaryFeatures.sectionsSeen.map((section) => ({
          section,
          productId: thread.productId,
        })),
      ),
      (item) => item.section,
      (item) => item.productId,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        section: entry.value,
        productIds: entry.productIds,
        count: entry.count,
      })),
    8,
  );

  const sharedTestHotspots = topEntries(
    bucketCounts(
      tests,
      (item) => item.testKey,
      (item) => item.productId,
      (item) => item.id,
    )
      .filter((entry) => entry.productIds.length > 1)
      .map((entry) => ({
        testKey: entry.value,
        productIds: entry.productIds,
        signalIds: entry.signalIds,
        count: entry.count,
      })),
    10,
  );

  return {
    sharedSupplierBatches,
    sharedReportedPartNumbers,
    sharedBomFindNumbers,
    similarClaimThemes,
    sharedOrders,
    sharedReworkUsers,
    sharedOccurrenceSections,
    sharedSections,
    sharedTestHotspots,
  };
};

type ArticleMechanismContext = {
  totalProducts: number;
  batchProductCounts: Map<string, number>;
  partProductCounts: Map<string, number>;
  partBatchProductCounts: Map<string, number>;
  occurrenceSectionProductCounts: Map<string, number>;
  detectedSectionProductCounts: Map<string, number>;
  orderProductCounts: Map<string, number>;
  reworkUserProductCounts: Map<string, number>;
  testKeyProductCounts: Map<string, number>;
};

const roundMetric = (value: number, digits = 2) =>
  Number(value.toFixed(digits));

const clamp01 = (value: number) => Math.max(0, Math.min(1, roundMetric(value, 3)));

const safeRatio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

function toStableToken(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);

  return normalized || "item";
}

function buildProductCountMap(
  threads: ClusteredProductDossier[],
  getter: (thread: ClusteredProductDossier) => Array<string | null | undefined>,
) {
  const productIdsByKey = new Map<string, Set<string>>();

  for (const thread of threads) {
    for (const key of uniqueValues(
      getter(thread).map((value) => normalizeNullableText(value)),
    )) {
      const current = productIdsByKey.get(key) ?? new Set<string>();
      current.add(thread.productId);
      productIdsByKey.set(key, current);
    }
  }

  return new Map(
    [...productIdsByKey.entries()].map(([key, productIds]) => [key, productIds.size]),
  );
}

function buildArticleMechanismContext(dossier: ClusteredArticleDossier): ArticleMechanismContext {
  return {
    totalProducts: dossier.productThreads.length,
    batchProductCounts: buildProductCountMap(dossier.productThreads, (thread) =>
      thread.installedParts.map((item) => item.batchId ?? item.batchNumber),
    ),
    partProductCounts: buildProductCountMap(dossier.productThreads, (thread) => [
      ...thread.summaryFeatures.reportedPartNumbers,
      ...thread.installedParts.map((item) => item.partNumber),
    ]),
    partBatchProductCounts: buildProductCountMap(dossier.productThreads, (thread) =>
      thread.installedParts
        .filter((item) => item.partNumber && (item.batchId ?? item.batchNumber))
        .map((item) => `${item.partNumber}|${item.batchId ?? item.batchNumber}`),
    ),
    occurrenceSectionProductCounts: buildProductCountMap(dossier.productThreads, (thread) =>
      thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.map(
        (item) => item.value,
      ),
    ),
    detectedSectionProductCounts: buildProductCountMap(dossier.productThreads, (thread) =>
      thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections.map(
        (item) => item.value,
      ),
    ),
    orderProductCounts: buildProductCountMap(dossier.productThreads, (thread) => [thread.orderId]),
    reworkUserProductCounts: buildProductCountMap(dossier.productThreads, (thread) =>
      thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers.map(
        (item) => item.userId,
      ),
    ),
    testKeyProductCounts: buildProductCountMap(dossier.productThreads, (thread) =>
      thread.summaryFeatures.testKeysMarginalFail,
    ),
  };
}

function calculateLift(input: {
  anchorOnAffectedCount: number;
  affectedProductCount: number;
  articleBackgroundCount: number;
  totalProducts: number;
}) {
  const affectedPrevalence = safeRatio(
    input.anchorOnAffectedCount,
    input.affectedProductCount,
  );
  const articlePrevalence = safeRatio(
    input.articleBackgroundCount,
    input.totalProducts,
  );

  if (articlePrevalence <= 0) {
    return affectedPrevalence > 0 ? 10 : 0;
  }

  return roundMetric(affectedPrevalence / articlePrevalence);
}

function calculateBackgroundPrevalencePenalty(input: {
  articleBackgroundCount: number;
  totalProducts: number;
  lift: number;
}) {
  const articlePrevalence = safeRatio(
    input.articleBackgroundCount,
    input.totalProducts,
  );

  return clamp01(
    articlePrevalence - Math.max(0, input.lift - 1) * 0.45 + (articlePrevalence >= 0.75 ? 0.15 : 0),
  );
}

function pickDominantValue(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = normalizeNullableText(value);

    if (!normalized) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function buildCandidateStatistics(input: {
  threads: ClusteredProductDossier[];
  context: ArticleMechanismContext;
  articleBackgroundCount: number;
  anchorOnAffectedCount?: number;
}) {
  const affectedProductCount = input.threads.length;
  const anchorOnAffectedCount = input.anchorOnAffectedCount ?? affectedProductCount;
  const dominantWeek = pickDominantValue(
    input.threads.map((thread) => thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek),
  );
  const dominantOrder = pickDominantValue(input.threads.map((thread) => thread.orderId));
  const dominantUser = pickDominantValue(
    input.threads.map(
      (thread) => thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers[0]?.userId,
    ),
  );
  const claimBearingThreads = input.threads.filter((thread) => thread.claims.length > 0);
  const lift = calculateLift({
    anchorOnAffectedCount,
    affectedProductCount,
    articleBackgroundCount: input.articleBackgroundCount,
    totalProducts: input.context.totalProducts,
  });

  return {
    affectedProductCount,
    articleBackgroundCount: input.articleBackgroundCount,
    lift,
    backgroundPrevalencePenalty: calculateBackgroundPrevalencePenalty({
      articleBackgroundCount: input.articleBackgroundCount,
      totalProducts: input.context.totalProducts,
      lift,
    }),
    weekConcentrationScore: clamp01(
      safeRatio(
        input.threads.filter(
          (thread) =>
            thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek === dominantWeek,
        ).length,
        affectedProductCount,
      ),
    ),
    orderConcentrationScore: clamp01(
      safeRatio(
        input.threads.filter((thread) => thread.orderId === dominantOrder).length,
        affectedProductCount,
      ),
    ),
    reworkUserConcentrationScore: clamp01(
      safeRatio(
        input.threads.filter(
          (thread) =>
            thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers[0]?.userId ===
            dominantUser,
        ).length,
        affectedProductCount,
      ),
    ),
    claimOnlyRatio: clamp01(
      safeRatio(
        input.threads.filter((thread) => thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread)
          .length,
        affectedProductCount,
      ),
    ),
    preClaimFactoryDefectRatio: clamp01(
      safeRatio(
        claimBearingThreads.filter(
          (thread) => thread.mechanismEvidence.fieldLeakEvidence.hasPriorFactoryDefect,
        ).length,
        claimBearingThreads.length,
      ),
    ),
    detectedVsOccurrenceMismatchRate: clamp01(
      safeRatio(
        input.threads.filter(
          (thread) => thread.mechanismEvidence.temporalProcessEvidence.occurrenceDetectedMismatch.present,
        ).length,
        affectedProductCount,
      ),
    ),
  };
}

function buildThreadHypothesisSignals(
  thread: ClusteredProductDossier,
  dossier: ClusteredArticleDossier,
  context = buildArticleMechanismContext(dossier),
): ProductHypothesisSignals {
  const sameBatchSamePartHint = thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
    (item) => item.relatedProductCount >= 2,
  );
  const sameOccurrenceWindowHint =
    Boolean(thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections[0]) &&
    (thread.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.length > 0 ||
      thread.mechanismEvidence.temporalProcessEvidence.temporalContainmentHints.length > 0);
  const sameOrderClusterHint =
    Boolean(thread.orderId) && (context.orderProductCounts.get(thread.orderId ?? "") ?? 0) > 1;
  const primaryReworkUser =
    thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers[0]?.userId ?? null;
  const sameReworkUserHint =
    Boolean(primaryReworkUser) && (context.reworkUserProductCounts.get(primaryReworkUser ?? "") ?? 0) > 1;
  const detectorHotspotOnly =
    thread.mechanismEvidence.confounderEvidence.marginalOnlySignals ||
    (thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.length > 0 &&
      thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.length === 0);
  const falsePositiveFlag =
    thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.length > 0;
  const claimOnlyThread = thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread;
  const hasFactoryDefectBeforeClaim =
    thread.mechanismEvidence.fieldLeakEvidence.hasPriorFactoryDefect;
  const discriminativeAnchors = uniqueValues([
    ...thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity
      .filter((item) => item.specificity !== "article_wide")
      .slice(0, 3)
      .map((item) => `${item.anchorType}:${item.anchorValue}`),
    ...thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors
      .slice(0, 2)
      .map((item) => item.anchorValue),
    thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections[0]?.value ?? null,
  ]).slice(0, 6);
  const broadContextAnchors = uniqueValues([
    ...thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity
      .filter((item) => item.specificity === "article_wide")
      .slice(0, 3)
      .map((item) => `${item.anchorType}:${item.anchorValue}`),
    ...thread.mechanismEvidence.traceabilityEvidence.blastRadiusHints
      .slice(0, 2)
      .map((item) => `${item.anchorType}:${item.anchorValue}`),
  ]).slice(0, 6);
  const votes = [
    sameBatchSamePartHint
      ? {
          family: "supplier_batch_material" as const,
          score: clamp01(
            0.48 +
              (thread.summaryFeatures.defectCodesPresent.length > 0 ? 0.18 : 0) +
              (thread.summaryFeatures.testKeysMarginalFail.length > 0 ? 0.1 : 0) +
              (thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket === "short" ? 0.08 : 0) +
              (discriminativeAnchors.length > 0 ? 0.08 : 0),
          ),
          reasons: uniqueValues([
            "Same part plus batch anchor recurs across products.",
            thread.summaryFeatures.defectCodesPresent[0]
              ? `Repeated defect mode ${thread.summaryFeatures.defectCodesPresent[0]}.`
              : null,
            thread.summaryFeatures.testKeysMarginalFail[0]
              ? `Test behavior includes ${thread.summaryFeatures.testKeysMarginalFail[0]}.`
              : null,
          ]),
        }
      : null,
    sameOccurrenceWindowHint
      ? {
          family: "process_window_calibration" as const,
          score: clamp01(
            0.5 +
              (thread.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.length > 0
                ? 0.15
                : 0) +
              (thread.mechanismEvidence.temporalProcessEvidence.postWindowQuietHints.length > 0
                ? 0.1
                : 0) +
              (thread.rework.length > 0 || thread.actions.length > 0 ? 0.08 : 0),
          ),
          reasons: uniqueValues([
            "Occurrence section and time window line up.",
            ...thread.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.slice(0, 1),
            ...thread.mechanismEvidence.operatorHandlingEvidence.handlingPatternHints.slice(0, 1),
          ]),
        }
      : null,
    claimOnlyThread &&
    ["medium", "long"].includes(thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket)
      ? {
          family: "latent_design_escape" as const,
          score: clamp01(
            0.58 +
              (thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts.length > 0
                ? 0.12
                : 0) +
              (thread.mechanismEvidence.fieldLeakEvidence.dominantClaimBomPositions.length > 0
                ? 0.12
                : 0) +
              (!hasFactoryDefectBeforeClaim ? 0.08 : -0.08),
          ),
          reasons: uniqueValues([
            "Claim-only leakage appears without a factory defect trail.",
            `Claim lag is ${thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket}.`,
            thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts[0]
              ? `Reported part focus on ${thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts[0].value}.`
              : null,
          ]),
        }
      : null,
    sameOrderClusterHint &&
    sameReworkUserHint &&
    thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals
      ? {
          family: "operator_handling_order_cluster" as const,
          score: clamp01(
            0.6 +
              (thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly ? 0.12 : 0) +
              (thread.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent ? -0.08 : 0) +
              (thread.rework.length > 0 ? 0.08 : 0),
          ),
          reasons: uniqueValues([
            "Order concentration and rework-user concentration line up.",
            ...thread.mechanismEvidence.operatorHandlingEvidence.handlingPatternHints.slice(0, 2),
          ]),
        }
      : null,
    detectorHotspotOnly
      ? {
          family: "detector_hotspot_noise" as const,
          score: clamp01(
            0.6 +
              (thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.length > 0 ? 0.12 : 0) +
              (thread.mechanismEvidence.confounderEvidence.marginalOnlySignals ? 0.12 : 0),
          ),
          reasons: uniqueValues([
            "Detected-section-only or marginal-only evidence dominates.",
            ...thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.slice(0, 2),
          ]),
        }
      : null,
    falsePositiveFlag
      ? {
          family: "false_positive_noise" as const,
          score: clamp01(0.72 + thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.length * 0.02),
          reasons: uniqueValues([
            ...thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.slice(0, 2),
            "False-positive language appears directly in the evidence.",
          ]),
        }
      : null,
    thread.mechanismEvidence.confounderEvidence.marginalOnlySignals
      ? {
          family: "near_limit_leading_indicator" as const,
          score: clamp01(
            0.58 +
              (thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.length > 0 ? 0.12 : 0),
          ),
          reasons: uniqueValues([
            "Only marginal or near-limit test signals are present.",
            ...thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.slice(0, 2),
          ]),
        }
      : null,
  ].filter(
    (
      value,
    ): value is {
      family: MechanismFamily;
      score: number;
      reasons: string[];
    } => Boolean(value),
  );

  return {
    candidateFamilyVotes: votes
      .sort((left, right) => right.score - left.score || left.family.localeCompare(right.family))
      .slice(0, 4),
    negativeEvidence: uniqueValues([
      !thread.claims.length ? "No field claim evidence is present." : null,
      !thread.defects.length ? "No factory defect row is present." : null,
      !thread.rework.length ? "No rework closure is recorded." : null,
      !thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.length
        ? "No dominant occurrence section is surfaced."
        : null,
      broadContextAnchors.length > 0
        ? `Broad context anchors present: ${broadContextAnchors.slice(0, 2).join(", ")}.`
        : null,
    ]).slice(0, 6),
    discriminativeAnchors,
    broadContextAnchors,
    claimLagDays: thread.mechanismEvidence.fieldLeakEvidence.buildToClaimDays.slice(0, 8),
    hasFactoryDefectBeforeClaim,
    sameOrderClusterHint,
    sameReworkUserHint,
    sameOccurrenceWindowHint,
    sameBatchSamePartHint,
    detectorHotspotOnly,
    falsePositiveFlag,
    claimOnlyThread,
    occurrenceDetectedMismatch:
      thread.mechanismEvidence.temporalProcessEvidence.occurrenceDetectedMismatch.present,
  };
}

function ensureThreadHypothesisSignals(
  thread: ClusteredProductDossier,
  dossier: ClusteredArticleDossier,
  context = buildArticleMechanismContext(dossier),
) {
  return thread.hypothesisSignals ?? buildThreadHypothesisSignals(thread, dossier, context);
}

function buildSupplierBatchCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const buckets = new Map<
    string,
    {
      family: MechanismFamily;
      partNumber: string;
      batchRef: string;
      mode: string;
      threads: ClusteredProductDossier[];
    }
  >();

  for (const thread of dossier.productThreads) {
    const partBatchAnchors = thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.slice(0, 3);
    const modes = uniqueValues([
      ...thread.summaryFeatures.defectCodesPresent.slice(0, 2),
      ...thread.summaryFeatures.testKeysMarginalFail.slice(0, 2),
    ]);

    if (!partBatchAnchors.length || !modes.length) {
      continue;
    }

    for (const anchor of partBatchAnchors) {
      for (const mode of modes.slice(0, 2)) {
        const key = `${anchor.partNumber}|${anchor.batchRef}|${mode}`;
        const current =
          buckets.get(key) ??
          {
            family: "supplier_batch_material" as const,
            partNumber: anchor.partNumber,
            batchRef: anchor.batchRef,
            mode,
            threads: [],
          };

        current.threads.push(thread);
        buckets.set(key, current);
      }
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      threads: uniqueBy(bucket.threads, (thread) => thread.productId),
    }))
    .filter((bucket) => bucket.threads.length >= 2)
    .map((bucket) => {
      const articleBackgroundCount =
        context.partBatchProductCounts.get(`${bucket.partNumber}|${bucket.batchRef}`) ??
        bucket.threads.length;
      const stats = buildCandidateStatistics({
        threads: bucket.threads,
        context,
        articleBackgroundCount,
      });
      const hasShortLag = bucket.threads.some((thread) =>
        ["same_week", "short"].includes(thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket),
      );
      const hasReworkOnPart = bucket.threads.some((thread) =>
        thread.rework.some((item) => item.reportedPartNumber === bucket.partNumber),
      );
      const requiredEvidencePresent = uniqueValues([
        `Same part number ${bucket.partNumber}.`,
        `Same supplier batch ${bucket.batchRef}.`,
        `Repeated defect/test mode ${bucket.mode}.`,
        hasShortLag ? "Short-lag claim behavior appears in the affected slice." : null,
        hasReworkOnPart ? "Rework touches the same part family." : null,
      ]);
      const requiredEvidenceMissing = uniqueValues([
        !hasShortLag && !hasReworkOnPart
          ? "No short-lag claim behavior or same-part rework signal backs the batch story."
          : null,
        stats.backgroundPrevalencePenalty >= 0.7
          ? "The part+batch anchor is broad article context rather than discriminative."
          : null,
      ]);

      return {
        candidateFamilyId: `CFAM-${toStableToken(bucket.partNumber)}-${toStableToken(
          bucket.batchRef,
        )}-${toStableToken(bucket.mode)}`,
        family: "supplier_batch_material" as const,
        title: `${bucket.partNumber} / ${bucket.batchRef} / ${bucket.mode}`,
        shouldReviewAs:
          requiredEvidenceMissing.length === 0 && stats.lift >= 1.15
            ? "case"
            : stats.backgroundPrevalencePenalty >= 0.72
              ? "noise"
              : "watchlist",
        dominantAnchor: `${bucket.partNumber} + ${bucket.batchRef}`,
        supportingProductIds: bucket.threads.map((thread) => thread.productId),
        supportingSignalIds: uniqueValues(
          bucket.threads.flatMap((thread) =>
            thread.signals
              .filter((signal) =>
                signal.headline.includes(bucket.mode) ||
                signal.sourceContext?.includes(bucket.mode),
              )
              .map((signal) => signal.signalId),
          ),
        ).slice(0, 120),
        signalTypesPresent: uniqueValues(
          bucket.threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
        ),
        discriminativeAnchors: uniqueValues([
          `${bucket.partNumber}|${bucket.batchRef}`,
          bucket.mode,
          ...bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).discriminativeAnchors.slice(0, 2),
          ),
        ]).slice(0, 8),
        broadContextAnchors: uniqueValues(
          bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).broadContextAnchors.slice(0, 2),
          ),
        ).slice(0, 6),
        requiredEvidencePresent,
        requiredEvidenceMissing,
        strongestEvidence: uniqueValues([
          `Part ${bucket.partNumber} and batch ${bucket.batchRef} recur across ${bucket.threads.length} products.`,
          `Mode ${bucket.mode} repeats inside the same part+batch family.`,
          hasShortLag ? "Claim lag stays short when field impact appears." : null,
        ]).slice(0, 6),
        strongestCounterevidence: uniqueValues([
          stats.backgroundPrevalencePenalty >= 0.7
            ? `${bucket.batchRef} is common across the article and has weak lift.`
            : null,
          bucket.threads.some((thread) => thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread)
            ? "Some affected products look claim-only, which can point toward a design escape instead."
            : null,
        ]).slice(0, 6),
        bestCompetingFamilies: uniqueValues([
          bucket.threads.some((thread) => thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread)
            ? "latent_design_escape"
            : null,
          bucket.threads.some((thread) =>
            thread.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.length > 0,
          )
            ? "process_window_calibration"
            : null,
        ]) as MechanismFamily[],
        statistics: stats,
      } satisfies Stage2CandidateFamily;
    });
}

function buildProcessWindowCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const buckets = new Map<
    string,
    {
      section: string;
      week: string;
      threads: ClusteredProductDossier[];
    }
  >();

  for (const thread of dossier.productThreads) {
    const section =
      thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections[0]?.value ?? null;
    const week = thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek ?? null;

    if (!section || !week) {
      continue;
    }

    const key = `${section}|${week}`;
    const current = buckets.get(key) ?? { section, week, threads: [] };
    current.threads.push(thread);
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      threads: uniqueBy(bucket.threads, (thread) => thread.productId),
    }))
    .filter((bucket) => bucket.threads.length >= 2)
    .map((bucket) => {
      const articleBackgroundCount =
        context.occurrenceSectionProductCounts.get(bucket.section) ?? bucket.threads.length;
      const stats = buildCandidateStatistics({
        threads: bucket.threads,
        context,
        articleBackgroundCount,
      });
      const hasQuietAfterWindow = bucket.threads.some(
        (thread) => thread.mechanismEvidence.temporalProcessEvidence.postWindowQuietHints.length > 0,
      );
      const hasReworkLanguage = bucket.threads.some(
        (thread) =>
          thread.rework.length > 0 ||
          thread.actions.some((item) => /\b(rework|adjust|tighten|realign|retest|calib)/i.test(item.comments)),
      );
      const requiredEvidencePresent = uniqueValues([
        `Same occurrence section ${bucket.section}.`,
        `Signals concentrate around week ${bucket.week.slice(0, 10)}.`,
        hasQuietAfterWindow ? "Signals weaken after the narrow window." : null,
        hasReworkLanguage ? "Rework/action language suggests local correction." : null,
      ]);
      const requiredEvidenceMissing = uniqueValues([
        !hasQuietAfterWindow ? "The pattern does not clearly fade after the window." : null,
        !hasReworkLanguage ? "Rework or corrective-action language is weak." : null,
      ]);

      return {
        candidateFamilyId: `CFAM-${toStableToken(bucket.section)}-${toStableToken(bucket.week)}`,
        family: "process_window_calibration" as const,
        title: `${bucket.section} around ${bucket.week.slice(0, 10)}`,
        shouldReviewAs:
          requiredEvidenceMissing.length === 0 && stats.weekConcentrationScore >= 0.65
            ? "case"
            : "watchlist",
        dominantAnchor: `${bucket.section} @ ${bucket.week.slice(0, 10)}`,
        supportingProductIds: bucket.threads.map((thread) => thread.productId),
        supportingSignalIds: uniqueValues(
          bucket.threads.flatMap((thread) =>
            thread.signals
              .filter((signal) => signal.section === bucket.section)
              .map((signal) => signal.signalId),
          ),
        ).slice(0, 120),
        signalTypesPresent: uniqueValues(
          bucket.threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
        ),
        discriminativeAnchors: uniqueValues([
          bucket.section,
          bucket.week.slice(0, 10),
          ...bucket.threads.flatMap((thread) =>
            thread.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.slice(0, 1),
          ),
        ]).slice(0, 8),
        broadContextAnchors: uniqueValues(
          bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).broadContextAnchors.slice(0, 2),
          ),
        ).slice(0, 6),
        requiredEvidencePresent,
        requiredEvidenceMissing,
        strongestEvidence: uniqueValues([
          `${bucket.section} repeats across ${bucket.threads.length} products in a narrow window.`,
          hasQuietAfterWindow ? "Evidence weakens after the affected window." : null,
          hasReworkLanguage ? "Corrective-action language is consistent with a local process issue." : null,
        ]).slice(0, 6),
        strongestCounterevidence: uniqueValues([
          bucket.threads.some(
            (thread) =>
              thread.mechanismEvidence.temporalProcessEvidence.occurrenceDetectedMismatch.present,
          )
            ? "Detected-vs-occurrence mismatches raise detector-hotspot risk."
            : null,
          bucket.threads.some((thread) =>
            thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
              (item) => item.relatedProductCount >= 2,
            ),
          )
            ? "Shared traceability anchors could point to a supplier explanation instead."
            : null,
        ]).slice(0, 6),
        bestCompetingFamilies: uniqueValues([
          bucket.threads.some(
            (thread) =>
              thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
                (item) => item.relatedProductCount >= 2,
              ),
          )
            ? "supplier_batch_material"
            : null,
          stats.detectedVsOccurrenceMismatchRate >= 0.4 ? "detector_hotspot_noise" : null,
        ]) as MechanismFamily[],
        statistics: stats,
      } satisfies Stage2CandidateFamily;
    });
}

function buildDesignEscapeCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const buckets = new Map<
    string,
    {
      partNumber: string;
      bomPosition: string;
      lagBucket: string;
      threads: ClusteredProductDossier[];
    }
  >();

  for (const thread of dossier.productThreads) {
    const partNumber =
      thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts[0]?.value ??
      thread.summaryFeatures.reportedPartNumbers[0] ??
      null;
    const bomPosition =
      thread.mechanismEvidence.fieldLeakEvidence.dominantClaimBomPositions[0]?.value ??
      thread.summaryFeatures.bomFindNumbers[0] ??
      null;
    const lagBucket = thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket;

    if (
      !thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread ||
      !partNumber ||
      !bomPosition ||
      !["medium", "long"].includes(lagBucket)
    ) {
      continue;
    }

    const key = `${partNumber}|${bomPosition}|${lagBucket}`;
    const current = buckets.get(key) ?? { partNumber, bomPosition, lagBucket, threads: [] };
    current.threads.push(thread);
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      threads: uniqueBy(bucket.threads, (thread) => thread.productId),
    }))
    .filter((bucket) => bucket.threads.length >= 2)
    .map((bucket) => {
      const articleBackgroundCount = Math.max(
        context.partProductCounts.get(bucket.partNumber) ?? 0,
        buildProductCountMap(dossier.productThreads, (thread) => thread.summaryFeatures.bomFindNumbers).get(
          bucket.bomPosition,
        ) ?? 0,
      );
      const stats = buildCandidateStatistics({
        threads: bucket.threads,
        context,
        articleBackgroundCount,
      });
      const requiredEvidencePresent = uniqueValues([
        `Repeated claim-only leakage on ${bucket.partNumber}.`,
        `Shared BOM position ${bucket.bomPosition}.`,
        `Lag profile is ${bucket.lagBucket}.`,
        stats.preClaimFactoryDefectRatio <= 0.2
          ? "Prior factory defects are absent or near-zero."
          : null,
      ]);
      const requiredEvidenceMissing = uniqueValues([
        stats.preClaimFactoryDefectRatio > 0.2
          ? "Too many affected products already show a factory defect trail."
          : null,
        stats.orderConcentrationScore >= 0.65
          ? "One production order may explain the pattern better than a design escape."
          : null,
        stats.backgroundPrevalencePenalty >= 0.7
          ? "The part/BOM anchor is common article context."
          : null,
      ]);

      return {
        candidateFamilyId: `CFAM-${toStableToken(bucket.partNumber)}-${toStableToken(
          bucket.bomPosition,
        )}-${bucket.lagBucket}`,
        family: "latent_design_escape" as const,
        title: `${bucket.partNumber} at ${bucket.bomPosition} with ${bucket.lagBucket} claim lag`,
        shouldReviewAs:
          requiredEvidenceMissing.length === 0 && stats.claimOnlyRatio >= 0.85
            ? "case"
            : "watchlist",
        dominantAnchor: `${bucket.partNumber} @ ${bucket.bomPosition}`,
        supportingProductIds: bucket.threads.map((thread) => thread.productId),
        supportingSignalIds: uniqueValues(
          bucket.threads.flatMap((thread) => thread.claims.map((claim) => claim.id)),
        ).slice(0, 120),
        signalTypesPresent: uniqueValues(
          bucket.threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
        ),
        discriminativeAnchors: uniqueValues([
          bucket.partNumber,
          bucket.bomPosition,
          `${bucket.lagBucket} claim lag`,
        ]),
        broadContextAnchors: uniqueValues(
          bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).broadContextAnchors.slice(0, 2),
          ),
        ).slice(0, 6),
        requiredEvidencePresent,
        requiredEvidenceMissing,
        strongestEvidence: uniqueValues([
          `${bucket.partNumber} claims recur without a factory defect trail.`,
          `Claims map back to ${bucket.bomPosition} with ${bucket.lagBucket} lag.`,
        ]).slice(0, 6),
        strongestCounterevidence: uniqueValues([
          stats.orderConcentrationScore >= 0.65
            ? "Order concentration suggests a handling or process explanation."
            : null,
          bucket.threads.some((thread) =>
            thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
              (item) => item.relatedProductCount >= 2,
            ),
          )
            ? "Shared part+batch anchors could indicate a supplier explanation instead."
            : null,
        ]).slice(0, 6),
        bestCompetingFamilies: uniqueValues([
          stats.orderConcentrationScore >= 0.65 ? "operator_handling_order_cluster" : null,
          bucket.threads.some((thread) =>
            thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
              (item) => item.relatedProductCount >= 2,
            ),
          )
            ? "supplier_batch_material"
            : null,
        ]) as MechanismFamily[],
        statistics: stats,
      } satisfies Stage2CandidateFamily;
    });
}

function buildHandlingCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const buckets = new Map<string, { userId: string; threads: ClusteredProductDossier[] }>();

  for (const thread of dossier.productThreads) {
    const userId = thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers[0]?.userId;

    if (
      !userId ||
      !thread.orderId ||
      !thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals ||
      !thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly
    ) {
      continue;
    }

    const current = buckets.get(userId) ?? { userId, threads: [] };
    current.threads.push(thread);
    buckets.set(userId, current);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      threads: uniqueBy(bucket.threads, (thread) => thread.productId),
    }))
    .filter((bucket) => bucket.threads.length >= 2)
    .map((bucket) => {
      const articleBackgroundCount =
        context.reworkUserProductCounts.get(bucket.userId) ?? bucket.threads.length;
      const stats = buildCandidateStatistics({
        threads: bucket.threads,
        context,
        articleBackgroundCount,
      });
      const orderValues = uniqueValues(bucket.threads.map((thread) => thread.orderId));
      const requiredEvidencePresent = uniqueValues([
        `Rework user ${bucket.userId} dominates the affected slice.`,
        orderValues.length <= 3 ? `Orders stay concentrated (${orderValues.join(", ")}).` : null,
        "Low-severity cosmetic signals dominate the family.",
      ]);
      const requiredEvidenceMissing = uniqueValues([
        orderValues.length > 3 ? "Orders are too diffuse for a handling cluster." : null,
        stats.claimOnlyRatio > 0.35 ? "Field-claim leakage is too strong for a pure handling story." : null,
      ]);

      return {
        candidateFamilyId: `CFAM-user-${toStableToken(bucket.userId)}`,
        family: "operator_handling_order_cluster" as const,
        title: `${bucket.userId} cosmetic handling cluster`,
        shouldReviewAs:
          requiredEvidenceMissing.length === 0 && stats.orderConcentrationScore >= 0.45
            ? "case"
            : "watchlist",
        dominantAnchor: bucket.userId,
        supportingProductIds: bucket.threads.map((thread) => thread.productId),
        supportingSignalIds: uniqueValues(
          bucket.threads.flatMap((thread) => thread.signals.map((signal) => signal.signalId)),
        ).slice(0, 120),
        signalTypesPresent: uniqueValues(
          bucket.threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
        ),
        discriminativeAnchors: uniqueValues([
          bucket.userId,
          ...orderValues.slice(0, 3),
        ]),
        broadContextAnchors: uniqueValues(
          bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).broadContextAnchors.slice(0, 2),
          ),
        ).slice(0, 6),
        requiredEvidencePresent,
        requiredEvidenceMissing,
        strongestEvidence: uniqueValues([
          `${bucket.userId} repeats across ${bucket.threads.length} low-severity cosmetic threads.`,
          orderValues.length <= 3 ? "Orders stay concentrated rather than article-wide." : null,
        ]).slice(0, 6),
        strongestCounterevidence: uniqueValues([
          bucket.threads.some((thread) =>
            thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
              (item) => item.relatedProductCount >= 2,
            ),
          )
            ? "Shared part+batch anchors may point to a supplier issue instead."
            : null,
          stats.claimOnlyRatio > 0.35
            ? "Claim-only leakage is too strong for a pure handling explanation."
            : null,
        ]).slice(0, 6),
        bestCompetingFamilies: uniqueValues([
          bucket.threads.some((thread) =>
            thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors.some(
              (item) => item.relatedProductCount >= 2,
            ),
          )
            ? "supplier_batch_material"
            : null,
          stats.claimOnlyRatio > 0.35 ? "latent_design_escape" : null,
        ]) as MechanismFamily[],
        statistics: stats,
      } satisfies Stage2CandidateFamily;
    });
}

function buildDetectorHotspotCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const buckets = new Map<string, { anchor: string; threads: ClusteredProductDossier[] }>();

  for (const thread of dossier.productThreads) {
    const hypothesisSignals = ensureThreadHypothesisSignals(thread, dossier, context);

    if (!hypothesisSignals.detectorHotspotOnly) {
      continue;
    }

    const anchor =
      thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections[0]?.value ??
      thread.summaryFeatures.testKeysMarginalFail[0] ??
      "detector-hotspot";
    const current = buckets.get(anchor) ?? { anchor, threads: [] };
    current.threads.push(thread);
    buckets.set(anchor, current);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      threads: uniqueBy(bucket.threads, (thread) => thread.productId),
    }))
    .filter((bucket) => bucket.threads.length >= 2)
    .map((bucket) => {
      const articleBackgroundCount =
        context.detectedSectionProductCounts.get(bucket.anchor) ??
        context.testKeyProductCounts.get(bucket.anchor) ??
        bucket.threads.length;
      const stats = buildCandidateStatistics({
        threads: bucket.threads,
        context,
        articleBackgroundCount,
      });

      return {
        candidateFamilyId: `CFAM-detector-${toStableToken(bucket.anchor)}`,
        family: "detector_hotspot_noise" as const,
        title: `${bucket.anchor} detector hotspot`,
        shouldReviewAs: stats.backgroundPrevalencePenalty >= 0.45 ? "noise" : "watchlist",
        dominantAnchor: bucket.anchor,
        supportingProductIds: bucket.threads.map((thread) => thread.productId),
        supportingSignalIds: uniqueValues(
          bucket.threads.flatMap((thread) => thread.signals.map((signal) => signal.signalId)),
        ).slice(0, 120),
        signalTypesPresent: uniqueValues(
          bucket.threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
        ),
        discriminativeAnchors: [bucket.anchor],
        broadContextAnchors: uniqueValues(
          bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).broadContextAnchors.slice(0, 2),
          ),
        ).slice(0, 6),
        requiredEvidencePresent: [
          "Detected-section or marginal-only evidence dominates.",
          "No stronger occurrence-side family explains the same slice.",
        ],
        requiredEvidenceMissing: [],
        strongestEvidence: uniqueValues([
          `${bucket.anchor} recurs mainly as detected-side or marginal-only evidence.`,
          ...bucket.threads.flatMap((thread) =>
            thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.slice(0, 1),
          ),
        ]).slice(0, 6),
        strongestCounterevidence: uniqueValues([
          bucket.threads.some(
            (thread) =>
              thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.length > 0,
          )
            ? "Some products still carry occurrence-side evidence, so this may not be pure detector noise."
            : null,
        ]).slice(0, 6),
        bestCompetingFamilies: uniqueValues([
          bucket.threads.some(
            (thread) =>
              thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.length > 0,
          )
            ? "process_window_calibration"
            : null,
        ]) as MechanismFamily[],
        statistics: stats,
      } satisfies Stage2CandidateFamily;
    });
}

function buildFalsePositiveCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const threads = dossier.productThreads.filter(
    (thread) => ensureThreadHypothesisSignals(thread, dossier, context).falsePositiveFlag,
  );

  if (threads.length < 2) {
    return [] as Stage2CandidateFamily[];
  }

  const stats = buildCandidateStatistics({
    threads,
    context,
    articleBackgroundCount: threads.length,
  });

  return [
    {
      candidateFamilyId: "CFAM-false-positive-noise",
      family: "false_positive_noise",
      title: "False-positive cluster",
      shouldReviewAs: "noise",
      dominantAnchor: "false-positive language",
      supportingProductIds: threads.map((thread) => thread.productId),
      supportingSignalIds: uniqueValues(
        threads.flatMap((thread) => thread.signals.map((signal) => signal.signalId)),
      ).slice(0, 120),
      signalTypesPresent: uniqueValues(
        threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
      ),
      discriminativeAnchors: ["false-positive language"],
      broadContextAnchors: [],
      requiredEvidencePresent: [
        "False-positive or no-defect language is present directly in the evidence.",
      ],
      requiredEvidenceMissing: [],
      strongestEvidence: uniqueValues(
        threads.flatMap((thread) =>
          thread.mechanismEvidence.confounderEvidence.falsePositiveMarkers.slice(0, 1),
        ),
      ).slice(0, 6),
      strongestCounterevidence: [],
      bestCompetingFamilies: [],
      statistics: stats,
    },
  ];
}

function buildNearLimitCandidates(
  dossier: ClusteredArticleDossier,
  context: ArticleMechanismContext,
) {
  const buckets = new Map<string, { testKey: string; threads: ClusteredProductDossier[] }>();

  for (const thread of dossier.productThreads) {
    if (!thread.mechanismEvidence.confounderEvidence.marginalOnlySignals) {
      continue;
    }

    const testKey = thread.summaryFeatures.testKeysMarginalFail[0];

    if (!testKey) {
      continue;
    }

    const current = buckets.get(testKey) ?? { testKey, threads: [] };
    current.threads.push(thread);
    buckets.set(testKey, current);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      threads: uniqueBy(bucket.threads, (thread) => thread.productId),
    }))
    .filter((bucket) => bucket.threads.length >= 2)
    .map((bucket) => {
      const articleBackgroundCount =
        context.testKeyProductCounts.get(bucket.testKey) ?? bucket.threads.length;
      const stats = buildCandidateStatistics({
        threads: bucket.threads,
        context,
        articleBackgroundCount,
      });

      return {
        candidateFamilyId: `CFAM-near-limit-${toStableToken(bucket.testKey)}`,
        family: "near_limit_leading_indicator" as const,
        title: `${bucket.testKey} near-limit leading indicator`,
        shouldReviewAs: "watchlist",
        dominantAnchor: bucket.testKey,
        supportingProductIds: bucket.threads.map((thread) => thread.productId),
        supportingSignalIds: uniqueValues(
          bucket.threads.flatMap((thread) =>
            thread.tests
              .filter((test) => test.testKey === bucket.testKey)
              .map((test) => test.id),
          ),
        ).slice(0, 120),
        signalTypesPresent: uniqueValues(
          bucket.threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent),
        ),
        discriminativeAnchors: [bucket.testKey],
        broadContextAnchors: uniqueValues(
          bucket.threads.flatMap((thread) =>
            ensureThreadHypothesisSignals(thread, dossier, context).broadContextAnchors.slice(0, 2),
          ),
        ).slice(0, 6),
        requiredEvidencePresent: [
          "Marginal-only or near-limit tests repeat across products.",
        ],
        requiredEvidenceMissing: [],
        strongestEvidence: uniqueValues([
          `${bucket.testKey} repeats without a stronger confirmed-failure story.`,
          ...bucket.threads.flatMap((thread) =>
            thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.slice(0, 1),
          ),
        ]).slice(0, 6),
        strongestCounterevidence: uniqueValues([
          bucket.threads.some((thread) => thread.defects.length > 0)
            ? "Some products also have defect rows, so this may be more than an early warning."
            : null,
        ]).slice(0, 6),
        bestCompetingFamilies: uniqueValues([
          bucket.threads.some((thread) => thread.defects.length > 0)
            ? "process_window_calibration"
            : null,
        ]) as MechanismFamily[],
        statistics: stats,
      } satisfies Stage2CandidateFamily;
    });
}

function buildStage2CandidateFamilies(
  dossier: ClusteredArticleDossier,
  context = buildArticleMechanismContext(dossier),
) {
  const candidates = [
    ...buildSupplierBatchCandidates(dossier, context),
    ...buildProcessWindowCandidates(dossier, context),
    ...buildDesignEscapeCandidates(dossier, context),
    ...buildHandlingCandidates(dossier, context),
    ...buildDetectorHotspotCandidates(dossier, context),
    ...buildFalsePositiveCandidates(dossier, context),
    ...buildNearLimitCandidates(dossier, context),
  ];
  const deduped = new Map<string, Stage2CandidateFamily>();

  for (const candidate of candidates) {
    const key = [
      candidate.family,
      candidate.dominantAnchor,
      [...candidate.supportingProductIds].sort().join(","),
    ].join("|");

    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const dispositionRank = {
        case: 3,
        watchlist: 2,
        incident: 1,
        noise: 0,
      } satisfies Record<CandidateFamilyDisposition, number>;
      const rankDelta =
        dispositionRank[right.shouldReviewAs] - dispositionRank[left.shouldReviewAs];

      if (rankDelta !== 0) {
        return rankDelta;
      }

      const scoreDelta =
        right.statistics.lift -
        right.statistics.backgroundPrevalencePenalty -
        (left.statistics.lift - left.statistics.backgroundPrevalencePenalty);

      if (scoreDelta !== 0) {
        return scoreDelta > 0 ? 1 : -1;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, 48);
}

function ensureStage2CandidateFamilies(
  dossier: ClusteredArticleDossier,
  context = buildArticleMechanismContext(dossier),
) {
  return dossier.candidateFamilies ?? buildStage2CandidateFamilies(dossier, context);
}

function buildFallbackProductThreadSynthesis(input: {
  productId: string;
  articleId: string;
  signalTimeline: ProductSignalTimelineItem[];
  summaryFeatures: ClusteredProductDossier["summaryFeatures"];
  mechanismEvidence: ProductMechanismEvidence;
}) {
  const recentSignals = input.signalTimeline.slice(-4);

  return {
    productSummary: recentSignals.length
      ? `${input.productId} in ${input.articleId} carries ${input.signalTimeline.length} recorded signals across ${input.summaryFeatures.signalTypesPresent.length} signal families.`
      : `${input.productId} in ${input.articleId} currently has no recorded quality signals in the dossier scope.`,
    timeline: recentSignals.map(
      (signal) => `${signal.occurredAt}: ${signal.headline} (${signal.section ?? "section unknown"})`,
    ),
    evidenceFeatures: {
      confirmedFailures: input.summaryFeatures.defectCodesPresent.slice(0, 6),
      marginalSignals: input.summaryFeatures.testKeysMarginalFail.slice(0, 6),
      traceHighlights: [
        ...input.summaryFeatures.bomFindNumbers.slice(0, 3),
        ...input.summaryFeatures.supplierBatches.slice(0, 3),
        ...input.mechanismEvidence.traceabilityEvidence.productAnchorCandidates
          .map((item) => item.anchorValue)
          .slice(0, 2),
      ].slice(0, 6),
      serviceSignals: input.summaryFeatures.fieldClaimWithoutFactoryDefect
        ? [
            "Field claim exists without a prior factory defect.",
            ...input.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.slice(
              0,
              2,
            ),
          ]
        : input.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.slice(
            0,
            2,
          ),
      contradictions: [],
    },
    suspiciousPatterns: [
      ...input.summaryFeatures.reportedPartNumbers.slice(0, 3).map(
        (part) => `Reported part focus around ${part}.`,
      ),
      ...input.summaryFeatures.supplierBatches.slice(0, 2).map(
        (batch) => `Traceability touches supplier batch ${batch}.`,
      ),
      ...input.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.slice(0, 2),
      ...input.mechanismEvidence.fieldLeakEvidence.latentFailureHints.slice(0, 2),
    ].slice(0, 6),
    possibleNoiseFlags: [
      ...input.summaryFeatures.falsePositiveMarkers.slice(0, 4),
      ...input.mechanismEvidence.confounderEvidence.detectionBiasRisk.slice(0, 2),
      ...input.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.slice(0, 2),
    ].slice(0, 6),
    openQuestions: [
      input.summaryFeatures.fieldClaimWithoutFactoryDefect
        ? "Why is there a field claim without a corresponding factory defect trail?"
        : null,
      input.summaryFeatures.reworkPresent
        ? "Did rework change the apparent symptom path for this unit?"
        : null,
      input.mechanismEvidence.traceabilityEvidence.blastRadiusHints[0]
        ? `Why does ${input.mechanismEvidence.traceabilityEvidence.blastRadiusHints[0].anchorValue} connect to ${input.mechanismEvidence.traceabilityEvidence.blastRadiusHints[0].relatedProductCount} scoped products?`
        : null,
    ].filter((value): value is string => Boolean(value)),
  } satisfies ProductThreadSynthesis;
}

function buildStage1PromptPayload(input: {
  product: ProductRow;
  articleName: string | null;
  sourceCounts: ClusteredProductDossier["sourceCounts"];
  signalTimeline: ProductSignalTimelineItem[];
  summaryFeatures: ClusteredProductDossier["summaryFeatures"];
  mechanismEvidence: ProductMechanismEvidence;
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  tests: ManexTestSignal[];
  rework: ManexReworkRecord[];
  actions: ManexWorkflowAction[];
  installedParts: ManexInstalledPart[];
}) {
  const recentTimeline = input.signalTimeline.slice(-16);
  const recentDefects = input.defects.slice(-10);
  const recentClaims = input.claims.slice(-8);
  const recentTests = input.tests.slice(-10);
  const recentRework = input.rework.slice(-8);
  const recentActions = input.actions.slice(-8);
  const installedPartSample = input.installedParts.slice(0, 20);

  return {
    product: {
      productId: input.product.product_id,
      articleId: input.product.article_id,
      articleName: input.articleName,
      buildTs: safeIso(input.product.build_ts),
      orderId: normalizeNullableText(input.product.order_id),
    },
    sourceCounts: input.sourceCounts,
    truncationSummary: {
      timeline: {
        surfaced: recentTimeline.length,
        total: input.signalTimeline.length,
      },
      defects: {
        surfaced: recentDefects.length,
        total: input.defects.length,
      },
      claims: {
        surfaced: recentClaims.length,
        total: input.claims.length,
      },
      tests: {
        surfaced: recentTests.length,
        total: input.tests.length,
      },
      rework: {
        surfaced: recentRework.length,
        total: input.rework.length,
      },
      actions: {
        surfaced: recentActions.length,
        total: input.actions.length,
      },
      installedParts: {
        surfaced: installedPartSample.length,
        total: input.installedParts.length,
      },
    },
    timeline: recentTimeline.map((signal) => ({
      signalId: signal.signalId,
      signalType: signal.signalType,
      occurredAt: signal.occurredAt,
      severity: signal.severity,
      headline: signal.headline,
      notePreview: signal.notePreview,
      section: signal.section,
      sourceContext: signal.sourceContext,
    })),
    evidenceFeatures: input.summaryFeatures,
    mechanismEvidence: {
      traceabilityEvidence: {
        productAnchorCandidates:
          input.mechanismEvidence.traceabilityEvidence.productAnchorCandidates.slice(0, 4),
        partBatchAnchors: input.mechanismEvidence.traceabilityEvidence.partBatchAnchors
          .slice(0, 3)
          .map((item) => ({
            anchorValue: item.anchorValue,
            partNumber: item.partNumber,
            batchRef: item.batchRef,
            relatedProductCount: item.relatedProductCount,
            bomPositions: item.bomPositions.slice(0, 4),
            suppliers: item.suppliers.slice(0, 4),
          })),
        dominantTraceAnchors:
          input.mechanismEvidence.traceabilityEvidence.dominantTraceAnchors.slice(0, 4),
        traceabilityNeighborhood:
          input.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood
            .slice(0, 3)
            .map((item) => ({
              productId: item.productId,
              orderId: item.orderId,
              buildTs: item.buildTs,
              matchedInstallCount: item.matchedInstallCount,
              sharedAnchorTypes: item.sharedAnchorTypes,
              sharedAnchorValues: item.sharedAnchorValues.slice(0, 4),
              sharedPartNumbers: item.sharedPartNumbers.slice(0, 4),
              sharedFindNumbers: item.sharedFindNumbers.slice(0, 4),
              sharedBatchNumbers: item.sharedBatchNumbers.slice(0, 4),
            })),
        anchorSpecificity: input.mechanismEvidence.traceabilityEvidence.anchorSpecificity
          .slice(0, 4)
          .map((item) => ({
            anchorType: item.anchorType,
            anchorValue: item.anchorValue,
            specificity: item.specificity,
            relatedProductCount: item.relatedProductCount,
            reason: trimPreview(item.reason, 140),
          })),
        cooccurringAnchorBundles:
          input.mechanismEvidence.traceabilityEvidence.cooccurringAnchorBundles
            .slice(0, 3)
            .map((item) => ({
              bundleKey: item.bundleKey,
              partNumbers: item.partNumbers,
              batchRefs: item.batchRefs,
              bomPositions: item.bomPositions,
              relatedProductCount: item.relatedProductCount,
              reason: trimPreview(item.reason, 140),
            })),
        blastRadiusHints: input.mechanismEvidence.traceabilityEvidence.blastRadiusHints
          .slice(0, 2)
          .map((item) => ({
            anchorType: item.anchorType,
            anchorValue: item.anchorValue,
            relatedProductCount: item.relatedProductCount,
            sharedPartNumbers: item.sharedPartNumbers.slice(0, 6),
            sharedBomPositions: item.sharedBomPositions.slice(0, 6),
            sharedSupplierBatches: item.sharedSupplierBatches.slice(0, 6),
          })),
        blastRadiusSuspects:
          input.mechanismEvidence.traceabilityEvidence.blastRadiusSuspects
            .slice(0, 2)
            .map((item) => ({
              anchorType: item.anchorType,
              anchorValue: item.anchorValue,
              partNumber: item.partNumber,
              batchNumber: item.batchNumber,
              affectedProductCount: item.affectedProductCount,
              concentrationRatio: item.concentrationRatio,
              reason: trimPreview(item.reason, 140),
            })),
        batchConcentrationHints:
          input.mechanismEvidence.traceabilityEvidence.batchConcentrationHints.slice(0, 4),
        traceabilityConcentrationHints:
          input.mechanismEvidence.traceabilityEvidence.traceabilityConcentrationHints.slice(0, 4),
      },
      temporalProcessEvidence: {
        buildWeek: input.mechanismEvidence.temporalProcessEvidence.buildWeek,
        firstFactorySignalWeek:
          input.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek,
        lastFactorySignalWeek:
          input.mechanismEvidence.temporalProcessEvidence.lastFactorySignalWeek,
        defectWeeks: input.mechanismEvidence.temporalProcessEvidence.defectWeeks.slice(-6),
        testWeeks: input.mechanismEvidence.temporalProcessEvidence.testWeeks.slice(-6),
        dominantOccurrenceSections:
          input.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.slice(0, 4),
        dominantDetectedSections:
          input.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections.slice(0, 4),
        dominantTestResults:
          input.mechanismEvidence.temporalProcessEvidence.dominantTestResults.slice(0, 2),
        occurrenceDetectedMismatch:
          input.mechanismEvidence.temporalProcessEvidence.occurrenceDetectedMismatch,
        temporalBurstHints:
          input.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.slice(0, 4),
        postWindowQuietHints:
          input.mechanismEvidence.temporalProcessEvidence.postWindowQuietHints.slice(0, 3),
        temporalContainmentHints:
          input.mechanismEvidence.temporalProcessEvidence.temporalContainmentHints.slice(0, 4),
        marginalVsFailHints:
          input.mechanismEvidence.temporalProcessEvidence.marginalVsFailHints.slice(0, 4),
      },
      fieldLeakEvidence: {
        claimOnlyThread: input.mechanismEvidence.fieldLeakEvidence.claimOnlyThread,
        hasPriorFactoryDefect:
          input.mechanismEvidence.fieldLeakEvidence.hasPriorFactoryDefect,
        buildToClaimDays: input.mechanismEvidence.fieldLeakEvidence.buildToClaimDays.slice(0, 8),
        claimLagBucket: input.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
        claimLagStats: input.mechanismEvidence.fieldLeakEvidence.claimLagStats,
        dominantClaimReportedParts:
          input.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts.slice(0, 4),
        dominantClaimBomPositions:
          input.mechanismEvidence.fieldLeakEvidence.dominantClaimBomPositions.slice(0, 4),
        latentFailureHints:
          input.mechanismEvidence.fieldLeakEvidence.latentFailureHints.slice(0, 4),
      },
      operatorHandlingEvidence: {
        orderId: input.mechanismEvidence.operatorHandlingEvidence.orderId,
        dominantReworkUsers:
          input.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers.slice(0, 4),
        orderClusterHints:
          input.mechanismEvidence.operatorHandlingEvidence.orderClusterHints.slice(0, 4),
        userConcentrationHints:
          input.mechanismEvidence.operatorHandlingEvidence.userConcentrationHints.slice(0, 4),
        cosmeticOnlySignals:
          input.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals,
        lowSeverityOnly: input.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly,
        fieldImpactPresent:
          input.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent,
        handlingPatternHints:
          input.mechanismEvidence.operatorHandlingEvidence.handlingPatternHints.slice(0, 4),
      },
      confounderEvidence: {
        falsePositiveMarkers:
          input.mechanismEvidence.confounderEvidence.falsePositiveMarkers.slice(0, 4),
        marginalOnlySignals:
          input.mechanismEvidence.confounderEvidence.marginalOnlySignals,
        detectionBiasRisk:
          input.mechanismEvidence.confounderEvidence.detectionBiasRisk.slice(0, 4),
        lowVolumePeriodRisk:
          input.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.slice(0, 4),
        mixedServiceDocumentationSignals:
          input.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.slice(0, 4),
        nearLimitTestSignals:
          input.mechanismEvidence.confounderEvidence.nearLimitTestSignals.slice(0, 4),
      },
    },
    defects: recentDefects.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      code: item.code,
      severity: item.severity,
      reportedPartNumber: item.reportedPartNumber,
      detectedSectionName: item.detectedSectionName,
      occurrenceSectionName: item.occurrenceSectionName,
      detectedTestName: item.detectedTestName,
      detectedTestOverall: item.detectedTestOverall,
      notes: item.notes,
    })),
    claims: recentClaims.map((item) => ({
      id: item.id,
      claimedAt: item.claimedAt,
      market: item.market,
      mappedDefectCode: item.mappedDefectCode,
      mappedDefectSeverity: item.mappedDefectSeverity,
      daysFromBuild: item.daysFromBuild,
      reportedPartNumber: item.reportedPartNumber,
      complaintText: item.complaintText,
      notes: item.notes,
    })),
    tests: recentTests.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      overallResult: item.overallResult,
      testKey: item.testKey,
      testValue: item.testValue,
      unit: item.unit,
      sectionName: item.sectionName,
      notes: item.notes,
    })),
    installedParts: installedPartSample.map((item) => ({
      findNumber: item.findNumber,
      positionCode: item.positionCode,
      partNumber: item.partNumber,
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      supplierName: item.supplierName,
    })),
    rework: recentRework.map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      sectionId: item.sectionId,
      reportedPartNumber: item.reportedPartNumber,
      actionText: item.actionText,
      userId: item.userId,
    })),
    actions: recentActions.map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      actionType: item.actionType,
      status: item.status,
      sectionId: item.sectionId,
      defectId: item.defectId,
      comments: item.comments,
    })),
  };
}

function ensureStage1Synthesis(thread: ClusteredProductDossier) {
  if (
    thread.stage1Synthesis &&
    typeof thread.stage1Synthesis === "object" &&
    typeof thread.stage1Synthesis.productSummary === "string"
  ) {
    return thread.stage1Synthesis;
  }

  return buildFallbackProductThreadSynthesis({
    productId: thread.productId,
    articleId: thread.articleId,
    signalTimeline: thread.signals,
    summaryFeatures: thread.summaryFeatures,
    mechanismEvidence: thread.mechanismEvidence,
  });
}

function ensureMechanismEvidence(
  thread: ClusteredProductDossier,
  articleScope = createTraceabilityScope(thread.installedParts),
) {
  if (
    thread.mechanismEvidence &&
    typeof thread.mechanismEvidence === "object" &&
    typeof thread.mechanismEvidence.traceabilityEvidence === "object" &&
    Array.isArray(thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors) &&
    Array.isArray(thread.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood) &&
    Array.isArray(thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity) &&
    Array.isArray(thread.mechanismEvidence.traceabilityEvidence.cooccurringAnchorBundles) &&
    Array.isArray(thread.mechanismEvidence.traceabilityEvidence.blastRadiusSuspects) &&
    Array.isArray(thread.mechanismEvidence.traceabilityEvidence.dominantTraceAnchors) &&
    typeof thread.mechanismEvidence.temporalProcessEvidence?.firstFactorySignalWeek !== "undefined" &&
    Array.isArray(thread.mechanismEvidence.temporalProcessEvidence?.marginalVsFailHints) &&
    typeof thread.mechanismEvidence.fieldLeakEvidence?.claimLagStats === "object" &&
    Array.isArray(thread.mechanismEvidence.operatorHandlingEvidence?.orderClusterHints) &&
    Array.isArray(thread.mechanismEvidence.confounderEvidence?.nearLimitTestSignals)
  ) {
    return thread.mechanismEvidence;
  }

  const traceabilityEvidence = buildProductTraceabilityEvidence(
    thread.installedParts,
    articleScope,
  );

  return buildMechanismEvidence({
    product: {
      product_id: thread.productId,
      article_id: thread.articleId,
      order_id: thread.orderId,
      build_ts: thread.buildTs,
    },
    defects: thread.defects,
    claims: thread.claims,
    tests: thread.tests,
    rework: thread.rework,
    actions: thread.actions,
    installedParts: thread.installedParts,
    weeklyQualitySnippets: thread.weeklyQualitySnippets,
    summaryFeatures: thread.summaryFeatures,
    traceabilityEvidence,
  });
}

function hydrateArticleDossier(dossier: ClusteredArticleDossier | null) {
  if (!dossier) {
    return null;
  }

  const articleScope = createTraceabilityScope(
    dossier.rawEvidenceAppendix.installs.length
      ? dossier.rawEvidenceAppendix.installs
      : dossier.productThreads.flatMap((thread) => thread.installedParts),
  );

  return {
    ...dossier,
    productThreads: dossier.productThreads.map((thread) => {
      const mechanismEvidence = ensureMechanismEvidence(thread, articleScope);

      return {
        ...thread,
        mechanismEvidence,
        stage1Synthesis: ensureStage1Synthesis({
          ...thread,
          mechanismEvidence,
        }),
      };
    }),
  } satisfies ClusteredArticleDossier;
}

async function loadArticleMeta(articleId: string) {
  const [articleRows, productRows] = await Promise.all([
    queryPostgres<ArticleRow>(
      `
        SELECT article_id, name
        FROM article
        WHERE article_id = $1
        LIMIT 1
      `,
      [articleId],
    ),
    queryPostgres<ProductRow>(
      `
        SELECT product_id, article_id, order_id, build_ts
        FROM product
        WHERE article_id = $1
        ORDER BY build_ts ASC NULLS LAST, product_id ASC
      `,
      [articleId],
    ),
  ]);

  return {
    article: articleRows?.[0] ?? null,
    products: productRows ?? [],
  };
}

function buildProductContextMap(products: ProductRow[], articleName: string | null) {
  return new Map(
    products.map((product) => [
      product.product_id,
      {
        articleId: product.article_id,
        articleName,
        orderId: normalizeNullableText(product.order_id),
        productBuiltAt: safeIso(product.build_ts),
      },
    ]),
  );
}

function mapInstalledPartBatchRow(
  row: InstalledPartBatchRow,
  context?: {
    articleId: string;
    articleName: string | null;
    orderId: string | null;
    productBuiltAt: string | null;
  },
): ManexInstalledPart {
  return {
    productId: row.product_id,
    articleId: context?.articleId ?? null,
    articleName: context?.articleName ?? null,
    orderId: context?.orderId ?? null,
    productBuiltAt: context?.productBuiltAt ?? null,
    installId: row.install_id,
    installedAt: safeIso(row.installed_ts),
    installedSectionId: normalizeNullableText(row.installed_section_id),
    positionCode: normalizeNullableText(row.position_code),
    installUserId: normalizeNullableText(row.install_user_id),
    bomNodeId: row.bom_node_id,
    findNumber: normalizeNullableText(row.find_number),
    nodeType: normalizeNullableText(row.node_type),
    parentFindNumber: normalizeNullableText(row.parent_find_number),
    parentNodeType: normalizeNullableText(row.parent_node_type),
    partNumber: row.part_number,
    partTitle: normalizeNullableText(row.part_title),
    commodity: normalizeNullableText(row.commodity),
    drawingNumber: normalizeNullableText(row.drawing_number),
    partId: row.part_id,
    serialNumber: normalizeNullableText(row.serial_number),
    qualityStatus: normalizeNullableText(row.quality_status),
    manufacturerName: normalizeNullableText(row.manufacturer_name),
    batchId: normalizeNullableText(row.batch_id),
    batchNumber: normalizeNullableText(row.batch_number),
    supplierName: normalizeNullableText(row.supplier_name),
    supplierId: normalizeNullableText(row.supplier_id),
    batchReceivedDate: safeIso(row.batch_received_date),
  };
}

function mapActionBatchRow(row: ActionBatchRow): ManexWorkflowAction {
  return {
    id: row.action_id,
    productId: row.product_id,
    recordedAt: new Date(row.ts).toISOString(),
    actionType: row.action_type,
    status: row.status,
    userId: normalizeNullableText(row.user_id),
    sectionId: normalizeNullableText(row.section_id),
    comments: normalizeText(row.comments),
    defectId: normalizeNullableText(row.defect_id),
  };
}

function mapReworkBatchRow(row: ReworkBatchRow): ManexReworkRecord {
  return {
    id: row.rework_id,
    defectId: row.defect_id,
    productId: row.product_id,
    recordedAt: new Date(row.ts).toISOString(),
    sectionId: normalizeNullableText(row.rework_section_id),
    actionText: normalizeText(row.action_text),
    reportedPartNumber: normalizeNullableText(row.reported_part_number),
    userId: normalizeNullableText(row.user_id),
    imageUrl: resolveManexImageUrl(row.image_url),
    timeMinutes:
      row.time_minutes === null || row.time_minutes === undefined
        ? null
        : Number(row.time_minutes),
    cost:
      row.cost === null || row.cost === undefined
        ? null
        : Number(row.cost),
  };
}

async function loadInstalledPartsByProduct(
  products: ProductRow[],
  articleName: string | null,
) {
  if (!products.length) {
    return new Map<string, ManexInstalledPart[]>();
  }

  const productIds = products.map((product) => product.product_id);
  const contextByProduct = buildProductContextMap(products, articleName);
  const rows =
    (await queryPostgres<InstalledPartBatchRow>(
      `
        SELECT
          product_id,
          install_id,
          installed_ts,
          installed_section_id,
          position_code,
          install_user_id,
          bom_node_id,
          find_number,
          node_type,
          parent_find_number,
          parent_node_type,
          part_number,
          part_title,
          commodity,
          drawing_number,
          part_id,
          serial_number,
          quality_status,
          manufacturer_name,
          batch_id,
          batch_number,
          supplier_name,
          supplier_id,
          batch_received_date
        FROM v_product_bom_parts
        WHERE product_id = ANY($1::text[])
        ORDER BY product_id ASC, installed_ts ASC NULLS LAST, install_id ASC
      `,
      [productIds],
    )) ?? [];

  return groupBy(
    rows.map((row) => mapInstalledPartBatchRow(row, contextByProduct.get(row.product_id))),
    (item) => item.productId,
  );
}

async function loadActionsByProduct(products: ProductRow[]) {
  if (!products.length) {
    return new Map<string, ManexWorkflowAction[]>();
  }

  const productIds = products.map((product) => product.product_id);
  const rows =
    (await queryPostgres<ActionBatchRow>(
      `
        SELECT
          action_id,
          product_id,
          ts,
          action_type,
          status,
          user_id,
          section_id,
          comments,
          defect_id
        FROM product_action
        WHERE product_id = ANY($1::text[])
        ORDER BY product_id ASC, ts ASC NULLS LAST, action_id ASC
      `,
      [productIds],
    )) ?? [];

  return groupBy(
    rows.map((row) => mapActionBatchRow(row)),
    (item) => item.productId,
  );
}

async function loadReworkByProduct(products: ProductRow[]) {
  if (!products.length) {
    return new Map<string, ManexReworkRecord[]>();
  }

  const productIds = products.map((product) => product.product_id);
  const rows =
    (await queryPostgres<ReworkBatchRow>(
      `
        SELECT
          rework_id,
          defect_id,
          product_id,
          ts,
          rework_section_id,
          action_text,
          reported_part_number,
          user_id,
          image_url,
          time_minutes,
          cost
        FROM rework
        WHERE product_id = ANY($1::text[])
        ORDER BY product_id ASC, ts ASC NULLS LAST, rework_id ASC
      `,
      [productIds],
    )) ?? [];

  return groupBy(
    rows.map((row) => mapReworkBatchRow(row)),
    (item) => item.productId,
  );
}

export async function buildArticleDossier(
  articleId: string,
  onStageChange?: (stage: "stage1_loading" | "stage1_synthesis", detail: string) => Promise<void>,
  options?: PipelineExecutionOptions,
): Promise<ClusteredArticleDossier> {
  if (!capabilities.hasPostgres) {
    throw new Error("Article dossier building requires DATABASE_URL.");
  }

  throwIfPipelineAborted(options?.abortSignal);
  await ensureTeamCaseClusteringState();

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();

  await onStageChange?.("stage1_loading", "Loading deterministic article dossier.");
  throwIfPipelineAborted(options?.abortSignal);

  const { article, products } = await loadArticleMeta(normalizedArticleId);
  throwIfPipelineAborted(options?.abortSignal);

  if (!article || !products.length) {
    throw new Error(`No products found for article ${normalizedArticleId}.`);
  }

  const data = createManexDataAccess();
  const [
    defectResult,
    claimResult,
    testResult,
    weeklyResult,
    installedPartsByProduct,
    actionsByProduct,
    reworkByProduct,
  ] = await Promise.all([
    data.investigation.findDefects({
      articleId: normalizedArticleId,
      limit: MAX_RELATION_ROWS,
      sort: "newest",
    }),
    data.investigation.findClaimsForArticle(normalizedArticleId, {
      limit: MAX_RELATION_ROWS,
      sort: "newest",
    }),
    data.investigation.findTestSignals({
      articleId: normalizedArticleId,
      outcomes: ["FAIL", "MARGINAL"],
      limit: MAX_RELATION_ROWS,
      sort: "newest",
    }),
    data.quality.findWeeklySummariesForArticle(normalizedArticleId, {
      limit: 64,
      sort: "newest",
    }),
    loadInstalledPartsByProduct(products, article.name),
    loadActionsByProduct(products),
    loadReworkByProduct(products),
  ]);

  const defectsByProduct = groupBy(defectResult.items, (item) => item.productId);
  const claimsByProduct = groupBy(claimResult.items, (item) => item.productId);
  const testsByProduct = groupBy(testResult.items, (item) => item.productId);
  const allInstalledParts = [...installedPartsByProduct.values()].flat();
  const articleTraceabilityScope = createTraceabilityScope(allInstalledParts);
  const productThreadDrafts = products.map((product) => {
      const installedParts = installedPartsByProduct.get(product.product_id) ?? [];
      const actions = actionsByProduct.get(product.product_id) ?? [];
      const rework = reworkByProduct.get(product.product_id) ?? [];
      const defects = defectsByProduct.get(product.product_id) ?? [];
      const claims = claimsByProduct.get(product.product_id) ?? [];
      const tests = testsByProduct.get(product.product_id) ?? [];
      const signalTimeline = buildSignalTimeline({
        defects,
        claims,
        tests,
        rework,
        actions,
      });
      const traceabilityEvidence = buildProductTraceabilityEvidence(
        installedParts,
        articleTraceabilityScope,
      );
      const traceabilitySnapshot = buildTraceabilitySnapshot(traceabilityEvidence);
      const evidenceFrames = buildEvidenceFrames(defects, claims);
      const summaryFeatures = buildSummaryFeatures({
        product,
        defects,
        claims,
        tests,
        rework,
        actions,
        installedParts,
        signalTimeline,
      });
      const relevantWeeklySummaries = weeklyResult.items
        .filter((item) => item.articleId === normalizedArticleId)
        .slice(0, 6);
      const mechanismEvidence = buildMechanismEvidence({
        product,
        defects,
        claims,
        tests,
        rework,
        actions,
        installedParts,
        weeklyQualitySnippets: relevantWeeklySummaries,
        summaryFeatures,
        traceabilityEvidence,
      });
      const sourceCounts = {
        defects: defects.length,
        claims: claims.length,
        badTests: tests.filter((item) => item.overallResult === "FAIL").length,
        marginalTests: tests.filter((item) => item.overallResult === "MARGINAL").length,
        rework: rework.length,
        actions: actions.length,
        installedParts: installedParts.length,
      };

      return {
        product,
        defects,
        claims,
        tests,
        rework,
        actions,
        installedParts,
        signalTimeline,
        traceabilitySnapshot,
        mechanismEvidence,
        evidenceFrames,
        summaryFeatures,
        relevantWeeklySummaries,
        sourceCounts,
      };
    });

  await onStageChange?.(
    "stage1_synthesis",
    `Synthesizing ${productThreadDrafts.length} product threads.`,
  );
  let completedProductThreads = 0;
  const stage1ProgressStep = Math.max(1, Math.ceil(productThreadDrafts.length / 10));

  const productThreads = await mapWithConcurrency(
    productThreadDrafts,
    STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY,
    async (draft) => {
      throwIfPipelineAborted(options?.abortSignal);
      const stage1PromptPayload = buildStage1PromptPayload({
        product: draft.product,
        articleName: article.name,
        sourceCounts: draft.sourceCounts,
        signalTimeline: draft.signalTimeline,
        summaryFeatures: draft.summaryFeatures,
        mechanismEvidence: draft.mechanismEvidence,
        defects: draft.defects,
        claims: draft.claims,
        tests: draft.tests,
        rework: draft.rework,
        actions: draft.actions,
        installedParts: draft.installedParts,
      });
      const stage1Synthesis =
        draft.signalTimeline.length > 0
          ? await generateProductThreadSynthesis({
              articleId: draft.product.article_id,
              productId: draft.product.product_id,
              promptPayload: stage1PromptPayload,
              abortSignal: options?.abortSignal,
            }).catch((error) => {
              if (isPipelineStopError(error)) {
                throw error;
              }

              return buildFallbackProductThreadSynthesis({
                productId: draft.product.product_id,
                articleId: draft.product.article_id,
                signalTimeline: draft.signalTimeline,
                summaryFeatures: draft.summaryFeatures,
                mechanismEvidence: draft.mechanismEvidence,
              });
            })
          : buildFallbackProductThreadSynthesis({
              productId: draft.product.product_id,
              articleId: draft.product.article_id,
              signalTimeline: draft.signalTimeline,
              summaryFeatures: draft.summaryFeatures,
              mechanismEvidence: draft.mechanismEvidence,
            });

      throwIfPipelineAborted(options?.abortSignal);
      const payload = {
        contractVersion: PRODUCT_DOSSIER_SCHEMA_VERSION,
        productId: draft.product.product_id,
        articleId: draft.product.article_id,
        articleName: article.name,
        buildTs: safeIso(draft.product.build_ts),
        orderId: normalizeNullableText(draft.product.order_id),
        sourceCounts: draft.sourceCounts,
        signals: draft.signalTimeline,
        defects: draft.defects,
        claims: draft.claims,
        tests: draft.tests,
        rework: draft.rework,
        actions: draft.actions,
        installedParts: draft.installedParts,
        weeklyQualitySnippets: draft.relevantWeeklySummaries,
        evidenceFrames: draft.evidenceFrames,
        stage1Synthesis,
        traceabilitySnapshot: draft.traceabilitySnapshot,
        mechanismEvidence: draft.mechanismEvidence,
        summaryFeatures: draft.summaryFeatures,
        existingSurfaceContext: {
          dossierSnapshot: {
            defectCount: draft.defects.length,
            claimCount: draft.claims.length,
            installedPartCount: draft.traceabilitySnapshot.installedPartCount,
            uniqueBatchCount: draft.traceabilitySnapshot.uniqueBatchCount,
            uniqueSupplierCount: draft.traceabilitySnapshot.uniqueSupplierCount,
            openActionCount: draft.actions.filter((item) => item.status !== "done")
              .length,
          },
          traceviewSnapshot: draft.traceabilitySnapshot,
        },
      } satisfies ClusteredProductDossier;

      await upsertTeamProductDossier({
        productId: payload.productId,
        articleId: payload.articleId,
        articleName: payload.articleName,
        buildTs: payload.buildTs,
        orderId: payload.orderId,
        signalCount: payload.signals.length,
        sourceCounts: payload.sourceCounts,
        summaryFeatures: payload.summaryFeatures,
        payload,
      });

      completedProductThreads += 1;

      if (
        completedProductThreads === productThreadDrafts.length ||
        completedProductThreads === 1 ||
        completedProductThreads % stage1ProgressStep === 0
      ) {
        await onStageChange?.(
          "stage1_synthesis",
          `Synthesizing ${productThreadDrafts.length} product threads (${completedProductThreads}/${productThreadDrafts.length}).`,
        );
      }

      return payload;
    },
    options,
  );

  throwIfPipelineAborted(options?.abortSignal);

  const allSignals = productThreads.flatMap((thread) => thread.signals);
  const allInstalls = productThreads.flatMap((thread) => thread.installedParts);
  const articleSummary = {
    sourceCounts: {
      defects: defectResult.items.length,
      claims: claimResult.items.length,
      badTests: testResult.items.filter((item) => item.overallResult === "FAIL").length,
      marginalTests: testResult.items.filter((item) => item.overallResult === "MARGINAL")
        .length,
      rework: productThreads.reduce((total, item) => total + item.rework.length, 0),
      actions: productThreads.reduce((total, item) => total + item.actions.length, 0),
      installedParts: allInstalls.length,
    },
    topDefectCodes: topEntries(
      bucketCounts(
        defectResult.items,
        (item) => item.code,
        (item) => item.productId,
        (item) => item.id,
      ),
      8,
    ),
    topReportedParts: topEntries(
      bucketCounts(
        [...defectResult.items, ...claimResult.items],
        (item) => item.reportedPartNumber,
        (item) => item.productId,
        (item) => item.id,
      ),
      8,
    ),
    topBomPositions: topEntries(
      bucketCounts(
        allInstalls,
        (item) => item.findNumber ?? item.positionCode,
        (item) => item.productId,
      ),
      8,
    ),
    topSections: topEntries(
      bucketCounts(
        productThreads.flatMap((thread) =>
          thread.summaryFeatures.sectionsSeen.map((section) => ({
            productId: thread.productId,
            section,
          })),
        ),
        (item) => item.section,
        (item) => item.productId,
      ),
      8,
    ),
    topSupplierBatches: topEntries(
      bucketCounts(
        allInstalls,
        (item) => item.batchId ?? item.batchNumber,
        (item) => item.productId,
      ),
      8,
    ),
    topProductionOrders: topEntries(
      bucketCounts(
        products,
        (item) => item.order_id,
        (item) => item.product_id,
      ),
      8,
    ),
    fieldClaimOnlyPatterns: topEntries(
      bucketCounts(
        productThreads
          .filter((thread) => thread.summaryFeatures.fieldClaimWithoutFactoryDefect)
          .flatMap((thread) =>
            thread.summaryFeatures.reportedPartNumbers.map((label) => ({
              productId: thread.productId,
              label,
            })),
          ),
        (item) => item.label,
        (item) => item.productId,
      )
        .map((entry) => ({
          label: entry.value,
          count: entry.count,
          productIds: entry.productIds,
        })),
      8,
    ),
    testHotspots: topEntries(
      bucketCounts(
        testResult.items,
        (item) => item.testKey,
        (item) => item.productId,
        (item) => item.id,
      ).map((entry) => ({
        label: entry.value,
        count: entry.count,
        productIds: entry.productIds,
      })),
      8,
    ),
  };

  const dossier = {
    contractVersion: ARTICLE_DOSSIER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    article: {
      articleId: normalizedArticleId,
      articleName: article.name,
      productCount: products.length,
      signaledProductCount: productThreads.filter((item) => item.signals.length > 0).length,
      totalSignals: allSignals.length,
      timeWindow: {
        firstSeenAt: allSignals[0]?.occurredAt ?? null,
        lastSeenAt: allSignals[allSignals.length - 1]?.occurredAt ?? null,
      },
    },
    articleSummary,
    crossProductSummaries: buildCrossProductSummary(
      productThreads,
      defectResult.items,
      claimResult.items,
      testResult.items,
    ),
    productThreads,
    weeklyQualitySummaries: weeklyResult.items,
    rawEvidenceAppendix: {
      defects: defectResult.items,
      claims: claimResult.items,
      tests: testResult.items,
      installs: allInstalls,
      rework: productThreads.flatMap((thread) => thread.rework),
      actions: productThreads.flatMap((thread) => thread.actions),
    },
  } satisfies ClusteredArticleDossier;

  await upsertTeamArticleDossier({
    articleId: dossier.article.articleId,
    articleName: dossier.article.articleName,
    productCount: dossier.article.productCount,
    signalCount: dossier.article.totalSignals,
    summaryPayload: {
      schemaVersion: ARTICLE_DOSSIER_SCHEMA_VERSION,
      articleSummary: dossier.articleSummary,
      crossProductSummaries: dossier.crossProductSummaries,
    },
    payload: dossier,
  });

  return dossier;
}

function chooseRunStrategy(dossier: ClusteredArticleDossier) {
  const proposalPayload = buildStage2ProposalPayload({ dossier });
  const estimatedPromptChars =
    buildPassASystemPrompt().length + buildPassAUserPrompt(proposalPayload).length;

  if (
    dossier.productThreads.length > SINGLE_PASS_PRODUCT_LIMIT ||
    estimatedPromptChars > STAGE2_SINGLE_PASS_PROMPT_CHAR_BUDGET
  ) {
    return "chunked" as const;
  }

  return "single" as const;
}

function estimateStage2ProposalPromptChars(input: {
  dossier: ClusteredArticleDossier;
  productIds?: Set<string>;
  chunkInfo?: {
    chunkIndex: number;
    chunkCount: number;
    productIds: string[];
  };
}) {
  const payload = buildStage2ProposalPayload(input);
  return buildPassASystemPrompt().length + buildPassAUserPrompt(payload).length;
}

function estimateStage2ReviewPromptChars(payload: ReturnType<typeof buildStage2ReviewPayload>) {
  return buildPassBSystemPrompt().length + buildPassBUserPrompt(payload).length;
}

function formatBuildWeek(buildTs: string | null) {
  if (!buildTs) {
    return null;
  }

  return startOfWeek(new Date(buildTs)).toISOString().slice(0, 10);
}

function rankSignalForStage2(signal: ProductSignalTimelineItem) {
  const typeRank =
    signal.signalType === "defect"
      ? 6
      : signal.signalType === "field_claim"
        ? 5
        : signal.signalType === "bad_test"
          ? 4
          : signal.signalType === "rework"
            ? 3
            : signal.signalType === "marginal_test"
              ? 2
              : 1;
  const severityRank =
    /critical|high|major/i.test(signal.severity ?? "")
      ? 3
      : /medium|moderate/i.test(signal.severity ?? "")
        ? 2
        : /low|minor/i.test(signal.severity ?? "")
          ? 1
          : 0;

  return typeRank * 100 + severityRank * 10;
}

function collectDiagnosticTimelineEvents(thread: ClusteredProductDossier) {
  return [...thread.signals]
    .sort((left, right) => {
      const rankDelta = rankSignalForStage2(right) - rankSignalForStage2(left);

      if (rankDelta !== 0) {
        return rankDelta;
      }

      return right.occurredAt.localeCompare(left.occurredAt);
    })
    .slice(0, MAX_STAGE2_DIAGNOSTIC_TIMELINE_EVENTS)
    .sort(byOccurredAtAsc)
    .map((signal) => ({
      signalId: signal.signalId,
      signalType: signal.signalType,
      occurredAt: signal.occurredAt,
      severity: signal.severity,
      headline: trimPreview(signal.headline, 120),
      section: signal.section,
      reportedPartNumber: signal.reportedPartNumber,
      sourceContext: signal.sourceContext,
      notePreview: trimPreview(signal.notePreview, 140),
    }));
}

function collectRawEvidenceSnippets(thread: ClusteredProductDossier) {
  const snippets = [
    ...thread.defects
      .filter((item) => normalizeText(item.notes).length > 0)
      .map((item) => ({
        signalId: item.id,
        signalType: "defect" as const,
        text: trimPreview(item.notes, 180),
      })),
    ...thread.claims
      .filter(
        (item) =>
          normalizeText(item.complaintText).length > 0 || normalizeText(item.notes).length > 0,
      )
      .map((item) => ({
        signalId: item.id,
        signalType: "field_claim" as const,
        text: trimPreview(item.complaintText || item.notes, 180),
      })),
    ...thread.tests
      .filter((item) => normalizeText(item.notes).length > 0)
      .map((item) => ({
        signalId: item.id,
        signalType:
          item.overallResult === "FAIL"
            ? ("bad_test" as const)
            : ("marginal_test" as const),
        text: trimPreview(item.notes, 180),
      })),
    ...thread.rework
      .filter((item) => normalizeText(item.actionText).length > 0)
      .map((item) => ({
        signalId: item.id,
        signalType: "rework" as const,
        text: trimPreview(item.actionText, 180),
      })),
    ...thread.actions
      .filter((item) => normalizeText(item.comments).length > 0)
      .map((item) => ({
        signalId: item.id,
        signalType: "product_action" as const,
        text: trimPreview(item.comments, 180),
      })),
  ];

  return snippets
    .filter(
      (item, index, collection) =>
        collection.findIndex((candidate) => candidate.text === item.text) === index,
    )
    .slice(0, MAX_STAGE2_RAW_SNIPPETS);
}

function toCompactAnchorRows(
  rows: Array<{
    value: string;
    count: number;
    relatedProductCount: number;
  }>,
  limit: number,
) {
  return rows.slice(0, limit).map((row) => ({
    value: row.value,
    count: row.count,
    relatedProductCount: row.relatedProductCount,
  }));
}

function toCompactArticleSummaryRows(
  rows: Array<{
    value: string;
    count: number;
    productIds: string[];
  }>,
  limit: number,
) {
  return rows.slice(0, limit).map((row) => ({
    value: row.value,
    count: row.count,
    productCount: row.productIds.length,
  }));
}

function toCompactArticleLabelRows(
  rows: Array<{
    label: string;
    count: number;
    productIds: string[];
  }>,
  limit: number,
) {
  return rows.slice(0, limit).map((row) => ({
    label: row.label,
    count: row.count,
    productCount: row.productIds.length,
  }));
}

function toStage2ProductClusterCard(thread: ClusteredProductDossier) {
  return {
    productId: thread.productId,
    buildWeek: formatBuildWeek(thread.buildTs),
    orderId: thread.orderId,
    sourceCounts: thread.sourceCounts,
    claimLagSummary: {
      claimLagBucket: thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
      buildToClaimDays: thread.summaryFeatures.daysFromBuildToClaim.slice(0, 5),
      fieldClaimWithoutFactoryDefect: thread.summaryFeatures.fieldClaimWithoutFactoryDefect,
    },
    stage1Summary: {
      productSummary: trimPreview(thread.stage1Synthesis.productSummary, 220),
      timeline: thread.stage1Synthesis.timeline.slice(0, 3),
      evidenceFeatures: {
        confirmedFailures: thread.stage1Synthesis.evidenceFeatures.confirmedFailures.slice(0, 3),
        marginalSignals: thread.stage1Synthesis.evidenceFeatures.marginalSignals.slice(0, 3),
        traceHighlights: thread.stage1Synthesis.evidenceFeatures.traceHighlights.slice(0, 3),
        serviceSignals: thread.stage1Synthesis.evidenceFeatures.serviceSignals.slice(0, 2),
        contradictions: thread.stage1Synthesis.evidenceFeatures.contradictions.slice(0, 2),
      },
      suspiciousPatterns: thread.stage1Synthesis.suspiciousPatterns.slice(0, 3),
      possibleNoiseFlags: thread.stage1Synthesis.possibleNoiseFlags.slice(0, 3),
      openQuestions: thread.stage1Synthesis.openQuestions.slice(0, 2),
    },
    strongestMechanismAnchors: {
      signalTypesPresent: thread.summaryFeatures.signalTypesPresent.slice(0, 5),
      defectCodesPresent: thread.summaryFeatures.defectCodesPresent.slice(0, 5),
      testKeysMarginalFail: thread.summaryFeatures.testKeysMarginalFail.slice(0, 5),
      reportedPartNumbers: thread.summaryFeatures.reportedPartNumbers.slice(0, 5),
      bomFindNumbers: thread.summaryFeatures.bomFindNumbers.slice(0, 5),
      supplierBatches: thread.summaryFeatures.supplierBatches.slice(0, 5),
      sectionsSeen: thread.summaryFeatures.sectionsSeen.slice(0, 5),
      ordersSeen: thread.summaryFeatures.ordersSeen.slice(0, 4),
    },
    traceabilityAnchors: {
      dominantInstalledParts: toCompactAnchorRows(
        thread.mechanismEvidence.traceabilityEvidence.dominantInstalledParts,
        3,
      ),
      dominantBomPositions: toCompactAnchorRows(
        thread.mechanismEvidence.traceabilityEvidence.dominantBomPositions,
        3,
      ),
      dominantSupplierBatches: toCompactAnchorRows(
        thread.mechanismEvidence.traceabilityEvidence.dominantSupplierBatches,
        3,
      ),
      dominantSuppliers: toCompactAnchorRows(
        thread.mechanismEvidence.traceabilityEvidence.dominantSuppliers,
        2,
      ),
      productAnchorCandidates:
        thread.mechanismEvidence.traceabilityEvidence.productAnchorCandidates
          .slice(0, 2)
          .map((item) => ({
            anchorType: item.anchorType,
            anchorValue: item.anchorValue,
            reason: trimPreview(item.reason, 80),
          })),
      partBatchAnchors: thread.mechanismEvidence.traceabilityEvidence.partBatchAnchors
        .slice(0, 2)
        .map((item) => ({
          anchorValue: item.anchorValue,
          partNumber: item.partNumber,
          batchRef: item.batchRef,
          relatedProductCount: item.relatedProductCount,
        })),
      dominantTraceAnchors: thread.mechanismEvidence.traceabilityEvidence.dominantTraceAnchors.slice(
        0,
        4,
      ),
      neighborhoodHints:
        thread.mechanismEvidence.traceabilityEvidence.traceabilityNeighborhood
          .slice(0, 2)
          .map(
            (item) =>
              `${item.productId} shares ${item.sharedAnchorTypes.join("/")} anchors ${item.sharedAnchorValues
                .slice(0, 2)
                .join(", ")}.`,
          ),
      anchorSpecificity: thread.mechanismEvidence.traceabilityEvidence.anchorSpecificity
        .slice(0, 3)
        .map(
          (item) =>
            `${item.anchorType}:${item.anchorValue} is ${item.specificity} across ${item.relatedProductCount} products.`,
        ),
      cooccurringBundles:
        thread.mechanismEvidence.traceabilityEvidence.cooccurringAnchorBundles
          .slice(0, 2)
          .map((item) => ({
            bundleKey: item.bundleKey,
            relatedProductCount: item.relatedProductCount,
          })),
      broadAnchorWarnings: [
        ...thread.mechanismEvidence.traceabilityEvidence.blastRadiusHints
          .slice(0, 1)
          .map(
            (item) =>
              `${item.anchorType}:${item.anchorValue} reaches ${item.relatedProductCount} products (ratio ${item.concentrationRatio.toFixed(2)}).`,
          ),
        thread.mechanismEvidence.traceabilityEvidence.blastRadiusSuspects
          .slice(0, 1)
          .map(
            (item) =>
              `${item.anchorType}:${item.anchorValue} may be broad blast radius over ${item.affectedProductCount} products.`,
          ),
      ],
      batchConcentrationHints: thread.mechanismEvidence.traceabilityEvidence.batchConcentrationHints
        .slice(0, 2)
        .map((item) => ({
          batchRef: item.batchRef,
          productCount: item.productIds.length,
          partNumbers: item.partNumbers.slice(0, 2),
          suppliers: item.supplierNames.slice(0, 2),
        })),
      traceabilityConcentrationHints: thread.mechanismEvidence.traceabilityEvidence.traceabilityConcentrationHints.slice(
        0,
        3,
      ),
    },
    temporalProcessAnchors: {
      buildWeek: thread.mechanismEvidence.temporalProcessEvidence.buildWeek,
      firstFactorySignalWeek:
        thread.mechanismEvidence.temporalProcessEvidence.firstFactorySignalWeek,
      lastFactorySignalWeek:
        thread.mechanismEvidence.temporalProcessEvidence.lastFactorySignalWeek,
      dominantOccurrenceSections:
        thread.mechanismEvidence.temporalProcessEvidence.dominantOccurrenceSections.slice(0, 3),
      dominantDetectedSections:
        thread.mechanismEvidence.temporalProcessEvidence.dominantDetectedSections.slice(0, 3),
      dominantTestResults:
        thread.mechanismEvidence.temporalProcessEvidence.dominantTestResults.slice(0, 2),
      occurrenceDetectedMismatch:
        thread.mechanismEvidence.temporalProcessEvidence.occurrenceDetectedMismatch,
      temporalBurstHints:
        thread.mechanismEvidence.temporalProcessEvidence.temporalBurstHints.slice(0, 3),
      postWindowQuietHints:
        thread.mechanismEvidence.temporalProcessEvidence.postWindowQuietHints.slice(0, 2),
      temporalContainmentHints:
        thread.mechanismEvidence.temporalProcessEvidence.temporalContainmentHints.slice(0, 3),
      marginalVsFailHints:
        thread.mechanismEvidence.temporalProcessEvidence.marginalVsFailHints.slice(0, 3),
    },
    fieldLeakAnchors: {
      claimOnlyThread: thread.mechanismEvidence.fieldLeakEvidence.claimOnlyThread,
      hasPriorFactoryDefect: thread.mechanismEvidence.fieldLeakEvidence.hasPriorFactoryDefect,
      claimLagBucket: thread.mechanismEvidence.fieldLeakEvidence.claimLagBucket,
      buildToClaimDays:
        thread.mechanismEvidence.fieldLeakEvidence.buildToClaimDays.slice(0, 4),
      claimLagStats: thread.mechanismEvidence.fieldLeakEvidence.claimLagStats,
      dominantClaimReportedParts:
        thread.mechanismEvidence.fieldLeakEvidence.dominantClaimReportedParts.slice(0, 3),
      dominantClaimBomPositions:
        thread.mechanismEvidence.fieldLeakEvidence.dominantClaimBomPositions.slice(0, 3),
      latentFailureHints:
        thread.mechanismEvidence.fieldLeakEvidence.latentFailureHints.slice(0, 3),
    },
    operatorHandlingAnchors: {
      dominantReworkUsers:
        thread.mechanismEvidence.operatorHandlingEvidence.dominantReworkUsers.slice(0, 3),
      orderClusterHints:
        thread.mechanismEvidence.operatorHandlingEvidence.orderClusterHints.slice(0, 3),
      userConcentrationHints:
        thread.mechanismEvidence.operatorHandlingEvidence.userConcentrationHints.slice(0, 3),
      handlingPatternHints:
        thread.mechanismEvidence.operatorHandlingEvidence.handlingPatternHints.slice(0, 3),
      fieldImpactPresent:
        thread.mechanismEvidence.operatorHandlingEvidence.fieldImpactPresent,
      lowSeverityOnly: thread.mechanismEvidence.operatorHandlingEvidence.lowSeverityOnly,
      cosmeticOnlySignals:
        thread.mechanismEvidence.operatorHandlingEvidence.cosmeticOnlySignals,
    },
    confounders: {
      falsePositiveMarkers: thread.summaryFeatures.falsePositiveMarkers.slice(0, 3),
      marginalOnlySignals: thread.mechanismEvidence.confounderEvidence.marginalOnlySignals,
      detectionBiasRisk:
        thread.mechanismEvidence.confounderEvidence.detectionBiasRisk.slice(0, 3),
      lowVolumePeriodRisk:
        thread.mechanismEvidence.confounderEvidence.lowVolumePeriodRisk.slice(0, 3),
      mixedServiceDocumentationSignals:
        thread.mechanismEvidence.confounderEvidence.mixedServiceDocumentationSignals.slice(0, 3),
      nearLimitTestSignals:
        thread.mechanismEvidence.confounderEvidence.nearLimitTestSignals.slice(0, 3),
    },
    diagnosticTimelineEvents: collectDiagnosticTimelineEvents(thread).slice(0, 3),
    rawEvidenceSnippets: collectRawEvidenceSnippets(thread),
  };
}

function buildStage2ArticleContext(dossier: ClusteredArticleDossier) {
  return {
    article: dossier.article,
    articleSummary: {
      sourceCounts: dossier.articleSummary.sourceCounts,
      topDefectCodes: toCompactArticleSummaryRows(dossier.articleSummary.topDefectCodes, 4),
      topReportedParts: toCompactArticleSummaryRows(dossier.articleSummary.topReportedParts, 4),
      topBomPositions: toCompactArticleSummaryRows(dossier.articleSummary.topBomPositions, 4),
      topSections: toCompactArticleSummaryRows(dossier.articleSummary.topSections, 4),
      topSupplierBatches: toCompactArticleSummaryRows(
        dossier.articleSummary.topSupplierBatches,
        4,
      ),
      topProductionOrders: toCompactArticleSummaryRows(
        dossier.articleSummary.topProductionOrders,
        4,
      ),
      fieldClaimOnlyPatterns: toCompactArticleLabelRows(
        dossier.articleSummary.fieldClaimOnlyPatterns,
        4,
      ),
      testHotspots: toCompactArticleLabelRows(dossier.articleSummary.testHotspots, 4),
    },
    crossProductSummaries: {
      sharedSupplierBatches: dossier.crossProductSummaries.sharedSupplierBatches
        .slice(0, 4)
        .map((item) => ({
          batchRef: item.batchRef,
          count: item.count,
          productCount: item.productIds.length,
          supplierNames: item.supplierNames.slice(0, 2),
          partNumbers: item.partNumbers.slice(0, 2),
        })),
      sharedReportedPartNumbers: dossier.crossProductSummaries.sharedReportedPartNumbers
        .slice(0, 4)
        .map((item) => ({
          partNumber: item.partNumber,
          count: item.count,
          productCount: item.productIds.length,
        })),
      sharedBomFindNumbers: dossier.crossProductSummaries.sharedBomFindNumbers
        .slice(0, 4)
        .map((item) => ({
          findNumber: item.findNumber,
          count: item.count,
          productCount: item.productIds.length,
          partNumbers: item.partNumbers.slice(0, 2),
        })),
      similarClaimThemes: dossier.crossProductSummaries.similarClaimThemes
        .slice(0, 4)
        .map((item) => ({
          keyword: item.keyword,
          count: item.count,
          productCount: item.productIds.length,
        })),
      sharedOrders: dossier.crossProductSummaries.sharedOrders.slice(0, 4).map((item) => ({
        orderId: item.orderId,
        count: item.count,
        productCount: item.productIds.length,
      })),
      sharedReworkUsers: dossier.crossProductSummaries.sharedReworkUsers
        .slice(0, 4)
        .map((item) => ({
          userId: item.userId,
          count: item.count,
          productCount: item.productIds.length,
        })),
      sharedOccurrenceSections: dossier.crossProductSummaries.sharedOccurrenceSections
        .slice(0, 4)
        .map((item) => ({
          section: item.section,
          count: item.count,
          productCount: item.productIds.length,
        })),
      sharedSections: dossier.crossProductSummaries.sharedSections.slice(0, 4).map((item) => ({
        section: item.section,
        count: item.count,
        productCount: item.productIds.length,
      })),
      sharedTestHotspots: dossier.crossProductSummaries.sharedTestHotspots
        .slice(0, 4)
        .map((item) => ({
          testKey: item.testKey,
          count: item.count,
          productCount: item.productIds.length,
        })),
    },
  };
}

function buildStage2ProposalPayload(input: {
  dossier: ClusteredArticleDossier;
  productIds?: Set<string>;
  chunkInfo?: {
    chunkIndex: number;
    chunkCount: number;
    productIds: string[];
  };
}) {
  const selectedThreads = input.productIds
    ? input.dossier.productThreads.filter((thread) => input.productIds?.has(thread.productId))
    : input.dossier.productThreads;

  return {
    articleContext: buildStage2ArticleContext(input.dossier),
    productClusterCards: selectedThreads.map((thread) => toStage2ProductClusterCard(thread)),
    chunkInfo: input.chunkInfo ?? null,
  };
}

function mergeProposalOutputs(outputs: ProposalOutput[], reviewSummary: string): ProposalOutput {
  return {
    contractVersion: CASE_PROPOSAL_SCHEMA_VERSION,
    reviewSummary,
    cases: outputs.flatMap((item) => item.cases),
    incidents: outputs.flatMap((item) => item.incidents),
    watchlists: outputs.flatMap((item) => item.watchlists),
    noise: outputs.flatMap((item) => item.noise),
    unassignedProducts: outputs.flatMap((item) => item.unassignedProducts),
    standaloneSignals: outputs.flatMap((item) => item.standaloneSignals),
    ambiguousLinks: outputs.flatMap((item) => item.ambiguousLinks),
    globalObservations: uniqueValues(
      outputs.flatMap((item) => item.globalObservations),
    ).slice(0, 12),
  };
}

type IncidentAnchorField =
  | "reportedPartNumbers"
  | "defectCodesPresent"
  | "testKeysPresent"
  | "supplierBatches"
  | "bomFindNumbers"
  | "orders";

type IncidentAnchorCounts = Record<IncidentAnchorField, Map<string, number>>;

function buildIncidentAnchorCounts(incidents: ProposalIncident[]): IncidentAnchorCounts {
  const buildCounts = (selector: (incident: ProposalIncident) => string[]) => {
    const counts = new Map<string, number>();

    for (const incident of incidents) {
      for (const value of uniqueValues(selector(incident))) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    return counts;
  };

  return {
    reportedPartNumbers: buildCounts((incident) => incident.reportedPartNumbers),
    defectCodesPresent: buildCounts((incident) => incident.defectCodesPresent),
    testKeysPresent: buildCounts((incident) => incident.testKeysPresent),
    supplierBatches: buildCounts((incident) => incident.supplierBatches),
    bomFindNumbers: buildCounts((incident) => incident.bomFindNumbers),
    orders: buildCounts((incident) => incident.orders),
  };
}

function intersectValues(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return uniqueValues(left.filter((value) => rightSet.has(value)));
}

function getSpecificIncidentAnchorValues(input: {
  values: string[];
  counts: Map<string, number>;
  maxSpecificFrequency: number;
}) {
  return uniqueValues(input.values).filter((value) => {
    const count = input.counts.get(value) ?? 0;
    return count >= 2 && count <= input.maxSpecificFrequency;
  });
}

function buildSharedSpecificIncidentAnchors(input: {
  left: ProposalIncident;
  right: ProposalIncident;
  anchorCounts: IncidentAnchorCounts;
  maxSpecificFrequency: number;
}) {
  const sharedForField = (field: IncidentAnchorField) =>
    getSpecificIncidentAnchorValues({
      values: intersectValues(input.left[field], input.right[field]),
      counts: input.anchorCounts[field],
      maxSpecificFrequency: input.maxSpecificFrequency,
    });

  return {
    reportedPartNumbers: sharedForField("reportedPartNumbers"),
    defectCodesPresent: sharedForField("defectCodesPresent"),
    testKeysPresent: sharedForField("testKeysPresent"),
    supplierBatches: sharedForField("supplierBatches"),
    bomFindNumbers: sharedForField("bomFindNumbers"),
    orders: sharedForField("orders"),
  };
}

function scoreIncidentCaseLink(input: {
  left: ProposalIncident;
  right: ProposalIncident;
  anchorCounts: IncidentAnchorCounts;
  maxSpecificFrequency: number;
}) {
  const shared = buildSharedSpecificIncidentAnchors(input);
  let score = 0;

  if (shared.reportedPartNumbers.length) {
    score += 8;
  }

  if (shared.defectCodesPresent.length) {
    score += 7;
  }

  if (shared.testKeysPresent.length) {
    score += 5;
  }

  if (shared.supplierBatches.length) {
    score += 5;
  }

  if (shared.bomFindNumbers.length) {
    score += 3;
  }

  if (shared.orders.length) {
    score += 2;
  }

  if (input.left.incidentKind === input.right.incidentKind) {
    score += 1;
  }

  const hasStrongAnchor =
    shared.reportedPartNumbers.length > 0 ||
    shared.defectCodesPresent.length > 0 ||
    shared.testKeysPresent.length > 0 ||
    shared.supplierBatches.length > 0;
  const hasMultiLaneSupport =
    [
      shared.reportedPartNumbers,
      shared.defectCodesPresent,
      shared.testKeysPresent,
      shared.supplierBatches,
      shared.bomFindNumbers,
      shared.orders,
    ].filter((values) => values.length > 0).length >= 2;

  return {
    shared,
    score,
    qualifies: hasStrongAnchor && hasMultiLaneSupport && score >= 10,
  };
}

function collectComponentAnchorValues(input: {
  incidents: ProposalIncident[];
  anchorCounts: IncidentAnchorCounts;
  maxSpecificFrequency: number;
}) {
  const collect = (field: IncidentAnchorField) => {
    const counts = new Map<string, number>();

    for (const incident of input.incidents) {
      for (const value of getSpecificIncidentAnchorValues({
        values: incident[field],
        counts: input.anchorCounts[field],
        maxSpecificFrequency: input.maxSpecificFrequency,
      })) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([value]) => value);
  };

  return {
    reportedPartNumbers: collect("reportedPartNumbers"),
    defectCodesPresent: collect("defectCodesPresent"),
    testKeysPresent: collect("testKeysPresent"),
    supplierBatches: collect("supplierBatches"),
    bomFindNumbers: collect("bomFindNumbers"),
    orders: collect("orders"),
  };
}

function summarizeIncidentAnchorFamily(input: {
  incidents: ProposalIncident[];
  sharedAnchors: ReturnType<typeof collectComponentAnchorValues>;
}) {
  const parts = [
    input.sharedAnchors.reportedPartNumbers[0],
    input.sharedAnchors.defectCodesPresent[0],
    input.sharedAnchors.testKeysPresent[0],
    input.sharedAnchors.supplierBatches[0],
    input.sharedAnchors.orders[0],
  ].filter((value): value is string => Boolean(value));

  return parts.slice(0, 3).join(" / ");
}

function derivePromotedCaseKind(input: {
  incidents: ProposalIncident[];
  sharedAnchors: ReturnType<typeof collectComponentAnchorValues>;
}) {
  if (input.sharedAnchors.supplierBatches.length && input.sharedAnchors.reportedPartNumbers.length) {
    return "supplier_batch" as const;
  }

  if (
    input.sharedAnchors.orders.length ||
    input.sharedAnchors.testKeysPresent.includes("VIB_TEST") ||
    input.sharedAnchors.defectCodesPresent.includes("VIB_FAIL")
  ) {
    return "process_drift" as const;
  }

  const kindCounts = new Map<string, number>();

  for (const incident of input.incidents) {
    kindCounts.set(incident.incidentKind, (kindCounts.get(incident.incidentKind) ?? 0) + 1);
  }

  return [...kindCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] as
    | "functional_failure"
    | "process_drift"
    | "supplier_batch"
    | "design_weakness"
    | "service_issue"
    | "cosmetic_issue"
    | "false_positive"
    | "mixed"
    | "other";
}

function buildPromotedCaseFromIncidentGroup(input: {
  incidents: ProposalIncident[];
  anchorCounts: IncidentAnchorCounts;
  maxSpecificFrequency: number;
  index: number;
}): ProposalOutput["cases"][number] | null {
  const sharedAnchors = collectComponentAnchorValues(input);
  const productIds = uniqueValues(input.incidents.map((incident) => incident.productId));

  if (productIds.length < 2) {
    return null;
  }

  const primaryAnchorSummary = summarizeIncidentAnchorFamily({
    incidents: input.incidents,
    sharedAnchors,
  });
  const structuralAnchorCount = [
    sharedAnchors.reportedPartNumbers,
    sharedAnchors.defectCodesPresent,
    sharedAnchors.testKeysPresent,
    sharedAnchors.supplierBatches,
    sharedAnchors.bomFindNumbers,
    sharedAnchors.orders,
  ].filter((values) => values.length > 0).length;

  if (
    structuralAnchorCount < 2 ||
    (!sharedAnchors.reportedPartNumbers.length &&
      !sharedAnchors.defectCodesPresent.length &&
      !sharedAnchors.testKeysPresent.length &&
      !sharedAnchors.supplierBatches.length)
  ) {
    return null;
  }

  const includedSignalIds = uniqueValues(
    input.incidents.flatMap((incident) => incident.includedSignalIds),
  );
  const strongestEvidence = uniqueValues([
    `Recurring across ${productIds.length} products with shared anchors: ${primaryAnchorSummary || "specific defect/process evidence"}.`,
    ...input.incidents.flatMap((incident) => incident.strongestEvidence),
  ]).slice(0, 8);
  const conflictingEvidence = uniqueValues(
    input.incidents.flatMap((incident) => incident.conflictingEvidence),
  ).slice(0, 8);
  const recommendedNextTraceChecks = uniqueValues(
    input.incidents.flatMap((incident) => incident.recommendedNextTraceChecks),
  ).slice(0, 8);
  const sharedEvidence = uniqueValues([
    sharedAnchors.reportedPartNumbers.length
      ? `Shared reported parts: ${sharedAnchors.reportedPartNumbers.slice(0, 3).join(", ")}`
      : null,
    sharedAnchors.defectCodesPresent.length
      ? `Shared defect codes: ${sharedAnchors.defectCodesPresent.slice(0, 3).join(", ")}`
      : null,
    sharedAnchors.testKeysPresent.length
      ? `Shared tests: ${sharedAnchors.testKeysPresent.slice(0, 3).join(", ")}`
      : null,
    sharedAnchors.supplierBatches.length
      ? `Shared supplier batches: ${sharedAnchors.supplierBatches.slice(0, 3).join(", ")}`
      : null,
    sharedAnchors.orders.length
      ? `Shared production orders: ${sharedAnchors.orders.slice(0, 3).join(", ")}`
      : null,
  ]).slice(0, 12);
  const averageConfidence =
    input.incidents.reduce((sum, incident) => sum + incident.confidence, 0) /
    input.incidents.length;
  const maxPriority = [...input.incidents]
    .map((incident) => incident.priority)
    .sort((left, right) => priorityRank[right] - priorityRank[left])[0];
  const caseKind = derivePromotedCaseKind({
    incidents: input.incidents,
    sharedAnchors,
  });

  return {
    proposalTempId: `AUTOCASE-${input.index + 1}`,
    title:
      productIds.length === 2
        ? `${primaryAnchorSummary || "Recurring anchor"} across 2 products`
        : `${primaryAnchorSummary || "Recurring anchor"} incident family`,
    caseKind,
    summary: `Deterministically promoted from ${input.incidents.length} repeated incidents because the products share specific structural anchors${
      primaryAnchorSummary ? ` (${primaryAnchorSummary})` : ""
    } across the same article.`,
    suspectedCommonRootCause: uniqueValues(
      input.incidents.map((incident) => incident.suspectedPrimaryCause),
    ).slice(0, 2).join(" / "),
    suspectedRootCauseFamily:
      sharedAnchors.reportedPartNumbers[0] ??
      sharedAnchors.defectCodesPresent[0] ??
      sharedAnchors.testKeysPresent[0] ??
      null,
    confidence: Math.min(0.97, Number((averageConfidence + 0.04).toFixed(2))),
    priority: maxPriority,
    includedProductIds: productIds,
    includedSignalIds,
    sharedEvidence,
    conflictingEvidence,
    strongestEvidence,
    weakestEvidence: conflictingEvidence.slice(0, 4),
    recommendedNextTraceChecks:
      recommendedNextTraceChecks.length > 0
        ? recommendedNextTraceChecks
        : ["Inspect neighboring products sharing the same anchor family."],
    signalTypesPresent: uniqueValues(
      input.incidents.flatMap((incident) => incident.signalTypesPresent),
    ).slice(0, 8),
    defectCodesPresent: uniqueValues(
      input.incidents.flatMap((incident) => incident.defectCodesPresent),
    ).slice(0, 24),
    testKeysPresent: uniqueValues(
      input.incidents.flatMap((incident) => incident.testKeysPresent),
    ).slice(0, 24),
    reportedPartNumbers: sharedAnchors.reportedPartNumbers.slice(0, 24),
    bomFindNumbers: sharedAnchors.bomFindNumbers.slice(0, 24),
    supplierBatches: sharedAnchors.supplierBatches.slice(0, 24),
    sections: uniqueValues(input.incidents.flatMap((incident) => incident.sections)).slice(0, 24),
    orders: sharedAnchors.orders.slice(0, 24),
    memberRationales: input.incidents.map((incident) => ({
      productId: incident.productId,
      rationale: `Shared recurring anchors with the case family: ${
        primaryAnchorSummary || "specific structural evidence"
      }.`,
    })),
    excludedProductHints: [],
  };
}

function promoteRecurringIncidentsToCases(input: {
  proposal: ProposalOutput;
  fallbackIncidents?: ProposalIncident[];
}) {
  const fallbackByProductId = new Map(
    (input.fallbackIncidents ?? []).map((incident) => [incident.productId, incident]),
  );
  const sourceByProductId = new Map(
    input.proposal.incidents.map((incident) => [incident.productId, incident]),
  );

  for (const [productId, incident] of fallbackByProductId.entries()) {
    if (!sourceByProductId.has(productId)) {
      sourceByProductId.set(productId, incident);
    }
  }

  const sourceIncidents = [...sourceByProductId.values()].filter(
    (incident) => incident.incidentKind !== "service_issue",
  );

  if (sourceIncidents.length < 2) {
    return input.proposal;
  }

  const anchorCounts = buildIncidentAnchorCounts(sourceIncidents);
  const maxSpecificFrequency = Math.max(3, Math.ceil(sourceIncidents.length * 0.4));
  const adjacency = new Map<string, Set<string>>();

  for (const incident of sourceIncidents) {
    adjacency.set(incident.productId, new Set<string>());
  }

  for (let leftIndex = 0; leftIndex < sourceIncidents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sourceIncidents.length; rightIndex += 1) {
      const left = sourceIncidents[leftIndex];
      const right = sourceIncidents[rightIndex];
      const link = scoreIncidentCaseLink({
        left,
        right,
        anchorCounts,
        maxSpecificFrequency,
      });

      if (!link.qualifies) {
        continue;
      }

      adjacency.get(left.productId)?.add(right.productId);
      adjacency.get(right.productId)?.add(left.productId);
    }
  }

  const visited = new Set<string>();
  const components: ProposalIncident[][] = [];

  for (const incident of sourceIncidents) {
    if (visited.has(incident.productId)) {
      continue;
    }

    const queue = [incident.productId];
    const componentIds: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      componentIds.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (componentIds.length >= 2) {
      components.push(
        componentIds
          .map((productId) => sourceByProductId.get(productId))
          .filter((value): value is ProposalIncident => Boolean(value)),
      );
    }
  }

  const existingCaseProducts = new Set(
    input.proposal.cases.flatMap((caseItem) => caseItem.includedProductIds),
  );
  const promotedCaseGroups: ProposalIncident[][] = [];

  for (const component of components.sort((left, right) => right.length - left.length)) {
    if (component.some((incident) => existingCaseProducts.has(incident.productId))) {
      continue;
    }

    promotedCaseGroups.push(component);

    for (const incident of component) {
      existingCaseProducts.add(incident.productId);
    }
  }

  if (!promotedCaseGroups.length) {
    return input.proposal;
  }

  const promotedCases = promotedCaseGroups
    .map((incidents, index) =>
      buildPromotedCaseFromIncidentGroup({
        incidents,
        anchorCounts,
        maxSpecificFrequency,
        index,
      }),
    )
    .filter((value): value is ProposalOutput["cases"][number] => Boolean(value))
    .slice(0, 8);

  if (!promotedCases.length) {
    return input.proposal;
  }

  const promotedProductIds = new Set(
    promotedCases.flatMap((caseItem) => caseItem.includedProductIds),
  );
  const promotedSignalIds = new Set(
    promotedCases.flatMap((caseItem) => caseItem.includedSignalIds),
  );

  return {
    ...input.proposal,
    reviewSummary: `${input.proposal.reviewSummary} Promoted ${promotedCases.length} recurring incident famil${
      promotedCases.length === 1 ? "y" : "ies"
    } into cases via deterministic anchor matching.`,
    cases: [...input.proposal.cases, ...promotedCases].slice(0, 20),
    incidents: input.proposal.incidents.filter(
      (incident) => !promotedProductIds.has(incident.productId),
    ),
    unassignedProducts: input.proposal.unassignedProducts.filter(
      (item) => !promotedProductIds.has(item.productId),
    ),
    standaloneSignals: input.proposal.standaloneSignals.filter(
      (item) => !promotedSignalIds.has(item.signalId),
    ),
    ambiguousLinks: input.proposal.ambiguousLinks.filter(
      (item) => !promotedProductIds.has(item.productId),
    ),
  };
}

function rankDraftCaseForReview(caseItem: ProposalOutput["cases"][number]) {
  const priorityRank =
    caseItem.priority === "critical"
      ? 3
      : caseItem.priority === "high"
        ? 2
        : caseItem.priority === "medium"
          ? 1
          : 0;

  return (
    priorityRank * 10_000 +
    Math.round(caseItem.confidence * 1_000) * 10 +
    caseItem.includedProductIds.length
  );
}

function rankDraftIncidentForReview(incident: ProposalIncident) {
  const priorityRank =
    incident.priority === "critical"
      ? 3
      : incident.priority === "high"
        ? 2
        : incident.priority === "medium"
          ? 1
          : 0;

  return priorityRank * 10_000 + Math.round(incident.confidence * 1_000) * 10;
}

function rankDraftWatchlistForReview(watchlist: ProposalWatchlist) {
  const priorityRank =
    watchlist.priority === "critical"
      ? 3
      : watchlist.priority === "high"
        ? 2
        : watchlist.priority === "medium"
          ? 1
          : 0;

  return (
    priorityRank * 10_000 +
    Math.round(watchlist.confidence * 1_000) * 10 +
    watchlist.linkedProductIds.length
  );
}

function toChunkReviewCaseDigest(caseItem: ProposalOutput["cases"][number]) {
  return {
    proposalTempId: caseItem.proposalTempId,
    title: caseItem.title,
    caseKind: caseItem.caseKind,
    summary: trimPreview(caseItem.summary, 280),
    suspectedCommonRootCause: trimPreview(caseItem.suspectedCommonRootCause, 220),
    suspectedRootCauseFamily: caseItem.suspectedRootCauseFamily,
    confidence: caseItem.confidence,
    priority: caseItem.priority,
    includedProductIds: caseItem.includedProductIds,
    productCount: caseItem.includedProductIds.length,
    signalCount: caseItem.includedSignalIds.length,
    sharedEvidence: caseItem.sharedEvidence.slice(0, 4),
    conflictingEvidence: caseItem.conflictingEvidence.slice(0, 3),
    strongestEvidence: caseItem.strongestEvidence.slice(0, 3),
    recommendedNextTraceChecks: caseItem.recommendedNextTraceChecks.slice(0, 3),
    signalTypesPresent: caseItem.signalTypesPresent.slice(0, 6),
    defectCodesPresent: caseItem.defectCodesPresent.slice(0, 8),
    reportedPartNumbers: caseItem.reportedPartNumbers.slice(0, 8),
    bomFindNumbers: caseItem.bomFindNumbers.slice(0, 8),
    supplierBatches: caseItem.supplierBatches.slice(0, 8),
    sections: caseItem.sections.slice(0, 8),
  };
}

function toChunkReviewIncidentDigest(incident: ProposalIncident) {
  return {
    incidentTempId: incident.incidentTempId,
    title: incident.title,
    incidentKind: incident.incidentKind,
    summary: trimPreview(incident.summary, 240),
    suspectedPrimaryCause: trimPreview(incident.suspectedPrimaryCause, 200),
    confidence: incident.confidence,
    priority: incident.priority,
    productId: incident.productId,
    signalCount: incident.includedSignalIds.length,
    strongestEvidence: incident.strongestEvidence.slice(0, 4),
    conflictingEvidence: incident.conflictingEvidence.slice(0, 3),
    reasonNotCase: incident.reasonNotCase,
    orders: incident.orders.slice(0, 4),
    supplierBatches: incident.supplierBatches.slice(0, 4),
    sections: incident.sections.slice(0, 4),
  };
}

function toChunkReviewWatchlistDigest(watchlist: ProposalWatchlist) {
  return {
    watchlistTempId: watchlist.watchlistTempId,
    title: watchlist.title,
    watchlistKind: watchlist.watchlistKind,
    summary: trimPreview(watchlist.summary, 220),
    rationale: trimPreview(watchlist.rationale, 180),
    confidence: watchlist.confidence,
    priority: watchlist.priority,
    linkedProductIds: watchlist.linkedProductIds,
    strongestEvidence: watchlist.strongestEvidence.slice(0, 4),
    confounders: watchlist.confounders.slice(0, 4),
  };
}

function toChunkReviewNoiseDigest(noise: ProposalNoise) {
  return {
    noiseTempId: noise.noiseTempId,
    title: noise.title,
    noiseKind: noise.noiseKind,
    summary: trimPreview(noise.summary, 220),
    dismissalReason: trimPreview(noise.dismissalReason, 180),
    linkedProductIds: noise.linkedProductIds,
    strongestEvidence: noise.strongestEvidence.slice(0, 4),
  };
}

function toStage2ReviewEvidencePacket(thread: ClusteredProductDossier) {
  return {
    productId: thread.productId,
    sourceCounts: thread.sourceCounts,
    diagnosticTimelineEvents: collectDiagnosticTimelineEvents(thread).slice(
      0,
      MAX_STAGE2_REVIEW_RAW_EVENTS,
    ),
    rawEvidenceSnippets: collectRawEvidenceSnippets(thread),
    defects: thread.defects.slice(0, 3).map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      code: item.code,
      severity: item.severity,
      reportedPartNumber: item.reportedPartNumber,
      detectedSectionName: item.detectedSectionName,
      occurrenceSectionName: item.occurrenceSectionName,
      detectedTestName: item.detectedTestName,
      notes: trimPreview(item.notes, 180),
    })),
    claims: thread.claims.slice(0, 2).map((item) => ({
      id: item.id,
      claimedAt: item.claimedAt,
      mappedDefectCode: item.mappedDefectCode,
      mappedDefectSeverity: item.mappedDefectSeverity,
      reportedPartNumber: item.reportedPartNumber,
      daysFromBuild: item.daysFromBuild,
      complaintText: trimPreview(item.complaintText || item.notes, 180),
    })),
    tests: thread.tests.slice(0, 3).map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      overallResult: item.overallResult,
      testKey: item.testKey,
      testValue: item.testValue,
      unit: item.unit,
      sectionName: item.sectionName,
      notes: trimPreview(item.notes, 160),
    })),
    rework: thread.rework.slice(0, 2).map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      reportedPartNumber: item.reportedPartNumber,
      actionText: trimPreview(item.actionText, 160),
      userId: item.userId,
    })),
    actions: thread.actions.slice(0, 2).map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      actionType: item.actionType,
      status: item.status,
      defectId: item.defectId,
      comments: trimPreview(item.comments, 160),
    })),
    installedParts: thread.installedParts.slice(0, 6).map((item) => ({
      findNumber: item.findNumber,
      positionCode: item.positionCode,
      partNumber: item.partNumber,
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      supplierName: item.supplierName,
    })),
  };
}

function selectStage2ReviewEvidenceProductIds(input: {
  dossier: ClusteredArticleDossier;
  draft: ProposalOutput;
  selectedProductIds?: Set<string>;
}) {
  const allowedProductIds = input.selectedProductIds
    ? new Set(
        input.dossier.productThreads
          .filter((thread) => input.selectedProductIds?.has(thread.productId))
          .map((thread) => thread.productId),
      )
    : new Set(input.dossier.productThreads.map((thread) => thread.productId));
  const proposalByTempId = new Map(
    input.draft.cases.map((caseItem) => [caseItem.proposalTempId, caseItem]),
  );
  const selected = new Set<string>();

  const pushProductId = (productId: string | null | undefined) => {
    const normalized = normalizeNullableText(productId);

    if (
      !normalized ||
      !allowedProductIds.has(normalized) ||
      selected.size >= MAX_STAGE2_REVIEW_EVIDENCE_PRODUCTS
    ) {
      return;
    }

    selected.add(normalized);
  };

  const rankedCases = [...input.draft.cases].sort(
    (left, right) => rankDraftCaseForReview(right) - rankDraftCaseForReview(left),
  );

  for (const caseItem of rankedCases.filter(
    (item) =>
      item.priority === "critical" ||
      item.priority === "high" ||
      item.confidence >= 0.55 ||
      item.includedProductIds.length <= 2,
  )) {
    for (const productId of caseItem.includedProductIds) {
      pushProductId(productId);
    }
  }

  for (const incident of [...input.draft.incidents]
    .sort((left, right) => rankDraftIncidentForReview(right) - rankDraftIncidentForReview(left))
    .slice(0, 16)) {
    pushProductId(incident.productId);
  }

  for (const watchlist of [...input.draft.watchlists]
    .sort((left, right) => rankDraftWatchlistForReview(right) - rankDraftWatchlistForReview(left))
    .slice(0, 12)) {
    for (const productId of watchlist.linkedProductIds) {
      pushProductId(productId);
    }
  }

  for (const noise of input.draft.noise.slice(0, 12)) {
    for (const productId of noise.linkedProductIds) {
      pushProductId(productId);
    }
  }

  for (const link of input.draft.ambiguousLinks.slice(0, 20)) {
    pushProductId(link.productId);

    for (const proposalTempId of link.relatedProposalTempIds) {
      const relatedCase = proposalByTempId.get(proposalTempId);

      for (const productId of relatedCase?.includedProductIds ?? []) {
        pushProductId(productId);
      }
    }
  }

  for (const standalone of input.draft.standaloneSignals.slice(0, 12)) {
    pushProductId(standalone.productId);
  }

  for (const unassigned of input.draft.unassignedProducts.slice(0, 12)) {
    pushProductId(unassigned.productId);
  }

  for (const caseItem of rankedCases) {
    for (const productId of caseItem.includedProductIds) {
      pushProductId(productId);
    }
  }

  return [...selected];
}

function buildStage2ReviewPayload(input: {
  dossier: ClusteredArticleDossier;
  draft: ProposalOutput;
  selectedProductIds?: Set<string>;
}) {
  const reviewThreads = input.selectedProductIds
    ? input.dossier.productThreads.filter((thread) =>
        input.selectedProductIds?.has(thread.productId),
      )
    : input.dossier.productThreads;
  const caseDigests = [...input.draft.cases]
    .sort((left, right) => {
      const rankDelta = rankDraftCaseForReview(right) - rankDraftCaseForReview(left);

      if (rankDelta !== 0) {
        return rankDelta;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, MAX_CHUNK_REVIEW_CASE_DIGESTS)
    .map((caseItem) => toChunkReviewCaseDigest(caseItem));
  const incidentDigests = [...input.draft.incidents]
    .sort(
      (left, right) =>
        rankDraftIncidentForReview(right) - rankDraftIncidentForReview(left),
    )
    .slice(0, 40)
    .map((incident) => toChunkReviewIncidentDigest(incident));
  const watchlistDigests = [...input.draft.watchlists]
    .sort(
      (left, right) =>
        rankDraftWatchlistForReview(right) - rankDraftWatchlistForReview(left),
    )
    .slice(0, 24)
    .map((watchlist) => toChunkReviewWatchlistDigest(watchlist));
  const noiseDigests = input.draft.noise.slice(0, 24).map((noise) => toChunkReviewNoiseDigest(noise));

  const standaloneSignals = input.draft.standaloneSignals
    .slice(0, MAX_CHUNK_REVIEW_STANDALONE_SIGNAL_DIGESTS)
    .map((item) => ({
      signalId: item.signalId,
      productId: item.productId,
      signalType: item.signalType,
      reason: trimPreview(item.reason, 180),
    }));
  const validationEvidenceProductIds = selectStage2ReviewEvidenceProductIds(input);
  const reviewProductCards = reviewThreads
    .filter((thread) => validationEvidenceProductIds.includes(thread.productId))
    .map((thread) => toStage2ProductClusterCard(thread));
  const validationEvidencePackets = reviewThreads
    .filter((thread) => validationEvidenceProductIds.includes(thread.productId))
    .map((thread) => toStage2ReviewEvidencePacket(thread));

  return {
    articleContext: buildStage2ArticleContext(input.dossier),
    reviewProductCards,
    draftDigest: {
      originalCaseCount: input.draft.cases.length,
      surfacedCaseCount: caseDigests.length,
      originalIncidentCount: input.draft.incidents.length,
      surfacedIncidentCount: incidentDigests.length,
      originalWatchlistCount: input.draft.watchlists.length,
      surfacedWatchlistCount: watchlistDigests.length,
      originalNoiseCount: input.draft.noise.length,
      surfacedNoiseCount: noiseDigests.length,
      originalStandaloneSignalCount: input.draft.standaloneSignals.length,
      surfacedStandaloneSignalCount: standaloneSignals.length,
      unassignedProductCount: input.draft.unassignedProducts.length,
      ambiguousLinkCount: input.draft.ambiguousLinks.length,
      globalObservations: input.draft.globalObservations,
      cases: caseDigests,
      incidents: incidentDigests,
      watchlists: watchlistDigests,
      noise: noiseDigests,
      unassignedProducts: input.draft.unassignedProducts.slice(0, 80),
      standaloneSignals,
      standaloneSignalTypeCounts: input.draft.standaloneSignals.reduce<Record<string, number>>(
        (counts, item) => {
          counts[item.signalType] = (counts[item.signalType] ?? 0) + 1;
          return counts;
        },
        {},
      ),
      ambiguousLinks: input.draft.ambiguousLinks.slice(0, 40),
    },
    validationEvidence: {
      selectedProductCount: validationEvidencePackets.length,
      productPackets: validationEvidencePackets,
    },
  };
}

function fitStage2ReviewPayloadToBudget(payload: ReturnType<typeof buildStage2ReviewPayload>) {
  let fittedPayload = payload;

  while (
    estimateStage2ReviewPromptChars(fittedPayload) > STAGE2_REVIEW_PROMPT_CHAR_BUDGET &&
    fittedPayload.validationEvidence.productPackets.length > 4
  ) {
    const nextCount = Math.max(
      4,
      Math.ceil(fittedPayload.validationEvidence.productPackets.length / 2),
    );

    fittedPayload = {
      ...fittedPayload,
      reviewProductCards: fittedPayload.reviewProductCards.slice(0, nextCount),
      validationEvidence: {
        selectedProductCount: nextCount,
        productPackets: fittedPayload.validationEvidence.productPackets.slice(0, nextCount),
      },
    };
  }

  while (
    estimateStage2ReviewPromptChars(fittedPayload) > STAGE2_REVIEW_PROMPT_CHAR_BUDGET &&
    fittedPayload.draftDigest.cases.length > 24
  ) {
    const nextCaseCount = Math.max(24, Math.ceil(fittedPayload.draftDigest.cases.length / 2));

    fittedPayload = {
      ...fittedPayload,
      draftDigest: {
        ...fittedPayload.draftDigest,
        surfacedCaseCount: nextCaseCount,
        cases: fittedPayload.draftDigest.cases.slice(0, nextCaseCount),
      },
    };
  }

  while (
    estimateStage2ReviewPromptChars(fittedPayload) > STAGE2_REVIEW_PROMPT_CHAR_BUDGET &&
    fittedPayload.draftDigest.standaloneSignals.length > 20
  ) {
    const nextSignalCount = Math.max(
      20,
      Math.ceil(fittedPayload.draftDigest.standaloneSignals.length / 2),
    );

    fittedPayload = {
      ...fittedPayload,
      draftDigest: {
        ...fittedPayload.draftDigest,
        surfacedStandaloneSignalCount: nextSignalCount,
        standaloneSignals: fittedPayload.draftDigest.standaloneSignals.slice(0, nextSignalCount),
      },
    };
  }

  return fittedPayload;
}

function getOpenAiClient() {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for case clustering.");
  }

  return createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
}

async function generateStructuredObject<TSchema extends z.ZodTypeAny>(input: {
  schema: TSchema;
  schemaName: string;
  schemaDescription: string;
  system: string;
  prompt: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
  stageName: ModelCallStageName;
  articleId: string;
  payload: unknown;
  chunkId?: string | null;
  selectedProductCount?: number | null;
  maxOutputTokens?: number | null;
  abortSignal?: AbortSignal;
}) {
  const openai = getOpenAiClient();

  logModelCallMetrics({
    stageName: input.stageName,
    articleId: input.articleId,
    model: env.OPENAI_MODEL,
    system: input.system,
    prompt: input.prompt,
    payload: input.payload,
    chunkId: input.chunkId,
    selectedProductCount: input.selectedProductCount,
    maxOutputTokens: input.maxOutputTokens,
  });

  return generateStructuredObjectWithRepair({
    model: openai.responses(env.OPENAI_MODEL),
    schema: input.schema,
    schemaName: input.schemaName,
    schemaDescription: input.schemaDescription,
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: input.maxOutputTokens,
    abortSignal: input.abortSignal,
    abortMessage: STOPPED_PIPELINE_MESSAGE,
    createAbortError: createPipelineStopError,
    isStopError: isPipelineStopError,
    maxAttempts: MODEL_CALL_MAX_ATTEMPTS,
    providerOptions: {
      openai: {
        reasoningEffort: input.reasoningEffort,
        store: false,
        textVerbosity: "low",
      },
    },
  });
}

async function generateProductThreadSynthesis(input: {
  articleId: string;
  productId: string;
  promptPayload: unknown;
  abortSignal?: AbortSignal;
}) {
  return generateStructuredObject({
    schema: productThreadSynthesisSchema,
    schemaName: "manex_product_thread_synthesis",
    schemaDescription:
      "Compressed product-level investigation dossier for one manufactured unit in the Manex hackathon dataset.",
    system: buildStage1SystemPrompt(),
    prompt: buildStage1UserPrompt(input.promptPayload),
    reasoningEffort: STAGE1_REASONING_EFFORT,
    stageName: "stage1_product_synthesis",
    articleId: input.articleId,
    payload: input.promptPayload,
    chunkId: input.productId,
    selectedProductCount: 1,
    maxOutputTokens: STAGE1_MAX_OUTPUT_TOKENS,
    abortSignal: input.abortSignal,
  });
}

async function generateProposalObject(input: {
  articleId: string;
  stageName: "stage2_draft" | "stage2_review";
  system: string;
  prompt: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
  payload: unknown;
  chunkId?: string | null;
  selectedProductCount?: number | null;
  maxOutputTokens?: number | null;
  abortSignal?: AbortSignal;
}) {
  return generateStructuredObject({
    schema: clusteringProposalSchema,
    schemaName: "manex_article_case_set",
    schemaDescription:
      "Article-local proposed case set for one article dossier in the Manex hackathon dataset.",
    system: input.system,
    prompt: input.prompt,
    reasoningEffort: input.reasoningEffort,
    stageName: input.stageName,
    articleId: input.articleId,
    payload: input.payload,
    chunkId: input.chunkId,
    selectedProductCount: input.selectedProductCount,
    maxOutputTokens: input.maxOutputTokens,
    abortSignal: input.abortSignal,
  });
}

async function generateGlobalReconciliationObject(input: {
  articleId: string;
  payload: unknown;
  abortSignal?: AbortSignal;
}) {
  return generateStructuredObject({
    schema: globalReconciliationSchema,
    schemaName: "manex_global_case_inventory",
    schemaDescription:
      "Global reconciliation inventory of validated cases, watchlists, noise buckets, and rejected cases for the Manex hackathon dataset.",
    system: buildStage3SystemPrompt(),
    prompt: buildStage3UserPrompt(input.payload),
    reasoningEffort: STAGE3_REASONING_EFFORT,
    stageName: "stage3_reconciliation",
    articleId: input.articleId,
    payload: input.payload,
    selectedProductCount: null,
    maxOutputTokens: STAGE3_MAX_OUTPUT_TOKENS,
    abortSignal: input.abortSignal,
  });
}

function planStage2Chunks(dossier: ClusteredArticleDossier) {
  const chunks: ClusteredProductDossier[][] = [];
  let currentChunk: ClusteredProductDossier[] = [];

  const flushChunk = () => {
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
  };

  for (const thread of dossier.productThreads) {
    const nextChunk = [...currentChunk, thread];
    const nextProductIds = new Set(nextChunk.map((item) => item.productId));
    const estimatedPromptChars = estimateStage2ProposalPromptChars({
      dossier,
      productIds: nextProductIds,
    });

    if (
      currentChunk.length > 0 &&
      (currentChunk.length >= PRODUCT_CHUNK_SIZE ||
        estimatedPromptChars > STAGE2_CHUNK_PROMPT_CHAR_BUDGET)
    ) {
      flushChunk();
      currentChunk = [thread];
      continue;
    }

    currentChunk = nextChunk;
  }

  flushChunk();

  return chunks;
}

async function runProposalPass(
  dossier: ClusteredArticleDossier,
  onStageChange?: (stage: "stage2_draft" | "stage2_review", detail: string) => Promise<void>,
  options?: PipelineExecutionOptions,
): Promise<{ draft: ProposalOutput; review: ProposalOutput; strategy: "single" | "chunked" }> {
  throwIfPipelineAborted(options?.abortSignal);
  const strategy = chooseRunStrategy(dossier);

  if (strategy === "single") {
    await onStageChange?.(
      "stage2_draft",
      `Drafting article-wide cases for ${dossier.article.productCount} products.`,
    );
    const proposalPayload = buildStage2ProposalPayload({ dossier });
    const rawDraft = await generateProposalObject({
      articleId: dossier.article.articleId,
      stageName: "stage2_draft",
      system: buildPassASystemPrompt(),
      prompt: buildPassAUserPrompt(proposalPayload),
      reasoningEffort: STAGE2_DRAFT_REASONING_EFFORT,
      payload: proposalPayload,
      selectedProductCount: dossier.productThreads.length,
      maxOutputTokens: STAGE2_DRAFT_MAX_OUTPUT_TOKENS,
      abortSignal: options?.abortSignal,
    });
    const draft = promoteRecurringIncidentsToCases({
      proposal: rawDraft,
    });
    await onStageChange?.("stage2_review", "Reviewing and refining article-wide cases.");
    const reviewPayload = fitStage2ReviewPayloadToBudget(
      buildStage2ReviewPayload({ dossier, draft }),
    );
    const rawReview = await generateProposalObject({
      articleId: dossier.article.articleId,
      stageName: "stage2_review",
      system: buildPassBSystemPrompt(),
      prompt: buildPassBUserPrompt(reviewPayload),
      reasoningEffort: STAGE2_REVIEW_REASONING_EFFORT,
      payload: reviewPayload,
      selectedProductCount: reviewPayload.reviewProductCards.length,
      maxOutputTokens: STAGE2_REVIEW_MAX_OUTPUT_TOKENS,
      abortSignal: options?.abortSignal,
    });
    const review = promoteRecurringIncidentsToCases({
      proposal: rawReview,
      fallbackIncidents: draft.incidents,
    });

    return { draft, review, strategy };
  }

  const chunks = planStage2Chunks(dossier);
  await onStageChange?.(
    "stage2_draft",
    `Drafting article-wide cases across ${chunks.length} dossier chunks.`,
  );
  let completedChunks = 0;
  const stage2ChunkProgressStep = Math.max(1, Math.ceil(chunks.length / 8));
  const chunkDrafts = await mapWithConcurrency(
    chunks,
    STAGE2_CHUNK_PROPOSAL_CONCURRENCY,
    async (chunk, index) => {
      throwIfPipelineAborted(options?.abortSignal);
      const chunkProductIds = new Set(chunk.map((item) => item.productId));
      const chunkPayload = buildStage2ProposalPayload({
        dossier,
        productIds: chunkProductIds,
        chunkInfo: {
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          productIds: [...chunkProductIds],
        },
      });

      return generateProposalObject({
        articleId: dossier.article.articleId,
        stageName: "stage2_draft",
        system: buildPassASystemPrompt(),
        prompt: buildPassAUserPrompt(chunkPayload),
        reasoningEffort: STAGE2_DRAFT_REASONING_EFFORT,
        payload: chunkPayload,
        chunkId: `chunk-${index + 1}-of-${chunks.length}`,
        selectedProductCount: chunk.length,
        maxOutputTokens: STAGE2_DRAFT_MAX_OUTPUT_TOKENS,
        abortSignal: options?.abortSignal,
      }).finally(async () => {
        completedChunks += 1;

        if (
          completedChunks === chunks.length ||
          completedChunks === 1 ||
          completedChunks % stage2ChunkProgressStep === 0
        ) {
          await onStageChange?.(
            "stage2_draft",
            `Drafting article-wide cases across ${chunks.length} dossier chunks (${completedChunks}/${chunks.length}).`,
          );
        }
      });
    },
    options,
  );

  throwIfPipelineAborted(options?.abortSignal);
  const draft = promoteRecurringIncidentsToCases({
    proposal: mergeProposalOutputs(
      chunkDrafts,
      "Chunked draft proposals generated before final review.",
    ),
  });

  await onStageChange?.("stage2_review", "Reviewing and consolidating chunked case drafts.");
  const reviewPayload = fitStage2ReviewPayloadToBudget(
    buildStage2ReviewPayload({ dossier, draft }),
  );
  const rawReview = await generateProposalObject({
    articleId: dossier.article.articleId,
    stageName: "stage2_review",
    system: buildPassBSystemPrompt(),
    prompt: buildPassBUserPrompt(reviewPayload),
    reasoningEffort: STAGE2_REVIEW_REASONING_EFFORT,
    payload: reviewPayload,
    selectedProductCount: reviewPayload.reviewProductCards.length,
    maxOutputTokens: STAGE2_REVIEW_MAX_OUTPUT_TOKENS,
    abortSignal: options?.abortSignal,
  });
  const review = promoteRecurringIncidentsToCases({
    proposal: rawReview,
    fallbackIncidents: draft.incidents,
  });

  return { draft, review, strategy };
}

function materializeCaseCandidates(input: {
  articleId: string;
  runId: string;
  proposal: ProposalOutput;
  dossier: ClusteredArticleDossier;
}) {
  const productIdSet = new Set(input.dossier.productThreads.map((item) => item.productId));
  const signalLookup = new Map<
    string,
    { productId: string; signalType: ProductSignalTimelineItem["signalType"] }
  >();

  for (const thread of input.dossier.productThreads) {
    for (const signal of thread.signals) {
      signalLookup.set(signal.signalId, {
        productId: thread.productId,
        signalType: signal.signalType,
      });
    }
  }

  return input.proposal.cases
    .map((candidate) => {
      const dedupedSignalIds = uniqueValues(candidate.includedSignalIds).filter((signalId) =>
        signalLookup.has(signalId),
      );
      const inferredProductIds = uniqueValues(
        dedupedSignalIds.map((signalId) => signalLookup.get(signalId)?.productId ?? null),
      );
      const dedupedProductIds = uniqueValues(candidate.includedProductIds)
        .filter((productId) => productIdSet.has(productId))
        .concat(inferredProductIds.filter((productId) => !candidate.includedProductIds.includes(productId)));

      if (!dedupedProductIds.length) {
        return null;
      }

      const rationaleMap = new Map(
        candidate.memberRationales.map((item) => [item.productId, item.rationale]),
      );
      const candidateId = createId("TCAND");

      return {
        id: candidateId,
        title: candidate.title,
        lifecycleStatus: "proposed" as const,
        caseKind: candidate.caseKind,
        summary: candidate.summary,
        suspectedCommonRootCause: candidate.suspectedCommonRootCause,
        suspectedRootCauseFamily: candidate.suspectedRootCauseFamily,
        confidence: candidate.confidence,
        priority: candidate.priority,
        strongestEvidence: uniqueValues(candidate.strongestEvidence),
        weakestEvidence: uniqueValues(candidate.weakestEvidence),
        sharedEvidence: uniqueValues(candidate.sharedEvidence),
        conflictingEvidence: uniqueValues(candidate.conflictingEvidence),
        recommendedNextTraceChecks: uniqueValues(candidate.recommendedNextTraceChecks),
        includedProductIds: dedupedProductIds,
        includedSignalIds: dedupedSignalIds,
        payload: {
          contractVersion: CASE_PROPOSAL_SCHEMA_VERSION,
          proposal: candidate,
          incidents: input.proposal.incidents,
          watchlists: input.proposal.watchlists,
          noise: input.proposal.noise,
          unassignedProducts: input.proposal.unassignedProducts,
          standaloneSignals: input.proposal.standaloneSignals,
          ambiguousLinks: input.proposal.ambiguousLinks,
        },
        members: [
          ...dedupedProductIds.map((productId) => ({
            id: createId("TCMEM"),
            memberType: "product" as const,
            entityId: productId,
            productId,
            signalId: null,
            signalType: null,
            rationale: rationaleMap.get(productId) ?? null,
          })),
          ...dedupedSignalIds.map((signalId) => ({
            id: createId("TCMEM"),
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

function extractUnclusteredState(input: {
  dossier: ClusteredArticleDossier | null;
  latestRun: TeamCaseRunSummary | null;
  proposedCases: TeamCaseCandidateRecord[];
}) {
  const parsed = parseStage2FromReviewPayload(input.latestRun?.reviewPayload);
  const productIdSet = new Set(
    (input.dossier?.productThreads ?? []).map((thread) => thread.productId),
  );
  const signalLookup = new Map<
    string,
    {
      productId: string;
      signalType: ProductSignalTimelineItem["signalType"];
    }
  >();

  for (const thread of input.dossier?.productThreads ?? []) {
    for (const signal of thread.signals) {
      signalLookup.set(signal.signalId, {
        productId: thread.productId,
        signalType: signal.signalType,
      });
    }
  }

  const assignedProductIds = new Set(
    input.proposedCases.flatMap((candidate) => candidate.includedProductIds),
  );
  const assignedSignalIds = new Set(
    input.proposedCases.flatMap((candidate) => candidate.includedSignalIds),
  );

  if (!parsed) {
    return {
      incidents: [] as ArticleCaseboardReadModel["incidents"],
      watchlists: [] as ArticleCaseboardReadModel["watchlists"],
      noise: [] as ArticleCaseboardReadModel["noise"],
      unassignedProducts: [] as ArticleCaseboardReadModel["unassignedProducts"],
      standaloneSignals: [] as ArticleCaseboardReadModel["standaloneSignals"],
      ambiguousLinks: [] as ArticleCaseboardReadModel["ambiguousLinks"],
      globalObservations: [] as string[],
    };
  }

  const standaloneBySignalId = new Map<string, ProposalStandaloneSignal>();
  const typedProductIds = new Set<string>([
    ...parsed.incidents.map((item) => item.productId),
    ...parsed.watchlists.flatMap((item) => item.linkedProductIds),
    ...parsed.noise.flatMap((item) => item.linkedProductIds),
  ]);
  const typedSignalIds = new Set<string>([
    ...parsed.incidents.flatMap((item) => item.includedSignalIds),
    ...parsed.watchlists.flatMap((item) => item.linkedSignalIds),
    ...parsed.noise.flatMap((item) => item.linkedSignalIds),
  ]);

  for (const item of parsed.standaloneSignals) {
    if (!standaloneBySignalId.has(item.signalId)) {
      standaloneBySignalId.set(item.signalId, item);
    }
  }

  return {
    incidents: parsed.incidents.filter((item) => productIdSet.has(item.productId)),
    watchlists: parsed.watchlists.filter((item) =>
      item.linkedProductIds.some((productId) => productIdSet.has(productId)),
    ),
    noise: parsed.noise.filter((item) =>
      item.linkedProductIds.some((productId) => productIdSet.has(productId)),
    ),
    unassignedProducts: parsed.unassignedProducts.filter(
      (item) =>
        productIdSet.has(item.productId) &&
        !assignedProductIds.has(item.productId) &&
        !typedProductIds.has(item.productId),
    ),
    standaloneSignals: [...standaloneBySignalId.values()].filter((item) => {
      const signal = signalLookup.get(item.signalId);

      return (
        Boolean(signal) &&
        signal?.productId === item.productId &&
        signal?.signalType === item.signalType &&
        !assignedSignalIds.has(item.signalId) &&
        !typedSignalIds.has(item.signalId)
      );
    }),
    ambiguousLinks: parsed.ambiguousLinks.filter((item) =>
      productIdSet.has(item.productId),
    ),
    globalObservations: parsed.globalObservations,
  };
}

function parseStage2FromReviewPayload(payload: unknown) {
  const normalizeProposalPayload = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const proposal = value as Record<string, unknown>;

    return {
      ...proposal,
      incidents: Array.isArray(proposal.incidents) ? proposal.incidents : [],
      watchlists: Array.isArray(proposal.watchlists) ? proposal.watchlists : [],
      noise: Array.isArray(proposal.noise) ? proposal.noise : [],
    };
  };

  const direct = clusteringProposalSchema.safeParse(normalizeProposalPayload(payload));

  if (direct.success) {
    return direct.data;
  }

  if (payload && typeof payload === "object" && "stage2" in payload) {
    const nested = clusteringProposalSchema.safeParse(
      normalizeProposalPayload((payload as { stage2?: unknown }).stage2),
    );

    if (nested.success) {
      return nested.data;
    }
  }

  return null;
}

function parseStage3FromReviewPayload(payload: unknown) {
  if (payload && typeof payload === "object" && "stage3" in payload) {
    const nested = globalReconciliationSchema.safeParse(
      (payload as { stage3?: unknown }).stage3,
    );

    if (nested.success) {
      return nested.data;
    }
  }

  return null;
}

const priorityRank: Record<"low" | "medium" | "high" | "critical", number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function sortCandidatesForArticleQueue(candidates: TeamCaseCandidateRecord[]) {
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

function buildArticleCaseSetSummary(input: {
  articleId: string;
  articleName: string | null;
  dossier: ClusteredArticleDossier;
  stage2: ProposalOutput;
  candidates: TeamCaseCandidateRecord[];
}) {
  return {
    articleId: input.articleId,
    articleName: input.articleName,
    productCount: input.dossier.article.productCount,
    signalCount: input.dossier.article.totalSignals,
    clusteringNotes: input.stage2.reviewSummary,
    articleSummary: {
      topDefectCodes: toCompactArticleSummaryRows(input.dossier.articleSummary.topDefectCodes, 4),
      topReportedParts: toCompactArticleSummaryRows(
        input.dossier.articleSummary.topReportedParts,
        4,
      ),
      topBomPositions: toCompactArticleSummaryRows(
        input.dossier.articleSummary.topBomPositions,
        4,
      ),
      topSupplierBatches: toCompactArticleSummaryRows(
        input.dossier.articleSummary.topSupplierBatches,
        4,
      ),
      topSections: toCompactArticleSummaryRows(input.dossier.articleSummary.topSections, 4),
      fieldClaimOnlyPatterns: toCompactArticleLabelRows(
        input.dossier.articleSummary.fieldClaimOnlyPatterns,
        4,
      ),
    },
    proposedCases: input.candidates.map((candidate) => {
      const proposal =
        candidate.payload &&
        typeof candidate.payload === "object" &&
        "proposal" in candidate.payload
          ? (candidate.payload as { proposal?: Record<string, unknown> }).proposal
          : null;

      return {
        candidateId: candidate.id,
        title: candidate.title,
        caseKind: candidate.caseKind,
        summary: candidate.summary,
        suspectedCommonRootCause: candidate.suspectedCommonRootCause,
        confidence: candidate.confidence,
        priority: candidate.priority,
        includedProductIds: candidate.includedProductIds,
        includedSignalIds: candidate.includedSignalIds,
        strongestEvidence: candidate.strongestEvidence,
        conflictingEvidence: candidate.conflictingEvidence,
        recommendedNextTraceChecks: candidate.recommendedNextTraceChecks,
        sharedEvidence: candidate.sharedEvidence,
        bomFindNumbers: Array.isArray(proposal?.bomFindNumbers)
          ? (proposal.bomFindNumbers as string[])
          : [],
        supplierBatches: Array.isArray(proposal?.supplierBatches)
          ? (proposal.supplierBatches as string[])
          : [],
        reportedPartNumbers: Array.isArray(proposal?.reportedPartNumbers)
          ? (proposal.reportedPartNumbers as string[])
          : [],
        signalTypesPresent: Array.isArray(proposal?.signalTypesPresent)
          ? (proposal.signalTypesPresent as string[])
          : [],
      };
    }),
    incidents: input.stage2.incidents,
    watchlists: input.stage2.watchlists,
    noise: input.stage2.noise,
    unassignedProducts: input.stage2.unassignedProducts,
    standaloneSignals: input.stage2.standaloneSignals,
    ambiguousProducts: input.stage2.ambiguousLinks,
  };
}

function buildGlobalReconciliationContext(input: {
  articleCaseSets: Array<ReturnType<typeof buildArticleCaseSetSummary>>;
  dossiers: ClusteredArticleDossier[];
}) {
  const productThreads = input.dossiers.flatMap((dossier) => dossier.productThreads);
  const defects = productThreads.flatMap((thread) => thread.defects);
  const claims = productThreads.flatMap((thread) => thread.claims);
  const tests = productThreads.flatMap((thread) => thread.tests);
  const weeklySummaryByWeek = new Map<
    string,
    { productsBuilt: number; defectCount: number; claimCount: number; reworkCount: number }
  >();

  for (const summary of input.dossiers.flatMap((dossier) => dossier.weeklyQualitySummaries)) {
    const current = weeklySummaryByWeek.get(summary.weekStart) ?? {
      productsBuilt: 0,
      defectCount: 0,
      claimCount: 0,
      reworkCount: 0,
    };
    current.productsBuilt += summary.productsBuilt;
    current.defectCount += summary.defectCount;
    current.claimCount += summary.claimCount;
    current.reworkCount += summary.reworkCount;
    weeklySummaryByWeek.set(summary.weekStart, current);
  }

  const detectionSectionDistribution = topEntries(
    bucketCounts(
      [
        ...defects.map((item) => ({
          section: item.detectedSectionName,
          productId: item.productId,
        })),
        ...tests.map((item) => ({
          section: item.sectionName,
          productId: item.productId,
        })),
      ],
      (item) => item.section,
      (item) => item.productId,
    ),
    10,
  ).map((entry) => ({
    section: entry.value,
    count: entry.count,
    productCount: entry.productIds.length,
  }));

  const occurrenceSectionDistribution = topEntries(
    bucketCounts(
      defects.map((item) => ({
        section: item.occurrenceSectionName,
        productId: item.productId,
      })),
      (item) => item.section,
      (item) => item.productId,
    ),
    10,
  ).map((entry) => ({
    section: entry.value,
    count: entry.count,
    productCount: entry.productIds.length,
  }));

  const falsePositivePool = productThreads
    .filter((thread) => thread.summaryFeatures.falsePositiveMarkers.length > 0)
    .map((thread) => ({
      productId: thread.productId,
      markers: thread.summaryFeatures.falsePositiveMarkers.slice(0, 3),
    }))
    .slice(0, 12);

  const marginalOnlyPool = productThreads
    .filter(
      (thread) =>
        thread.sourceCounts.marginalTests > 0 &&
        thread.sourceCounts.badTests === 0 &&
        thread.sourceCounts.defects === 0 &&
        thread.sourceCounts.claims === 0,
    )
    .map((thread) => ({
      productId: thread.productId,
      articleId: thread.articleId,
      testKeys: thread.summaryFeatures.testKeysMarginalFail.slice(0, 4),
      noiseFlags: thread.stage1Synthesis.possibleNoiseFlags.slice(0, 3),
    }))
    .slice(0, 12);

  const testResultBandSummaries = topEntries(
    bucketCounts(
      tests,
      (item) => `${item.testKey}:${item.overallResult}`,
      (item) => item.productId,
      (item) => item.id,
    ),
    12,
  ).map((entry) => ({
    band: entry.value,
    count: entry.count,
    productCount: entry.productIds.length,
    signalCount: entry.signalIds.length,
  }));

  const claimLags = claims
    .map((item) => item.daysFromBuild)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  const fieldClaimLagSummaries = claimLags.length
    ? {
        count: claimLags.length,
        minDays: claimLags[0],
        medianDays: claimLags[Math.floor(claimLags.length / 2)],
        maxDays: claimLags[claimLags.length - 1],
      }
    : {
        count: 0,
        minDays: null,
        medianDays: null,
        maxDays: null,
      };

  return {
    articleCaseSets: input.articleCaseSets,
    globalDistributions: {
      detectionSectionDistribution,
      occurrenceSectionDistribution,
      globalFalsePositivePool: falsePositivePool,
      marginalOnlyPool,
      volumeByWeek: [...weeklySummaryByWeek.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(-12)
        .map(([weekStart, value]) => ({
          weekStart,
          ...value,
          defectRatePerBuilt:
            value.productsBuilt > 0 ? value.defectCount / value.productsBuilt : null,
          claimRatePerBuilt:
            value.productsBuilt > 0 ? value.claimCount / value.productsBuilt : null,
          reworkRatePerBuilt:
            value.productsBuilt > 0 ? value.reworkCount / value.productsBuilt : null,
        })),
      testResultBandSummaries,
      fieldClaimLagSummaries,
    },
  };
}

type LatestCompletedCaseRunRow = {
  run_id: string;
  article_id: string;
  article_name: string | null;
  review_payload: unknown;
  completed_at: string | null;
};

async function loadLatestCompletedArticleRuns() {
  const rows =
    (await queryPostgres<LatestCompletedCaseRunRow>(
      `
        SELECT DISTINCT ON (article_id)
          run_id,
          article_id,
          article_name,
          review_payload,
          completed_at
        FROM team_case_run
        WHERE status = 'completed'
        ORDER BY article_id, completed_at DESC NULLS LAST, started_at DESC
      `,
    )) ?? [];

  return rows;
}

async function runGlobalReconciliation(input: {
  currentArticleId: string;
  currentArticleName: string | null;
  currentDossier: ClusteredArticleDossier;
  currentStage2: ProposalOutput;
  currentCandidates: TeamCaseCandidateRecord[];
  abortSignal?: AbortSignal;
}) {
  throwIfPipelineAborted(input.abortSignal);
  const latestCompletedRuns = await loadLatestCompletedArticleRuns();
  const persistedEntries = await mapWithConcurrency(
    latestCompletedRuns.filter((row) => row.article_id !== input.currentArticleId),
    STAGE3_ARTICLE_LOAD_CONCURRENCY,
    async (row) => {
      throwIfPipelineAborted(input.abortSignal);
      const stage2 = parseStage2FromReviewPayload(row.review_payload);

      if (!stage2) {
        return null;
      }

      const [dossierRecord, candidates] = await Promise.all([
        getTeamArticleDossierRecord<ClusteredArticleDossier>(row.article_id),
        listTeamCaseCandidatesForRun(row.run_id),
      ]);

      const hydratedDossier = hydrateArticleDossier(dossierRecord?.payload ?? null);

      if (!hydratedDossier) {
        return null;
      }

      return {
        dossier: hydratedDossier,
        caseSet: buildArticleCaseSetSummary({
          articleId: row.article_id,
          articleName: dossierRecord?.articleName ?? row.article_name,
          dossier: hydratedDossier,
          stage2,
          candidates,
        }),
      };
    },
    { abortSignal: input.abortSignal },
  );

  const currentCaseSet = buildArticleCaseSetSummary({
    articleId: input.currentArticleId,
    articleName: input.currentArticleName,
    dossier: input.currentDossier,
    stage2: input.currentStage2,
    candidates: input.currentCandidates,
  });

  const allEntries = [
    ...persistedEntries.filter((value): value is NonNullable<typeof value> => Boolean(value)),
    {
      dossier: input.currentDossier,
      caseSet: currentCaseSet,
    },
  ];

  const context = buildGlobalReconciliationContext({
    articleCaseSets: allEntries.map((entry) => entry.caseSet),
    dossiers: allEntries.map((entry) => entry.dossier),
  });

  return generateGlobalReconciliationObject({
    articleId: input.currentArticleId,
    payload: context,
    abortSignal: input.abortSignal,
  });
}

async function getLatestGlobalRunWithInventory() {
  const rows =
    (await queryPostgres<LatestCompletedCaseRunRow>(
      `
        SELECT
          run_id,
          article_id,
          article_name,
          review_payload,
          completed_at
        FROM team_case_run
        WHERE status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, started_at DESC
        LIMIT 12
      `,
    )) ?? [];

  for (const row of rows) {
    const globalInventory = parseStage3FromReviewPayload(row.review_payload);

    if (!globalInventory) {
      continue;
    }

    const run = await getLatestTeamCaseRun(row.article_id);

    if (!run || run.id !== row.run_id) {
      return {
        latestGlobalRun: {
          id: row.run_id,
          articleId: row.article_id,
          articleName: row.article_name,
          model: env.OPENAI_MODEL,
          status: "completed" as const,
          strategy: "single" as const,
          schemaVersion: CASE_PROPOSAL_SCHEMA_VERSION,
          promptVersion: CASE_PROMPT_VERSION,
          productCount: 0,
          signalCount: 0,
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

export async function runArticleCaseClustering(
  articleId: string,
  options?: PipelineExecutionOptions,
) {
  if (!capabilities.hasPostgres) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Case clustering requires OPENAI_API_KEY.");
  }

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();
  throwIfPipelineAborted(options?.abortSignal);
  const preloadedMeta = await loadArticleMeta(normalizedArticleId);

  if (!preloadedMeta.article || !preloadedMeta.products.length) {
    throw new Error(`No products found for article ${normalizedArticleId}.`);
  }

  const runId = createId("TCRUN");

  await createTeamCaseRun({
    id: runId,
    articleId: normalizedArticleId,
    articleName: preloadedMeta.article.name,
    model: env.OPENAI_MODEL,
    strategy:
      preloadedMeta.products.length > SINGLE_PASS_PRODUCT_LIMIT ? "chunked" : "single",
    schemaVersion: CASE_PROPOSAL_SCHEMA_VERSION,
    promptVersion: CASE_PROMPT_VERSION,
    productCount: preloadedMeta.products.length,
    signalCount: 0,
    currentStage: "stage1_loading",
    stageDetail: "Loading deterministic article dossier.",
    builderPayload: {
      articleDossierSchemaVersion: ARTICLE_DOSSIER_SCHEMA_VERSION,
      productDossierSchemaVersion: PRODUCT_DOSSIER_SCHEMA_VERSION,
    },
    requestPayload: {
      articleId: normalizedArticleId,
      productCount: preloadedMeta.products.length,
      totalSignals: 0,
    },
  });

  try {
    const dossier = await buildArticleDossier(
      normalizedArticleId,
      async (stage, detail) => {
        await updateTeamCaseRunStage({
          id: runId,
          currentStage: stage,
          stageDetail: detail,
        });
      },
      options,
    );

    throwIfPipelineAborted(options?.abortSignal);
    await updateTeamCaseRunStage({
      id: runId,
      currentStage: "stage1_synthesis",
      stageDetail: `Built article dossier with ${dossier.article.totalSignals} signals.`,
      articleName: dossier.article.articleName,
      productCount: dossier.article.productCount,
      signalCount: dossier.article.totalSignals,
    });

    const proposalPass = await runProposalPass(
      dossier,
      async (stage, detail) => {
        await updateTeamCaseRunStage({
          id: runId,
          currentStage: stage,
          stageDetail: detail,
        });
      },
      options,
    );
    throwIfPipelineAborted(options?.abortSignal);
    const candidates = materializeCaseCandidates({
      articleId: dossier.article.articleId,
      runId,
      proposal: proposalPass.review,
      dossier,
    });

    await updateTeamCaseRunStage({
      id: runId,
      currentStage: "stage2_persisting",
      stageDetail: `Persisting ${candidates.length} proposed cases.`,
    });

    await replaceTeamCaseCandidatesForRun({
      runId,
      articleId: dossier.article.articleId,
      candidates,
    });

    const persistedCandidates = await listTeamCaseCandidatesForRun(runId);
    throwIfPipelineAborted(options?.abortSignal);

    await updateTeamCaseRunStage({
      id: runId,
      currentStage: "stage3_reconciliation",
      stageDetail: "Reconciling global watchlists, validated cases, and noise.",
    });

    const globalReconciliation = await runGlobalReconciliation({
      currentArticleId: dossier.article.articleId,
      currentArticleName: dossier.article.articleName,
      currentDossier: dossier,
      currentStage2: proposalPass.review,
      currentCandidates: persistedCandidates,
      abortSignal: options?.abortSignal,
    });

    const reviewPayload: CasePipelineReviewPayload = {
      contractVersion: CASE_PIPELINE_REVIEW_SCHEMA_VERSION,
      stage2: proposalPass.review,
      stage3: globalReconciliation,
    };

    await completeTeamCaseRun({
      id: runId,
      candidateCount: candidates.length,
      proposalPayload: proposalPass.draft,
      reviewPayload,
      stageDetail: `Finished with ${candidates.length} proposed cases.`,
    });

    const [latestRun] = await Promise.all([
      getLatestTeamCaseRun(dossier.article.articleId),
    ]);

    return {
      articleId: dossier.article.articleId,
      dossier,
      latestRun,
      proposedCases: persistedCandidates,
      globalInventory: globalReconciliation,
    };
  } catch (error) {
    await failTeamCaseRun({
      id: runId,
      errorMessage: isPipelineStopError(error)
        ? STOPPED_PIPELINE_MESSAGE
        : error instanceof Error
          ? error.message
          : String(error),
      stageDetail: isPipelineStopError(error)
        ? STOPPED_PIPELINE_MESSAGE
        : "Pipeline failed before completion.",
    });

    throw error;
  }
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

export type ArticleCaseClusteringBatchResult = {
  articleId: string;
  ok: boolean;
  runId: string | null;
  caseCount: number;
  validatedCount: number;
  watchlistCount: number;
  noiseCount: number;
  error: string | null;
  completedAt: string;
};

export async function runArticleCaseClusteringBatch(input?: {
  articleIds?: string[];
  onStart?: (payload: {
    requestedArticleIds: string[];
    concurrency: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
  onArticleComplete?: (payload: {
    result: ArticleCaseClusteringBatchResult;
    okCount: number;
    errorCount: number;
    completedCount: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
  abortSignal?: AbortSignal;
}) {
  if (!capabilities.hasPostgres) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Case clustering requires OPENAI_API_KEY.");
  }

  const requestedIds =
    input?.articleIds?.map((articleId) => normalizeUiIdentifier(articleId)).filter(Boolean) ?? [];
  throwIfPipelineAborted(input?.abortSignal);
  const targetArticleIds = requestedIds.length
    ? uniqueValues(requestedIds)
    : await loadAllClusterableArticleIds();
  let okCount = 0;
  let errorCount = 0;
  let completedCount = 0;

  await input?.onStart?.({
    requestedArticleIds: targetArticleIds,
    concurrency: ARTICLE_PIPELINE_CONCURRENCY,
    totalArticleCount: targetArticleIds.length,
  });

  const results = await mapWithConcurrency(
    targetArticleIds,
    ARTICLE_PIPELINE_CONCURRENCY,
    async (articleId) => {
      throwIfPipelineAborted(input?.abortSignal);
      let result: Omit<ArticleCaseClusteringBatchResult, "completedAt">;

      try {
        const articleResult = await runArticleCaseClustering(articleId, {
          abortSignal: input?.abortSignal,
        });
        result = {
          articleId,
          ok: true as const,
          runId: articleResult.latestRun?.id ?? null,
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
      } satisfies ArticleCaseClusteringBatchResult;

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
    { abortSignal: input?.abortSignal },
  );

  const latestGlobalSnapshot = await getLatestGlobalRunWithInventory();

  return {
    requestedArticleIds: targetArticleIds,
    concurrency: ARTICLE_PIPELINE_CONCURRENCY,
    okCount,
    errorCount,
    results,
    latestGlobalRun: latestGlobalSnapshot.latestGlobalRun,
    globalInventory: latestGlobalSnapshot.globalInventory,
  };
}

export const listArticleClusteringDashboard = memoizeWithTtl(
  "article-clustering-dashboard",
  15_000,
  () => "dashboard",
  async () => {
    if (!capabilities.hasPostgres) {
      return [] as TeamArticleClusterCard[];
    }

    return listTeamArticleClusterCards();
  },
);

export const getProposedCasesDashboard = memoizeWithTtl(
  "proposed-cases-dashboard",
  15_000,
  () => "dashboard",
  async (): Promise<ProposedCasesDashboardReadModel> => {
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
      listTeamArticleClusterCards(),
      listActiveTeamCaseRuns(),
      getLatestGlobalRunWithInventory(),
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
            const candidates = await listTeamCaseCandidatesForRun(article.latestRun!.id);
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

export const getArticleCaseboard = memoizeWithTtl(
  "article-caseboard",
  15_000,
  (articleId: string) => articleId,
  async (articleId: string): Promise<ArticleCaseboardReadModel | null> => {
    if (!capabilities.hasPostgres) {
      return null;
    }

    const normalizedArticleId =
      normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();

    const [dashboardCards, latestRun, dossierRecord] = await Promise.all([
      listTeamArticleClusterCards(),
      getLatestTeamCaseRun(normalizedArticleId),
      getTeamArticleDossierRecord<ClusteredArticleDossier>(normalizedArticleId),
    ]);

    const dashboardCard =
      dashboardCards.find((item) => item.articleId === normalizedArticleId) ?? null;
    const hydratedDossier = hydrateArticleDossier(dossierRecord?.payload ?? null);
    const proposedCases =
      latestRun?.status === "completed"
        ? await listTeamCaseCandidatesForRun(latestRun.id)
        : [];
    const unclusteredState = extractUnclusteredState({
      dossier: hydratedDossier,
      latestRun,
      proposedCases,
    });

    if (!dashboardCard && !dossierRecord && !latestRun) {
      return null;
    }

    return {
      articleId: normalizedArticleId,
      articleName: dossierRecord?.articleName ?? dashboardCard?.articleName ?? null,
      dashboardCard,
      dossier: hydratedDossier,
      latestRun,
      proposedCases,
      incidents: unclusteredState.incidents,
      watchlists: unclusteredState.watchlists,
      noise: unclusteredState.noise,
      unassignedProducts: unclusteredState.unassignedProducts,
      standaloneSignals: unclusteredState.standaloneSignals,
      ambiguousLinks: unclusteredState.ambiguousLinks,
      globalObservations: unclusteredState.globalObservations,
      globalInventory: parseStage3FromReviewPayload(latestRun?.reviewPayload) ?? null,
    };
  },
);

export const getProposedCasesForProduct = memoizeWithTtl(
  "product-proposed-cases",
  15_000,
  (productId: string) => productId,
  async (productId: string) => {
    if (!capabilities.hasPostgres) {
      return [] as TeamCaseCandidateRecord[];
    }

    const normalizedProductId =
      normalizeUiIdentifier(productId) ?? productId.replace(/\s+/g, "").trim().toUpperCase();
    return listTeamCaseCandidatesForProduct(normalizedProductId);
  },
);
