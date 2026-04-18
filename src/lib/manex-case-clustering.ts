import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
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
import { queryPostgres } from "@/lib/postgres";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

const ARTICLE_DOSSIER_SCHEMA_VERSION = "manex.article_dossier.v2";
const PRODUCT_DOSSIER_SCHEMA_VERSION = "manex.product_dossier.v2";
const CASE_PROPOSAL_SCHEMA_VERSION = "manex.article_case_set.v2";
const GLOBAL_RECONCILIATION_SCHEMA_VERSION = "manex.global_case_inventory.v1";
const CASE_PIPELINE_REVIEW_SCHEMA_VERSION = "manex.case_pipeline_review.v1";
const CASE_PROMPT_VERSION = "2026-04-18.case-clustering.v3";
const MAX_RELATION_ROWS = 800;
const SINGLE_PASS_PRODUCT_LIMIT = 18;
const PRODUCT_CHUNK_SIZE = 12;
const MAX_PROMPT_CHARS = 120_000;

const readPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MINI_MODEL_CONCURRENCY_MULTIPLIER = /mini/i.test(env.OPENAI_MODEL) ? 1 : 0;
const STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY = readPositiveInt(
  process.env.MANEX_STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY,
  8 + MINI_MODEL_CONCURRENCY_MULTIPLIER * 4,
);
const STAGE2_CHUNK_PROPOSAL_CONCURRENCY = readPositiveInt(
  process.env.MANEX_STAGE2_CHUNK_PROPOSAL_CONCURRENCY,
  4 + MINI_MODEL_CONCURRENCY_MULTIPLIER * 2,
);
const STAGE3_ARTICLE_LOAD_CONCURRENCY = readPositiveInt(
  process.env.MANEX_STAGE3_ARTICLE_LOAD_CONCURRENCY,
  8,
);
const ARTICLE_PIPELINE_CONCURRENCY = readPositiveInt(
  process.env.MANEX_ARTICLE_PIPELINE_CONCURRENCY,
  3,
);

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
});

const proposalCaseSchema = z.object({
  proposalTempId: z.string().trim().min(1).max(48),
  title: z.string().trim().min(8).max(160),
  caseKind: z.enum([
    "functional_failure",
    "process_drift",
    "supplier_batch",
    "design_weakness",
    "service_issue",
    "cosmetic_issue",
    "false_positive",
    "mixed",
    "other",
  ]),
  summary: z.string().trim().min(20).max(1500),
  suspectedCommonRootCause: z.string().trim().min(10).max(1500),
  suspectedRootCauseFamily: z.string().trim().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1),
  priority: z.enum(["low", "medium", "high", "critical"]),
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

const clusteringProposalSchema = z.object({
  contractVersion: z.literal(CASE_PROPOSAL_SCHEMA_VERSION),
  reviewSummary: z.string().trim().min(1).max(1500),
  cases: z.array(proposalCaseSchema).max(20),
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
        signalType: z.enum([
          "defect",
          "field_claim",
          "bad_test",
          "marginal_test",
          "rework",
          "product_action",
        ]),
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

export type ProductThreadSynthesis = z.infer<typeof productThreadSynthesisSchema>;

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
    sharedSections: Array<{ section: string; productIds: string[]; count: number }>;
    sharedTestHotspots: Array<{
      testKey: string;
      productIds: string[];
      signalIds: string[];
      count: number;
    }>;
  };
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

const normalizeText = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
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

const countUnique = (values: Array<string | null | undefined>) =>
  uniqueValues(values).length;

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const safeIso = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

const trimPreview = (value: string | null | undefined, max = 220) => {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

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
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
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

function buildTraceabilitySnapshot(installedParts: ManexInstalledPart[]): ProductTraceabilitySnapshot {
  const assemblies = groupBy(
    installedParts,
    (item) => normalizeNullableText(item.parentFindNumber) ?? "Direct install",
  );

  const assemblySummaries = [...assemblies.entries()]
    .map(([assemblyLabel, items]) => ({
      assemblyLabel,
      partCount: items.length,
      uniqueBatchCount: countUnique(items.map((item) => item.batchId ?? item.batchNumber)),
      uniqueSupplierCount: countUnique(items.map((item) => item.supplierName)),
    }))
    .sort(
      (left, right) =>
        right.partCount - left.partCount ||
        left.assemblyLabel.localeCompare(right.assemblyLabel),
    );

  return {
    installedPartCount: installedParts.length,
    uniqueBatchCount: countUnique(
      installedParts.map((item) => item.batchId ?? item.batchNumber),
    ),
    uniqueSupplierCount: countUnique(installedParts.map((item) => item.supplierName)),
    uniquePartCount: countUnique(installedParts.map((item) => item.partNumber)),
    assemblies: assemblySummaries,
    graphSummary: {
      nodeCount:
        1 +
        countUnique(installedParts.map((item) => item.partNumber)) +
        countUnique(installedParts.map((item) => item.findNumber ?? item.positionCode)) +
        countUnique(installedParts.map((item) => item.batchId ?? item.batchNumber)) +
        countUnique(installedParts.map((item) => item.supplierName)),
      edgeCount: installedParts.length * 3,
      dominantBatches: uniqueValues(
        installedParts.slice(0, 10).map((item) => item.batchId ?? item.batchNumber),
      ).slice(0, 6),
      dominantSuppliers: uniqueValues(
        installedParts.slice(0, 10).map((item) => item.supplierName),
      ).slice(0, 6),
    },
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
    sharedSections,
    sharedTestHotspots,
  };
};

function buildFallbackProductThreadSynthesis(input: {
  productId: string;
  articleId: string;
  signalTimeline: ProductSignalTimelineItem[];
  summaryFeatures: ClusteredProductDossier["summaryFeatures"];
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
      ].slice(0, 6),
      serviceSignals: input.summaryFeatures.fieldClaimWithoutFactoryDefect
        ? ["Field claim exists without a prior factory defect."]
        : [],
      contradictions: [],
    },
    suspiciousPatterns: [
      ...input.summaryFeatures.reportedPartNumbers.slice(0, 3).map(
        (part) => `Reported part focus around ${part}.`,
      ),
      ...input.summaryFeatures.supplierBatches.slice(0, 2).map(
        (batch) => `Traceability touches supplier batch ${batch}.`,
      ),
    ].slice(0, 6),
    possibleNoiseFlags: input.summaryFeatures.falsePositiveMarkers.slice(0, 6),
    openQuestions: [
      input.summaryFeatures.fieldClaimWithoutFactoryDefect
        ? "Why is there a field claim without a corresponding factory defect trail?"
        : null,
      input.summaryFeatures.reworkPresent
        ? "Did rework change the apparent symptom path for this unit?"
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
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  tests: ManexTestSignal[];
  rework: ManexReworkRecord[];
  actions: ManexWorkflowAction[];
  installedParts: ManexInstalledPart[];
}) {
  return {
    product: {
      productId: input.product.product_id,
      articleId: input.product.article_id,
      articleName: input.articleName,
      buildTs: safeIso(input.product.build_ts),
      orderId: normalizeNullableText(input.product.order_id),
    },
    sourceCounts: input.sourceCounts,
    timeline: input.signalTimeline.map((signal) => ({
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
    defects: input.defects.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      code: item.code,
      severity: item.severity,
      reportedPartNumber: item.reportedPartNumber,
      section: item.detectedSectionName ?? item.occurrenceSectionName,
      notes: item.notes,
    })),
    claims: input.claims.map((item) => ({
      id: item.id,
      claimedAt: item.claimedAt,
      market: item.market,
      mappedDefectCode: item.mappedDefectCode,
      reportedPartNumber: item.reportedPartNumber,
      complaintText: item.complaintText,
      notes: item.notes,
    })),
    tests: input.tests.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      overallResult: item.overallResult,
      testKey: item.testKey,
      testValue: item.testValue,
      sectionName: item.sectionName,
      notes: item.notes,
    })),
    installedParts: input.installedParts.slice(0, 40).map((item) => ({
      findNumber: item.findNumber,
      positionCode: item.positionCode,
      partNumber: item.partNumber,
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      supplierName: item.supplierName,
    })),
    rework: input.rework.map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      sectionId: item.sectionId,
      reportedPartNumber: item.reportedPartNumber,
      actionText: item.actionText,
      userId: item.userId,
    })),
    actions: input.actions.map((item) => ({
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
  });
}

function hydrateArticleDossier(dossier: ClusteredArticleDossier | null) {
  if (!dossier) {
    return null;
  }

  return {
    ...dossier,
    productThreads: dossier.productThreads.map((thread) => ({
      ...thread,
      stage1Synthesis: ensureStage1Synthesis(thread),
    })),
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

async function buildArticleDossier(
  articleId: string,
  onStageChange?: (stage: "stage1_loading" | "stage1_synthesis", detail: string) => Promise<void>,
): Promise<ClusteredArticleDossier> {
  if (!capabilities.hasPostgres) {
    throw new Error("Article dossier building requires DATABASE_URL.");
  }

  await ensureTeamCaseClusteringState();

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();

  await onStageChange?.("stage1_loading", "Loading deterministic article dossier.");

  const { article, products } = await loadArticleMeta(normalizedArticleId);

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
      const traceabilitySnapshot = buildTraceabilitySnapshot(installedParts);
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

  const productThreads = await mapWithConcurrency(
    productThreadDrafts,
    STAGE1_PRODUCT_SYNTHESIS_CONCURRENCY,
    async (draft) => {
      const stage1Synthesis =
        draft.signalTimeline.length > 0
          ? await generateProductThreadSynthesis({
              promptPayload: buildStage1PromptPayload({
                product: draft.product,
                articleName: article.name,
                sourceCounts: draft.sourceCounts,
                signalTimeline: draft.signalTimeline,
                summaryFeatures: draft.summaryFeatures,
                defects: draft.defects,
                claims: draft.claims,
                tests: draft.tests,
                rework: draft.rework,
                actions: draft.actions,
                installedParts: draft.installedParts,
              }),
            }).catch(() =>
              buildFallbackProductThreadSynthesis({
                productId: draft.product.product_id,
                articleId: draft.product.article_id,
                signalTimeline: draft.signalTimeline,
                summaryFeatures: draft.summaryFeatures,
              }),
            )
          : buildFallbackProductThreadSynthesis({
              productId: draft.product.product_id,
              articleId: draft.product.article_id,
              signalTimeline: draft.signalTimeline,
              summaryFeatures: draft.summaryFeatures,
            });

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

      return payload;
    },
  );

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
  const serialized = JSON.stringify(dossier);

  if (
    dossier.productThreads.length > SINGLE_PASS_PRODUCT_LIMIT ||
    serialized.length > MAX_PROMPT_CHARS
  ) {
    return "chunked" as const;
  }

  return "single" as const;
}

function buildStage1SystemPrompt() {
  return [
    "You are building a product-level investigation dossier for one manufactured unit.",
    "Your job is compression and structuring, not clustering and not final root-cause attribution.",
    "Preserve all relevant facts while staying compact.",
    "Highlight suspicious patterns, contradictions, and missing evidence.",
    "Distinguish confirmed failures, marginal signals, likely false positives, and service or documentation style issues.",
    "Return strict JSON only.",
  ].join("\n");
}

function buildStage1UserPrompt(payload: unknown) {
  return [
    "You will receive one complete product thread for a single product.",
    "Consolidate it into one coherent evidence thread.",
    "Do not infer an exact root cause.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

function buildPassASystemPrompt() {
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

function buildPassAUserPrompt(payload: unknown) {
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

function buildPassBSystemPrompt() {
  return [
    "You are the article-local reviewer for manufacturing quality case clustering.",
    "Refine, merge, split, or reject weak draft case clusters within this article.",
    "Keep only clusters that are investigation-worthy and supported by shared evidence.",
    "Remove products that do not belong, merge duplicate cases, and keep cosmetic, service, or false-positive groups separate from likely functional or manufacturing cases.",
    "Preserve standalone signals when a fault appears isolated or not cluster-related.",
    "Return the same structured JSON contract, now representing the final reviewed proposal set.",
  ].join("\n");
}

function buildPassBUserPrompt(payload: unknown) {
  return [
    "Review and refine these draft case proposals using the same article dossier context.",
    "The final output should be tighter than the draft: fewer duplicates, cleaner case boundaries, clearer evidence, and clearer unassigned products where confidence is weak.",
    "Keep standalone signals explicit when the evidence suggests they should not be grouped into any proposed case.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

function buildStage3SystemPrompt() {
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

function buildStage3UserPrompt(payload: unknown) {
  return [
    "Reconcile these article-local case sets into one global inventory.",
    "Use the article-local proposals plus the provided global summaries to merge, suppress, or watch patterns without forcing a case where the evidence is weak.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

function toPromptProductThread(thread: ClusteredProductDossier) {
  return {
    productId: thread.productId,
    articleId: thread.articleId,
    articleName: thread.articleName,
    buildTs: thread.buildTs,
    orderId: thread.orderId,
    productSummary: thread.stage1Synthesis.productSummary,
    timelineSummary: thread.stage1Synthesis.timeline,
    suspiciousPatterns: thread.stage1Synthesis.suspiciousPatterns,
    possibleNoiseFlags: thread.stage1Synthesis.possibleNoiseFlags,
    openQuestions: thread.stage1Synthesis.openQuestions,
    structuredEvidenceFeatures: thread.stage1Synthesis.evidenceFeatures,
    sourceCounts: thread.sourceCounts,
    summaryFeatures: thread.summaryFeatures,
    signals: thread.signals,
    defects: thread.defects.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      code: item.code,
      severity: item.severity,
      reportedPartNumber: item.reportedPartNumber,
      reportedPartTitle: item.reportedPartTitle,
      detectedSectionName: item.detectedSectionName,
      occurrenceSectionName: item.occurrenceSectionName,
      detectedTestName: item.detectedTestName,
      detectedTestOverall: item.detectedTestOverall,
      notes: item.notes,
      imageUrl: item.imageUrl,
    })),
    claims: thread.claims.map((item) => ({
      id: item.id,
      claimedAt: item.claimedAt,
      mappedDefectCode: item.mappedDefectCode,
      mappedDefectSeverity: item.mappedDefectSeverity,
      reportedPartNumber: item.reportedPartNumber,
      reportedPartTitle: item.reportedPartTitle,
      market: item.market,
      daysFromBuild: item.daysFromBuild,
      complaintText: item.complaintText,
      notes: item.notes,
      imageUrl: item.imageUrl,
    })),
    tests: thread.tests.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      overallResult: item.overallResult,
      testKey: item.testKey,
      testValue: item.testValue,
      unit: item.unit,
      sectionName: item.sectionName,
      notes: item.notes,
    })),
    rework: thread.rework.map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      sectionId: item.sectionId,
      reportedPartNumber: item.reportedPartNumber,
      actionText: item.actionText,
      userId: item.userId,
    })),
    actions: thread.actions.map((item) => ({
      id: item.id,
      recordedAt: item.recordedAt,
      actionType: item.actionType,
      status: item.status,
      sectionId: item.sectionId,
      comments: item.comments,
      defectId: item.defectId,
    })),
    installedParts: thread.installedParts.map((item) => ({
      installId: item.installId,
      findNumber: item.findNumber,
      positionCode: item.positionCode,
      partNumber: item.partNumber,
      partTitle: item.partTitle,
      partId: item.partId,
      serialNumber: item.serialNumber,
      qualityStatus: item.qualityStatus,
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      supplierName: item.supplierName,
      supplierId: item.supplierId,
      manufacturerName: item.manufacturerName,
      installedAt: item.installedAt,
    })),
    weeklyQualitySnippets: thread.weeklyQualitySnippets.map((item) => ({
      weekStart: item.weekStart,
      defectCount: item.defectCount,
      claimCount: item.claimCount,
      reworkCount: item.reworkCount,
      topDefectCode: item.topDefectCode,
    })),
    evidenceFrames: thread.evidenceFrames,
    traceabilitySnapshot: thread.traceabilitySnapshot,
    existingSurfaceContext: thread.existingSurfaceContext,
  };
}

function toPromptArticlePayload(dossier: ClusteredArticleDossier, productIds?: Set<string>) {
  const selectedThreads = productIds
    ? dossier.productThreads.filter((thread) => productIds.has(thread.productId))
    : dossier.productThreads;

  const selectedProductIds = new Set(selectedThreads.map((thread) => thread.productId));

  return {
    contractVersion: dossier.contractVersion,
    generatedAt: dossier.generatedAt,
    article: dossier.article,
    articleSummary: dossier.articleSummary,
    crossProductSummaries: dossier.crossProductSummaries,
    productThreads: selectedThreads.map(toPromptProductThread),
    rawEvidenceAppendix: {
      defects: dossier.rawEvidenceAppendix.defects
        .filter((item) => selectedProductIds.has(item.productId))
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          occurredAt: item.occurredAt,
          code: item.code,
          severity: item.severity,
          reportedPartNumber: item.reportedPartNumber,
          notes: item.notes,
        })),
      claims: dossier.rawEvidenceAppendix.claims
        .filter((item) => selectedProductIds.has(item.productId))
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          claimedAt: item.claimedAt,
          mappedDefectCode: item.mappedDefectCode,
          mappedDefectSeverity: item.mappedDefectSeverity,
          reportedPartNumber: item.reportedPartNumber,
          complaintText: item.complaintText,
        })),
      tests: dossier.rawEvidenceAppendix.tests
        .filter((item) => selectedProductIds.has(item.productId))
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          occurredAt: item.occurredAt,
          overallResult: item.overallResult,
          testKey: item.testKey,
          testValue: item.testValue,
          sectionName: item.sectionName,
          notes: item.notes,
        })),
      installs: dossier.rawEvidenceAppendix.installs
        .filter((item) => selectedProductIds.has(item.productId))
        .map((item) => ({
          productId: item.productId,
          findNumber: item.findNumber,
          positionCode: item.positionCode,
          partNumber: item.partNumber,
          batchId: item.batchId,
          batchNumber: item.batchNumber,
          supplierName: item.supplierName,
        })),
      rework: dossier.rawEvidenceAppendix.rework
        .filter((item) => selectedProductIds.has(item.productId))
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          recordedAt: item.recordedAt,
          reportedPartNumber: item.reportedPartNumber,
          actionText: item.actionText,
        })),
      actions: dossier.rawEvidenceAppendix.actions
        .filter((item) => selectedProductIds.has(item.productId))
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          recordedAt: item.recordedAt,
          actionType: item.actionType,
          status: item.status,
          defectId: item.defectId,
          comments: item.comments,
        })),
    },
  };
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
}) {
  const openai = getOpenAiClient();

  const result = await generateObject({
    model: openai.responses(env.OPENAI_MODEL),
    schema: input.schema,
    schemaName: input.schemaName,
    schemaDescription: input.schemaDescription,
    system: input.system,
    prompt: input.prompt,
    providerOptions: {
      openai: {
        reasoningEffort: "medium",
        store: false,
        textVerbosity: "low",
      },
    },
  });

  return result.object as z.infer<TSchema>;
}

async function generateProductThreadSynthesis(input: {
  promptPayload: unknown;
}) {
  return generateStructuredObject({
    schema: productThreadSynthesisSchema,
    schemaName: "manex_product_thread_synthesis",
    schemaDescription:
      "Compressed product-level investigation dossier for one manufactured unit in the Manex hackathon dataset.",
    system: buildStage1SystemPrompt(),
    prompt: buildStage1UserPrompt(input.promptPayload),
  });
}

async function generateProposalObject(input: {
  system: string;
  prompt: string;
}) {
  return generateStructuredObject({
    schema: clusteringProposalSchema,
    schemaName: "manex_article_case_set",
    schemaDescription:
      "Article-local proposed case set for one article dossier in the Manex hackathon dataset.",
    system: input.system,
    prompt: input.prompt,
  });
}

async function generateGlobalReconciliationObject(input: {
  payload: unknown;
}) {
  return generateStructuredObject({
    schema: globalReconciliationSchema,
    schemaName: "manex_global_case_inventory",
    schemaDescription:
      "Global reconciliation inventory of validated cases, watchlists, noise buckets, and rejected cases for the Manex hackathon dataset.",
    system: buildStage3SystemPrompt(),
    prompt: buildStage3UserPrompt(input.payload),
  });
}

function chunkProductThreads(productThreads: ClusteredProductDossier[]) {
  const chunks: ClusteredProductDossier[][] = [];

  for (let index = 0; index < productThreads.length; index += PRODUCT_CHUNK_SIZE) {
    chunks.push(productThreads.slice(index, index + PRODUCT_CHUNK_SIZE));
  }

  return chunks;
}

async function runProposalPass(
  dossier: ClusteredArticleDossier,
  onStageChange?: (stage: "stage2_draft" | "stage2_review", detail: string) => Promise<void>,
): Promise<{ draft: ProposalOutput; review: ProposalOutput; strategy: "single" | "chunked" }> {
  const strategy = chooseRunStrategy(dossier);

  if (strategy === "single") {
    await onStageChange?.(
      "stage2_draft",
      `Drafting article-wide cases for ${dossier.article.productCount} products.`,
    );
    const draft = await generateProposalObject({
      system: buildPassASystemPrompt(),
      prompt: buildPassAUserPrompt(toPromptArticlePayload(dossier)),
    });
    await onStageChange?.("stage2_review", "Reviewing and refining article-wide cases.");
    const review = await generateProposalObject({
      system: buildPassBSystemPrompt(),
      prompt: buildPassBUserPrompt({
        articleDossier: toPromptArticlePayload(dossier),
        draftProposals: draft,
      }),
    });

    return { draft, review, strategy };
  }

  const chunks = chunkProductThreads(dossier.productThreads);
  await onStageChange?.(
    "stage2_draft",
    `Drafting article-wide cases across ${chunks.length} dossier chunks.`,
  );
  const chunkDrafts = await mapWithConcurrency(
    chunks,
    STAGE2_CHUNK_PROPOSAL_CONCURRENCY,
    async (chunk, index) => {
      const chunkProductIds = new Set(chunk.map((item) => item.productId));
      const chunkPayload = {
        ...toPromptArticlePayload(dossier, chunkProductIds),
        chunkInfo: {
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          productIds: [...chunkProductIds],
        },
      };

      return generateProposalObject({
        system: buildPassASystemPrompt(),
        prompt: buildPassAUserPrompt(chunkPayload),
      });
    },
  );

  const draft: ProposalOutput = {
    contractVersion: CASE_PROPOSAL_SCHEMA_VERSION,
    reviewSummary: "Chunked draft proposals generated before final review.",
    cases: chunkDrafts.flatMap((item) => item.cases),
    unassignedProducts: chunkDrafts.flatMap((item) => item.unassignedProducts),
    standaloneSignals: chunkDrafts.flatMap((item) => item.standaloneSignals),
    ambiguousLinks: chunkDrafts.flatMap((item) => item.ambiguousLinks),
    globalObservations: uniqueValues(
      chunkDrafts.flatMap((item) => item.globalObservations),
    ).slice(0, 12),
  };

  await onStageChange?.("stage2_review", "Reviewing and consolidating chunked case drafts.");
  const review = await generateProposalObject({
      system: buildPassBSystemPrompt(),
      prompt: buildPassBUserPrompt({
        articleContext: {
          article: dossier.article,
          articleSummary: dossier.articleSummary,
          crossProductSummaries: dossier.crossProductSummaries,
        },
        allProductThreads: dossier.productThreads.map((thread) => ({
          productId: thread.productId,
          sourceCounts: thread.sourceCounts,
          summaryFeatures: thread.summaryFeatures,
        })),
        draftProposals: draft,
      }),
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
      unassignedProducts: [] as ArticleCaseboardReadModel["unassignedProducts"],
      standaloneSignals: [] as ArticleCaseboardReadModel["standaloneSignals"],
      ambiguousLinks: [] as ArticleCaseboardReadModel["ambiguousLinks"],
      globalObservations: [] as string[],
    };
  }

  const standaloneBySignalId = new Map<string, ProposalStandaloneSignal>();

  for (const item of parsed.standaloneSignals) {
    if (!standaloneBySignalId.has(item.signalId)) {
      standaloneBySignalId.set(item.signalId, item);
    }
  }

  return {
    unassignedProducts: parsed.unassignedProducts.filter(
      (item) =>
        productIdSet.has(item.productId) &&
        !assignedProductIds.has(item.productId),
    ),
    standaloneSignals: [...standaloneBySignalId.values()].filter((item) => {
      const signal = signalLookup.get(item.signalId);

      return (
        Boolean(signal) &&
        signal?.productId === item.productId &&
        signal?.signalType === item.signalType &&
        !assignedSignalIds.has(item.signalId)
      );
    }),
    ambiguousLinks: parsed.ambiguousLinks.filter((item) =>
      productIdSet.has(item.productId),
    ),
    globalObservations: parsed.globalObservations,
  };
}

function parseStage2FromReviewPayload(payload: unknown) {
  const direct = clusteringProposalSchema.safeParse(payload);

  if (direct.success) {
    return direct.data;
  }

  if (payload && typeof payload === "object" && "stage2" in payload) {
    const nested = clusteringProposalSchema.safeParse(
      (payload as { stage2?: unknown }).stage2,
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
      topDefectCodes: input.dossier.articleSummary.topDefectCodes.slice(0, 5),
      topReportedParts: input.dossier.articleSummary.topReportedParts.slice(0, 5),
      topBomPositions: input.dossier.articleSummary.topBomPositions.slice(0, 5),
      topSupplierBatches: input.dossier.articleSummary.topSupplierBatches.slice(0, 5),
      topSections: input.dossier.articleSummary.topSections.slice(0, 5),
      fieldClaimOnlyPatterns: input.dossier.articleSummary.fieldClaimOnlyPatterns.slice(0, 5),
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
    { defectCount: number; claimCount: number; reworkCount: number }
  >();

  for (const summary of input.dossiers.flatMap((dossier) => dossier.weeklyQualitySummaries)) {
    const current = weeklySummaryByWeek.get(summary.weekStart) ?? {
      defectCount: 0,
      claimCount: 0,
      reworkCount: 0,
    };
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
  );

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
  );

  const falsePositivePool = productThreads
    .filter((thread) => thread.summaryFeatures.falsePositiveMarkers.length > 0)
    .map((thread) => ({
      productId: thread.productId,
      markers: thread.summaryFeatures.falsePositiveMarkers.slice(0, 3),
    }))
    .slice(0, 20);

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
    .slice(0, 24);

  const testResultBandSummaries = topEntries(
    bucketCounts(
      tests,
      (item) => `${item.testKey}:${item.overallResult}`,
      (item) => item.productId,
      (item) => item.id,
    ),
    12,
  );

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
        .slice(-16)
        .map(([weekStart, value]) => ({
          weekStart,
          ...value,
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
}) {
  const latestCompletedRuns = await loadLatestCompletedArticleRuns();
  const persistedEntries = await mapWithConcurrency(
    latestCompletedRuns.filter((row) => row.article_id !== input.currentArticleId),
    STAGE3_ARTICLE_LOAD_CONCURRENCY,
    async (row) => {
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
    payload: context,
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

export async function runArticleCaseClustering(articleId: string) {
  if (!capabilities.hasPostgres) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Case clustering requires OPENAI_API_KEY.");
  }

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();
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
    const dossier = await buildArticleDossier(normalizedArticleId, async (stage, detail) => {
      await updateTeamCaseRunStage({
        id: runId,
        currentStage: stage,
        stageDetail: detail,
      });
    });

    await updateTeamCaseRunStage({
      id: runId,
      currentStage: "stage1_synthesis",
      stageDetail: `Built article dossier with ${dossier.article.totalSignals} signals.`,
      articleName: dossier.article.articleName,
      productCount: dossier.article.productCount,
      signalCount: dossier.article.totalSignals,
    });

    const proposalPass = await runProposalPass(dossier, async (stage, detail) => {
      await updateTeamCaseRunStage({
        id: runId,
        currentStage: stage,
        stageDetail: detail,
      });
    });
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
      errorMessage: error instanceof Error ? error.message : String(error),
      stageDetail: "Pipeline failed before completion.",
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

export async function runArticleCaseClusteringBatch(articleIds?: string[]) {
  if (!capabilities.hasPostgres) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Case clustering requires OPENAI_API_KEY.");
  }

  const requestedIds =
    articleIds?.map((articleId) => normalizeUiIdentifier(articleId)).filter(Boolean) ?? [];
  const targetArticleIds = requestedIds.length
    ? uniqueValues(requestedIds)
    : await loadAllClusterableArticleIds();

  const results = await mapWithConcurrency(
    targetArticleIds,
    ARTICLE_PIPELINE_CONCURRENCY,
    async (articleId) => {
      try {
        const result = await runArticleCaseClustering(articleId);
        return {
          articleId,
          ok: true as const,
          runId: result.latestRun?.id ?? null,
          caseCount: result.proposedCases.length,
          validatedCount: result.globalInventory?.validatedCases.length ?? 0,
          watchlistCount: result.globalInventory?.watchlists.length ?? 0,
          noiseCount: result.globalInventory?.noiseBuckets.length ?? 0,
          error: null,
        };
      } catch (error) {
        return {
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
    },
  );

  const latestGlobalSnapshot = await getLatestGlobalRunWithInventory();

  return {
    requestedArticleIds: targetArticleIds,
    concurrency: ARTICLE_PIPELINE_CONCURRENCY,
    okCount: results.filter((item) => item.ok).length,
    errorCount: results.filter((item) => !item.ok).length,
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
