import type { ManexInstalledPart } from "@/lib/manex-data-access";

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

export type TraceabilityAssemblyGroup = {
  assemblyLabel: string;
  partCount: number;
  uniqueBatchCount: number;
  uniqueSupplierCount: number;
  items: ManexInstalledPart[];
};

export type TraceabilityAnchorSummary = {
  value: string;
  count: number;
  ratio: number;
  relatedProductCount: number;
  productIds: string[];
};

export type TraceabilityBatchConcentrationHint = {
  batchRef: string;
  count: number;
  ratio: number;
  productIds: string[];
  partNumbers: string[];
  findNumbers: string[];
  supplierNames: string[];
};

export type TraceabilityAnchorCandidate = {
  anchorType: "supplier_batch" | "part_number" | "bom_position" | "part_batch";
  anchorValue: string;
  count: number;
  ratio: number;
  reason: string;
};

export type TraceabilityBlastRadiusHint = {
  anchorType: TraceabilityAnchorCandidate["anchorType"];
  anchorValue: string;
  relatedProductCount: number;
  relatedInstallCount: number;
  concentrationRatio: number;
  productIds: string[];
  sharedPartNumbers: string[];
  sharedBomPositions: string[];
  sharedSupplierBatches: string[];
  sharedSuppliers: string[];
};

export type ProductTraceabilityEvidence = {
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
  dominantInstalledParts: TraceabilityAnchorSummary[];
  dominantBomPositions: TraceabilityAnchorSummary[];
  dominantSupplierBatches: TraceabilityAnchorSummary[];
  dominantSuppliers: TraceabilityAnchorSummary[];
  batchConcentrationHints: TraceabilityBatchConcentrationHint[];
  productAnchorCandidates: TraceabilityAnchorCandidate[];
  blastRadiusHints: TraceabilityBlastRadiusHint[];
};

export type TraceabilityRelatedProductSummary = {
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

export type TraceabilityBlastRadiusSuspect = {
  batchId: string | null;
  batchNumber: string | null;
  partNumber: string | null;
  supplierNames: string[];
  affectedProductCount: number;
  matchedInstallCount: number;
};

type TraceabilityScopeBucket = {
  items: ManexInstalledPart[];
  productIds: Set<string>;
};

export type TraceabilityScope = {
  totalProducts: number;
  totalInstalls: number;
  byBatchRef: Map<string, TraceabilityScopeBucket>;
  byPartNumber: Map<string, TraceabilityScopeBucket>;
  byBomPosition: Map<string, TraceabilityScopeBucket>;
  bySupplier: Map<string, TraceabilityScopeBucket>;
  byPartBatch: Map<string, TraceabilityScopeBucket>;
};

const normalizeText = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

const compareNullable = (left: string | null, right: string | null) =>
  (left ?? "").localeCompare(right ?? "");

const groupBy = <T,>(items: T[], keyFn: (item: T) => string) =>
  items.reduce((groups, item) => {
    const key = keyFn(item);
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
    return groups;
  }, new Map<string, T[]>());

const pushScopeBucket = (
  map: Map<string, TraceabilityScopeBucket>,
  key: string | null,
  item: ManexInstalledPart,
) => {
  if (!key) {
    return;
  }

  const current = map.get(key) ?? {
    items: [],
    productIds: new Set<string>(),
  };

  current.items.push(item);
  current.productIds.add(item.productId);
  map.set(key, current);
};

const topByCount = <T extends { count: number }>(items: T[], limit = 6) =>
  items.slice(0, limit);

const toBatchRef = (item: ManexInstalledPart) =>
  normalizeTraceabilityText(item.batchId ?? item.batchNumber);

const toBomPosition = (item: ManexInstalledPart) =>
  normalizeTraceabilityText(item.findNumber ?? item.positionCode);

const toPartBatchRef = (item: ManexInstalledPart) => {
  const batchRef = toBatchRef(item);

  if (!batchRef) {
    return null;
  }

  return normalizeTraceabilityText(`${item.partNumber}@${batchRef}`);
};

const uniqueFromBucket = (
  values: Array<string | null | undefined>,
) => uniqueTraceabilityValues(values);

const summarizeAnchors = (
  items: ManexInstalledPart[],
  scopeMap: Map<string, TraceabilityScopeBucket>,
  keyFn: (item: ManexInstalledPart) => string | null,
  limit = 6,
): TraceabilityAnchorSummary[] =>
  topByCount(
    [...groupBy(
      items.filter((item) => Boolean(keyFn(item))),
      (item) => keyFn(item) ?? "",
    ).entries()]
      .map(([value, localItems]) => {
        const scopeBucket = scopeMap.get(value);

        return {
          value,
          count: localItems.length,
          ratio: items.length > 0 ? localItems.length / items.length : 0,
          relatedProductCount: scopeBucket?.productIds.size ?? 0,
          productIds: scopeBucket
            ? [...scopeBucket.productIds].sort((left, right) => left.localeCompare(right))
            : [],
        } satisfies TraceabilityAnchorSummary;
      })
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.relatedProductCount - left.relatedProductCount ||
          left.value.localeCompare(right.value),
      ),
    limit,
  );

const buildBatchConcentrationHints = (
  items: ManexInstalledPart[],
  scope: TraceabilityScope,
): TraceabilityBatchConcentrationHint[] =>
  topByCount(
    [...groupBy(
      items.filter((item) => Boolean(toBatchRef(item))),
      (item) => toBatchRef(item) ?? "",
    ).entries()]
      .map(([batchRef, batchItems]) => {
        const scopeBucket = scope.byBatchRef.get(batchRef);

        return {
          batchRef,
          count: batchItems.length,
          ratio: items.length > 0 ? batchItems.length / items.length : 0,
          productIds: scopeBucket
            ? [...scopeBucket.productIds].sort((left, right) => left.localeCompare(right))
            : [],
          partNumbers: uniqueFromBucket(batchItems.map((item) => item.partNumber)),
          findNumbers: uniqueFromBucket(batchItems.map((item) => toBomPosition(item))),
          supplierNames: uniqueFromBucket(batchItems.map((item) => item.supplierName)),
        } satisfies TraceabilityBatchConcentrationHint;
      })
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.productIds.length - left.productIds.length ||
          left.batchRef.localeCompare(right.batchRef),
      ),
    6,
  );

const buildAnchorCandidates = (
  items: ManexInstalledPart[],
  scope: TraceabilityScope,
  summaries: {
    parts: TraceabilityAnchorSummary[];
    positions: TraceabilityAnchorSummary[];
    batches: TraceabilityAnchorSummary[];
  },
): TraceabilityAnchorCandidate[] => {
  const candidates: TraceabilityAnchorCandidate[] = [];

  for (const entry of summaries.batches.slice(0, 3)) {
    candidates.push({
      anchorType: "supplier_batch",
      anchorValue: entry.value,
      count: entry.count,
      ratio: entry.ratio,
      reason: `${entry.count} installs tie this product to batch ${entry.value}, touching ${entry.relatedProductCount} products in scope.`,
    });
  }

  for (const entry of summaries.parts.slice(0, 2)) {
    candidates.push({
      anchorType: "part_number",
      anchorValue: entry.value,
      count: entry.count,
      ratio: entry.ratio,
      reason: `${entry.value} appears ${entry.count} times on this unit and spans ${entry.relatedProductCount} products in scope.`,
    });
  }

  for (const entry of summaries.positions.slice(0, 2)) {
    candidates.push({
      anchorType: "bom_position",
      anchorValue: entry.value,
      count: entry.count,
      ratio: entry.ratio,
      reason: `Position ${entry.value} is populated ${entry.count} times and recurs across ${entry.relatedProductCount} products in scope.`,
    });
  }

  for (const [value, localItems] of [...groupBy(
    items.filter((item) => Boolean(toPartBatchRef(item))),
    (item) => toPartBatchRef(item) ?? "",
  ).entries()]
    .map(([anchorValue, matched]) => [anchorValue, matched] as const)
    .sort(
      (left, right) =>
        right[1].length - left[1].length || left[0].localeCompare(right[0]),
    )
    .slice(0, 2)) {
    const scopeBucket = scope.byPartBatch.get(value);

    candidates.push({
      anchorType: "part_batch",
      anchorValue: value,
      count: localItems.length,
      ratio: items.length > 0 ? localItems.length / items.length : 0,
      reason: `${value} forms a combined part+batch anchor across ${scopeBucket?.productIds.size ?? 0} scoped products.`,
    });
  }

  const deduped = new Map<string, TraceabilityAnchorCandidate>();

  for (const candidate of candidates) {
    deduped.set(`${candidate.anchorType}:${candidate.anchorValue}`, candidate);
  }

  return [...deduped.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.ratio - left.ratio ||
        left.anchorValue.localeCompare(right.anchorValue),
    )
    .slice(0, 6);
};

const buildBlastRadiusHints = (
  scope: TraceabilityScope,
  candidates: TraceabilityAnchorCandidate[],
): TraceabilityBlastRadiusHint[] =>
  candidates
    .map((candidate) => {
      const bucket =
        candidate.anchorType === "supplier_batch"
          ? scope.byBatchRef.get(candidate.anchorValue)
          : candidate.anchorType === "part_number"
            ? scope.byPartNumber.get(candidate.anchorValue)
            : candidate.anchorType === "bom_position"
              ? scope.byBomPosition.get(candidate.anchorValue)
              : scope.byPartBatch.get(candidate.anchorValue);

      if (!bucket) {
        return null;
      }

      return {
        anchorType: candidate.anchorType,
        anchorValue: candidate.anchorValue,
        relatedProductCount: bucket.productIds.size,
        relatedInstallCount: bucket.items.length,
        concentrationRatio:
          scope.totalProducts > 0 ? bucket.productIds.size / scope.totalProducts : 0,
        productIds: [...bucket.productIds].sort((left, right) => left.localeCompare(right)),
        sharedPartNumbers: uniqueFromBucket(bucket.items.map((item) => item.partNumber)),
        sharedBomPositions: uniqueFromBucket(bucket.items.map((item) => toBomPosition(item))),
        sharedSupplierBatches: uniqueFromBucket(bucket.items.map((item) => toBatchRef(item))),
        sharedSuppliers: uniqueFromBucket(bucket.items.map((item) => item.supplierName)),
      } satisfies TraceabilityBlastRadiusHint;
    })
    .filter((value): value is TraceabilityBlastRadiusHint => Boolean(value))
    .sort(
      (left, right) =>
        right.relatedProductCount - left.relatedProductCount ||
        right.relatedInstallCount - left.relatedInstallCount ||
        left.anchorValue.localeCompare(right.anchorValue),
    )
    .slice(0, 6);

export const normalizeTraceabilityText = normalizeText;

export const uniqueTraceabilityValues = (
  values: Array<string | null | undefined>,
) =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeTraceabilityText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));

export const countUniqueTraceabilityValues = (
  values: Array<string | null | undefined>,
) => uniqueTraceabilityValues(values).length;

export function sortTraceabilityPartsForDisplay(items: ManexInstalledPart[]) {
  return [...items].sort((left, right) => {
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
}

export function buildTraceabilityAssemblies(items: ManexInstalledPart[]) {
  return [...groupBy(sortTraceabilityPartsForDisplay(items), (item) => item.parentFindNumber ?? "Direct install").entries()]
    .map(([assemblyLabel, assemblyItems]) => ({
      assemblyLabel,
      partCount: assemblyItems.length,
      uniqueBatchCount: countUniqueTraceabilityValues(
        assemblyItems.map((item) => toBatchRef(item)),
      ),
      uniqueSupplierCount: countUniqueTraceabilityValues(
        assemblyItems.map((item) => item.supplierName),
      ),
      items: assemblyItems,
    }))
    .sort(
      (left, right) =>
        right.partCount - left.partCount ||
        left.assemblyLabel.localeCompare(right.assemblyLabel),
    );
}

export function createTraceabilityScope(items: ManexInstalledPart[]): TraceabilityScope {
  const scope: TraceabilityScope = {
    totalProducts: countUniqueTraceabilityValues(items.map((item) => item.productId)),
    totalInstalls: items.length,
    byBatchRef: new Map(),
    byPartNumber: new Map(),
    byBomPosition: new Map(),
    bySupplier: new Map(),
    byPartBatch: new Map(),
  };

  for (const item of items) {
    pushScopeBucket(scope.byBatchRef, toBatchRef(item), item);
    pushScopeBucket(scope.byPartNumber, normalizeTraceabilityText(item.partNumber), item);
    pushScopeBucket(scope.byBomPosition, toBomPosition(item), item);
    pushScopeBucket(scope.bySupplier, normalizeTraceabilityText(item.supplierName), item);
    pushScopeBucket(scope.byPartBatch, toPartBatchRef(item), item);
  }

  return scope;
}

export function buildProductTraceabilityEvidence(
  installedParts: ManexInstalledPart[],
  scope = createTraceabilityScope(installedParts),
): ProductTraceabilityEvidence {
  const assemblies = buildTraceabilityAssemblies(installedParts);
  const dominantInstalledParts = summarizeAnchors(
    installedParts,
    scope.byPartNumber,
    (item) => normalizeTraceabilityText(item.partNumber),
  );
  const dominantBomPositions = summarizeAnchors(
    installedParts,
    scope.byBomPosition,
    (item) => toBomPosition(item),
  );
  const dominantSupplierBatches = summarizeAnchors(
    installedParts,
    scope.byBatchRef,
    (item) => toBatchRef(item),
  );
  const dominantSuppliers = summarizeAnchors(
    installedParts,
    scope.bySupplier,
    (item) => normalizeTraceabilityText(item.supplierName),
  );
  const batchConcentrationHints = buildBatchConcentrationHints(installedParts, scope);
  const productAnchorCandidates = buildAnchorCandidates(installedParts, scope, {
    parts: dominantInstalledParts,
    positions: dominantBomPositions,
    batches: dominantSupplierBatches,
  });

  return {
    installedPartCount: installedParts.length,
    uniqueBatchCount: countUniqueTraceabilityValues(
      installedParts.map((item) => toBatchRef(item)),
    ),
    uniqueSupplierCount: countUniqueTraceabilityValues(
      installedParts.map((item) => item.supplierName),
    ),
    uniquePartCount: countUniqueTraceabilityValues(
      installedParts.map((item) => item.partNumber),
    ),
    assemblies: assemblies.map((assembly) => ({
      assemblyLabel: assembly.assemblyLabel,
      partCount: assembly.partCount,
      uniqueBatchCount: assembly.uniqueBatchCount,
      uniqueSupplierCount: assembly.uniqueSupplierCount,
    })),
    graphSummary: {
      nodeCount:
        1 +
        countUniqueTraceabilityValues(installedParts.map((item) => item.partNumber)) +
        countUniqueTraceabilityValues(installedParts.map((item) => toBomPosition(item))) +
        countUniqueTraceabilityValues(installedParts.map((item) => toBatchRef(item))) +
        countUniqueTraceabilityValues(installedParts.map((item) => item.supplierName)),
      edgeCount: installedParts.length * 3,
      dominantBatches: dominantSupplierBatches.map((item) => item.value).slice(0, 6),
      dominantSuppliers: dominantSuppliers.map((item) => item.value).slice(0, 6),
    },
    dominantInstalledParts,
    dominantBomPositions,
    dominantSupplierBatches,
    dominantSuppliers,
    batchConcentrationHints,
    productAnchorCandidates,
    blastRadiusHints: buildBlastRadiusHints(scope, productAnchorCandidates),
  };
}

export function pickDominantTraceabilityBatch(
  items: ManexInstalledPart[],
): { batchId: string | null; batchNumber: string | null } | null {
  const winner = [...groupBy(
    items.filter((item) => Boolean(toBatchRef(item))),
    (item) => toBatchRef(item) ?? "",
  ).entries()]
    .map(([batchRef, batchItems]) => ({
      batchRef,
      batchId: normalizeTraceabilityText(batchItems[0]?.batchId),
      batchNumber: normalizeTraceabilityText(batchItems[0]?.batchNumber),
      count: batchItems.length,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.batchRef.localeCompare(right.batchRef),
    )[0];

  return winner
    ? {
        batchId: winner.batchId,
        batchNumber: winner.batchNumber,
      }
    : null;
}

export function buildProductTraceabilityGraph(items: ManexInstalledPart[]) {
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

    if (toBatchRef(item)) {
      const batchId = `batch:${toBatchRef(item)}`;

      addNode({
        id: batchId,
        kind: "batch",
        label: toBatchRef(item) ?? "Unknown batch",
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
}

export function buildTraceabilityRelatedProducts(
  items: ManexInstalledPart[],
): TraceabilityRelatedProductSummary[] {
  return [...groupBy(items, (item) => item.productId).entries()]
    .map(([productId, productItems]) => {
      const sortedItems = sortTraceabilityPartsForDisplay(productItems);
      const head = sortedItems[0];

      return {
        productId,
        articleId: head.articleId,
        articleName: head.articleName,
        orderId: head.orderId,
        buildTs: head.productBuiltAt,
        sharedBatchIds: uniqueTraceabilityValues(sortedItems.map((item) => item.batchId)),
        sharedBatchNumbers: uniqueTraceabilityValues(
          sortedItems.map((item) => item.batchNumber),
        ),
        sharedPartNumbers: uniqueTraceabilityValues(
          sortedItems.map((item) => item.partNumber),
        ),
        sharedPositions: uniqueTraceabilityValues(
          sortedItems.map((item) => item.positionCode),
        ),
        sharedFindNumbers: uniqueTraceabilityValues(
          sortedItems.map((item) => item.findNumber),
        ),
        sharedSuppliers: uniqueTraceabilityValues(
          sortedItems.map((item) => item.supplierName),
        ),
        matchedParts: sortedItems,
      } satisfies TraceabilityRelatedProductSummary;
    })
    .sort(
      (left, right) =>
        compareNullable(right.buildTs, left.buildTs) ||
        left.productId.localeCompare(right.productId),
    );
}

export function buildBlastRadiusGraph(
  relatedProducts: TraceabilityRelatedProductSummary[],
  suspect: TraceabilityBlastRadiusSuspect,
) {
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
}
