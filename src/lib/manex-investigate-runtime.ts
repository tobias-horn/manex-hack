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

type ManexInvestigateRuntimeState = {
  batch: BatchExecutionState;
  articleExecutions: Map<string, ArticleExecutionState>;
};

declare global {
  var __manexInvestigateRuntimeState: ManexInvestigateRuntimeState | undefined;
}

function getRuntimeState(): ManexInvestigateRuntimeState {
  if (!globalThis.__manexInvestigateRuntimeState) {
    globalThis.__manexInvestigateRuntimeState = {
      batch: {
        batchId: null,
        abortController: null,
        promise: null,
      },
      articleExecutions: new Map<string, ArticleExecutionState>(),
    };
  }

  return globalThis.__manexInvestigateRuntimeState;
}

export function getInvestigateBatchExecutionState() {
  return getRuntimeState().batch;
}

export function registerInvestigateBatchExecution(input: {
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

export function clearInvestigateBatchExecution(abortController?: AbortController | null) {
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

export function hasActiveInvestigateArticleExecution(articleId: string) {
  return getRuntimeState().articleExecutions.has(articleId);
}

export function registerInvestigateArticleExecution(input: ArticleExecutionState) {
  getRuntimeState().articleExecutions.set(input.articleId, input);
}

export function clearInvestigateArticleExecution(
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

export function stopAllInvestigateExecutions(reason = "Pipeline stopped by user.") {
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
