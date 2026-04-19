import { capabilities } from "@/lib/env";
import { runDeterministicArticleCaseClusteringBatch } from "@/lib/manex-deterministic-case-clustering";
import {
  getLatestDeterministicCaseBatch,
  listActiveDeterministicCaseRuns,
  resetDeterministicCaseClusteringState,
  stopActiveDeterministicCaseClustering,
  upsertDeterministicCaseBatch,
  type DeterministicCaseBatchSummary,
  type DeterministicClusteringResetSummary,
} from "@/lib/manex-deterministic-case-clustering-state";
import {
  clearDeterministicBatchExecution,
  getDeterministicBatchExecutionState,
  stopAllDeterministicClusteringExecutions,
  registerDeterministicBatchExecution,
} from "@/lib/manex-deterministic-case-clustering-runtime";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type BatchRequestBody = {
  articleIds?: string[];
};

type BatchStatus = DeterministicCaseBatchSummary;

type ResetStatus = {
  completedAt: string | null;
  summary: DeterministicClusteringResetSummary | null;
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
      error: "Deterministic case clustering requires DATABASE_URL for run and candidate persistence.",
      status: 503,
    } as const;
  }

  if (!capabilities.hasAi) {
    return {
      ok: false,
      error: "Set OPENAI_API_KEY before running deterministic case clustering.",
      status: 503,
    } as const;
  }

  return null;
}

function validatePostgresCapability() {
  if (!capabilities.hasPostgres) {
    return {
      ok: false,
      error: "Deterministic case clustering reset requires DATABASE_URL.",
      status: 503,
    } as const;
  }

  return null;
}

async function buildStatusPayload() {
  const activeRuns = await listActiveDeterministicCaseRuns();
  const persistedBatchStatus = await getLatestDeterministicCaseBatch();
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

  if (getDeterministicBatchExecutionState().promise) {
    const statusPayload = await buildStatusPayload();
    return Response.json(
      {
        ok: false,
        error: "A deterministic pipeline batch is already running.",
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
        error: "There are already active deterministic article runs in progress.",
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
  const batchId = `DTCBATCH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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
  await upsertDeterministicCaseBatch(latestBatchStatus);

  const abortController = new AbortController();
  const activeBatchPromise = (async () => {
    try {
      const result = await runDeterministicArticleCaseClusteringBatch({
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
          return upsertDeterministicCaseBatch(latestBatchStatus);
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
          return upsertDeterministicCaseBatch(latestBatchStatus);
        },
      });

      latestBatchStatus = {
        status:
          abortController.signal.aborted ||
          latestBatchStatus.errorMessage === STOPPED_PIPELINE_MESSAGE
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
          abortController.signal.aborted ||
          latestBatchStatus.errorMessage === STOPPED_PIPELINE_MESSAGE
            ? STOPPED_PIPELINE_MESSAGE
            : result.errorCount > 0
              ? `${result.errorCount} deterministic article runs failed during the complete batch.`
              : null,
        articleResults: [...result.results]
          .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
          .slice(0, 24),
      };
      await upsertDeterministicCaseBatch(latestBatchStatus);
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
            : "The deterministic batch clustering engine failed unexpectedly.",
      };
      await upsertDeterministicCaseBatch(latestBatchStatus);
    } finally {
      clearDeterministicBatchExecution(abortController);
    }
  })();
  registerDeterministicBatchExecution({
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

  const runtimeBatch = getDeterministicBatchExecutionState();
  const existingStatus = await buildStatusPayload();

  if (!runtimeBatch.promise && existingStatus.activeRuns.length === 0) {
    return Response.json(
      {
        ok: false,
        error: "There is no active deterministic pipeline to stop.",
        ...existingStatus,
      },
      { status: 409 },
    );
  }

  stopAllDeterministicClusteringExecutions(STOPPED_PIPELINE_MESSAGE);
  await stopActiveDeterministicCaseClustering(STOPPED_PIPELINE_MESSAGE);

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

  if (getDeterministicBatchExecutionState().promise) {
    return Response.json(
      {
        ok: false,
        error:
          "A deterministic pipeline batch is still running. Wait for it to finish before resetting deterministic clustering state.",
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
        error:
          "There are active deterministic article runs in progress. Wait for them to finish before resetting deterministic clustering state.",
        ...existingStatus,
      },
      { status: 409 },
    );
  }

  const resetSummary = await resetDeterministicCaseClusteringState();
  latestResetStatus = {
    completedAt: new Date().toISOString(),
    summary: resetSummary,
  };

  return Response.json({
    ok: true,
    ...(await buildStatusPayload()),
  });
}
