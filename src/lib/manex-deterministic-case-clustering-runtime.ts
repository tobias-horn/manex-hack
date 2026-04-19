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

type ManexDeterministicCaseClusteringRuntimeState = {
  batch: BatchExecutionState;
  articleExecutions: Map<string, ArticleExecutionState>;
};

declare global {
  var __manexDeterministicCaseClusteringRuntimeState:
    | ManexDeterministicCaseClusteringRuntimeState
    | undefined;
}

function getRuntimeState(): ManexDeterministicCaseClusteringRuntimeState {
  if (!globalThis.__manexDeterministicCaseClusteringRuntimeState) {
    globalThis.__manexDeterministicCaseClusteringRuntimeState = {
      batch: {
        batchId: null,
        abortController: null,
        promise: null,
      },
      articleExecutions: new Map<string, ArticleExecutionState>(),
    };
  }

  return globalThis.__manexDeterministicCaseClusteringRuntimeState;
}

export function getDeterministicBatchExecutionState() {
  return getRuntimeState().batch;
}

export function registerDeterministicBatchExecution(input: {
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

export function clearDeterministicBatchExecution(abortController?: AbortController | null) {
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

export function hasActiveDeterministicArticleExecution(articleId: string) {
  return getRuntimeState().articleExecutions.has(articleId);
}

export function registerDeterministicArticleExecution(input: ArticleExecutionState) {
  getRuntimeState().articleExecutions.set(input.articleId, input);
}

export function clearDeterministicArticleExecution(
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

export function stopAllDeterministicClusteringExecutions(
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
