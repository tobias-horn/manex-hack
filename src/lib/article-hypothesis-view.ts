import type { ArticleHypothesisReview } from "@/lib/article-hypothesis-review-state";
import type {
  ArticleCaseboardReadModel,
  ClusteredArticleDossier,
  ClusteredProductDossier,
} from "@/lib/manex-case-clustering";
import type { ClusteringMode } from "@/lib/manex-clustering-mode";
import type { DeterministicArticleCaseboardReadModel } from "@/lib/manex-deterministic-case-clustering";
import type { HypothesisArticleCaseboardReadModel } from "@/lib/manex-hypothesis-case-clustering";
import type { InvestigateArticleCaseboardReadModel } from "@/lib/manex-investigate";
import type { Initiative } from "@/lib/quality-workspace";
import { formatUiDateTime } from "@/lib/ui-format";

export type ArticleHypothesisBoardCaseboard =
  | ArticleCaseboardReadModel
  | DeterministicArticleCaseboardReadModel
  | HypothesisArticleCaseboardReadModel
  | InvestigateArticleCaseboardReadModel;

export type ArticleHypothesisBoardStatus =
  | "leading"
  | "plausible"
  | "weak"
  | "ruled_out"
  | "confirmed";

export type ArticleHypothesisBoardTimelineItem = {
  id: string;
  kind: "signal" | "workflow" | "build";
  label: string;
  detail: string;
  timestamp: string | null;
  productId: string | null;
  signalType: string | null;
  severity: string | null;
  section: string | null;
};

export type ArticleHypothesisBoardProduct = {
  productId: string;
  orderId: string | null;
  buildTs: string | null;
  summary: string;
  suspiciousPatterns: string[];
};

export type ArticleHypothesisCardViewModel = {
  id: string;
  source: "candidate" | "synthetic";
  title: string;
  caseKind: string;
  confidence: number | null;
  priority: string;
  currentStatus: ArticleHypothesisBoardStatus;
  systemStatus: ArticleHypothesisBoardStatus;
  reviewable: boolean;
  thesis: string;
  summary: string;
  whyItFits: string[];
  mustBeTrue: string[];
  weakensIt: string[];
  nextChecks: string[];
  whyNot: string[];
  strongestSharedSignal: string;
  affectedProductCount: number;
  signalCount: number;
  productIds: string[];
  signalIds: string[];
  reportedParts: string[];
  findNumbers: string[];
  supplierBatches: string[];
  sections: string[];
  relatedProducts: ArticleHypothesisBoardProduct[];
  evidenceSpine: ArticleHypothesisBoardTimelineItem[];
  timeline: ArticleHypothesisBoardTimelineItem[];
  frames: ClusteredProductDossier["evidenceFrames"];
  memberNotes: string[];
  actions: Initiative[];
  suggestedActionType: string;
  suggestedActionComment: string;
  defaultProductId: string;
  defaultDefectId: string;
  updatedAt: string | null;
};

export type ArticleHypothesisBoardViewModel = {
  articleId: string;
  articleName: string | null;
  caseShell: {
    title: string;
    issueType: string;
    priority: string;
    affectedProductCount: number;
    strongestSharedSignal: string;
    summary: string;
    proposedHypothesisCount: number;
    articleProductCount: number;
    totalSignals: number;
  };
  hypotheses: ArticleHypothesisCardViewModel[];
  defaultHypothesisId: string | null;
  globalContext: {
    validatedCount: number;
    watchlistCount: number;
    leadingIndicatorCount: number;
    noiseCount: number;
    notes: string[];
  } | null;
  benchmark: string | null;
};

type CandidateLike = {
  id: string;
  title: string;
  caseKind: string;
  summary: string;
  suspectedCommonRootCause?: string;
  confidence: number | null;
  priority: string;
  strongestEvidence: string[];
  conflictingEvidence?: string[];
  recommendedNextTraceChecks?: string[];
  includedProductIds: string[];
  includedSignalIds: string[];
  payload?: unknown;
  updatedAt?: string;
  members?: Array<{ rationale?: string | null }>;
};

type CaseboardSupplementLike = {
  title: string;
  summary: string;
  strongestEvidence?: string[];
  linkedProductIds?: string[];
  linkedSignalIds?: string[];
  includedSignalIds?: string[];
  recommendedNextTraceChecks?: string[];
  confidence?: number;
  priority?: string;
  family?: string;
  indicatorKind?: string;
  productId?: string;
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.replace(/\s+/g, " ").trim()).filter(Boolean) as string[]),
  );
}

function toCaseKindLabel(value: string | null | undefined) {
  const cleaned = value?.replace(/[_-]+/g, " ").trim();
  return cleaned ? cleaned : "hypothesis";
}

function priorityWeight(priority: string) {
  if (priority === "critical") {
    return 4;
  }

  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}

function statusWeight(status: ArticleHypothesisBoardStatus) {
  if (status === "confirmed") {
    return 5;
  }

  if (status === "leading") {
    return 4;
  }

  if (status === "plausible") {
    return 3;
  }

  if (status === "weak") {
    return 2;
  }

  return 1;
}

function deriveSystemStatus(index: number, confidence: number | null) {
  if (index === 0 || (confidence ?? 0) >= 0.82) {
    return "leading" as const;
  }

  if ((confidence ?? 0) >= 0.58) {
    return "plausible" as const;
  }

  return "weak" as const;
}

function getSelectedThreads(
  dossier: ClusteredArticleDossier | null,
  productIds: string[],
) {
  if (!dossier) {
    return [] as ClusteredProductDossier[];
  }

  return dossier.productThreads.filter((thread) => productIds.includes(thread.productId));
}

function buildTimeline(threads: ClusteredProductDossier[]) {
  const events: ArticleHypothesisBoardTimelineItem[] = [];

  for (const thread of threads) {
    if (thread.buildTs) {
      events.push({
        id: `${thread.productId}:build`,
        kind: "build",
        label: "Build completed",
        detail: thread.orderId
          ? `Product ${thread.productId} was built under order ${thread.orderId}.`
          : `Product ${thread.productId} entered the observed cohort.`,
        timestamp: thread.buildTs,
        productId: thread.productId,
        signalType: null,
        severity: null,
        section: null,
      });
    }

    for (const signal of thread.signals) {
      events.push({
        id: `${thread.productId}:${signal.signalId}`,
        kind: "signal",
        label: signal.headline,
        detail: signal.notePreview,
        timestamp: signal.occurredAt,
        productId: thread.productId,
        signalType: signal.signalType,
        severity: signal.severity,
        section: signal.section,
      });
    }

    for (const action of thread.actions) {
      events.push({
        id: `${thread.productId}:action:${action.id}`,
        kind: "workflow",
        label: action.actionType.replaceAll("_", " "),
        detail: action.comments || "Workflow action captured without extra notes.",
        timestamp: action.recordedAt,
        productId: thread.productId,
        signalType: "product_action",
        severity: action.status,
        section: null,
      });
    }
  }

  return events.sort((left, right) => {
    const leftTime = left.timestamp ?? "";
    const rightTime = right.timestamp ?? "";
    return leftTime.localeCompare(rightTime);
  });
}

function addSpineEvent(
  collection: ArticleHypothesisBoardTimelineItem[],
  candidate: ArticleHypothesisBoardTimelineItem | undefined,
) {
  if (!candidate) {
    return;
  }

  if (collection.some((item) => item.id === candidate.id)) {
    return;
  }

  collection.push(candidate);
}

function buildEvidenceSpine(timeline: ArticleHypothesisBoardTimelineItem[]) {
  const spine: ArticleHypothesisBoardTimelineItem[] = [];
  addSpineEvent(spine, timeline[0]);
  addSpineEvent(spine, timeline.find((item) => item.signalType === "bad_test"));
  addSpineEvent(spine, timeline.find((item) => item.signalType === "defect"));
  addSpineEvent(spine, timeline.find((item) => item.signalType === "field_claim"));
  addSpineEvent(spine, [...timeline].reverse().find((item) => item.kind === "workflow"));
  addSpineEvent(spine, timeline[timeline.length - 1]);
  return spine.slice(0, 5);
}

function getProposalPayload(candidate: CandidateLike) {
  if (!candidate.payload || typeof candidate.payload !== "object") {
    return null;
  }

  const payload = candidate.payload as Record<string, unknown>;
  const proposal =
    payload.proposal && typeof payload.proposal === "object"
      ? (payload.proposal as Record<string, unknown>)
      : null;
  const sourceCase =
    payload.sourceCase && typeof payload.sourceCase === "object"
      ? (payload.sourceCase as Record<string, unknown>)
      : null;

  return {
    payload,
    proposal,
    sourceCase,
  };
}

function buildWhyItFits(candidate: CandidateLike, payload: ReturnType<typeof getProposalPayload>) {
  const lines = [
    ...candidate.strongestEvidence,
    ...(payload?.proposal && Array.isArray(payload.proposal.sharedEvidence)
      ? (payload.proposal.sharedEvidence as string[])
      : []),
    ...(payload?.payload && typeof payload.payload.oneLineWhyGrouped === "string"
      ? [payload.payload.oneLineWhyGrouped]
      : []),
  ];

  return uniqueStrings(lines)
    .slice(0, 3)
    .map((item) => {
      if (/share|shared|overlap|same/i.test(item)) {
        return `Shared observation: ${item}`;
      }

      if (/spike|cluster|concentration|overrepresented/i.test(item)) {
        return `Pattern in the record: ${item}`;
      }

      return `Observed signal: ${item}`;
    });
}

function buildPremises(
  candidate: CandidateLike,
  threads: ClusteredProductDossier[],
  payload: ReturnType<typeof getProposalPayload>,
) {
  const supplierBatches = uniqueStrings(
    threads.flatMap((thread) => thread.summaryFeatures.supplierBatches),
  );
  const findNumbers = uniqueStrings(
    threads.flatMap((thread) => thread.summaryFeatures.bomFindNumbers),
  );
  const sections = uniqueStrings(threads.flatMap((thread) => thread.summaryFeatures.sectionsSeen));
  const signalTypes = uniqueStrings(threads.flatMap((thread) => thread.summaryFeatures.signalTypesPresent));
  const assumptions: string[] = [];

  if (supplierBatches.length) {
    assumptions.push(
      `This account assumes the affected units are genuinely concentrated in ${supplierBatches.slice(0, 2).join(" / ")}, not merely adjacent in the article view.`,
    );
  }

  if (findNumbers.length) {
    assumptions.push(
      `This account assumes the mechanism follows installed-part traceability at ${findNumbers.slice(0, 2).join(" / ")}, not just symptom resemblance.`,
    );
  }

  if (sections.length) {
    assumptions.push(
      `This account assumes the section concentration around ${sections.slice(0, 2).join(" / ")} survives comparison against unaffected products.`,
    );
  }

  if (!assumptions.length && signalTypes.includes("field_claim")) {
    assumptions.push(
      "This account assumes the field complaints reflect a real latent defect pattern rather than a documentation or service artifact.",
    );
  }

  if (
    payload?.payload &&
    typeof payload.payload.articleWideAnchorRisk === "boolean" &&
    payload.payload.articleWideAnchorRisk
  ) {
    assumptions.push(
      "This account assumes the shared anchor still resolves to one bounded mechanism after article-wide background noise is stripped away.",
    );
  }

  if (!assumptions.length) {
    assumptions.push(
      "This account assumes the selected products belong to one mechanism family rather than several adjacent incidents that only look similar.",
    );
  }

  return assumptions.slice(0, 3);
}

function buildWeakensIt(
  candidate: CandidateLike,
  threads: ClusteredProductDossier[],
  payload: ReturnType<typeof getProposalPayload>,
) {
  const contradictions = uniqueStrings(candidate.conflictingEvidence ?? []);

  if (
    payload?.sourceCase &&
    Array.isArray(payload.sourceCase.confounders)
  ) {
    contradictions.push(...(payload.sourceCase.confounders as string[]));
  }

  if (
    payload?.payload &&
    typeof payload.payload.oneLineWhyExcluded === "string"
  ) {
    contradictions.push(payload.payload.oneLineWhyExcluded);
  }

  if (
    payload?.payload &&
    typeof payload.payload.articleWideAnchorRisk === "boolean" &&
    payload.payload.articleWideAnchorRisk
  ) {
    contradictions.push(
      "The anchor may still be too article-wide to justify one concrete mechanism.",
    );
  }

  if (!contradictions.length) {
    const noiseFlags = uniqueStrings(
      threads.flatMap((thread) => thread.stage1Synthesis.possibleNoiseFlags),
    );
    contradictions.push(
      noiseFlags[0] ??
        "The current record still lacks one discriminating comparison that could materially weaken this account.",
    );
  }

  return contradictions.slice(0, 2).map((item) => `Undercutter: ${item}`);
}

function buildNextChecks(candidate: CandidateLike, payload: ReturnType<typeof getProposalPayload>) {
  const checks = [
    ...(candidate.recommendedNextTraceChecks ?? []),
    ...(payload?.sourceCase && Array.isArray(payload.sourceCase.recommendedChecks)
      ? (payload.sourceCase.recommendedChecks as string[])
      : []),
    ...(payload?.payload && Array.isArray(payload.payload.recommendedActions)
      ? (payload.payload.recommendedActions as string[])
      : []),
  ];

  if (!checks.length) {
    checks.push(
      "Run an affected-vs-unaffected cohort comparison before treating this as the working explanation.",
    );
  }

  return uniqueStrings(checks)
    .slice(0, 2)
    .map((item, index) =>
      index === 0 ? `Primary discriminating test: ${item}` : `Backup check: ${item}`,
    );
}

function buildWhyNot(
  weakensIt: string[],
  supplement: CaseboardSupplementLike | null,
) {
  const lines: string[] = [];

  for (const item of weakensIt) {
    if (/marginal|near-limit|screening/i.test(item)) {
      lines.push("Not just a marginal-only or screening echo.");
    } else if (/false|noise|artifact|hotspot/i.test(item)) {
      lines.push("Not just a detection hotspot or false-positive cluster.");
    } else if (/cosmetic|handling|operator/i.test(item)) {
      lines.push("Not just a cosmetic or handling-only pattern.");
    }
  }

  if (supplement?.title) {
    lines.push(`Not fully explained by ${supplement.title.toLowerCase()}.`);
  }

  if (!lines.length) {
    lines.push("Not yet better explained by the weaker alternative patterns still visible in this article.");
  }

  return uniqueStrings(lines).slice(0, 3);
}

function getSuggestedActionType(candidate: CandidateLike, payload: ReturnType<typeof getProposalPayload>) {
  if (
    payload?.payload &&
    typeof payload.payload.recommendedActionType === "string"
  ) {
    return payload.payload.recommendedActionType;
  }

  return "supplier_containment";
}

function getSuggestedActionComment(
  title: string,
  whyItFits: string[],
  nextChecks: string[],
) {
  const evidenceLine = whyItFits.slice(0, 2).join(" ");
  const checkLine = nextChecks[0] ?? "Define one decisive verification step.";
  return `${title}: ${evidenceLine} Next decisive check: ${checkLine}`;
}

function getDefaultDefectId(threads: ClusteredProductDossier[]) {
  return threads.find((thread) => thread.defects[0]?.id)?.defects[0]?.id ?? "";
}

function buildActions(threads: ClusteredProductDossier[]) {
  return threads
    .flatMap((thread) =>
      thread.actions.map((action) => ({
        id: action.id,
        productId: thread.productId,
        defectId: action.defectId,
        actionType: action.actionType,
        status: action.status,
        comments: action.comments || "No notes attached.",
        timestamp: formatUiDateTime(action.recordedAt),
      })),
    )
    .slice(0, 8) satisfies Initiative[];
}

function buildCardFromCandidate(input: {
  candidate: CandidateLike;
  caseboard: ArticleHypothesisBoardCaseboard;
  dossier: ClusteredArticleDossier | null;
  review: ArticleHypothesisReview | null;
  index: number;
  alternative: CaseboardSupplementLike | null;
}): ArticleHypothesisCardViewModel {
  const payload = getProposalPayload(input.candidate);
  const threads = getSelectedThreads(input.dossier, input.candidate.includedProductIds);
  const timeline = buildTimeline(threads);
  const evidenceSpine = buildEvidenceSpine(timeline);
  const whyItFits = buildWhyItFits(input.candidate, payload);
  const nextChecks = buildNextChecks(input.candidate, payload);
  const weakensIt = buildWeakensIt(input.candidate, threads, payload);
  const mustBeTrue = buildPremises(input.candidate, threads, payload);
  const systemStatus = deriveSystemStatus(input.index, input.candidate.confidence);
  const currentStatus = input.review?.status ?? systemStatus;
  const reportedParts = uniqueStrings(
    threads.flatMap((thread) => thread.summaryFeatures.reportedPartNumbers),
  );
  const findNumbers = uniqueStrings(
    threads.flatMap((thread) => thread.summaryFeatures.bomFindNumbers),
  );
  const supplierBatches = uniqueStrings(
    threads.flatMap((thread) => thread.summaryFeatures.supplierBatches),
  );
  const sections = uniqueStrings(threads.flatMap((thread) => thread.summaryFeatures.sectionsSeen));
  const memberNotes = uniqueStrings(
    (input.candidate.members ?? []).map((member) => member.rationale ?? null),
  );
  const suggestedActionType = getSuggestedActionType(input.candidate, payload);

  return {
    id: input.candidate.id,
    source: "candidate",
    title: input.candidate.title,
    caseKind: toCaseKindLabel(input.candidate.caseKind),
    confidence: input.candidate.confidence,
    priority: input.candidate.priority,
    currentStatus,
    systemStatus,
    reviewable: true,
    thesis:
      input.candidate.suspectedCommonRootCause?.trim() ||
      whyItFits[0] ||
      input.candidate.summary,
    summary: input.candidate.summary,
    whyItFits,
    mustBeTrue,
    weakensIt,
    nextChecks,
    whyNot: buildWhyNot(weakensIt, input.alternative),
    strongestSharedSignal: whyItFits[0] ?? input.candidate.summary,
    affectedProductCount: input.candidate.includedProductIds.length,
    signalCount: input.candidate.includedSignalIds.length,
    productIds: input.candidate.includedProductIds,
    signalIds: input.candidate.includedSignalIds,
    reportedParts,
    findNumbers,
    supplierBatches,
    sections,
    relatedProducts: threads.map((thread) => ({
      productId: thread.productId,
      orderId: thread.orderId,
      buildTs: thread.buildTs,
      summary: thread.stage1Synthesis.productSummary,
      suspiciousPatterns: thread.stage1Synthesis.suspiciousPatterns.slice(0, 3),
    })),
    evidenceSpine,
    timeline: timeline.slice(-10).reverse(),
    frames: threads
      .flatMap((thread) => thread.evidenceFrames)
      .filter(
        (frame, index, collection) =>
          collection.findIndex((candidate) => candidate.id === frame.id) === index,
      )
      .slice(0, 6),
    memberNotes,
    actions: buildActions(threads),
    suggestedActionType,
    suggestedActionComment: getSuggestedActionComment(input.candidate.title, whyItFits, nextChecks),
    defaultProductId: input.candidate.includedProductIds[0] ?? "",
    defaultDefectId: getDefaultDefectId(threads),
    updatedAt: input.review?.updatedAt ?? input.candidate.updatedAt ?? null,
  };
}

function buildSyntheticCard(input: {
  supplement: CaseboardSupplementLike;
  dossier: ClusteredArticleDossier | null;
  index: number;
}): ArticleHypothesisCardViewModel {
  const productIds = uniqueStrings([
    ...(input.supplement.linkedProductIds ?? []),
    input.supplement.productId ?? null,
  ]);
  const signalIds = uniqueStrings([
    ...(input.supplement.linkedSignalIds ?? []),
    ...(input.supplement.includedSignalIds ?? []),
  ]);
  const threads = getSelectedThreads(input.dossier, productIds);
  const timeline = buildTimeline(threads);
  const whyItFits = uniqueStrings(input.supplement.strongestEvidence ?? []);
  const nextChecks = uniqueStrings(input.supplement.recommendedNextTraceChecks ?? []);

  return {
    id: `synthetic:${input.supplement.title}`,
    source: "synthetic",
    title: input.supplement.title,
    caseKind: toCaseKindLabel(
      input.supplement.family ?? input.supplement.indicatorKind ?? "alternative",
    ),
    confidence: input.supplement.confidence ?? null,
    priority: input.supplement.priority ?? "medium",
    currentStatus: "weak",
    systemStatus: deriveSystemStatus(input.index + 2, input.supplement.confidence ?? 0.32),
    reviewable: false,
    thesis: input.supplement.summary,
    summary: input.supplement.summary,
    whyItFits: whyItFits.length
      ? whyItFits.slice(0, 3)
      : ["This article still contains a plausible non-root-cause interpretation worth keeping visible."],
    mustBeTrue: [
      "The pattern is mostly explained by bias, noise, or an early-warning effect rather than one shared mechanism.",
    ],
    weakensIt: [
      "This alternative stops being convincing if the decisive cohort check still isolates one concrete cause.",
    ],
    nextChecks: nextChecks.length
      ? nextChecks.slice(0, 2)
      : ["Use this as a falsification lane, not as the default root-cause answer."],
    whyNot: ["Keep this visible so the leading hypothesis still has to beat a disciplined alternative."],
    strongestSharedSignal: whyItFits[0] ?? input.supplement.summary,
    affectedProductCount: productIds.length,
    signalCount: signalIds.length,
    productIds,
    signalIds,
    reportedParts: uniqueStrings(
      threads.flatMap((thread) => thread.summaryFeatures.reportedPartNumbers),
    ),
    findNumbers: uniqueStrings(
      threads.flatMap((thread) => thread.summaryFeatures.bomFindNumbers),
    ),
    supplierBatches: uniqueStrings(
      threads.flatMap((thread) => thread.summaryFeatures.supplierBatches),
    ),
    sections: uniqueStrings(threads.flatMap((thread) => thread.summaryFeatures.sectionsSeen)),
    relatedProducts: threads.map((thread) => ({
      productId: thread.productId,
      orderId: thread.orderId,
      buildTs: thread.buildTs,
      summary: thread.stage1Synthesis.productSummary,
      suspiciousPatterns: thread.stage1Synthesis.suspiciousPatterns.slice(0, 3),
    })),
    evidenceSpine: buildEvidenceSpine(timeline),
    timeline: timeline.slice(-8).reverse(),
    frames: threads
      .flatMap((thread) => thread.evidenceFrames)
      .filter(
        (frame, index, collection) =>
          collection.findIndex((candidate) => candidate.id === frame.id) === index,
      )
      .slice(0, 4),
    memberNotes: [],
    actions: buildActions(threads),
    suggestedActionType: "review",
    suggestedActionComment:
      "Alternative explanation kept visible so the team can challenge the leading hypothesis before acting.",
    defaultProductId: productIds[0] ?? "",
    defaultDefectId: getDefaultDefectId(threads),
    updatedAt: null,
  };
}

function pickSyntheticCompetitor(caseboard: ArticleHypothesisBoardCaseboard) {
  const leadingIndicator =
    "leadingIndicators" in caseboard && Array.isArray(caseboard.leadingIndicators)
      ? (caseboard.leadingIndicators[0] as CaseboardSupplementLike | undefined)
      : undefined;

  return (
    (caseboard.noise[0] as CaseboardSupplementLike | undefined) ??
    (caseboard.watchlists[0] as CaseboardSupplementLike | undefined) ??
    leadingIndicator ??
    (caseboard.incidents[0] as CaseboardSupplementLike | undefined) ??
    null
  );
}

function chooseDisplayedCards(
  candidates: ArticleHypothesisCardViewModel[],
  synthetic: ArticleHypothesisCardViewModel | null,
  forcedId: string | null,
) {
  const selected = forcedId ? candidates.find((candidate) => candidate.id === forcedId) ?? null : null;
  const first = candidates[0] ?? null;
  const second = candidates.find((candidate) => candidate.id !== first?.id) ?? null;
  const cards = [first, selected, second]
    .filter((item): item is ArticleHypothesisCardViewModel => Boolean(item))
    .filter((item, index, collection) => collection.findIndex((candidate) => candidate.id === item.id) === index);

  if (synthetic) {
    cards.push(synthetic);
  } else if (candidates.length > cards.length) {
    const fallback = candidates.find((candidate) => !cards.some((card) => card.id === candidate.id));
    if (fallback) {
      cards.push(fallback);
    }
  }

  return cards.slice(0, 3);
}

export function buildArticleHypothesisBoardViewModel(input: {
  caseboard: ArticleHypothesisBoardCaseboard;
  mode: ClusteringMode;
  initialSelectedId: string | null;
  reviews: ArticleHypothesisReview[];
}) {
  const dossier = input.caseboard.dossier;
  const reviewMap = new Map(input.reviews.map((review) => [review.candidateId, review]));
  const sortedCandidates = [...(input.caseboard.proposedCases as CandidateLike[])].sort((left, right) => {
    const leftReview = reviewMap.get(left.id);
    const rightReview = reviewMap.get(right.id);
    const statusDelta =
      statusWeight(rightReview?.status ?? deriveSystemStatus(0, right.confidence)) -
      statusWeight(leftReview?.status ?? deriveSystemStatus(0, left.confidence));

    if (statusDelta !== 0) {
      return statusDelta;
    }

    const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);

    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return priorityWeight(right.priority) - priorityWeight(left.priority);
  });
  const syntheticSupplement = pickSyntheticCompetitor(input.caseboard);
  const candidateCards = sortedCandidates.map((candidate, index) =>
    buildCardFromCandidate({
      candidate,
      caseboard: input.caseboard,
      dossier,
      review: reviewMap.get(candidate.id) ?? null,
      index,
      alternative: syntheticSupplement,
    }),
  );
  const syntheticCard =
    syntheticSupplement && dossier
      ? buildSyntheticCard({
          supplement: syntheticSupplement,
          dossier,
          index: candidateCards.length,
        })
      : syntheticSupplement
        ? buildSyntheticCard({
            supplement: syntheticSupplement,
            dossier: null,
            index: candidateCards.length,
          })
        : null;
  const displayedCards = chooseDisplayedCards(candidateCards, syntheticCard, input.initialSelectedId);
  const defaultHypothesisId =
    (input.initialSelectedId &&
      displayedCards.find((candidate) => candidate.id === input.initialSelectedId)?.id) ??
    displayedCards[0]?.id ??
    null;
  const leading = displayedCards[0] ?? null;
  const articleProductCount = dossier?.article.productCount ?? input.caseboard.dashboardCard?.productCount ?? 0;
  const totalSignals = dossier?.article.totalSignals ?? input.caseboard.dashboardCard?.totalSignals ?? 0;
  const benchmark =
    "evaluationSummary" in input.caseboard && input.caseboard.evaluationSummary
      ? input.caseboard.evaluationSummary.summaryLine
      : null;
  const globalInventory = input.caseboard.globalInventory;

  return {
    articleId: input.caseboard.articleId,
    articleName: input.caseboard.articleName,
    caseShell: {
      title: input.caseboard.articleName
        ? `${input.caseboard.articleId} · ${input.caseboard.articleName}`
        : input.caseboard.articleId,
      issueType: leading?.caseKind ?? "no ranked hypothesis yet",
      priority: leading?.priority ?? "medium",
      affectedProductCount: leading?.affectedProductCount ?? 0,
      strongestSharedSignal:
        leading?.strongestSharedSignal ??
        input.caseboard.globalObservations[0] ??
        "Run the article pipeline to surface the first shared mechanism.",
      summary:
        leading?.summary ??
        input.caseboard.globalObservations[0] ??
        "This article has not surfaced a shared hypothesis yet.",
      proposedHypothesisCount: input.caseboard.proposedCases.length,
      articleProductCount,
      totalSignals,
    },
    hypotheses: displayedCards,
    defaultHypothesisId,
    globalContext: globalInventory
      ? {
          validatedCount: globalInventory.validatedCases.length,
          watchlistCount: globalInventory.watchlists.length,
          leadingIndicatorCount:
            "leadingIndicators" in globalInventory && Array.isArray(globalInventory.leadingIndicators)
              ? globalInventory.leadingIndicators.length
              : 0,
          noiseCount: globalInventory.noiseBuckets.length,
          notes: globalInventory.confidenceNotes.slice(0, 3),
        }
      : null,
    benchmark,
  } satisfies ArticleHypothesisBoardViewModel;
}
