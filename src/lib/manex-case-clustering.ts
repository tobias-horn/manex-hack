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
  listTeamArticleClusterCards,
  listTeamCaseCandidatesForProduct,
  listTeamCaseCandidatesForRun,
  replaceTeamCaseCandidatesForRun,
  upsertTeamArticleDossier,
  upsertTeamProductDossier,
  type TeamArticleClusterCard,
  type TeamCaseCandidateRecord,
  type TeamCaseRunSummary,
} from "@/lib/manex-case-clustering-state";
import { queryPostgres } from "@/lib/postgres";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

const ARTICLE_DOSSIER_SCHEMA_VERSION = "manex.article_dossier.v1";
const PRODUCT_DOSSIER_SCHEMA_VERSION = "manex.product_dossier.v1";
const CASE_PROPOSAL_SCHEMA_VERSION = "manex.case_proposal_set.v1";
const CASE_PROMPT_VERSION = "2026-04-18.case-clustering.v1";
const MAX_RELATION_ROWS = 800;
const SINGLE_PASS_PRODUCT_LIMIT = 18;
const PRODUCT_CHUNK_SIZE = 12;
const MAX_PROMPT_CHARS = 120_000;

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
};

type ProposalOutput = z.infer<typeof clusteringProposalSchema>;

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

async function buildArticleDossier(articleId: string): Promise<ClusteredArticleDossier> {
  if (!capabilities.hasPostgres) {
    throw new Error("Article dossier building requires DATABASE_URL.");
  }

  await ensureTeamCaseClusteringState();

  const normalizedArticleId =
    normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();

  const { article, products } = await loadArticleMeta(normalizedArticleId);

  if (!article || !products.length) {
    throw new Error(`No products found for article ${normalizedArticleId}.`);
  }

  const data = createManexDataAccess();
  const [defectResult, claimResult, testResult, weeklyResult] = await Promise.all([
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
  ]);

  const defectsByProduct = groupBy(defectResult.items, (item) => item.productId);
  const claimsByProduct = groupBy(claimResult.items, (item) => item.productId);
  const testsByProduct = groupBy(testResult.items, (item) => item.productId);

  const productThreads = await Promise.all(
    products.map(async (product) => {
      const [installedResult, actionResult, reworkResult] = await Promise.all([
        data.traceability.findInstalledPartsForProduct(product.product_id, {
          limit: MAX_RELATION_ROWS,
        }),
        data.workflow.findActionsForProduct(product.product_id, {
          limit: 200,
        }),
        data.workflow.findRework({
          productId: product.product_id,
          limit: 200,
        }),
      ]);

      const defects = defectsByProduct.get(product.product_id) ?? [];
      const claims = claimsByProduct.get(product.product_id) ?? [];
      const tests = testsByProduct.get(product.product_id) ?? [];
      const signalTimeline = buildSignalTimeline({
        defects,
        claims,
        tests,
        rework: reworkResult.items,
        actions: actionResult.items,
      });
      const traceabilitySnapshot = buildTraceabilitySnapshot(installedResult.items);
      const evidenceFrames = buildEvidenceFrames(defects, claims);
      const summaryFeatures = buildSummaryFeatures({
        product,
        defects,
        claims,
        tests,
        rework: reworkResult.items,
        actions: actionResult.items,
        installedParts: installedResult.items,
        signalTimeline,
      });
      const relevantWeeklySummaries = weeklyResult.items
        .filter((item) => item.articleId === normalizedArticleId)
        .slice(0, 6);

      const payload = {
        contractVersion: PRODUCT_DOSSIER_SCHEMA_VERSION,
        productId: product.product_id,
        articleId: product.article_id,
        articleName: article.name,
        buildTs: safeIso(product.build_ts),
        orderId: normalizeNullableText(product.order_id),
        sourceCounts: {
          defects: defects.length,
          claims: claims.length,
          badTests: tests.filter((item) => item.overallResult === "FAIL").length,
          marginalTests: tests.filter((item) => item.overallResult === "MARGINAL").length,
          rework: reworkResult.items.length,
          actions: actionResult.items.length,
          installedParts: installedResult.items.length,
        },
        signals: signalTimeline,
        defects,
        claims,
        tests,
        rework: reworkResult.items,
        actions: actionResult.items,
        installedParts: installedResult.items,
        weeklyQualitySnippets: relevantWeeklySummaries,
        evidenceFrames,
        traceabilitySnapshot,
        summaryFeatures,
        existingSurfaceContext: {
          dossierSnapshot: {
            defectCount: defects.length,
            claimCount: claims.length,
            installedPartCount: traceabilitySnapshot.installedPartCount,
            uniqueBatchCount: traceabilitySnapshot.uniqueBatchCount,
            uniqueSupplierCount: traceabilitySnapshot.uniqueSupplierCount,
            openActionCount: actionResult.items.filter((item) => item.status !== "done")
              .length,
          },
          traceviewSnapshot: traceabilitySnapshot,
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
        summaryFeatures,
        payload,
      });

      return payload;
    }),
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

function buildPassASystemPrompt() {
  return [
    "You are a manufacturing quality clustering engine.",
    "You are not identifying exact root cause.",
    "Your job is to propose case clusters: groups of product threads that may share a common underlying issue and should be investigated together.",
    "Use all provided information: article summary, product timelines, free text, defect codes, test results, installed parts, BOM positions, supplier batches, sections, rework, actions, images, and raw evidence appendix.",
    "Prefer grouping by likely common mechanism, not just identical labels.",
    "Keep separate service or documentation complaints, cosmetic-only issues, likely functional failures, process drift, supplier-linked issues, and false positives.",
    "A product may remain unassigned if evidence is weak.",
    "Return only structured JSON.",
  ].join("\n");
}

function buildPassAUserPrompt(payload: unknown) {
  return [
    "Build proposed case clusters for this article dossier.",
    "Use product threads as the main unit of reasoning.",
    "Use the raw appendix only to confirm or sharpen the clusters.",
    "If a cluster is weak or noisy, leave products unassigned instead of forcing a grouping.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

function buildPassBSystemPrompt() {
  return [
    "You are the second-pass reviewer for manufacturing quality case clustering.",
    "Refine, merge, split, or reject draft case clusters.",
    "Keep only clusters that are investigation-worthy and supported by shared evidence.",
    "Remove products that do not belong, merge duplicate cases, and keep cosmetic, service, or false-positive groups separate from likely functional or manufacturing cases.",
    "Return the same structured JSON contract, now representing the final reviewed proposal set.",
  ].join("\n");
}

function buildPassBUserPrompt(payload: unknown) {
  return [
    "Review and refine these draft case proposals using the same article dossier context.",
    "The final output should be tighter than the draft: fewer duplicates, cleaner case boundaries, clearer evidence, and clearer unassigned products where confidence is weak.",
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

async function generateProposalObject(input: {
  system: string;
  prompt: string;
}) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for case clustering.");
  }

  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

  const result = await generateObject({
    model: openai.responses(env.OPENAI_MODEL),
    schema: clusteringProposalSchema,
    schemaName: "manex_case_proposal_set",
    schemaDescription:
      "Reviewed case cluster proposals for one article dossier in the Manex hackathon dataset.",
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

  return result.object;
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
): Promise<{ draft: ProposalOutput; review: ProposalOutput; strategy: "single" | "chunked" }> {
  const strategy = chooseRunStrategy(dossier);

  if (strategy === "single") {
    const draft = await generateProposalObject({
      system: buildPassASystemPrompt(),
      prompt: buildPassAUserPrompt(toPromptArticlePayload(dossier)),
    });
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
  const chunkDrafts = await Promise.all(
    chunks.map(async (chunk, index) => {
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
    }),
  );

  const draft: ProposalOutput = {
    contractVersion: CASE_PROPOSAL_SCHEMA_VERSION,
    reviewSummary: "Chunked draft proposals generated before final review.",
    cases: chunkDrafts.flatMap((item) => item.cases),
    unassignedProducts: chunkDrafts.flatMap((item) => item.unassignedProducts),
    ambiguousLinks: chunkDrafts.flatMap((item) => item.ambiguousLinks),
    globalObservations: uniqueValues(
      chunkDrafts.flatMap((item) => item.globalObservations),
    ).slice(0, 12),
  };

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

export async function runArticleCaseClustering(articleId: string) {
  if (!capabilities.hasPostgres) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Case clustering requires OPENAI_API_KEY.");
  }

  const dossier = await buildArticleDossier(articleId);
  const runId = createId("TCRUN");

  await createTeamCaseRun({
    id: runId,
    articleId: dossier.article.articleId,
    articleName: dossier.article.articleName,
    model: env.OPENAI_MODEL,
    strategy: chooseRunStrategy(dossier),
    schemaVersion: CASE_PROPOSAL_SCHEMA_VERSION,
    promptVersion: CASE_PROMPT_VERSION,
    productCount: dossier.article.productCount,
    signalCount: dossier.article.totalSignals,
    builderPayload: {
      articleDossierSchemaVersion: ARTICLE_DOSSIER_SCHEMA_VERSION,
      productDossierSchemaVersion: PRODUCT_DOSSIER_SCHEMA_VERSION,
    },
    requestPayload: {
      articleId: dossier.article.articleId,
      productCount: dossier.article.productCount,
      totalSignals: dossier.article.totalSignals,
    },
  });

  try {
    const proposalPass = await runProposalPass(dossier);
    const candidates = materializeCaseCandidates({
      articleId: dossier.article.articleId,
      runId,
      proposal: proposalPass.review,
      dossier,
    });

    await replaceTeamCaseCandidatesForRun({
      runId,
      articleId: dossier.article.articleId,
      candidates,
    });

    await completeTeamCaseRun({
      id: runId,
      candidateCount: candidates.length,
      proposalPayload: proposalPass.draft,
      reviewPayload: proposalPass.review,
    });

    const [latestRun, proposedCases] = await Promise.all([
      getLatestTeamCaseRun(dossier.article.articleId),
      listTeamCaseCandidatesForRun(runId),
    ]);

    return {
      articleId: dossier.article.articleId,
      dossier,
      latestRun,
      proposedCases,
    };
  } catch (error) {
    await failTeamCaseRun({
      id: runId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
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
    const proposedCases =
      latestRun?.status === "completed"
        ? await listTeamCaseCandidatesForRun(latestRun.id)
        : [];

    if (!dashboardCard && !dossierRecord && !latestRun) {
      return null;
    }

    return {
      articleId: normalizedArticleId,
      articleName: dossierRecord?.articleName ?? dashboardCard?.articleName ?? null,
      dashboardCard,
      dossier: dossierRecord?.payload ?? null,
      latestRun,
      proposedCases,
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
