import {
  createManexDataAccess,
  type ManexDefect,
  type ManexFieldClaim,
  type ManexTestSignal,
  type ManexWeeklyQualitySummary,
  type ManexWorkflowAction,
} from "@/lib/manex-data-access";
import {
  getProductTraceability,
  type ProductTraceability,
} from "@/lib/manex-traceability";
import type { Initiative } from "@/lib/quality-workspace";
import { formatUiDateTime, normalizeUiIdentifier } from "@/lib/ui-format";

export const DEFAULT_PRODUCT_DOSSIER_ID = "PRD-00023";

export type ProductDossierEvidenceFrame = {
  id: string;
  sourceType: "defect" | "field_claim";
  sourceId: string;
  imageUrl: string;
  title: string;
  caption: string;
};

export type ProductDossierReadModel = {
  requestedProductId: string;
  product: {
    productId: string;
    articleId: string | null;
    articleName: string | null;
    orderId: string | null;
    buildTs: string | null;
  } | null;
  defects: ManexDefect[];
  claims: ManexFieldClaim[];
  testSignals: ManexTestSignal[];
  traceability: ProductTraceability | null;
  weeklySummaries: ManexWeeklyQualitySummary[];
  actions: ManexWorkflowAction[];
  actionFeed: Initiative[];
  evidenceFrames: ProductDossierEvidenceFrame[];
  metrics: {
    defectCount: number;
    claimCount: number;
    installedPartCount: number;
    uniqueBatchCount: number;
    uniqueSupplierCount: number;
    openActionCount: number;
  };
  transports: {
    defects: string | null;
    claims: string | null;
    tests: string | null;
    traceability: string | null;
    summaries: string | null;
    actions: string | null;
  };
  actionSeed: {
    productId: string;
    defectId: string;
  };
};

const normalizeProductId = (value: string) =>
  normalizeUiIdentifier(value) ?? value.replace(/\s+/g, "").trim().toUpperCase();

const uniqueBy = <T,>(items: T[], keyFn: (item: T) => string | null | undefined) => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = keyFn(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const buildEvidenceFrames = (
  defects: ManexDefect[],
  claims: ManexFieldClaim[],
): ProductDossierEvidenceFrame[] =>
  uniqueBy(
    [
      ...defects
        .filter((item) => item.imageUrl)
        .map((item) => ({
          id: `defect:${item.id}`,
          sourceType: "defect" as const,
          sourceId: item.id,
          imageUrl: item.imageUrl!,
          title: item.code,
          caption: [
            item.reportedPartTitle ?? item.reportedPartNumber ?? "Factory defect",
            item.severity,
          ].join(" · "),
        })),
      ...claims
        .filter((item) => item.imageUrl)
        .map((item) => ({
          id: `claim:${item.id}`,
          sourceType: "field_claim" as const,
          sourceId: item.id,
          imageUrl: item.imageUrl!,
          title: item.mappedDefectCode ?? "Field claim",
          caption: [
            item.reportedPartTitle ?? item.reportedPartNumber ?? "Claim evidence",
            item.market ?? "Market unknown",
          ].join(" · "),
        })),
    ],
    (item) => item.imageUrl,
  ).slice(0, 6);

const mapActionFeed = (actions: ManexWorkflowAction[]): Initiative[] =>
  actions.map((action) => ({
    id: action.id,
    productId: action.productId,
    defectId: action.defectId,
    actionType: action.actionType,
    status: action.status,
    comments: action.comments || "No notes attached.",
    timestamp: formatUiDateTime(action.recordedAt),
  }));

export async function getProductDossier(
  rawProductId: string,
): Promise<ProductDossierReadModel | null> {
  const productId = normalizeProductId(rawProductId);
  const data = createManexDataAccess();

  const [traceability, defectsResult, claimsResult, testResult, actionsResult] =
    await Promise.all([
      getProductTraceability(productId),
      data.investigation.findDefectsForProduct(productId, {
        limit: 12,
        sort: "newest",
      }),
      data.investigation.findClaims({
        productId,
        limit: 8,
        sort: "newest",
      }),
      data.investigation.findTestSignalsForProduct(productId, {
        outcomes: ["FAIL", "MARGINAL"],
        limit: 6,
        sort: "newest",
      }),
      data.workflow.findActionsForProduct(productId, {
        limit: 8,
      }),
    ]);

  if (
    !traceability &&
    !defectsResult.items.length &&
    !claimsResult.items.length &&
    !testResult.items.length &&
    !actionsResult.items.length
  ) {
    return null;
  }

  const product =
    traceability?.product ??
    (defectsResult.items[0]
      ? {
          productId,
          articleId: defectsResult.items[0].articleId,
          articleName: defectsResult.items[0].articleName,
          orderId: defectsResult.items[0].orderId,
          buildTs: defectsResult.items[0].productBuiltAt,
        }
      : claimsResult.items[0]
        ? {
            productId,
            articleId: claimsResult.items[0].articleId,
            articleName: claimsResult.items[0].articleName,
            orderId: null,
            buildTs: claimsResult.items[0].productBuiltAt,
          }
        : testResult.items[0]
          ? {
              productId,
              articleId: testResult.items[0].articleId,
              articleName: testResult.items[0].articleName,
              orderId: testResult.items[0].orderId,
              buildTs: testResult.items[0].buildTs,
            }
          : {
              productId,
              articleId: null,
              articleName: null,
              orderId: null,
              buildTs: null,
            });

  const articleId = product.articleId;
  const weeklySummaries = articleId
    ? (
        await data.quality.findWeeklySummariesForArticle(articleId, {
          limit: 6,
          sort: "newest",
        })
      ).items
    : [];

  const evidenceFrames = buildEvidenceFrames(
    defectsResult.items,
    claimsResult.items,
  );

  return {
    requestedProductId: productId,
    product,
    defects: defectsResult.items,
    claims: claimsResult.items,
    testSignals: testResult.items,
    traceability,
    weeklySummaries,
    actions: actionsResult.items,
    actionFeed: mapActionFeed(actionsResult.items),
    evidenceFrames,
    metrics: {
      defectCount: defectsResult.total ?? defectsResult.items.length,
      claimCount: claimsResult.total ?? claimsResult.items.length,
      installedPartCount: traceability?.product?.installedPartCount ?? 0,
      uniqueBatchCount: traceability?.product?.uniqueBatchCount ?? 0,
      uniqueSupplierCount: traceability?.product?.uniqueSupplierCount ?? 0,
      openActionCount: actionsResult.items.filter((item) => item.status !== "done")
        .length,
    },
    transports: {
      defects: defectsResult.transport,
      claims: claimsResult.transport,
      tests: testResult.transport,
      traceability: traceability?.transport ?? null,
      summaries: articleId ? "derived" : null,
      actions: actionsResult.transport,
    },
    actionSeed: {
      productId,
      defectId: defectsResult.items[0]?.id ?? "",
    },
  };
}
