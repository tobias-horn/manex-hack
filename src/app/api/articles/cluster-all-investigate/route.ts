import { capabilities } from "@/lib/env";
import { runInvestigateArticleCaseClusteringBatch } from "@/lib/manex-investigate";
import {
  clearInvestigateArticleExecution,
  clearInvestigateBatchExecution,
  getInvestigateBatchExecutionState,
  hasActiveInvestigateArticleExecution,
  registerInvestigateBatchExecution,
  stopAllInvestigateExecutions,
} from "@/lib/manex-investigate-runtime";
import {
  clearInvestigateState,
  createInvestigateBatch,
  getLatestInvestigateBatch,
  listActiveInvestigateRuns,
  type InvestigateBatchArticleResult,
  updateInvestigateBatch,
} from "@/lib/manex-investigate-state";

export const runtime = "nodejs";

const STOPPED_PIPELINE_MESSAGE = "Pipeline stopped by user.";

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function buildBatchStatusPayload() {
  const [batch, activeRuns] = await Promise.all([
    getLatestInvestigateBatch(),
    listActiveInvestigateRuns(),
  ]);

  const stageCounts = activeRuns.reduce<Record<string, number>>((counts, run) => {
    counts[run.currentStage] = (counts[run.currentStage] ?? 0) + 1;
    return counts;
  }, {});

  return {
    batch: batch ?? {
      status: activeRuns.length ? "running" : "idle",
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
    },
    reset: {
      completedAt: null,
      summary: null,
    },
    activeRuns,
    runningArticleCount: activeRuns.length,
    stageCounts,
  };
}

export async function GET() {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Statistical investigation requires DATABASE_URL for batch state.",
      },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    ...(await buildBatchStatusPayload()),
  });
}

export async function POST() {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Statistical investigation requires DATABASE_URL for batch state.",
      },
      { status: 503 },
    );
  }

  if (!capabilities.hasAi) {
    return Response.json(
      {
        ok: false,
        error: "Set OPENAI_API_KEY before running statistical investigation.",
      },
      { status: 503 },
    );
  }

  const execution = getInvestigateBatchExecutionState();

  if (execution.promise) {
    return Response.json({
      ok: true,
      accepted: false,
      ...(await buildBatchStatusPayload()),
    });
  }

  const batchId = createId("INVBATCH");
  const abortController = new AbortController();

  const batchPromise = (async () => {
    const articleResults: InvestigateBatchArticleResult[] = [];

    try {
      const result = await runInvestigateArticleCaseClusteringBatch({
        abortSignal: abortController.signal,
        onStart: async (batchInput) => {
          await createInvestigateBatch({
            id: batchId,
            requestedArticleIds: batchInput.requestedArticleIds,
            totalArticleCount: batchInput.totalArticleCount,
            concurrency: batchInput.concurrency,
          });
        },
        onArticleComplete: async (articleInput) => {
          articleResults.push(articleInput.result);
          if (articleInput.result.runId && hasActiveInvestigateArticleExecution(articleInput.result.articleId)) {
            clearInvestigateArticleExecution(articleInput.result.articleId);
          }
          await updateInvestigateBatch({
            id: batchId,
            status: "running",
            okCount: articleInput.okCount,
            errorCount: articleInput.errorCount,
            articleResults,
          });
        },
      });

      await updateInvestigateBatch({
        id: batchId,
        status: "completed",
        okCount: result.okCount,
        errorCount: result.errorCount,
        articleResults: articleResults,
        completed: true,
      });
    } catch (error) {
      await updateInvestigateBatch({
        id: batchId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        articleResults,
        completed: true,
      });
    } finally {
      clearInvestigateBatchExecution(abortController);
    }
  })();

  registerInvestigateBatchExecution({
    batchId,
    abortController,
    promise: batchPromise,
  });

  return Response.json({
    ok: true,
    accepted: true,
    ...(await buildBatchStatusPayload()),
  });
}

export async function DELETE() {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Statistical investigation reset requires DATABASE_URL.",
      },
      { status: 503 },
    );
  }

  const execution = getInvestigateBatchExecutionState();

  if (execution.promise) {
    return Response.json(
      {
        ok: false,
        error: "A statistical investigation batch is still running. Stop it before resetting state.",
      },
      { status: 409 },
    );
  }

  const summary = await clearInvestigateState();

  return Response.json({
    ok: true,
    batch: {
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
    },
    reset: {
      completedAt: new Date().toISOString(),
      summary,
    },
    activeRuns: [],
    runningArticleCount: 0,
    stageCounts: {},
  });
}

export async function PATCH() {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Statistical investigation requires DATABASE_URL for batch state.",
      },
      { status: 503 },
    );
  }

  stopAllInvestigateExecutions(STOPPED_PIPELINE_MESSAGE);

  const batch = await getLatestInvestigateBatch();

  if (batch?.status === "running") {
    await updateInvestigateBatch({
      id: batch.id,
      status: "failed",
      errorMessage: STOPPED_PIPELINE_MESSAGE,
      articleResults: batch.articleResults,
      completed: true,
    });
  }

  return Response.json({
    ok: true,
    message: "Pipeline stopped.",
    ...(await buildBatchStatusPayload()),
  });
}
