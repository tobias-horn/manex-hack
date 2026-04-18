type BatchExecutionState = {
  batchId: string | null;
  abortController: AbortController | null;
  promise: Promise<void> | null;
};

type ArticleExecutionState = {
  articleId: string;
  abortController: AbortController;
  promise: Promise<void>;
  scope: "batch" | "single";
};

type ManexCaseClusteringRuntimeState = {
  batch: BatchExecutionState;
  articleExecutions: Map<string, ArticleExecutionState>;
};

declare global {
  var __manexCaseClusteringRuntimeState: ManexCaseClusteringRuntimeState | undefined;
}

function getRuntimeState(): ManexCaseClusteringRuntimeState {
  if (!globalThis.__manexCaseClusteringRuntimeState) {
    globalThis.__manexCaseClusteringRuntimeState = {
      batch: {
        batchId: null,
        abortController: null,
        promise: null,
      },
      articleExecutions: new Map<string, ArticleExecutionState>(),
    };
  }

  return globalThis.__manexCaseClusteringRuntimeState;
}

export function getBatchExecutionState() {
  return getRuntimeState().batch;
}

export function registerBatchExecution(input: {
  batchId: string;
  abortController: AbortController;
  promise: Promise<void>;
}) {
  const state = getRuntimeState();
  state.batch = {
    batchId: input.batchId,
    abortController: input.abortController,
    promise: input.promise,
  };
}

export function clearBatchExecution(abortController?: AbortController | null) {
  const state = getRuntimeState();

  if (
    abortController &&
    state.batch.abortController &&
    state.batch.abortController !== abortController
  ) {
    return;
  }

  state.batch = {
    batchId: null,
    abortController: null,
    promise: null,
  };
}

export function hasActiveArticleExecution(articleId: string) {
  return getRuntimeState().articleExecutions.has(articleId);
}

export function registerArticleExecution(input: ArticleExecutionState) {
  getRuntimeState().articleExecutions.set(input.articleId, input);
}

export function clearArticleExecution(articleId: string, abortController?: AbortController | null) {
  const current = getRuntimeState().articleExecutions.get(articleId);

  if (!current) {
    return;
  }

  if (abortController && current.abortController !== abortController) {
    return;
  }

  getRuntimeState().articleExecutions.delete(articleId);
}

export function stopAllClusteringExecutions(reason = "Pipeline stopped by user.") {
  const state = getRuntimeState();
  const stoppedArticleIds: string[] = [];

  if (state.batch.abortController && !state.batch.abortController.signal.aborted) {
    state.batch.abortController.abort(reason);
  }

  for (const [articleId, execution] of state.articleExecutions.entries()) {
    if (!execution.abortController.signal.aborted) {
      execution.abortController.abort(reason);
    }

    stoppedArticleIds.push(articleId);
  }

  return {
    batchId: state.batch.batchId,
    stoppedArticleIds,
  };
}
