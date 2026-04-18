import { capabilities } from "@/lib/env";
import { runArticleCaseClusteringBatch } from "@/lib/manex-case-clustering";
import {
  listActiveTeamCaseRuns,
  resetTeamCaseClusteringState,
  type TeamClusteringResetSummary,
} from "@/lib/manex-case-clustering-state";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type BatchRequestBody = {
  articleIds?: string[];
};

type BatchLifecycleStatus = "idle" | "running" | "completed" | "failed";

type BatchStatus = {
  status: BatchLifecycleStatus;
  requestedArticleIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  concurrency: number | null;
  okCount: number;
  errorCount: number;
  errorMessage: string | null;
};

type ResetStatus = {
  completedAt: string | null;
  summary: TeamClusteringResetSummary | null;
};

let activeBatchPromise: Promise<void> | null = null;
let latestBatchStatus: BatchStatus = {
  status: "idle",
  requestedArticleIds: [],
  startedAt: null,
  completedAt: null,
  concurrency: null,
  okCount: 0,
  errorCount: 0,
  errorMessage: null,
};
let latestResetStatus: ResetStatus = {
  completedAt: null,
  summary: null,
};

function validateCapabilities() {
  if (!capabilities.hasPostgres) {
    return {
      ok: false,
      error: "Case clustering requires DATABASE_URL for dossier and candidate persistence.",
      status: 503,
    } as const;
  }

  if (!capabilities.hasAi) {
    return {
      ok: false,
      error: "Set OPENAI_API_KEY before running article clustering.",
      status: 503,
    } as const;
  }

  return null;
}

function validatePostgresCapability() {
  if (!capabilities.hasPostgres) {
    return {
      ok: false,
      error: "Case clustering reset requires DATABASE_URL.",
      status: 503,
    } as const;
  }

  return null;
}

async function buildStatusPayload() {
  const activeRuns = await listActiveTeamCaseRuns();

  return {
    batch: latestBatchStatus,
    reset: latestResetStatus,
    activeRuns,
    runningArticleCount: activeRuns.length,
    stageCounts: activeRuns.reduce<Record<string, number>>((counts, run) => {
      counts[run.currentStage] = (counts[run.currentStage] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export async function GET() {
  const capabilityError = validateCapabilities();

  if (capabilityError) {
    return Response.json(
      {
        ok: false,
        error: capabilityError.error,
      },
      { status: capabilityError.status },
    );
  }

  return Response.json({
    ok: true,
    ...(await buildStatusPayload()),
  });
}

export async function POST(request: Request) {
  const capabilityError = validateCapabilities();

  if (capabilityError) {
    return Response.json(
      {
        ok: false,
        error: capabilityError.error,
      },
      { status: capabilityError.status },
    );
  }

  if (activeBatchPromise) {
    const statusPayload = await buildStatusPayload();
    return Response.json(
      {
        ok: false,
        error: "A complete pipeline batch is already running.",
        ...statusPayload,
      },
      { status: 409 },
    );
  }

  const existingStatus = await buildStatusPayload();

  if (existingStatus.activeRuns.length > 0) {
    return Response.json(
      {
        ok: false,
        error: "There are already active article runs in progress.",
        ...existingStatus,
      },
      { status: 409 },
    );
  }

  let body: BatchRequestBody = {};

  try {
    body = (await request.json()) as BatchRequestBody;
  } catch {
    body = {};
  }

  const normalizedArticleIds =
    body.articleIds
      ?.map((articleId) => normalizeUiIdentifier(articleId))
      .filter((articleId): articleId is string => Boolean(articleId)) ?? [];

  latestBatchStatus = {
    status: "running",
    requestedArticleIds: normalizedArticleIds,
    startedAt: new Date().toISOString(),
    completedAt: null,
    concurrency: null,
    okCount: 0,
    errorCount: 0,
    errorMessage: null,
  };

  activeBatchPromise = (async () => {
    try {
      const result = await runArticleCaseClusteringBatch(
        normalizedArticleIds.length ? normalizedArticleIds : undefined,
      );

      latestBatchStatus = {
        status: result.errorCount > 0 ? "failed" : "completed",
        requestedArticleIds: result.requestedArticleIds,
        startedAt: latestBatchStatus.startedAt,
        completedAt: new Date().toISOString(),
        concurrency: result.concurrency,
        okCount: result.okCount,
        errorCount: result.errorCount,
        errorMessage:
          result.errorCount > 0
            ? `${result.errorCount} article runs failed during the complete pipeline batch.`
            : null,
      };
    } catch (error) {
      latestBatchStatus = {
        ...latestBatchStatus,
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage:
          error instanceof Error
            ? error.message
            : "The batch clustering engine failed unexpectedly.",
      };
    } finally {
      activeBatchPromise = null;
    }
  })();

  return Response.json({
    ok: true,
    accepted: true,
    ...(await buildStatusPayload()),
  });
}

export async function DELETE() {
  const capabilityError = validatePostgresCapability();

  if (capabilityError) {
    return Response.json(
      {
        ok: false,
        error: capabilityError.error,
      },
      { status: capabilityError.status },
    );
  }

  if (activeBatchPromise) {
    return Response.json(
      {
        ok: false,
        error: "A complete pipeline batch is still running. Wait for it to finish before resetting clustering state.",
        ...(await buildStatusPayload()),
      },
      { status: 409 },
    );
  }

  const existingStatus = await buildStatusPayload();

  if (existingStatus.activeRuns.length > 0) {
    return Response.json(
      {
        ok: false,
        error: "There are active article runs in progress. Wait for them to finish before resetting clustering state.",
        ...existingStatus,
      },
      { status: 409 },
    );
  }

  const resetSummary = await resetTeamCaseClusteringState();
  latestBatchStatus = {
    status: "idle",
    requestedArticleIds: [],
    startedAt: null,
    completedAt: null,
    concurrency: null,
    okCount: 0,
    errorCount: 0,
    errorMessage: null,
  };
  latestResetStatus = {
    completedAt: new Date().toISOString(),
    summary: resetSummary,
  };

  return Response.json({
    ok: true,
    ...(await buildStatusPayload()),
  });
}
