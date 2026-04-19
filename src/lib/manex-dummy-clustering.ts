import type { ClusteredProductDossier } from "@/lib/manex-case-clustering";
import {
  getHypothesisArticleCaseboard,
  type HypothesisArticleCaseboardReadModel,
  type HypothesisProposedCasesDashboardReadModel,
} from "@/lib/manex-hypothesis-case-clustering";
import type {
  HypothesisArticleClusterCard,
  HypothesisCaseCandidateRecord,
  HypothesisCaseCandidatePriority,
  HypothesisCaseRunSummary,
} from "@/lib/manex-hypothesis-case-clustering-state";

type DummyGlobalInventory =
  NonNullable<HypothesisProposedCasesDashboardReadModel["globalInventory"]>;
type DummyGlobalInventoryItem = DummyGlobalInventory["validatedCases"][number];
type DummyWatchlist = HypothesisArticleCaseboardReadModel["watchlists"][number];
type DummyLeadingIndicator = HypothesisArticleCaseboardReadModel["leadingIndicators"][number];
type DummyNoise = HypothesisArticleCaseboardReadModel["noise"][number];
type DummyIncident = HypothesisArticleCaseboardReadModel["incidents"][number];
type DummyEvaluationSummary =
  NonNullable<HypothesisArticleCaseboardReadModel["evaluationSummary"]>;

type StoryBlueprint = {
  articleId: string;
  articleName: string;
  caseId: string;
  runId: string;
  title: string;
  caseKind: string;
  caseTypeHint: DummyGlobalInventoryItem["caseTypeHint"];
  summary: string;
  rootCause: string;
  priority: HypothesisCaseCandidatePriority;
  confidence: number;
  affectedProductCount: number;
  issueCount: number;
  signalCount: number;
  strongestEvidence: string[];
  conflictingEvidence: string[];
  recommendedNextTraceChecks: string[];
  globalSummary: string;
  keywords: string[];
  defectCodes?: string[];
  partNumbers?: string[];
  supplierBatches?: string[];
  bomFindNumbers?: string[];
  orders?: string[];
  sections?: string[];
  reworkUsers?: string[];
  preferClaimOnly?: boolean;
  actionType: string;
};

const DUMMY_MODEL = "seeded.challenge.v1";
const DUMMY_SCHEMA_VERSION = "2026-04-19.seeded-dummy.v1";
const DUMMY_PROMPT_VERSION = "2026-04-19.seeded-dummy";
const DUMMY_CONTRACT_VERSION = "2026-04-19.seeded-dummy.review";
const DUMMY_GENERATED_AT = "2026-04-19T08:05:00.000Z";
const DUMMY_COMPLETED_AT = "2026-04-19T08:09:00.000Z";
const DUMMY_STAGE_UPDATED_AT = "2026-04-19T08:08:30.000Z";

const STORY_BLUEPRINTS: StoryBlueprint[] = [
  {
    articleId: "ART-00001",
    articleName: "Motor Controller MC-200",
    caseId: "dummy-design-thermal-drift",
    runId: "dummy-run-art-00001",
    title: "Latent thermal drift escaping factory tests",
    caseKind: "latent_design",
    caseTypeHint: "design",
    summary:
      "Field claims accumulate on ART-00001 after 8-12 weeks in service while factory history stays clean. The dummy run frames this as a design-side leak around PM-00015 at BOM position R33 rather than a manufacturing-only event.",
    rootCause:
      "Resistor PM-00015 at BOM position R33 runs hot under nominal load and drifts out of tolerance slowly enough to escape short in-factory test coverage.",
    priority: "critical",
    confidence: 0.88,
    affectedProductCount: 15,
    issueCount: 21,
    signalCount: 19,
    strongestEvidence: [
      "Field claims mention Temperatur, Drift, and schleichender Ausfall without a matching factory defect trail.",
      "Reported part PM-00015 and BOM position R33 recur across delayed claims on ART-00001.",
      "The lag profile stays in the 8-12 week window, which fits a latent thermal weakness better than a line event.",
    ],
    conflictingEvidence: [
      "Factory-side tests stay mostly clean, so the seeded case depends on field evidence more than in-plant failures.",
      "Some products also carry unrelated cosmetic noise that should not be merged into the thermal story.",
    ],
    recommendedNextTraceChecks: [
      "Pull every ART-00001 claim with PM-00015 and compare build-to-claim lag buckets.",
      "Attach the R33 BOM position and nominal-load thermal stress rationale to the 8D opening memo.",
      "Open a design review task before asking production to hunt a nonexistent factory defect cluster.",
    ],
    globalSummary:
      "Claim-only field leakage on ART-00001 points to a latent thermal design weakness rather than a manufacturing window.",
    keywords: ["pm-00015", "r33", "temperatur", "drift", "schleichender", "claim-only"],
    partNumbers: ["PM-00015"],
    bomFindNumbers: ["R33"],
    preferClaimOnly: true,
    actionType: "design_review",
  },
  {
    articleId: "ART-00002",
    articleName: "Sensor Unit SU-100",
    caseId: "dummy-supplier-batch-sb-00007",
    runId: "dummy-run-art-00002",
    title: "Supplier batch SB-00007 cold-solder incident",
    caseKind: "supplier_batch",
    caseTypeHint: "supplier",
    summary:
      "The seeded run packages the classic supplier story: a capacitor batch from ElektroParts GmbH drives a SOLDER_COLD spike, then surfaces again as short-lag field failures.",
    rootCause:
      "Batch SB-00007 of PM-00008 capacitors arrived with elevated ESR, which reduced wetting during reflow and created cold joints that later fail under thermal cycling.",
    priority: "high",
    confidence: 0.93,
    affectedProductCount: 30,
    issueCount: 34,
    signalCount: 31,
    strongestEvidence: [
      "SOLDER_COLD, PM-00008, and supplier batch SB-00007 form the dominant shared anchor bundle.",
      "The dummy run preserves the short claim lag after early-February receipt and March field fallout.",
      "ESR_TEST marginal and fail behavior stays attached to the same material story instead of becoming its own investigation.",
    ],
    conflictingEvidence: [
      "Some products only show marginal ESR signals, so not every attached unit is a confirmed field failure.",
      "Detected-section hotspots at the end-of-line gate are treated as observation bias, not supplier evidence.",
    ],
    recommendedNextTraceChecks: [
      "Quarantine SB-00007 and compare all installed PM-00008 parts against neighboring batches.",
      "Draft the supplier escalation with ESR evidence, blast radius, and thermal-cycle complaint snippets attached.",
      "Split containment owners between incoming quality and field service so the lagged claims stay visible.",
    ],
    globalSummary:
      "Material traceability converges on supplier batch SB-00007 and PM-00008, making this the clearest shared containment case in the seeded mode.",
    keywords: ["sb-00007", "pm-00008", "solder_cold", "esr", "totalausfall", "wenigen wochen"],
    defectCodes: ["SOLDER_COLD"],
    partNumbers: ["PM-00008"],
    supplierBatches: ["SB-00007"],
    actionType: "supplier_containment",
  },
  {
    articleId: "ART-00003",
    articleName: "Power Distribution PD-300",
    caseId: "dummy-process-window-vib-fail",
    runId: "dummy-run-art-00003",
    title: "December process drift around vibration failures",
    caseKind: "process_window",
    caseTypeHint: "process",
    summary:
      "This seeded article run highlights a contained VIB_FAIL window tied to Montage Linie 1. The narrative frames it as calibration drift that self-corrected after week 02/2026 instead of a cross-article design defect.",
    rootCause:
      "A torque wrench drifted out of calibration in Montage Linie 1, leaving screws under-torqued until vibration amplitude exceeded the end-of-line limit.",
    priority: "high",
    confidence: 0.86,
    affectedProductCount: 20,
    issueCount: 18,
    signalCount: 20,
    strongestEvidence: [
      "VIB_FAIL and VIB_TEST failures stay concentrated in weeks 49-52/2025.",
      "Montage Linie 1 is the recurring occurrence section while rework language points to tightening torque back to spec.",
      "The signature disappears after the holiday window, which is consistent with local process recovery.",
    ],
    conflictingEvidence: [
      "Production volume also dips seasonally in late December, so raw counts need week-normalized interpretation.",
      "A few art-local failures are only marginal, not hard fails, which keeps this below the supplier case confidence.",
    ],
    recommendedNextTraceChecks: [
      "Overlay VIB_TEST fail and marginal rates by week for Montage Linie 1 only.",
      "Attach torque-tool calibration evidence and rework text that mentions Schraubmoment.",
      "Document the contained time window so the report does not over-generalize into a design claim.",
    ],
    globalSummary:
      "The seeded process case stays narrow: one section, one window, one corrective-calibration story.",
    keywords: ["vib_fail", "vib_test", "montage linie 1", "schraubmoment", "torque", "dez"],
    defectCodes: ["VIB_FAIL"],
    sections: ["Montage Linie 1"],
    actionType: "process_audit",
  },
  {
    articleId: "ART-00004",
    articleName: "Controller Board CB-150",
    caseId: "dummy-handling-cluster-user-042",
    runId: "dummy-run-art-00004",
    title: "Packaging handling cluster on three production orders",
    caseKind: "handling_cluster",
    caseTypeHint: "handling",
    summary:
      "The dummy handling story keeps cosmetic defects together only when order context and rework ownership are joined back in. It is intentionally lower severity and clearly separated from functional root-cause investigations.",
    rootCause:
      "Packaging operator user_042 handled products roughly across orders PO-00012, PO-00018, and PO-00024, creating recurring scratches and label misalignment without functional impact.",
    priority: "medium",
    confidence: 0.79,
    affectedProductCount: 15,
    issueCount: 14,
    signalCount: 15,
    strongestEvidence: [
      "VISUAL_SCRATCH and LABEL_MISALIGN stay low severity and cluster on PO-00012, PO-00018, and PO-00024.",
      "The seeded case only becomes obvious once rework ownership is joined back to user_042.",
      "No field-impact evidence is attached, which keeps the story in coaching and handling rather than escalated containment.",
    ],
    conflictingEvidence: [
      "Cosmetic-only patterns can look noisy when viewed without order or operator joins.",
      "Some units may also trip final inspection in Pruefung Linie 2, but that is a detection surface, not the handling origin.",
    ],
    recommendedNextTraceChecks: [
      "Group cosmetic defects by order and rework.user_id before writing the final initiative.",
      "Route the corrective action toward packaging handling standards and shift coaching.",
      "Explicitly state no functional impact so leadership does not confuse this with the supplier or design cases.",
    ],
    globalSummary:
      "The operator-handling story stays deliberately low severity, but it is still worth surfacing because it drives repeat cosmetic rework.",
    keywords: [
      "visual_scratch",
      "label_misalign",
      "po-00012",
      "po-00018",
      "po-00024",
      "user_042",
      "cosmetic",
    ],
    defectCodes: ["VISUAL_SCRATCH", "LABEL_MISALIGN"],
    orders: ["PO-00012", "PO-00018", "PO-00024"],
    reworkUsers: ["user_042"],
    actionType: "operator_coaching",
  },
];

const BLUEPRINT_BY_ARTICLE = new Map(
  STORY_BLUEPRINTS.map((story) => [story.articleId, story]),
);

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildThreadCorpus(thread: ClusteredProductDossier) {
  return [
    thread.productId,
    thread.orderId ?? "",
    thread.stage1Synthesis.productSummary,
    ...thread.stage1Synthesis.suspiciousPatterns,
    ...thread.stage1Synthesis.possibleNoiseFlags,
    ...thread.summaryFeatures.defectCodesPresent,
    ...thread.summaryFeatures.reportedPartNumbers,
    ...thread.summaryFeatures.bomFindNumbers,
    ...thread.summaryFeatures.supplierBatches,
    ...thread.summaryFeatures.sectionsSeen,
    ...thread.signals.flatMap((signal) => [
      signal.headline,
      signal.notePreview,
      signal.section ?? "",
    ]),
    ...thread.defects.flatMap((defect) => [
      defect.code,
      defect.notes,
      defect.reportedPartNumber ?? "",
      defect.detectedSectionName ?? "",
      defect.occurrenceSectionName ?? "",
    ]),
    ...thread.claims.flatMap((claim) => [
      claim.complaintText,
      claim.reportedPartNumber ?? "",
    ]),
    ...thread.tests.flatMap((test) => [test.testKey, test.notes, test.overallResult]),
    ...thread.rework.flatMap((item) => [
      item.actionText,
      item.reportedPartNumber ?? "",
      item.userId ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function scoreThread(thread: ClusteredProductDossier, blueprint: StoryBlueprint) {
  const corpus = buildThreadCorpus(thread);
  let score = 0;

  for (const keyword of blueprint.keywords) {
    if (corpus.includes(keyword.toLowerCase())) {
      score += 3;
    }
  }

  for (const defectCode of blueprint.defectCodes ?? []) {
    if (thread.summaryFeatures.defectCodesPresent.includes(defectCode)) {
      score += 4;
    }
  }

  for (const partNumber of blueprint.partNumbers ?? []) {
    if (thread.summaryFeatures.reportedPartNumbers.includes(partNumber)) {
      score += 5;
    }
  }

  for (const batch of blueprint.supplierBatches ?? []) {
    if (thread.summaryFeatures.supplierBatches.includes(batch)) {
      score += 6;
    }
  }

  for (const findNumber of blueprint.bomFindNumbers ?? []) {
    if (thread.summaryFeatures.bomFindNumbers.includes(findNumber)) {
      score += 5;
    }
  }

  for (const orderId of blueprint.orders ?? []) {
    if (thread.orderId === orderId) {
      score += 5;
    }
  }

  for (const userId of blueprint.reworkUsers ?? []) {
    if (thread.rework.some((item) => item.userId === userId)) {
      score += 4;
    }
  }

  for (const section of blueprint.sections ?? []) {
    if (corpus.includes(section.toLowerCase())) {
      score += 4;
    }
  }

  if (blueprint.preferClaimOnly && thread.summaryFeatures.fieldClaimWithoutFactoryDefect) {
    score += 8;
  }

  return score;
}

function pickStoryThreads(
  dossier: HypothesisArticleCaseboardReadModel["dossier"],
  blueprint: StoryBlueprint,
) {
  const signaledThreads =
    dossier?.productThreads.filter((thread) => thread.signals.length > 0) ?? [];

  if (!signaledThreads.length) {
    return [] as ClusteredProductDossier[];
  }

  const ranked = signaledThreads
    .map((thread) => ({
      thread,
      score: scoreThread(thread, blueprint),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.thread.signals.length !== left.thread.signals.length) {
        return right.thread.signals.length - left.thread.signals.length;
      }

      return left.thread.productId.localeCompare(right.thread.productId);
    });

  const positive = ranked.filter((entry) => entry.score > 0).slice(0, 4);
  const fallback = positive.length ? positive : ranked.slice(0, 4);
  return fallback.map((entry) => entry.thread);
}

function buildCandidateMembers(
  candidateId: string,
  runId: string,
  articleId: string,
  productIds: string[],
  signalIds: string[],
): HypothesisCaseCandidateRecord["members"] {
  const productMembers = productIds.map((productId) => ({
    id: `${candidateId}:product:${productId}`,
    candidateId,
    runId,
    articleId,
    memberType: "product" as const,
    entityId: productId,
    productId,
    signalId: null,
    signalType: null,
    rationale: "Seeded dummy story includes this product thread in the grouped case.",
    createdAt: DUMMY_GENERATED_AT,
  }));
  const signalMembers = signalIds.map((signalId) => ({
    id: `${candidateId}:signal:${signalId}`,
    candidateId,
    runId,
    articleId,
    memberType: "signal" as const,
    entityId: signalId,
    productId: null,
    signalId,
    signalType: null,
    rationale: "Representative signal kept in the seeded case membership for UI review.",
    createdAt: DUMMY_GENERATED_AT,
  }));

  return [...productMembers, ...signalMembers];
}

function buildGlobalInventoryItem(
  blueprint: StoryBlueprint,
  inventoryKind: DummyGlobalInventoryItem["inventoryKind"] = "validated_case",
): DummyGlobalInventoryItem {
  return {
    inventoryTempId: `${blueprint.caseId}:${inventoryKind}`,
    title: blueprint.title,
    inventoryKind,
    caseTypeHint: blueprint.caseTypeHint,
    oneLineExplanation: blueprint.globalSummary,
    summary: blueprint.summary,
    confidence: blueprint.confidence,
    priority: blueprint.priority,
    articleIds: [blueprint.articleId],
    linkedCandidateIds: [blueprint.caseId],
    strongestEvidence: blueprint.strongestEvidence.slice(0, 4),
  };
}

function buildGlobalInventory(): DummyGlobalInventory {
  return {
    contractVersion: "manex.hyp_global_inventory.v1",
    inventorySummary:
      "Seeded challenge mode surfaces the four known hackathon stories directly, keeps near-limit tests visible as early warnings, and suppresses detection-bias hotspots plus false positives so the UI behaves like a completed review pass.",
    validatedCases: STORY_BLUEPRINTS.map((story) => buildGlobalInventoryItem(story)),
    watchlists: [
      {
        inventoryTempId: "dummy-watchlist-detection-hotspot",
        title: 'Detected-section hotspot at "Pruefung Linie 2"',
        inventoryKind: "watchlist",
        caseTypeHint: "watchlist",
        oneLineExplanation:
          "Roughly 40% of detections land at the end-of-line gate, but the seeded mode treats that as detection bias rather than root cause.",
        summary:
          'Pruefung Linie 2 sees a heavy share of defects because it is the final screening gate. The dummy mode keeps it visible as a caution note so users do not mistake the loudest detector for the origin of the problem.',
        confidence: 0.71,
        priority: "medium",
        articleIds: ["ART-00001", "ART-00002", "ART-00003", "ART-00004"],
        linkedCandidateIds: [],
        strongestEvidence: [
          "High detected-section concentration without mechanism-specific anchors.",
          "Mixed defect families all terminate at the same inspection gate.",
        ],
      },
    ],
    leadingIndicators: [
      {
        inventoryTempId: "dummy-leading-indicator-near-limit",
        title: "Near-limit ESR and vibration results as early warning",
        inventoryKind: "watchlist",
        caseTypeHint: "watchlist",
        oneLineExplanation:
          "Marginal ESR_TEST and VIB_TEST results stay surfaced as a leading indicator rather than being promoted to a full case.",
        summary:
          "The seeded mode intentionally preserves marginal test patterns because they help the UI demonstrate early-warning behavior. These results are not failures yet, but they are the right place to start monitoring for supplier or calibration drift.",
        confidence: 0.69,
        priority: "medium",
        articleIds: ["ART-00002", "ART-00003"],
        linkedCandidateIds: [],
        strongestEvidence: [
          "ESR_TEST skews toward MARGINAL near the supplier story.",
          "VIB_TEST skews toward MARGINAL before the process window becomes a hard fail cluster.",
        ],
      },
    ],
    noiseBuckets: [
      {
        inventoryTempId: "dummy-noise-false-positives",
        title: "False-positive low-severity inspection noise",
        inventoryKind: "noise_bucket",
        caseTypeHint: "noise",
        oneLineExplanation:
          'Rows tagged "false positive" are intentionally suppressed so cosmetic or screening-only chatter does not become a case.',
        summary:
          "About ten low-severity rows with false-positive wording stay in the seeded noise lane. They are valuable to show in the UI because they test that the system can explain why something should be discounted.",
        confidence: 0.84,
        priority: "low",
        articleIds: ["ART-00001", "ART-00004"],
        linkedCandidateIds: [],
        strongestEvidence: [
          'Noise text repeatedly contains "false positive" or equivalent confirmation that no defect was found.',
        ],
      },
    ],
    rejectedCases: [
      {
        inventoryTempId: "dummy-rejected-seasonal-dip",
        title: "Holiday production dip rejected as root-cause evidence",
        inventoryKind: "rejected_case",
        caseTypeHint: "noise",
        oneLineExplanation:
          "Weeks 51-52/2025 carry lower volume, but the seeded mode rejects that seasonal dip as a quality mechanism.",
        summary:
          "The challenge data includes a holiday volume drop to test whether the UI can explain non-causal variation. In seeded mode it stays explicitly rejected so the report narrative does not anchor on the wrong temporal story.",
        confidence: 0.9,
        priority: "low",
        articleIds: ["ART-00003"],
        linkedCandidateIds: [],
        strongestEvidence: [
          "Lower production volume alone does not explain recurring mechanism-specific anchors.",
        ],
      },
    ],
    caseMergeLog: [
      'Suppressed "Pruefung Linie 2" as a detector hotspot, not a mechanism family.',
      "Kept marginal ESR/VIB signals outside the main validated cases so they remain early warnings.",
      "Rejected seasonal week-51/52 volume dip as a causal story.",
    ],
    confidenceNotes: [
      "This mode is seeded dummy output shaped like a finished run so UI work can continue without live clustering progress.",
      "Narratives mirror the four published hackathon stories and intentionally preserve the same caution signals.",
    ],
  };
}

function buildLatestRun(
  blueprint: StoryBlueprint,
  candidateCount: number,
  issueCount: number,
  reviewPayload: unknown,
): HypothesisCaseRunSummary {
  return {
    id: blueprint.runId,
    articleId: blueprint.articleId,
    articleName: blueprint.articleName,
    model: DUMMY_MODEL,
    status: "completed",
    schemaVersion: DUMMY_SCHEMA_VERSION,
    promptVersion: DUMMY_PROMPT_VERSION,
    productCount: blueprint.affectedProductCount,
    signalCount: blueprint.signalCount,
    issueCount,
    candidateCount,
    startedAt: DUMMY_GENERATED_AT,
    completedAt: DUMMY_COMPLETED_AT,
    errorMessage: null,
    currentStage: "completed",
    stageDetail:
      "Seeded challenge mode loaded a finished dummy run so the downstream article UI can be reviewed without waiting for live clustering.",
    stageUpdatedAt: DUMMY_STAGE_UPDATED_AT,
    requestPayload: {
      mode: "dummy",
      seeded: true,
      storyCaseId: blueprint.caseId,
    },
    proposalPayload: {
      mode: "dummy",
      candidateCount,
      issueCount,
    },
    reviewPayload,
  };
}

function buildDashboardCard(
  blueprint: StoryBlueprint,
  latestRun: HypothesisCaseRunSummary,
): HypothesisArticleClusterCard {
  return {
    articleId: blueprint.articleId,
    articleName: blueprint.articleName,
    productCount: blueprint.affectedProductCount,
    totalSignals: blueprint.signalCount,
    defectCount:
      blueprint.caseTypeHint === "design" ? 0 : Math.max(6, blueprint.signalCount - 5),
    claimCount: blueprint.caseTypeHint === "design" ? 15 : blueprint.caseTypeHint === "supplier" ? 12 : 2,
    badTestCount: blueprint.caseTypeHint === "process" ? 9 : blueprint.caseTypeHint === "supplier" ? 6 : 1,
    marginalTestCount: blueprint.caseTypeHint === "process" || blueprint.caseTypeHint === "supplier" ? 7 : 2,
    latestSignalAt: DUMMY_COMPLETED_AT,
    latestRun,
    proposedCaseCount: 1,
  };
}

function buildLeadingIndicator(
  dossier: HypothesisArticleCaseboardReadModel["dossier"],
  blueprint: StoryBlueprint,
): DummyLeadingIndicator {
  const marginalThreads =
    dossier?.productThreads.filter((thread) =>
      thread.tests.some((test) => test.overallResult === "MARGINAL"),
    ) ?? [];
  const linkedProductIds = uniqueValues(
    marginalThreads.slice(0, 4).map((thread) => thread.productId),
  );
  const linkedSignalIds = uniqueValues(
    marginalThreads
      .slice(0, 4)
      .flatMap((thread) =>
        thread.signals
          .filter((signal) => signal.signalType === "marginal_test")
          .map((signal) => signal.signalId),
      ),
  ).slice(0, 12);

  return {
    indicatorTempId: `dummy-indicator:${blueprint.articleId}`,
    indicatorKind:
      blueprint.caseTypeHint === "supplier" || blueprint.caseTypeHint === "process"
        ? "marginal_drift"
        : "near_limit",
    title:
      blueprint.caseTypeHint === "supplier"
        ? "Marginal ESR results around the supplier trail"
        : blueprint.caseTypeHint === "process"
          ? "Marginal vibration results before hard failures"
          : "Near-limit warning worth watching",
    summary:
      blueprint.caseTypeHint === "supplier"
        ? "Keep ESR_TEST marginals visible so the containment story can show deterioration before outright failure."
        : blueprint.caseTypeHint === "process"
          ? "The seeded view preserves pre-fail VIB_TEST drift so calibration recovery can be verified instead of guessed."
          : "A small band of near-limit results stays outside the main case but remains visible as an early warning.",
    confidence: 0.67,
    linkedProductIds: linkedProductIds.length ? linkedProductIds : ["PRD-00001"],
    linkedSignalIds,
    strongestEvidence: [
      "Marginal results recur around the same mechanism family without yet clearing the failure threshold.",
    ],
  };
}

function buildWatchlist(
  dossier: HypothesisArticleCaseboardReadModel["dossier"],
  blueprint: StoryBlueprint,
): DummyWatchlist {
  const hotspotThreads =
    dossier?.productThreads.filter((thread) =>
      buildThreadCorpus(thread).includes("pruefung linie 2"),
    ) ?? [];
  const linkedProductIds = uniqueValues(
    hotspotThreads.slice(0, 6).map((thread) => thread.productId),
  );
  const linkedSignalIds = uniqueValues(
    hotspotThreads.slice(0, 4).flatMap((thread) => thread.signals.map((signal) => signal.signalId)),
  ).slice(0, 18);

  return {
    watchlistTempId: `dummy-watchlist:${blueprint.articleId}`,
    title: 'Detection hotspot at "Pruefung Linie 2"',
    family: "noise_watchlist",
    summary:
      "This seeded watchlist is here to remind the reviewer that the end-of-line inspection gate is loud but non-causal. It should stay visible as caution text, not become the selected root-cause lane.",
    confidence: 0.7,
    priority: "medium",
    linkedProductIds: linkedProductIds.length ? linkedProductIds : ["PRD-00001"],
    linkedSignalIds,
    strongestEvidence: [
      "Multiple unrelated signal families are detected in the same gate section.",
    ],
  };
}

function buildNoise(
  dossier: HypothesisArticleCaseboardReadModel["dossier"],
  blueprint: StoryBlueprint,
): DummyNoise {
  const noisyThreads =
    dossier?.productThreads.filter(
      (thread) =>
        thread.summaryFeatures.falsePositiveMarkers.length > 0 ||
        thread.stage1Synthesis.possibleNoiseFlags.some((flag) =>
          /false positive|holiday|screening/i.test(flag),
        ),
    ) ?? [];
  const linkedProductIds = uniqueValues(
    noisyThreads.slice(0, 4).map((thread) => thread.productId),
  );
  const linkedSignalIds = uniqueValues(
    noisyThreads.slice(0, 4).flatMap((thread) => thread.signals.map((signal) => signal.signalId)),
  ).slice(0, 12);

  return {
    noiseTempId: `dummy-noise:${blueprint.articleId}`,
    title: "False positives and screening-only chatter",
    family: "false_positive_noise",
    summary:
      "Seeded mode keeps a visible bucket for weak or confirmed-no-defect rows so the report flow can explain why these items were not merged into the main case.",
    linkedProductIds,
    linkedSignalIds,
    strongestEvidence: [
      'False-positive wording or inspection-only markers recur in the attached low-severity notes.',
    ],
  };
}

function buildIncident(
  productIds: string[],
  signalIds: string[],
): DummyIncident | null {
  const productId = productIds[0];

  if (!productId) {
    return null;
  }

  return {
    incidentTempId: `dummy-incident:${productId}`,
    title: `Single-product follow-up for ${productId}`,
    family: "single_product_follow_up",
    summary:
      "A few units remain outside the seeded shared case so the article view still demonstrates product-level leftovers and triage lanes.",
    confidence: 0.52,
    priority: "low",
    productId,
    includedSignalIds: signalIds.slice(0, 6),
    strongestEvidence: [
      "Signals exist, but the dummy run intentionally keeps this unit outside the primary grouped story.",
    ],
    recommendedNextTraceChecks: [
      "Review the single-product timeline before promoting it into a shared case.",
    ],
  };
}

function buildEvaluationSummary(): DummyEvaluationSummary {
  return {
    applicableTruthCount: 6,
    surfacedTruthCount: 6,
    leadingIndicatorCount: 1,
    falseMergeCount: 0,
    falseNeighborCount: 0,
    summaryLine:
      "Seeded challenge mode marks all four published root-cause stories as surfaced, preserves the leading indicator, and suppresses the known noise traps.",
    rows: [
      {
        truthId: "story_supplier_batch",
        label: "Story 1 supplier batch",
        family: "supplier_batch",
        expectedKind: "case",
        applicable: true,
        surfaced: true,
        rankPosition: 1,
        matchedCandidateId: "dummy-supplier-batch-sb-00007",
        matchedTitle: "Supplier batch SB-00007 cold-solder incident",
        matchedAnchor: "supplier_batch:SB-00007",
        falseMergeCount: 0,
        falseNeighborCount: 0,
        topEvidence: ["Seeded as a validated supplier case."],
        notes: ["Seeded as a validated case."],
      },
      {
        truthId: "story_process_window",
        label: "Story 2 process drift",
        family: "process_window",
        expectedKind: "case",
        applicable: true,
        surfaced: true,
        rankPosition: 1,
        matchedCandidateId: "dummy-process-window-vib-fail",
        matchedTitle: "December process drift around vibration failures",
        matchedAnchor: "occurrence:Montage Linie 1",
        falseMergeCount: 0,
        falseNeighborCount: 0,
        topEvidence: ["Seeded as a validated process case."],
        notes: ["Seeded as a validated case."],
      },
      {
        truthId: "story_latent_design",
        label: "Story 3 latent design",
        family: "latent_design",
        expectedKind: "case",
        applicable: true,
        surfaced: true,
        rankPosition: 1,
        matchedCandidateId: "dummy-design-thermal-drift",
        matchedTitle: "Latent thermal drift escaping factory tests",
        matchedAnchor: "bom:R33",
        falseMergeCount: 0,
        falseNeighborCount: 0,
        topEvidence: ["Seeded as a validated design case."],
        notes: ["Seeded as a validated case."],
      },
      {
        truthId: "story_handling_cluster",
        label: "Story 4 handling cluster",
        family: "handling_cluster",
        expectedKind: "case",
        applicable: true,
        surfaced: true,
        rankPosition: 1,
        matchedCandidateId: "dummy-handling-cluster-user-042",
        matchedTitle: "Packaging handling cluster on three production orders",
        matchedAnchor: "user:user_042",
        falseMergeCount: 0,
        falseNeighborCount: 0,
        topEvidence: ["Seeded as a validated handling case."],
        notes: ["Seeded as a validated case."],
      },
      {
        truthId: "story_detection_bias",
        label: "Noise: detected-section hotspot",
        family: "noise_watchlist",
        expectedKind: "noise",
        applicable: true,
        surfaced: true,
        rankPosition: null,
        matchedCandidateId: null,
        matchedTitle: null,
        matchedAnchor: "detected:Pruefung Linie 2",
        falseMergeCount: 0,
        falseNeighborCount: 0,
        topEvidence: ["Suppressed into a watchlist."],
        notes: ["Suppressed into a watchlist."],
      },
      {
        truthId: "story_leading_indicator",
        label: "Leading indicator: near-limit tests",
        family: "leading_indicator",
        expectedKind: "leading_indicator",
        applicable: true,
        surfaced: true,
        rankPosition: null,
        matchedCandidateId: null,
        matchedTitle: null,
        matchedAnchor: "leading_indicator:near_limit",
        falseMergeCount: 0,
        falseNeighborCount: 0,
        topEvidence: ["Preserved as an early-warning indicator."],
        notes: ["Preserved as an early-warning indicator."],
      },
    ],
  };
}

function getBlueprint(articleId: string, articleName?: string | null): StoryBlueprint {
  return (
    BLUEPRINT_BY_ARTICLE.get(articleId) ?? {
      articleId,
      articleName: articleName ?? `Seeded article ${articleId}`,
      caseId: `dummy-generic-${articleId.toLowerCase()}`,
      runId: `dummy-run-${articleId.toLowerCase()}`,
      title: `Seeded walkthrough for ${articleId}`,
      caseKind: "seeded_walkthrough",
      caseTypeHint: "watchlist",
      summary:
        "This fallback seeded case exists so the UI can stay populated even when the selected article is outside the four curated challenge stories.",
      rootCause:
        "No single curated challenge story was assigned to this article, so the dummy mode presents a generic walkthrough case.",
      priority: "medium",
      confidence: 0.63,
      affectedProductCount: 8,
      issueCount: 8,
      signalCount: 8,
      strongestEvidence: [
        "The seeded mode keeps the screen populated even without a dedicated published story for this article.",
      ],
      conflictingEvidence: [
        "This is a fallback seeded story and should not be interpreted as a real run result.",
      ],
      recommendedNextTraceChecks: [
        "Switch back to a live pipeline when you want real grouped output for this article.",
      ],
      globalSummary:
        "Fallback seeded walkthrough for articles outside the four published story lanes.",
      keywords: [],
      actionType: "review",
    }
  );
}

export async function getDummyArticleCaseboard(
  articleId: string,
): Promise<HypothesisArticleCaseboardReadModel | null> {
  const base = await getHypothesisArticleCaseboard(articleId).catch(() => null);
  const normalizedArticleId = articleId.replace(/\s+/g, "").trim().toUpperCase();
  const blueprint = getBlueprint(
    normalizedArticleId,
    base?.articleName ?? base?.dashboardCard?.articleName ?? null,
  );
  const dossier = base?.dossier ?? null;
  const selectedThreads = pickStoryThreads(dossier, blueprint);
  const includedProductIds = selectedThreads.map((thread) => thread.productId);
  const includedSignalIds = uniqueValues(
    selectedThreads.flatMap((thread) => thread.signals.map((signal) => signal.signalId)),
  ).slice(0, 48);
  const candidateCount = 1;
  const globalInventory = buildGlobalInventory();
  const watchlist = buildWatchlist(dossier, blueprint);
  const leadingIndicator = buildLeadingIndicator(dossier, blueprint);
  const noise = buildNoise(dossier, blueprint);
  const unassignedProducts =
    dossier?.productThreads
      .filter((thread) => !includedProductIds.includes(thread.productId))
      .slice(0, 12)
      .map((thread) => ({
        productId: thread.productId,
        reason:
          "Seeded mode left this product outside the selected story so the UI still shows residual triage inventory.",
      })) ?? [];
  const incident = buildIncident(
    unassignedProducts.map((item) => item.productId),
    includedSignalIds,
  );
  const candidate: HypothesisCaseCandidateRecord = {
    id: blueprint.caseId,
    runId: blueprint.runId,
    articleId: blueprint.articleId,
    title: blueprint.title,
    lifecycleStatus: "proposed",
    caseKind: blueprint.caseKind,
    summary: blueprint.summary,
    suspectedCommonRootCause: blueprint.rootCause,
    confidence: blueprint.confidence,
    priority: blueprint.priority,
    strongestEvidence: blueprint.strongestEvidence,
    conflictingEvidence: blueprint.conflictingEvidence,
    recommendedNextTraceChecks: blueprint.recommendedNextTraceChecks,
    includedProductIds,
    includedSignalIds,
    payload: {
      mode: "dummy",
      seeded: true,
      caseTypeHint: blueprint.caseTypeHint,
      recommendedActionType: blueprint.actionType,
    },
    createdAt: DUMMY_GENERATED_AT,
    updatedAt: DUMMY_COMPLETED_AT,
    members: buildCandidateMembers(
      blueprint.caseId,
      blueprint.runId,
      blueprint.articleId,
      includedProductIds,
      includedSignalIds,
    ),
  };
  const localInventory = {
    contractVersion: "2026-04-19.hypothesis.local.v1",
    reviewSummary:
      "Seeded challenge mode publishes one finished article case plus supporting watchlists, noise, and leading indicators.",
    cases: [
      {
        localId: blueprint.caseId,
        title: blueprint.title,
        family: blueprint.caseKind,
        caseTypeHint: blueprint.caseTypeHint,
        summary: blueprint.summary,
        confidence: blueprint.confidence,
        priority: blueprint.priority,
        linkedProductIds: includedProductIds,
        linkedSignalIds: includedSignalIds,
        strongestEvidence: blueprint.strongestEvidence,
        conflictingEvidence: blueprint.conflictingEvidence,
        recommendedNextTraceChecks: blueprint.recommendedNextTraceChecks,
        score: Math.round(blueprint.confidence * 100),
        fingerprintTokens: [
          ...blueprint.defectCodes ?? [],
          ...blueprint.partNumbers ?? [],
          ...blueprint.supplierBatches ?? [],
          ...blueprint.bomFindNumbers ?? [],
        ].slice(0, 8),
      },
    ],
    incidents: incident ? [incident] : [],
    watchlists: [watchlist],
    leadingIndicators: [leadingIndicator],
    noise: [noise],
    rejectedCases: [],
    unassignedProducts,
    globalObservations: [
      blueprint.globalSummary,
      "Seeded mode preserves the published hackathon noise traps so the narrative surfaces caution as well as confidence.",
    ],
    caseMergeLog: globalInventory.caseMergeLog,
    evaluationSummary: buildEvaluationSummary(),
  };
  const latestRun = buildLatestRun(blueprint, candidateCount, blueprint.issueCount, {
    contractVersion: DUMMY_CONTRACT_VERSION,
    localInventory,
    globalInventory,
  });
  const dashboardCard =
    base?.dashboardCard ?? buildDashboardCard(blueprint, latestRun);

  return {
    articleId: normalizedArticleId,
    articleName: base?.articleName ?? dashboardCard.articleName ?? blueprint.articleName,
    dashboardCard,
    dossier,
    latestRun,
    proposedCases: [candidate],
    incidents: incident ? [incident] : [],
    watchlists: [watchlist],
    leadingIndicators: [leadingIndicator],
    noise: [noise],
    unassignedProducts,
    globalObservations: localInventory.globalObservations,
    globalInventory,
    evaluationSummary: localInventory.evaluationSummary,
  };
}

export async function getDummyProposedCasesDashboard(): Promise<HypothesisProposedCasesDashboardReadModel> {
  const globalInventory = buildGlobalInventory();
  const articleQueues = STORY_BLUEPRINTS.map((story) => {
    const latestRun = buildLatestRun(story, 1, story.issueCount, {
      contractVersion: DUMMY_CONTRACT_VERSION,
      globalInventory,
    });

    return {
      articleId: story.articleId,
      articleName: story.articleName,
      proposedCaseCount: 1,
      affectedProductCount: story.affectedProductCount,
      highestPriority: story.priority,
      topConfidence: story.confidence,
      summary: story.summary,
      leadingCaseTitle: story.title,
      latestRun,
    };
  });

  const articles = articleQueues.map((queue) =>
    buildDashboardCard(
      getBlueprint(queue.articleId, queue.articleName),
      queue.latestRun,
    ),
  );

  return {
    articles,
    activeRuns: [],
    articleQueues,
    latestGlobalRun: articleQueues[0]?.latestRun ?? null,
    globalInventory,
  };
}

export async function getDummyProposedCasesForProduct(productId: string) {
  const caseboards = await Promise.all(
    STORY_BLUEPRINTS.map((story) => getDummyArticleCaseboard(story.articleId)),
  );

  return caseboards
    .flatMap((caseboard) => caseboard?.proposedCases ?? [])
    .filter((candidate) => candidate.includedProductIds.includes(productId));
}
