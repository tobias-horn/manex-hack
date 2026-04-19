import { subDays } from "date-fns";

import { createManexDataAccess } from "@/lib/manex-data-access";
import { stringifyUnicodeSafe } from "@/lib/json-unicode";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export type QualitySignalType =
  | "field_claim"
  | "defect"
  | "bad_test"
  | "marginal_test";

export type QualityInboxWindow = "7d" | "30d" | "90d" | "all";

export type QualityInboxFilterState = {
  timeWindow: QualityInboxWindow;
  articleId: string | null;
  defectCode: string | null;
  signalType: QualitySignalType | "all";
};

export type QualitySignal = {
  id: string;
  sourceId: string;
  type: QualitySignalType;
  sourceLabel: string;
  occurredAt: string;
  productId: string;
  articleId: string | null;
  articleName: string | null;
  severity: string | null;
  defectCode: string | null;
  imageUrl: string | null;
  preview: string;
  context: string;
  caseHints: {
    articleId: string | null;
    productId: string;
    defectCode: string | null;
    testKey: string | null;
  };
};

export type QualityInboxFacetOption = {
  id: string;
  label: string;
};

export type QualityInboxReadModel = {
  filters: QualityInboxFilterState;
  items: QualitySignal[];
  totalSignals: number;
  counts: Record<QualitySignalType, number>;
  articleOptions: QualityInboxFacetOption[];
  defectCodeOptions: string[];
};

const QUALITY_SIGNAL_LIMIT = 180;

const trimText = (value: string | null | undefined, max = 160) => {
  const text = value?.replace(/\s+/g, " ").trim();

  if (!text) {
    return "";
  }

  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const normalizeWindow = (value: string | string[] | undefined): QualityInboxWindow => {
  const input = Array.isArray(value) ? value[0] : value;

  if (input === "7d" || input === "30d" || input === "90d" || input === "all") {
    return input;
  }

  return "30d";
};

const normalizeSignalType = (
  value: string | string[] | undefined,
): QualityInboxFilterState["signalType"] => {
  const input = Array.isArray(value) ? value[0] : value;

  if (
    input === "field_claim" ||
    input === "defect" ||
    input === "bad_test" ||
    input === "marginal_test"
  ) {
    return input;
  }

  return "all";
};

const normalizeScalarFilter = (value: string | string[] | undefined) => {
  const input = Array.isArray(value) ? value[0] : value;
  return normalizeUiIdentifier(input);
};

const getWindowStart = (window: QualityInboxWindow) => {
  if (window === "all") {
    return null;
  }

  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  return subDays(new Date(), days).toISOString();
};

const countsTemplate = (): Record<QualitySignalType, number> => ({
  field_claim: 0,
  defect: 0,
  bad_test: 0,
  marginal_test: 0,
});

const buildDefectPreview = (defectCode: string, notes: string, partTitle: string | null) => {
  const focus = partTitle ? `${defectCode} on ${partTitle}` : defectCode;
  const details = trimText(notes, 140);
  return details ? `${focus}. ${details}` : focus;
};

const buildClaimPreview = (complaintText: string, mappedDefectCode: string | null) => {
  const signal = mappedDefectCode
    ? `Claim aligned to ${mappedDefectCode}`
    : "Field claim without mapped factory defect";
  const details = trimText(complaintText, 150);
  return details ? `${signal}. ${details}` : signal;
};

const buildTestPreview = (
  testKey: string,
  overallResult: string,
  testValue: string | null,
  unit: string | null,
  sectionName: string | null,
) => {
  const valueText =
    testValue && unit ? `${testValue} ${unit}` : testValue ? testValue : null;
  const pieces = [
    `${testKey} returned ${overallResult.toLowerCase()}`,
    valueText ? `at ${valueText}` : null,
    sectionName ? `in ${sectionName}` : null,
  ].filter(Boolean);

  return pieces.join(" ");
};

export function parseQualityInboxFilters(
  params: Record<string, string | string[] | undefined>,
): QualityInboxFilterState {
  return {
    timeWindow: normalizeWindow(params.window),
    articleId: normalizeScalarFilter(params.article),
    defectCode: normalizeScalarFilter(params.defectCode),
    signalType: normalizeSignalType(params.signalType),
  };
}

const loadQualityInbox = memoizeWithTtl(
  "quality-inbox",
  12_000,
  (filters: QualityInboxFilterState) => stringifyUnicodeSafe(filters),
  async (filters: QualityInboxFilterState): Promise<QualityInboxReadModel> => {
  const data = createManexDataAccess();
  const observedAfter = getWindowStart(filters.timeWindow);

  const includeDefects = filters.signalType === "all" || filters.signalType === "defect";
  const includeClaims =
    filters.signalType === "all" || filters.signalType === "field_claim";
  const includeTests =
    filters.signalType === "all" ||
    filters.signalType === "bad_test" ||
    filters.signalType === "marginal_test";

  const defectCodeFilter = filters.defectCode ? [filters.defectCode] : undefined;
  const testOutcomes =
    filters.signalType === "bad_test"
      ? ["FAIL"]
      : filters.signalType === "marginal_test"
        ? ["MARGINAL"]
        : ["FAIL", "MARGINAL"];

  const [
    defectsResult,
    claimsResult,
    testsResult,
    summaryFacet,
    defectFacet,
    claimFacet,
  ] = await Promise.all([
    includeDefects
      ? data.investigation.findDefects({
          articleId: filters.articleId ?? undefined,
          defectCodes: defectCodeFilter,
          detectedAfter: observedAfter ?? undefined,
          sort: "newest",
          limit: QUALITY_SIGNAL_LIMIT,
        })
      : Promise.resolve({ items: [], total: 0, transport: "rest" as const }),
    includeClaims
      ? data.investigation.findClaims({
          articleId: filters.articleId ?? undefined,
          mappedDefectCodes: defectCodeFilter,
          claimedAfter: observedAfter ?? undefined,
          sort: "newest",
          limit: QUALITY_SIGNAL_LIMIT,
        })
      : Promise.resolve({ items: [], total: 0, transport: "rest" as const }),
    includeTests
      ? data.investigation.findTestSignals({
          articleId: filters.articleId ?? undefined,
          outcomes: testOutcomes,
          observedAfter: observedAfter ?? undefined,
          sort: "newest",
          limit: QUALITY_SIGNAL_LIMIT,
        })
      : Promise.resolve({ items: [], total: 0, transport: "rest" as const }),
    data.quality.findWeeklySummaries({
      limit: 120,
      sort: "newest",
    }),
    data.investigation.findDefects({
      limit: 240,
      sort: "newest",
    }),
    data.investigation.findClaims({
      limit: 120,
      sort: "newest",
    }),
  ]);

  const items: QualitySignal[] = [
    ...defectsResult.items.map((defect) => ({
      id: `defect:${defect.id}`,
      sourceId: defect.id,
      type: "defect" as const,
      sourceLabel: "Factory defect",
      occurredAt: defect.occurredAt,
      productId: defect.productId,
      articleId: defect.articleId,
      articleName: defect.articleName,
      severity: defect.severity,
      defectCode: defect.code,
      imageUrl: defect.imageUrl,
      preview: buildDefectPreview(
        defect.code,
        defect.notes,
        defect.reportedPartTitle,
      ),
      context: [
        defect.articleName ?? defect.articleId ?? "Unknown article",
        defect.productId,
        defect.detectedSectionName ?? defect.occurrenceSectionName ?? "Factory signal",
      ].join(" · "),
      caseHints: {
        articleId: defect.articleId,
        productId: defect.productId,
        defectCode: defect.code,
        testKey: defect.detectedTestName,
      },
    })),
    ...claimsResult.items.map((claim) => ({
      id: `claim:${claim.id}`,
      sourceId: claim.id,
      type: "field_claim" as const,
      sourceLabel: "Field claim",
      occurredAt: claim.claimedAt,
      productId: claim.productId,
      articleId: claim.articleId,
      articleName: claim.articleName,
      severity: claim.mappedDefectSeverity,
      defectCode: claim.mappedDefectCode,
      imageUrl: claim.imageUrl,
      preview: buildClaimPreview(claim.complaintText, claim.mappedDefectCode),
      context: [
        claim.articleName ?? claim.articleId ?? "Unknown article",
        claim.productId,
        claim.market ?? "Market not tagged",
      ].join(" · "),
      caseHints: {
        articleId: claim.articleId,
        productId: claim.productId,
        defectCode: claim.mappedDefectCode,
        testKey: null,
      },
    })),
    ...testsResult.items.map((test) => ({
      id: `test:${test.id}`,
      sourceId: test.id,
      type: test.overallResult === "FAIL" ? ("bad_test" as const) : ("marginal_test" as const),
      sourceLabel: test.overallResult === "FAIL" ? "Bad test" : "Marginal test",
      occurredAt: test.occurredAt,
      productId: test.productId,
      articleId: test.articleId,
      articleName: test.articleName,
      severity: test.severity,
      defectCode: null,
      imageUrl: null,
      preview: buildTestPreview(
        test.testKey,
        test.overallResult,
        test.testValue,
        test.unit,
        test.sectionName,
      ),
      context: [
        test.articleName ?? test.articleId ?? "Unknown article",
        test.productId,
        test.sectionName ?? "Test signal",
      ].join(" · "),
      caseHints: {
        articleId: test.articleId,
        productId: test.productId,
        defectCode: null,
        testKey: test.testKey,
      },
    })),
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, QUALITY_SIGNAL_LIMIT);

  const counts = items.reduce((accumulator, item) => {
    accumulator[item.type] += 1;
    return accumulator;
  }, countsTemplate());

  const articleOptions = Array.from(
    new Map(
      [
        ...summaryFacet.items.map((summary) => [
          summary.articleId,
          summary.articleName ?? summary.articleId,
        ]),
        ...items
          .filter((item) => item.articleId)
          .map((item) => [item.articleId!, item.articleName ?? item.articleId!]),
      ].filter((entry): entry is [string, string] => Boolean(entry[0])),
    ),
  )
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const defectCodeOptions = Array.from(
    new Set(
      [
        ...defectFacet.items.map((item) => item.code),
        ...claimFacet.items
          .map((item) => item.mappedDefectCode)
          .filter((value): value is string => Boolean(value)),
      ].filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    filters,
    items,
    totalSignals: items.length,
    counts,
    articleOptions,
    defectCodeOptions,
  };
  },
);

export async function getQualityInbox(
  filters: QualityInboxFilterState,
): Promise<QualityInboxReadModel> {
  return loadQualityInbox(filters);
}
