import { capabilities, env } from "@/lib/env";
import { createManexDataAccess } from "@/lib/manex-data-access";
import {
  formatUiDateTime,
  formatUiShortDay,
  formatUiWeekStamp,
} from "@/lib/ui-format";

export type DataMode = "live" | "demo";

export type StorySignal = {
  id: string;
  title: string;
  category: string;
  signal: string;
  scope: string;
  summary: string;
  nextMove: string;
  window: string;
  confidence: number;
  tone: "critical" | "strong" | "moderate" | "subtle";
};

export type TimelinePoint = {
  label: string;
  stamp: string;
  supplierSpike: number;
  vibrationFailures: number;
  thermalClaims: number;
  cosmeticNoise: number;
  total: number;
};

export type RecentDefect = {
  id: string;
  code: string;
  severity: string;
  timestamp: string;
  productId: string;
  partNumber: string;
  notes: string;
};

export type Initiative = {
  id: string;
  productId: string;
  defectId: string | null;
  actionType: string;
  status: string;
  comments: string;
  timestamp: string;
};

type WorkspaceStatBlock = {
  highImpactDefects: number;
  thermalClaims: number;
  falsePositives: number;
  supplierSpike: number;
  vibrationFailures: number;
};

type ConnectionState = {
  label: string;
  state: string;
  detail: string;
};

export type WorkspaceSnapshot = {
  analysisMode: DataMode;
  actionMode: DataMode;
  aiMode: DataMode;
  aiModel: string;
  stats: WorkspaceStatBlock & { openActions: number };
  timeline: TimelinePoint[];
  storyDeck: StorySignal[];
  recentDefects: RecentDefect[];
  actions: Initiative[];
  connections: ConnectionState[];
  defaultPrompt: string;
  defaultActionSeed: {
    productId: string;
    defectId: string;
  };
};

const STORY_DECK: StorySignal[] = [
  {
    id: "story-1",
    title: "Supplier incident",
    category: "Material quality",
    signal: "SOLDER_COLD ↔ SB-00007 ↔ PM-00008",
    scope: "~30 affected products / ~12 claims",
    summary:
      "Cold-solder defects and field claims align with a bad capacitor batch from ElektroParts GmbH. The pattern emerges across factory defects and later field failures.",
    nextMove:
      "Quarantine SB-00007, compare ESR near-misses, and draft a supplier escalation with batch traceability attached.",
    window: "KW 05-06 / Mar 2026",
    confidence: 92,
    tone: "strong",
  },
  {
    id: "story-2",
    title: "Process drift",
    category: "Calibration",
    signal: "VIB_FAIL at Montage Linie 1",
    scope: "~20 defects in a contained window",
    summary:
      "A December-only vibration failure cluster points to a torque wrench drifting out of calibration. The issue self-extinguishes after the new year, which is the signature of a local process drift rather than a product-wide design fault.",
    nextMove:
      "Document the calibration break, verify screw-torque recovery after week 02/2026, and attach rework evidence mentioning torque correction.",
    window: "KW 49-52 / Dec 2025",
    confidence: 86,
    tone: "moderate",
  },
  {
    id: "story-3",
    title: "Design weakness",
    category: "Latent thermal defect",
    signal: "Field claims on ART-00001 / PM-00015 / R33",
    scope: "~15 claims / zero factory defects",
    summary:
      "This one leaks through manufacturing entirely: field claims accumulate after 8-12 weeks in service with no matching in-factory defect trail. The evidence points to resistor PM-00015 at BOM position R33 drifting thermally under nominal load.",
    nextMove:
      "Draft a design review note that calls out the claim lag, zero-factory-defect signature, and R33 stress hypothesis.",
    window: "Jan-Mar 2026",
    confidence: 81,
    tone: "critical",
  },
  {
    id: "story-4",
    title: "Handling cluster",
    category: "Operator workflow",
    signal: "VISUAL_SCRATCH / LABEL_MISALIGN on 3 orders",
    scope: "~15 low-severity cosmetic defects",
    summary:
      "The defect shape is cosmetic, low severity, and concentrated on three production orders. Joining through rework exposes a single operator handling pattern rather than a machine or supplier problem.",
    nextMove:
      "Treat this as a coaching and packaging-handling issue, not a root-cause alarm for the full line.",
    window: "PO-00012 / 18 / 24",
    confidence: 74,
    tone: "subtle",
  },
];

const DEMO_TIMELINE: TimelinePoint[] = [
  {
    label: "09 Dec",
    stamp: "KW 50",
    supplierSpike: 1,
    vibrationFailures: 7,
    thermalClaims: 0,
    cosmeticNoise: 1,
    total: 9,
  },
  {
    label: "23 Dec",
    stamp: "KW 52",
    supplierSpike: 0,
    vibrationFailures: 6,
    thermalClaims: 0,
    cosmeticNoise: 0,
    total: 6,
  },
  {
    label: "03 Feb",
    stamp: "KW 06",
    supplierSpike: 9,
    vibrationFailures: 0,
    thermalClaims: 1,
    cosmeticNoise: 1,
    total: 11,
  },
  {
    label: "17 Feb",
    stamp: "KW 08",
    supplierSpike: 8,
    vibrationFailures: 0,
    thermalClaims: 2,
    cosmeticNoise: 1,
    total: 11,
  },
  {
    label: "03 Mar",
    stamp: "KW 10",
    supplierSpike: 4,
    vibrationFailures: 0,
    thermalClaims: 5,
    cosmeticNoise: 2,
    total: 11,
  },
  {
    label: "17 Mar",
    stamp: "KW 12",
    supplierSpike: 2,
    vibrationFailures: 0,
    thermalClaims: 6,
    cosmeticNoise: 3,
    total: 11,
  },
];

const DEMO_RECENT_DEFECTS: RecentDefect[] = [
  {
    id: "DEF-00418",
    code: "SOLDER_COLD",
    severity: "critical",
    timestamp: "18 Mar 2026, 09:42",
    productId: "PRD-00192",
    partNumber: "PM-00008",
    notes:
      "Cold joint around capacitor lead. Complaint text cluster references early-life outage after thermal cycling.",
  },
  {
    id: "DEF-00327",
    code: "VIB_FAIL",
    severity: "high",
    timestamp: "20 Dec 2025, 15:26",
    productId: "PRD-00107",
    partNumber: "PM-00002",
    notes:
      "End-of-line vibration amplitude beyond limit. Rework notes indicate torque tightening after test failure.",
  },
  {
    id: "DEF-00276",
    code: "LABEL_MISALIGN",
    severity: "low",
    timestamp: "12 Mar 2026, 11:08",
    productId: "PRD-00165",
    partNumber: "PM-00021",
    notes:
      "Cosmetic label shift on packaging handoff. No functional impact, but clustered on the same operator path.",
  },
  {
    id: "DEF-00188",
    code: "VISUAL_SCRATCH",
    severity: "low",
    timestamp: "05 Mar 2026, 14:11",
    productId: "PRD-00154",
    partNumber: "PM-00021",
    notes:
      "Surface scratch captured at final inspection. Order-level clustering suggests handling inconsistency rather than process defect.",
  },
];

const DEMO_ACTIONS: Initiative[] = [
  {
    id: "PA-00161",
    productId: "PRD-00192",
    defectId: "DEF-00418",
    actionType: "supplier_containment",
    status: "open",
    comments:
      "Freeze incoming stock from SB-00007 and attach ESR evidence for supplier review.",
    timestamp: "18 Apr 2026, 16:10",
  },
  {
    id: "PA-00158",
    productId: "PRD-00107",
    defectId: "DEF-00327",
    actionType: "verify_fix",
    status: "in_progress",
    comments:
      "Audit torque-tool calibration logs and confirm no vibration failures after week 02/2026.",
    timestamp: "18 Apr 2026, 15:24",
  },
  {
    id: "PA-00155",
    productId: "PRD-00165",
    defectId: "DEF-00276",
    actionType: "corrective",
    status: "blocked",
    comments:
      "Packaging coaching draft is ready but still needs shift-owner assignment.",
    timestamp: "18 Apr 2026, 14:52",
  },
];

const DEMO_STATS: WorkspaceStatBlock = {
  highImpactDefects: 47,
  thermalClaims: 15,
  falsePositives: 10,
  supplierSpike: 25,
  vibrationFailures: 20,
};

const defaultPrompt =
  "Summarize the strongest evidence in this workspace and turn it into a concise 8D opening statement.";

const trimNotes = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text && text.length > 160 ? `${text.slice(0, 157)}...` : text ?? "";
};

async function getAnalysisFeed() {
  if (!capabilities.hasPostgres && !capabilities.hasRest) {
    return null;
  }

  try {
    const data = createManexDataAccess();
    const since = "2025-12-01T00:00:00.000Z";

    const [
      recentDefectsResult,
      highImpactResult,
      supplierSpikeResult,
      vibrationResult,
      falsePositiveResult,
      thermalClaimsResult,
      timelineDefectsResult,
      timelineClaimsResult,
    ] = await Promise.all([
      data.investigation.findDefects({
        limit: 4,
        sort: "newest",
      }),
      data.investigation.findDefects({
        severities: ["high", "critical"],
      }),
      data.investigation.findDefects({
        defectCodes: ["SOLDER_COLD"],
      }),
      data.investigation.findDefects({
        defectCodes: ["VIB_FAIL"],
      }),
      data.investigation.findDefects({
        severities: ["low"],
      }),
      data.investigation.findClaims({
        reportedPartNumbers: ["PM-00015"],
      }),
      data.investigation.findDefects({
        detectedAfter: since,
      }),
      data.investigation.findClaims({
        claimedAfter: since,
        reportedPartNumbers: ["PM-00015"],
      }),
    ]);
    const transport = recentDefectsResult.transport;

    const timelineMap = new Map<
      string,
      Omit<TimelinePoint, "label" | "stamp" | "total"> & { weekStart: string }
    >();

    for (const defect of timelineDefectsResult.items) {
      const weekStart = defect.defectWeekStart;
      const existing = timelineMap.get(weekStart) ?? {
        weekStart,
        supplierSpike: 0,
        vibrationFailures: 0,
        thermalClaims: 0,
        cosmeticNoise: 0,
      };

      if (defect.code === "SOLDER_COLD") {
        existing.supplierSpike += 1;
      }

      if (defect.code === "VIB_FAIL") {
        existing.vibrationFailures += 1;
      }

      if (["VISUAL_SCRATCH", "LABEL_MISALIGN"].includes(defect.code)) {
        existing.cosmeticNoise += 1;
      }

      timelineMap.set(weekStart, existing);
    }

    for (const claim of timelineClaimsResult.items) {
      const weekStart = claim.claimWeekStart;
      const existing = timelineMap.get(weekStart) ?? {
        weekStart,
        supplierSpike: 0,
        vibrationFailures: 0,
        thermalClaims: 0,
        cosmeticNoise: 0,
      };

      existing.thermalClaims += 1;
      timelineMap.set(weekStart, existing);
    }

    const timeline = Array.from(timelineMap.values())
      .sort((left, right) => left.weekStart.localeCompare(right.weekStart))
      .slice(0, 8)
      .map((row) => ({
        label: formatUiShortDay(row.weekStart),
        stamp: formatUiWeekStamp(row.weekStart),
        supplierSpike: row.supplierSpike,
        vibrationFailures: row.vibrationFailures,
        thermalClaims: row.thermalClaims,
        cosmeticNoise: row.cosmeticNoise,
        total:
          row.supplierSpike +
          row.vibrationFailures +
          row.thermalClaims +
          row.cosmeticNoise,
      }));

    if (!timeline.length || !recentDefectsResult.items.length) {
      return null;
    }

    return {
      mode: "live" as const,
      stats: {
        highImpactDefects: highImpactResult.total ?? 0,
        thermalClaims: thermalClaimsResult.total ?? 0,
        falsePositives: falsePositiveResult.items.filter((defect) =>
          defect.notes.toLowerCase().includes("false positive"),
        ).length,
        supplierSpike: supplierSpikeResult.total ?? 0,
        vibrationFailures: vibrationResult.total ?? 0,
      },
      timeline,
      recentDefects: recentDefectsResult.items.map((defect) => ({
        id: defect.id,
        code: defect.code,
        severity: defect.severity,
        timestamp: formatUiDateTime(defect.occurredAt),
        productId: defect.productId,
        partNumber: defect.reportedPartNumber ?? "Unknown part",
        notes: trimNotes(defect.notes),
      })),
      transport,
    };
  } catch (error) {
    console.error("Postgres analysis unavailable:", error);
    return null;
  }
}

async function getActionFeed() {
  if (!capabilities.hasRest && !capabilities.hasPostgres) {
    return {
      mode: "demo" as const,
      actions: DEMO_ACTIONS,
    };
  }

  try {
    const data = createManexDataAccess();
    const actionResult = await data.workflow.findActions({ limit: 6 });

    return {
      mode: "live" as const,
      transport: actionResult.transport,
      actions: actionResult.items.map((action) => ({
        id: action.id,
        productId: action.productId,
        defectId: action.defectId,
        actionType: action.actionType,
        status: action.status,
        comments: action.comments,
        timestamp: formatUiDateTime(action.recordedAt),
      })),
    };
  } catch (error) {
    console.error("Manex action feed unavailable:", error);

    return {
      mode: "demo" as const,
      actions: DEMO_ACTIONS,
    };
  }
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [analysisFeed, actionFeed] = await Promise.all([
    getAnalysisFeed(),
    getActionFeed(),
  ]);

  const analysisMode = analysisFeed?.mode ?? "demo";
  const stats = analysisFeed?.stats ?? DEMO_STATS;
  const timeline = analysisFeed?.timeline ?? DEMO_TIMELINE;
  const recentDefects = analysisFeed?.recentDefects ?? DEMO_RECENT_DEFECTS;
  const actions = actionFeed.actions.length ? actionFeed.actions : DEMO_ACTIONS;
  const openActions = actions.filter((action) =>
    ["open", "in_progress", "blocked"].includes(action.status),
  ).length;

  return {
    analysisMode,
    actionMode: actionFeed.mode,
    aiMode: capabilities.hasAi ? "live" : "demo",
    aiModel: env.OPENAI_MODEL,
    stats: {
      ...stats,
      openActions,
    },
    timeline,
    storyDeck: STORY_DECK,
    recentDefects,
    actions,
    connections: [
      {
        label: "Analysis",
        state:
          analysisMode === "live"
            ? analysisFeed?.transport === "rest"
              ? "Investigation API live"
              : "Direct Postgres live"
            : "Demo feed",
        detail:
          analysisMode === "live"
            ? analysisFeed?.transport === "rest"
              ? "Investigation reads are flowing through the domain data layer over PostgREST views."
              : "Investigation reads are flowing through the domain data layer over direct Postgres."
            : "No DATABASE_URL configured, so the evidence surface uses seeded story patterns.",
      },
      {
        label: "Writes",
        state:
          actionFeed.mode === "live"
            ? actionFeed.transport === "rest"
              ? "Workflow API live"
              : "Workflow SQL live"
            : "Demo queue",
        detail:
          actionFeed.mode === "live"
            ? actionFeed.transport === "rest"
              ? "Action reads and writes are going through the workflow data layer over PostgREST."
              : "Action reads and writes are going through the workflow data layer over direct Postgres."
            : "Configure MANEX_REST_API_URL / MANEX_REST_API_KEY or DATABASE_URL to persist actions.",
      },
      {
        label: "Copilot",
        state: capabilities.hasAi ? "AI SDK ready" : "AI fallback ready",
        detail: capabilities.hasAi
          ? `Responses are generated through the Vercel AI SDK using ${env.OPENAI_MODEL}.`
          : "Add OPENAI_API_KEY to switch the drafting console from template mode to live inference.",
      },
    ],
    defaultPrompt,
    defaultActionSeed: {
      productId: recentDefects[0]?.productId ?? "PRD-00042",
      defectId: recentDefects[0]?.id ?? "DEF-00007",
    },
  };
}

export function buildCopilotContext(snapshot: WorkspaceSnapshot) {
  const topStories = snapshot.storyDeck
    .map(
      (story) =>
        `- ${story.title}: ${story.signal}; confidence ${story.confidence}%; next move: ${story.nextMove}`,
    )
    .join("\n");

  const recentEvidence = snapshot.recentDefects
    .map(
      (defect) =>
        `- ${defect.id} / ${defect.code} / ${defect.severity}: ${defect.notes}`,
    )
    .join("\n");

  const actionNotes = snapshot.actions
    .slice(0, 3)
    .map(
      (action) =>
        `- ${action.id} / ${action.actionType} / ${action.status}: ${action.comments}`,
    )
    .join("\n");

  return `
Workspace modes:
- Analysis: ${snapshot.analysisMode}
- Writes: ${snapshot.actionMode}
- AI: ${snapshot.aiMode}

Current counts:
- High impact defects: ${snapshot.stats.highImpactDefects}
- Thermal design claims: ${snapshot.stats.thermalClaims}
- False positives: ${snapshot.stats.falsePositives}
- Open actions: ${snapshot.stats.openActions}

Documented story deck:
${topStories}

Recent evidence:
${recentEvidence}

Latest actions:
${actionNotes}
`.trim();
}
