import {
  createManexDataAccess,
  type ManexInstalledPart,
  type ManexSearchResult,
} from "@/lib/manex-data-access";
import {
  buildBlastRadiusGraph,
  buildProductTraceabilityGraph,
  buildTraceabilityAssemblies,
  buildTraceabilityRelatedProducts,
  countUniqueTraceabilityValues,
  pickDominantTraceabilityBatch,
  sortTraceabilityPartsForDisplay,
  uniqueTraceabilityValues,
  type TraceabilityBlastRadiusSuspect,
  type TraceabilityGraphEdge,
  type TraceabilityGraphNode,
  type TraceabilityRelatedProductSummary,
} from "@/lib/manex-traceability-evidence";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

type TraceabilityTransport = ManexSearchResult<ManexInstalledPart>["transport"];

export type TraceabilityFilterState = {
  productId: string | null;
  batchRef: string | null;
  partNumber: string | null;
};

export type { TraceabilityGraphEdge, TraceabilityGraphNode };

export type ProductTraceability = {
  product: {
    productId: string;
    articleId: string | null;
    articleName: string | null;
    orderId: string | null;
    buildTs: string | null;
    installedPartCount: number;
    uniqueBatchCount: number;
    uniqueSupplierCount: number;
    uniquePartCount: number;
  } | null;
  assemblies: Array<{
    assemblyLabel: string;
    partCount: number;
    items: ManexInstalledPart[];
  }>;
  installedParts: ManexInstalledPart[];
  graph: {
    nodes: TraceabilityGraphNode[];
    edges: TraceabilityGraphEdge[];
  };
  transport: TraceabilityTransport;
};

export type TraceabilityRelatedProduct = TraceabilityRelatedProductSummary;

export type TraceabilityBlastRadius = {
  suspect: {
    batchId: string | null;
    batchNumber: string | null;
    partNumber: string | null;
    supplierNames: string[];
    affectedProductCount: number;
    matchedInstallCount: number;
  };
  relatedProducts: TraceabilityRelatedProduct[];
  articleTracks: Array<{
    articleId: string | null;
    articleName: string;
    productCount: number;
    productIds: string[];
  }>;
  graph: {
    nodes: TraceabilityGraphNode[];
    edges: TraceabilityGraphEdge[];
  };
  transport: TraceabilityTransport;
};

export type TraceabilityWorkbenchReadModel = {
  filters: TraceabilityFilterState;
  defaults: {
    productId: string | null;
    batchRef: string | null;
    partNumber: string | null;
  };
  productTrace: ProductTraceability | null;
  blastRadius: TraceabilityBlastRadius | null;
};

type BatchSelector = {
  batchId?: string;
  batchNumber?: string;
};

const DEFAULT_PART_NUMBER = "PM-00008";
const TRACEABILITY_LIMIT = 280;

const normalizeText = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

const normalizeCode = (value: string | string[] | undefined) => {
  const input = Array.isArray(value) ? value[0] : value;
  return normalizeUiIdentifier(input);
};

const parseBatchReference = (value: string | null): BatchSelector => {
  const normalized = normalizeText(value)?.toUpperCase();

  if (!normalized) {
    return {};
  }

  if (normalized.startsWith("SB-")) {
    return { batchId: normalized };
  }

  return { batchNumber: normalized };
};

const formatBatchReference = (selection: {
  batchId: string | null;
  batchNumber: string | null;
}) => selection.batchId ?? selection.batchNumber ?? null;

export function parseTraceabilityFilters(
  params: Record<string, string | string[] | undefined>,
): TraceabilityFilterState {
  return {
    productId: normalizeCode(params.product),
    batchRef: normalizeCode(params.batch),
    partNumber: normalizeCode(params.part),
  };
}

const loadProductTraceability = memoizeWithTtl(
  "traceability-product",
  15_000,
  (productId: string) => productId,
  async (productId: string): Promise<ProductTraceability | null> => {
  const data = createManexDataAccess();
  const result = await data.traceability.findInstalledPartsForProduct(productId, {
    limit: TRACEABILITY_LIMIT,
  });

  if (!result.items.length) {
    return null;
  }

  const installedParts = sortTraceabilityPartsForDisplay(result.items);
  const head = installedParts[0];

  return {
    product: {
      productId: head.productId,
      articleId: head.articleId,
      articleName: head.articleName,
      orderId: head.orderId,
      buildTs: head.productBuiltAt,
      installedPartCount: installedParts.length,
      uniqueBatchCount: countUniqueTraceabilityValues(
        installedParts.map((item) => item.batchId ?? item.batchNumber),
      ),
      uniqueSupplierCount: countUniqueTraceabilityValues(
        installedParts.map((item) => item.supplierName),
      ),
      uniquePartCount: countUniqueTraceabilityValues(
        installedParts.map((item) => item.partNumber),
      ),
    },
    assemblies: buildTraceabilityAssemblies(installedParts),
    installedParts,
    graph: buildProductTraceabilityGraph(installedParts),
    transport: result.transport,
  };
  },
);

export async function getProductTraceability(
  productId: string,
): Promise<ProductTraceability | null> {
  const normalized = normalizeUiIdentifier(productId);

  if (!normalized) {
    return null;
  }

  return loadProductTraceability(normalized);
}

const loadTraceabilityBlastRadius = memoizeWithTtl(
  "traceability-blast-radius",
  15_000,
  (query: { batchId?: string; batchNumber?: string; partNumber?: string }) =>
    JSON.stringify(query),
  async (query: {
    batchId?: string;
    batchNumber?: string;
    partNumber?: string;
  }): Promise<TraceabilityBlastRadius | null> => {
    if (!query.batchId && !query.batchNumber && !query.partNumber) {
      return null;
    }

    const data = createManexDataAccess();
    const result = await data.traceability.findInstalledParts({
      ...query,
      limit: TRACEABILITY_LIMIT,
    });

    const groupedProducts = buildTraceabilityRelatedProducts(result.items);

    const suspect: TraceabilityBlastRadiusSuspect = {
      batchId:
        query.batchId ??
        groupedProducts[0]?.sharedBatchIds[0] ??
        result.items[0]?.batchId ??
        null,
      batchNumber:
        query.batchNumber ??
        groupedProducts[0]?.sharedBatchNumbers[0] ??
        result.items[0]?.batchNumber ??
        null,
      partNumber:
        query.partNumber ??
        groupedProducts[0]?.sharedPartNumbers[0] ??
        result.items[0]?.partNumber ??
        null,
      supplierNames: uniqueTraceabilityValues(
        result.items.map((item) => item.supplierName),
      ),
      affectedProductCount: groupedProducts.length,
      matchedInstallCount: result.items.length,
    };

    const articleTracks = Array.from(
      groupedProducts.reduce((groups, item) => {
        const key = item.articleId ?? "unassigned";
        const current = groups.get(key) ?? {
          articleId: item.articleId,
          articleName: item.articleName ?? item.articleId ?? "Unknown article",
          productIds: [] as string[],
        };

        current.productIds.push(item.productId);
        groups.set(key, current);
        return groups;
      }, new Map<string, { articleId: string | null; articleName: string; productIds: string[] }>()),
    )
      .map(([, value]) => ({
        articleId: value.articleId,
        articleName: value.articleName,
        productCount: value.productIds.length,
        productIds: value.productIds.sort((left, right) => left.localeCompare(right)),
      }))
      .sort(
        (left, right) =>
          right.productCount - left.productCount ||
          left.articleName.localeCompare(right.articleName),
      );

    return {
      suspect,
      relatedProducts: groupedProducts,
      articleTracks,
      graph: buildBlastRadiusGraph(groupedProducts, suspect),
      transport: result.transport,
    };
  },
);

export async function getTraceabilityBlastRadius(query: {
  batchId?: string;
  batchNumber?: string;
  partNumber?: string;
}): Promise<TraceabilityBlastRadius | null> {
  return loadTraceabilityBlastRadius({
    batchId: normalizeUiIdentifier(query.batchId) ?? undefined,
    batchNumber: normalizeUiIdentifier(query.batchNumber) ?? undefined,
    partNumber: normalizeUiIdentifier(query.partNumber) ?? undefined,
  });
}

export async function getTraceabilityWorkbench(
  filters: TraceabilityFilterState,
): Promise<TraceabilityWorkbenchReadModel> {
  const hasExplicitFilters = Boolean(
    filters.productId || filters.batchRef || filters.partNumber,
  );
  const batchSelection = parseBatchReference(filters.batchRef);
  let effectivePartNumber = filters.partNumber;
  let effectiveBatchId: string | null = batchSelection.batchId ?? null;
  let effectiveBatchNumber: string | null = batchSelection.batchNumber ?? null;

  if (!hasExplicitFilters) {
    effectivePartNumber = DEFAULT_PART_NUMBER;
  }

  let blastRadius = await getTraceabilityBlastRadius({
    batchId: effectiveBatchId ?? undefined,
    batchNumber: effectiveBatchNumber ?? undefined,
    partNumber: effectivePartNumber ?? undefined,
  });

  if (!hasExplicitFilters && blastRadius) {
    const dominantBatch = pickDominantTraceabilityBatch(
      blastRadius.relatedProducts.flatMap((product) => product.matchedParts),
    );

    if (
      dominantBatch &&
      (dominantBatch.batchId !== effectiveBatchId ||
        dominantBatch.batchNumber !== effectiveBatchNumber)
    ) {
      effectiveBatchId = dominantBatch.batchId;
      effectiveBatchNumber = dominantBatch.batchNumber;
      blastRadius = await getTraceabilityBlastRadius({
        batchId: effectiveBatchId ?? undefined,
        batchNumber: effectiveBatchNumber ?? undefined,
        partNumber: effectivePartNumber ?? undefined,
      });
    }
  }

  const effectiveProductId =
    filters.productId ?? blastRadius?.relatedProducts[0]?.productId ?? null;
  const productTrace = effectiveProductId
    ? await getProductTraceability(effectiveProductId)
    : null;

  return {
    filters,
    defaults: {
      productId: effectiveProductId,
      batchRef: formatBatchReference({
        batchId: effectiveBatchId ?? null,
        batchNumber: effectiveBatchNumber ?? null,
      }),
      partNumber: effectivePartNumber ?? null,
    },
    productTrace,
    blastRadius,
  };
}
