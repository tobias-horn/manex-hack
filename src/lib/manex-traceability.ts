import {
  createManexDataAccess,
  type ManexInstalledPart,
  type ManexSearchResult,
} from "@/lib/manex-data-access";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

type TraceabilityTransport = ManexSearchResult<ManexInstalledPart>["transport"];

export type TraceabilityFilterState = {
  productId: string | null;
  batchRef: string | null;
  partNumber: string | null;
};

export type TraceabilityGraphNode = {
  id: string;
  kind: "article" | "product" | "position" | "part" | "batch" | "supplier";
  label: string;
  caption: string | null;
};

export type TraceabilityGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind:
    | "built_as"
    | "contains_position"
    | "uses_part"
    | "comes_from_batch"
    | "supplied_by"
    | "blast_radius";
  label: string | null;
};

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

export type TraceabilityRelatedProduct = {
  productId: string;
  articleId: string | null;
  articleName: string | null;
  orderId: string | null;
  buildTs: string | null;
  sharedBatchIds: string[];
  sharedBatchNumbers: string[];
  sharedPartNumbers: string[];
  sharedPositions: string[];
  sharedFindNumbers: string[];
  sharedSuppliers: string[];
  matchedParts: ManexInstalledPart[];
};

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

const sortPartsForDisplay = (items: ManexInstalledPart[]) =>
  [...items].sort((left, right) => {
    const leftAssembly = left.parentFindNumber ?? "ZZZ";
    const rightAssembly = right.parentFindNumber ?? "ZZZ";

    return (
      leftAssembly.localeCompare(rightAssembly) ||
      (left.positionCode ?? left.findNumber ?? left.partNumber).localeCompare(
        right.positionCode ?? right.findNumber ?? right.partNumber,
      ) ||
      left.partNumber.localeCompare(right.partNumber)
    );
  });

const uniqueValues = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));

const uniqueCount = (values: Array<string | null | undefined>) =>
  uniqueValues(values).length;

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

const pickDominantBatch = (
  items: ManexInstalledPart[],
): { batchId: string | null; batchNumber: string | null } | null => {
  const buckets = new Map<
    string,
    {
      batchId: string | null;
      batchNumber: string | null;
      count: number;
    }
  >();

  for (const item of items) {
    const key = item.batchId ?? item.batchNumber;

    if (!key) {
      continue;
    }

    const current = buckets.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    buckets.set(key, {
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      count: 1,
    });
  }

  const winner = [...buckets.values()].sort(
    (left, right) =>
      right.count - left.count ||
      (left.batchId ?? left.batchNumber ?? "").localeCompare(
        right.batchId ?? right.batchNumber ?? "",
      ),
  )[0];

  return winner
    ? {
        batchId: winner.batchId,
        batchNumber: winner.batchNumber,
      }
    : null;
};

const buildProductTraceGraph = (items: ManexInstalledPart[]) => {
  const nodes = new Map<string, TraceabilityGraphNode>();
  const edges = new Map<string, TraceabilityGraphEdge>();

  const addNode = (node: TraceabilityGraphNode) => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  };

  const addEdge = (edge: TraceabilityGraphEdge) => {
    if (!edges.has(edge.id)) {
      edges.set(edge.id, edge);
    }
  };

  const head = items[0];

  if (head?.articleId) {
    addNode({
      id: `article:${head.articleId}`,
      kind: "article",
      label: head.articleName ?? head.articleId,
      caption: head.articleId,
    });
  }

  if (head) {
    addNode({
      id: `product:${head.productId}`,
      kind: "product",
      label: head.productId,
      caption: head.orderId ?? head.articleName ?? null,
    });
  }

  if (head?.articleId) {
    addEdge({
      id: `edge:article:${head.articleId}:product:${head.productId}`,
      source: `article:${head.articleId}`,
      target: `product:${head.productId}`,
      kind: "built_as",
      label: "article build",
    });
  }

  for (const item of items) {
    const positionId = `position:${item.bomNodeId}`;
    const partId = `part:${item.partId}`;

    addNode({
      id: positionId,
      kind: "position",
      label: item.positionCode ?? item.findNumber ?? item.bomNodeId,
      caption: item.parentFindNumber ?? "Direct install",
    });
    addNode({
      id: partId,
      kind: "part",
      label: item.partNumber,
      caption: item.partTitle ?? item.serialNumber ?? null,
    });

    addEdge({
      id: `edge:product:${item.productId}:${positionId}`,
      source: `product:${item.productId}`,
      target: positionId,
      kind: "contains_position",
      label: item.parentFindNumber ?? "installed position",
    });
    addEdge({
      id: `edge:${positionId}:${partId}`,
      source: positionId,
      target: partId,
      kind: "uses_part",
      label: item.serialNumber ?? item.qualityStatus ?? null,
    });

    if (item.batchId ?? item.batchNumber) {
      const batchId = `batch:${item.batchId ?? item.batchNumber}`;

      addNode({
        id: batchId,
        kind: "batch",
        label: item.batchId ?? item.batchNumber ?? "Unknown batch",
        caption: item.batchNumber && item.batchId ? item.batchNumber : null,
      });
      addEdge({
        id: `edge:${partId}:${batchId}`,
        source: partId,
        target: batchId,
        kind: "comes_from_batch",
        label: item.batchReceivedDate ?? null,
      });

      if (item.supplierId ?? item.supplierName) {
        const supplierId = `supplier:${item.supplierId ?? item.supplierName}`;

        addNode({
          id: supplierId,
          kind: "supplier",
          label: item.supplierName ?? item.supplierId ?? "Unknown supplier",
          caption: item.manufacturerName ?? null,
        });
        addEdge({
          id: `edge:${batchId}:${supplierId}`,
          source: batchId,
          target: supplierId,
          kind: "supplied_by",
          label: "supplier batch",
        });
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
};

const buildBlastRadiusGraph = (
  relatedProducts: TraceabilityRelatedProduct[],
  suspect: TraceabilityBlastRadius["suspect"],
) => {
  const nodes = new Map<string, TraceabilityGraphNode>();
  const edges = new Map<string, TraceabilityGraphEdge>();

  const addNode = (node: TraceabilityGraphNode) => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  };

  const addEdge = (edge: TraceabilityGraphEdge) => {
    if (!edges.has(edge.id)) {
      edges.set(edge.id, edge);
    }
  };

  const suspectNodeIds: string[] = [];

  if (suspect.partNumber) {
    const partNodeId = `part:${suspect.partNumber}`;

    suspectNodeIds.push(partNodeId);
    addNode({
      id: partNodeId,
      kind: "part",
      label: suspect.partNumber,
      caption: "suspect part master",
    });
  }

  if (suspect.batchId ?? suspect.batchNumber) {
    const batchNodeId = `batch:${suspect.batchId ?? suspect.batchNumber}`;

    suspectNodeIds.push(batchNodeId);
    addNode({
      id: batchNodeId,
      kind: "batch",
      label: suspect.batchId ?? suspect.batchNumber ?? "Unknown batch",
      caption:
        suspect.batchId && suspect.batchNumber ? suspect.batchNumber : null,
    });

    for (const supplierName of suspect.supplierNames) {
      const supplierNodeId = `supplier:${supplierName}`;

      addNode({
        id: supplierNodeId,
        kind: "supplier",
        label: supplierName,
        caption: "shared supplier",
      });
      addEdge({
        id: `edge:${batchNodeId}:${supplierNodeId}`,
        source: batchNodeId,
        target: supplierNodeId,
        kind: "supplied_by",
        label: "supplier batch",
      });
    }
  }

  if (suspectNodeIds.length === 2) {
    addEdge({
      id: `edge:${suspectNodeIds[0]}:${suspectNodeIds[1]}`,
      source: suspectNodeIds[0],
      target: suspectNodeIds[1],
      kind: "comes_from_batch",
      label: "suspect chain",
    });
  }

  for (const product of relatedProducts) {
    const productNodeId = `product:${product.productId}`;

    addNode({
      id: productNodeId,
      kind: "product",
      label: product.productId,
      caption: product.orderId ?? product.articleName ?? null,
    });

    if (product.articleId) {
      const articleNodeId = `article:${product.articleId}`;

      addNode({
        id: articleNodeId,
        kind: "article",
        label: product.articleName ?? product.articleId,
        caption: product.articleId,
      });
      addEdge({
        id: `edge:${articleNodeId}:${productNodeId}`,
        source: articleNodeId,
        target: productNodeId,
        kind: "built_as",
        label: "article track",
      });
    }

    for (const suspectNodeId of suspectNodeIds) {
      addEdge({
        id: `edge:${suspectNodeId}:${productNodeId}`,
        source: suspectNodeId,
        target: productNodeId,
        kind: "blast_radius",
        label:
          product.sharedPositions[0] ??
          product.sharedFindNumbers[0] ??
          `${product.matchedParts.length} shared installs`,
      });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
};

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

  const installedParts = sortPartsForDisplay(result.items);
  const head = installedParts[0];

  return {
    product: {
      productId: head.productId,
      articleId: head.articleId,
      articleName: head.articleName,
      orderId: head.orderId,
      buildTs: head.productBuiltAt,
      installedPartCount: installedParts.length,
      uniqueBatchCount: uniqueCount(
        installedParts.map((item) => item.batchId ?? item.batchNumber),
      ),
      uniqueSupplierCount: uniqueCount(installedParts.map((item) => item.supplierName)),
      uniquePartCount: uniqueCount(installedParts.map((item) => item.partNumber)),
    },
    assemblies: Array.from(
      installedParts.reduce((groups, item) => {
        const key = item.parentFindNumber ?? "Direct install";
        const current = groups.get(key) ?? [];

        current.push(item);
        groups.set(key, current);
        return groups;
      }, new Map<string, ManexInstalledPart[]>()),
    ).map(([assemblyLabel, items]) => ({
      assemblyLabel,
      partCount: items.length,
      items,
    })),
    installedParts,
    graph: buildProductTraceGraph(installedParts),
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

    const groupedProducts = Array.from(
      result.items.reduce((groups, item) => {
        const current = groups.get(item.productId) ?? [];

        current.push(item);
        groups.set(item.productId, current);
        return groups;
      }, new Map<string, ManexInstalledPart[]>()),
    )
      .map(([productId, items]) => {
        const sortedItems = sortPartsForDisplay(items);
        const head = sortedItems[0];

        return {
          productId,
          articleId: head.articleId,
          articleName: head.articleName,
          orderId: head.orderId,
          buildTs: head.productBuiltAt,
          sharedBatchIds: uniqueValues(sortedItems.map((item) => item.batchId)),
          sharedBatchNumbers: uniqueValues(
            sortedItems.map((item) => item.batchNumber),
          ),
          sharedPartNumbers: uniqueValues(
            sortedItems.map((item) => item.partNumber),
          ),
          sharedPositions: uniqueValues(
            sortedItems.map((item) => item.positionCode),
          ),
          sharedFindNumbers: uniqueValues(
            sortedItems.map((item) => item.findNumber),
          ),
          sharedSuppliers: uniqueValues(
            sortedItems.map((item) => item.supplierName),
          ),
          matchedParts: sortedItems,
        } satisfies TraceabilityRelatedProduct;
      })
      .sort(
        (left, right) =>
          (right.buildTs ?? "").localeCompare(left.buildTs ?? "") ||
          left.productId.localeCompare(right.productId),
      );

    const suspect = {
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
      supplierNames: uniqueValues(result.items.map((item) => item.supplierName)),
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
    const dominantBatch = pickDominantBatch(
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
