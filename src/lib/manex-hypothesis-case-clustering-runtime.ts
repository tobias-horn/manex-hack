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

type ManexHypothesisCaseClusteringRuntimeState = {
  batch: BatchExecutionState;
  articleExecutions: Map<string, ArticleExecutionState>;
};

declare global {
  var __manexHypothesisCaseClusteringRuntimeState:
    | ManexHypothesisCaseClusteringRuntimeState
    | undefined;
}

function getRuntimeState(): ManexHypothesisCaseClusteringRuntimeState {
  if (!globalThis.__manexHypothesisCaseClusteringRuntimeState) {
    globalThis.__manexHypothesisCaseClusteringRuntimeState = {
      batch: {
        batchId: null,
        abortController: null,
        promise: null,
      },
      articleExecutions: new Map<string, ArticleExecutionState>(),
    };
  }

  return globalThis.__manexHypothesisCaseClusteringRuntimeState;
}

export function getHypothesisBatchExecutionState() {
  return getRuntimeState().batch;
}

export function registerHypothesisBatchExecution(input: {
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

export function clearHypothesisBatchExecution(abortController?: AbortController | null) {
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

export function hasActiveHypothesisArticleExecution(articleId: string) {
  return getRuntimeState().articleExecutions.has(articleId);
}

export function registerHypothesisArticleExecution(input: ArticleExecutionState) {
  getRuntimeState().articleExecutions.set(input.articleId, input);
}

export function clearHypothesisArticleExecution(
  articleId: string,
  abortController?: AbortController | null,
) {
  const current = getRuntimeState().articleExecutions.get(articleId);

  if (!current) {
    return;
  }

  if (abortController && current.abortController !== abortController) {
    return;
  }

  getRuntimeState().articleExecutions.delete(articleId);
}

export function stopAllHypothesisClusteringExecutions(
  reason = "Pipeline stopped by user.",
) {
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
