import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import {
  buildArticleDossier,
  type ClusteredArticleDossier,
  type ClusteredProductDossier,
} from "@/lib/manex-case-clustering";
import { getTeamArticleDossierRecord } from "@/lib/manex-case-clustering-state";
import { capabilities, env } from "@/lib/env";
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

const hypothesisLocalInventorySchema = z.object({
  contractVersion: z.literal(HYP_LOCAL_INVENTORY_SCHEMA_VERSION),
  reviewSummary: z.string().trim().min(1).max(1400),
  cases: z.array(localInventoryCaseSchema).max(40),
  incidents: z.array(localInventoryIncidentSchema).max(80),
  watchlists: z.array(localInventoryWatchlistSchema).max(40),
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
  noiseBuckets: z.array(hypothesisGlobalInventoryItemSchema).max(40),
  rejectedCases: z.array(hypothesisGlobalInventoryItemSchema).max(40),
  caseMergeLog: z.array(z.string().trim().min(1).max(240)).max(24),
  confidenceNotes: z.array(z.string().trim().min(1).max(240)).max(16),
});

type HypothesisNarrative = z.infer<typeof hypothesisNarrativeSchema>;
type HypothesisLocalInventory = z.infer<typeof hypothesisLocalInventorySchema>;
type HypothesisLocalIncident = z.infer<typeof localInventoryIncidentSchema>;
type HypothesisLocalWatchlist = z.infer<typeof localInventoryWatchlistSchema>;
type HypothesisLocalNoise = z.infer<typeof localInventoryNoiseSchema>;
type HypothesisGlobalInventory = z.infer<typeof hypothesisGlobalInventorySchema>;
export type HypothesisGlobalInventoryItem = z.infer<typeof hypothesisGlobalInventoryItemSchema>;

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
  noisePenalty: number;
  overlapPenalty: number;
  total: number;
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
  buildWeek: string | null;
  defectCount: number;
  claimCount: number;
  badTestCount: number;
  marginalTestCount: number;
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
  noise: HypothesisLocalNoise[];
  unassignedProducts: Array<{
    productId: string;
    reason: string;
  }>;
  globalObservations: string[];
  globalInventory: HypothesisGlobalInventory | null;
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

function createPipelineStopError(reason = STOPPED_PIPELINE_MESSAGE) {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
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

async function sleep(ms: number, abortSignal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createPipelineStopError());
      return;
    }

    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(createPipelineStopError());
    };

    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
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
    buildWeek: thread.mechanismEvidence.temporalProcessEvidence.buildWeek,
    defectCount: thread.sourceCounts.defects,
    claimCount: thread.sourceCounts.claims,
    badTestCount: thread.sourceCounts.badTests,
    marginalTestCount: thread.sourceCounts.marginalTests,
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

  const impact = clampScore(productCount * 2 + claimProducts + failureProducts, 0, 10);
  const noisePenalty = clampScore(noiseFlags, 0, 8);
  const overlapPenalty = input.overlapPenalty ?? 0;
  const total = input.coherence + input.causalSupport + impact - noisePenalty - overlapPenalty;

  return {
    impact,
    coherence: input.coherence,
    causalSupport: input.causalSupport,
    noisePenalty,
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
  articleWideAnchorRisk?: boolean;
  fingerprintTokens: Array<string | null | undefined>;
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
      const corroboratingParts = uniqueValues([
        ...entry.partNumbers,
        ...products.flatMap((product) => product.reportedParts),
      ]).slice(0, 4);
      const corroboratingFinds = uniqueValues([
        ...entry.findNumbers,
        ...products.flatMap((product) => product.bomFindNumbers),
      ]).slice(0, 4);
      const claimLagProducts = products.filter((product) => product.hasClaimOnlyLag).length;
      const coherence =
        5 +
        Math.min(2, corroboratingParts.length) +
        Math.min(2, corroboratingFinds.length) +
        (products.some((product) => product.defectCodes.length > 0) ? 1 : 0);
      const causalSupport =
        3 +
        Math.min(2, claimLagProducts) +
        (products.some((product) => product.badTestCount > 0) ? 1 : 0) +
        (products.some((product) => product.claimCount > 0) ? 1 : 0);
      const articleWideAnchorRisk =
        products.length >= Math.max(4, Math.ceil(dossier.article.productCount * 0.7));

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
        articleWideAnchorRisk,
        fingerprintTokens: [
          `family:supplier_batch`,
          `supplier_batch:${entry.batchRef}`,
          ...corroboratingParts.map((value) => `part:${value}`),
          ...corroboratingFinds.map((value) => `bom:${value}`),
        ],
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
          : 0);

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
          articleWideAnchorRisk: false,
          fingerprintTokens: [
            `family:process_window`,
            `occurrence:${section}`,
            earliestWeek ? `week:${earliestWeek}` : null,
            ...sharedDefectCodes.map((value) => `defect:${value}`),
            ...sharedTestKeys.map((value) => `test:${value}`),
          ],
        }),
      );
    }
  }

  return seeds;
}

function generateLatentDesignSeeds(
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
      const coherence = 6 + Math.min(2, bomFinds.length) + Math.min(2, lagBuckets.length === 1 ? 2 : 1);
      const causalSupport =
        5 +
        Math.min(2, products.filter((product) => product.claimCount > 0).length) +
        (products.every((product) => product.defectCount === 0 && product.badTestCount === 0) ? 2 : 0);

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
          lagBuckets.length ? `Lag pattern stays in ${lagBuckets.join(", ")} bucket(s).` : null,
          bomFinds.length ? `Repeated BOM positions: ${bomFinds.join(", ")}.` : null,
        ],
        conflictingEvidence: [
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
        articleWideAnchorRisk: false,
        fingerprintTokens: [
          `family:latent_design`,
          `part:${anchor}`,
          ...bomFinds.map((value) => `bom:${value}`),
          ...lagBuckets.map((value) => `claim_lag:${value}`),
        ],
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
      const articleWideAnchorRisk =
        products.length >= Math.max(4, Math.ceil(dossier.article.productCount * 0.7));
      const coherence = 5 + Math.min(2, orders.length) + Math.min(2, cosmeticCodes.length);
      const causalSupport =
        3 +
        (products.every((product) => product.claimCount === 0) ? 2 : 0) +
        (products.some((product) => product.reworkUsers.length > 0) ? 2 : 0);

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
        articleWideAnchorRisk,
        fingerprintTokens: [
          `family:handling_cluster`,
          factsByProduct.size && anchor.startsWith("ORD-") ? `order:${anchor}` : `user:${anchor}`,
          ...orders.map((value) => `order:${value}`),
          ...cosmeticCodes.map((value) => `defect:${value}`),
        ],
      });
    });
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
      articleWideAnchorRisk: false,
      fingerprintTokens: [
        `family:noise_watchlist`,
        anchorKey,
        ...uniqueValues(products.flatMap((product) => product.testKeys)).map((value) => `test:${value}`),
      ],
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

function resolveLocalInventory(input: {
  dossier: ClusteredArticleDossier;
  factsByProduct: Map<string, ThreadFacts>;
  seeds: HypothesisSeed[];
}) {
  const caseSeeds: HypothesisSeed[] = [];
  const watchlists: HypothesisLocalWatchlist[] = [];
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
      if (
        strongerOverlap.family === seed.family ||
        strongerOverlap.score.total - seed.score.total >= 4 ||
        seed.articleWideAnchorRisk
      ) {
        watchlists.push(
          convertSeedToWatchlist(
            seed,
            `Overlaps strongly with higher-ranked case ${strongerOverlap.anchorLabel}.`,
          ),
        );
        caseMergeLog.push(
          `${seed.titleSeed} was demoted behind stronger hypothesis ${strongerOverlap.titleSeed}.`,
        );
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
    noise,
    rejectedCases,
    unassignedProducts,
    globalObservations: uniqueValues([
      caseSeeds.length ? `${caseSeeds.length} case hypotheses survived local ranking.` : null,
      watchlists.length ? `${watchlists.length} weaker patterns remain on watchlist.` : null,
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
      "Open a focused engineering investigation for the shared mechanism hypothesis.",
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

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < HYP_MODEL_CALL_MAX_ATTEMPTS) {
    attempt += 1;

    try {
      throwIfPipelineAborted(abortSignal);
      const result = await generateObject({
        model: openai.responses(env.OPENAI_MODEL),
        schema: hypothesisNarrativeSchema,
        system: buildHypothesisNarrativeSystemPrompt(),
        prompt: buildHypothesisNarrativeUserPrompt(payload),
        maxOutputTokens: HYP_NARRATIVE_MAX_OUTPUT_TOKENS,
        abortSignal,
        providerOptions: {
          openai: {
            reasoningEffort: HYP_REASONING_EFFORT,
          },
        },
      });

      return result.object;
    } catch (error) {
      lastError = error;

      if (attempt >= HYP_MODEL_CALL_MAX_ATTEMPTS) {
        break;
      }

      await sleep(300 * attempt, abortSignal);
    }
  }

  if (lastError) {
    console.warn(
      `[manex-hypothesis:narrative-fallback] ${JSON.stringify({
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
            ? `${articleIds.length} articles share the same mechanism-specific anchor set.`
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
    inventorySummary: `${validatedCases.length} validated hypotheses, ${groupedWatchlists.length} watchlists, and ${groupedNoise.length} noise buckets are visible in the latest snapshot.`,
    validatedCases: validatedCases.slice(0, 40),
    watchlists: groupedWatchlists.slice(0, 40),
    noiseBuckets: groupedNoise.slice(0, 40),
    rejectedCases: groupedRejected.slice(0, 40),
    caseMergeLog: uniqueValues(caseMergeLog).slice(0, 24),
    confidenceNotes: [
      "The hypothesis engine prefers mechanism-specific anchors over generic similarity.",
      "Supplier, process, latent-field, and handling families are scored separately before any narrative is generated.",
      "Watchlists and noise remain visible so detection hotspots and marginal-only artifacts do not inflate active cases.",
    ],
  });
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
      ...generateLatentDesignSeeds(factsByProduct),
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

    const reviewPayload: HypothesisReviewPayload = {
      contractVersion: HYP_RUN_REVIEW_SCHEMA_VERSION,
      localInventory,
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
      noise: parsedReview?.localInventory.noise ?? [],
      unassignedProducts: parsedReview?.localInventory.unassignedProducts ?? [],
      globalObservations: parsedReview?.localInventory.globalObservations ?? [],
      globalInventory: parsedReview?.globalInventory ?? null,
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
