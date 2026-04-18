import { capabilities } from "@/lib/env";
import { runArticleCaseClusteringBatch } from "@/lib/manex-case-clustering";
import {
  getLatestTeamCaseBatch,
  listActiveTeamCaseRuns,
  resetTeamCaseClusteringState,
  stopActiveTeamCaseClustering,
  upsertTeamCaseBatch,
  type TeamClusteringResetSummary,
  type TeamCaseBatchSummary,
} from "@/lib/manex-case-clustering-state";
import {
  clearBatchExecution,
  getBatchExecutionState,
  registerBatchExecution,
  stopAllClusteringExecutions,
} from "@/lib/manex-case-clustering-runtime";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type BatchRequestBody = {
  articleIds?: string[];
};

type BatchStatus = TeamCaseBatchSummary;

type ResetStatus = {
  completedAt: string | null;
  summary: TeamClusteringResetSummary | null;
};

const idleBatchStatus = (): BatchStatus => ({
  id: "idle",
  status: "idle",
  requestedArticleIds: [],
  totalArticleCount: 0,
  startedAt: null,
  completedAt: null,
  lastUpdatedAt: null,
  concurrency: null,
  okCount: 0,
  errorCount: 0,
  errorMessage: null,
  articleResults: [],
});
let latestResetStatus: ResetStatus = {
  completedAt: null,
  summary: null,
};
const STOPPED_PIPELINE_MESSAGE = "Pipeline stopped by user.";

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
  const persistedBatchStatus = await getLatestTeamCaseBatch();
  const latestBatchStatus =
    persistedBatchStatus ??
    (activeRuns.length
      ? {
          id: "recovered",
          status: "running" as const,
          requestedArticleIds: activeRuns.map((run) => run.articleId),
          totalArticleCount: activeRuns.length,
          startedAt: activeRuns[activeRuns.length - 1]?.startedAt ?? null,
          completedAt: null,
          lastUpdatedAt: activeRuns[0]?.stageUpdatedAt ?? activeRuns[0]?.startedAt ?? null,
          concurrency: null,
          okCount: 0,
          errorCount: 0,
          errorMessage: null,
          articleResults: [],
        }
      : idleBatchStatus());

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

  if (getBatchExecutionState().promise) {
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
  const batchId = `TCBATCH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  let latestBatchStatus: BatchStatus = {
    id: batchId,
    status: "running",
    requestedArticleIds: normalizedArticleIds,
    totalArticleCount: normalizedArticleIds.length,
    startedAt: new Date().toISOString(),
    completedAt: null,
    lastUpdatedAt: new Date().toISOString(),
    concurrency: null,
    okCount: 0,
    errorCount: 0,
    errorMessage: null,
    articleResults: [],
  };
  await upsertTeamCaseBatch(latestBatchStatus);

  const abortController = new AbortController();
  const activeBatchPromise = (async () => {
    try {
      const result = await runArticleCaseClusteringBatch({
        articleIds: normalizedArticleIds.length ? normalizedArticleIds : undefined,
        abortSignal: abortController.signal,
        onStart: ({ requestedArticleIds, concurrency, totalArticleCount }) => {
          latestBatchStatus = {
            ...latestBatchStatus,
            requestedArticleIds,
            totalArticleCount,
            concurrency,
            lastUpdatedAt: new Date().toISOString(),
          };
          return upsertTeamCaseBatch(latestBatchStatus);
        },
        onArticleComplete: ({ result: articleResult, okCount, errorCount, totalArticleCount }) => {
          latestBatchStatus = {
            ...latestBatchStatus,
            totalArticleCount,
            okCount,
            errorCount,
            lastUpdatedAt: articleResult.completedAt,
            articleResults: [
              articleResult,
              ...latestBatchStatus.articleResults.filter(
                (item) => item.articleId !== articleResult.articleId,
              ),
            ].slice(0, 24),
          };
          return upsertTeamCaseBatch(latestBatchStatus);
        },
      });

      latestBatchStatus = {
        status:
          abortController.signal.aborted || latestBatchStatus.errorMessage === STOPPED_PIPELINE_MESSAGE
            ? "failed"
            : result.errorCount > 0
              ? "failed"
              : "completed",
        id: latestBatchStatus.id,
        requestedArticleIds: result.requestedArticleIds,
        totalArticleCount: result.requestedArticleIds.length,
        startedAt: latestBatchStatus.startedAt,
        completedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        concurrency: result.concurrency,
        okCount: result.okCount,
        errorCount: result.errorCount,
        errorMessage:
          abortController.signal.aborted || latestBatchStatus.errorMessage === STOPPED_PIPELINE_MESSAGE
            ? STOPPED_PIPELINE_MESSAGE
            : result.errorCount > 0
            ? `${result.errorCount} article runs failed during the complete pipeline batch.`
            : null,
        articleResults: [...result.results]
          .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
          .slice(0, 24),
      };
      await upsertTeamCaseBatch(latestBatchStatus);
    } catch (error) {
      latestBatchStatus = {
        ...latestBatchStatus,
        status: "failed",
        completedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        errorMessage:
          abortController.signal.aborted
            ? STOPPED_PIPELINE_MESSAGE
            : error instanceof Error
            ? error.message
            : "The batch clustering engine failed unexpectedly.",
      };
      await upsertTeamCaseBatch(latestBatchStatus);
    } finally {
      clearBatchExecution(abortController);
    }
  })();
  registerBatchExecution({
    batchId,
    abortController,
    promise: activeBatchPromise,
  });

  return Response.json({
    ok: true,
    accepted: true,
    ...(await buildStatusPayload()),
  });
}

export async function PATCH() {
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

  const runtimeBatch = getBatchExecutionState();
  const existingStatus = await buildStatusPayload();

  if (!runtimeBatch.promise && existingStatus.activeRuns.length === 0) {
    return Response.json(
      {
        ok: false,
        error: "There is no active pipeline to stop.",
        ...existingStatus,
      },
      { status: 409 },
    );
  }

  stopAllClusteringExecutions(STOPPED_PIPELINE_MESSAGE);
  await stopActiveTeamCaseClustering(STOPPED_PIPELINE_MESSAGE);

  if (runtimeBatch.abortController?.signal.aborted) {
    // Keep the current request-visible status until the aborted batch promise settles.
  }

  return Response.json({
    ok: true,
    message: STOPPED_PIPELINE_MESSAGE,
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

  if (getBatchExecutionState().promise) {
    return Response.json(
      {
        ok: false,
        error: "A complete pipeline batch is still running. Stop it before resetting clustering state.",
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
  latestResetStatus = {
    completedAt: new Date().toISOString(),
    summary: resetSummary,
  };

  return Response.json({
    ok: true,
    ...(await buildStatusPayload()),
  });
}
