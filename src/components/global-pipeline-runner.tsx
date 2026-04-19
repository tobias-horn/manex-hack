"use client";

import { LoaderCircle, Play, Square, Trash2, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatUiDateTime } from "@/lib/ui-format";

type PipelineRunSummary = {
  id: string;
  articleId: string;
  articleName: string | null;
  model: string;
  status: "building" | "completed" | "failed";
  currentStage: string;
  stageDetail: string | null;
  stageUpdatedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  candidateCount: number;
  issueCount?: number;
};

type BatchArticleResult = {
  articleId: string;
  ok: boolean;
  runId: string | null;
  issueCount?: number;
  caseCount: number;
  validatedCount: number;
  watchlistCount: number;
  noiseCount: number;
  error: string | null;
  completedAt: string;
};

type BatchStatus = {
  status: "idle" | "running" | "completed" | "failed";
  requestedArticleIds: string[];
  totalArticleCount: number;
  startedAt: string | null;
  completedAt: string | null;
  lastUpdatedAt: string | null;
  concurrency: number | null;
  okCount: number;
  errorCount: number;
  errorMessage: string | null;
  articleResults: BatchArticleResult[];
};

type ResetSummary =
  | {
      productDossiers: number;
      articleDossiers: number;
      runs: number;
      candidates: number;
      candidateMembers: number;
    }
  | {
      runs: number;
      batches: number;
      candidates: number;
      candidateMembers: number;
    };

type ResetStatus = {
  completedAt: string | null;
  summary: ResetSummary | null;
};

type StatusPayload = {
  ok: boolean;
  batch: BatchStatus;
  reset: ResetStatus;
  activeRuns: PipelineRunSummary[];
  runningArticleCount: number;
  stageCounts: Record<string, number>;
  message?: string;
  error?: string;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type GlobalPipelineRunnerProps = {
  hasAi: boolean;
  initialActiveRuns: PipelineRunSummary[];
  routePath: string;
  pipelineLabel: string;
  pipelineDescription: string;
  startButtonLabel: string;
  supportsStop?: boolean;
};

const stageLabels: Record<string, string> = {
  queued: "Queued",
  stage1_loading: "Stage 1: loading",
  stage1_synthesis: "Stage 1: synthesis",
  stage1_issue_extraction: "Stage 1: issue extraction",
  stage2_draft: "Stage 2: draft clustering",
  stage2_review: "Stage 2: review",
  stage2_grouping: "Stage 2: grouping",
  stage2_persisting: "Stage 2: persisting",
  stage3_reconciliation: "Stage 3: reconciliation",
  completed: "Completed",
  failed: "Failed",
};
const STOPPED_PIPELINE_MESSAGE = "Pipeline stopped by user.";

function formatStage(stage: string) {
  return stageLabels[stage] ?? stage.replaceAll("_", " ");
}

function buildInitialStageCounts(activeRuns: PipelineRunSummary[]) {
  return activeRuns.reduce<Record<string, number>>((counts, run) => {
    counts[run.currentStage] = (counts[run.currentStage] ?? 0) + 1;
    return counts;
  }, {});
}

function buildResetSuccessText(summary: ResetSummary | null) {
  if (!summary) {
    return "Clustering state cleared.";
  }

  if ("productDossiers" in summary) {
    return `Clustering state cleared: ${summary.productDossiers} product dossiers, ${summary.articleDossiers} article dossiers, ${summary.runs} runs, and ${summary.candidates} proposed cases removed.`;
  }

  return `Clustering state cleared: ${summary.runs} runs, ${summary.batches} batches, ${summary.candidates} proposed cases, and ${summary.candidateMembers} memberships removed.`;
}

const actionButtonClass =
  "h-auto min-h-12 w-full justify-start px-4 py-3 text-left whitespace-normal";

export function GlobalPipelineRunner({
  hasAi,
  initialActiveRuns,
  routePath,
  pipelineLabel,
  pipelineDescription,
  startButtonLabel,
  supportsStop = false,
}: GlobalPipelineRunnerProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [activeRuns, setActiveRuns] = useState(initialActiveRuns);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>(
    buildInitialStageCounts(initialActiveRuns),
  );
  const [batch, setBatch] = useState<BatchStatus>({
    status: initialActiveRuns.length ? "running" : "idle",
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
  const [reset, setReset] = useState<ResetStatus>({
    completedAt: null,
    summary: null,
  });
  const batchRef = useRef(batch);

  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  const shouldPoll =
    batch.status === "running" ||
    activeRuns.length > 0 ||
    isSubmitting ||
    isStopping ||
    isResetting;

  const refreshStatus = useEffectEvent(async () => {
    const response = await fetch(routePath, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as StatusPayload;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Could not refresh pipeline status.");
    }

    const previousBatch = batchRef.current;

    if (previousBatch.status === "running" && payload.batch.status === "completed") {
      setFeedback({
        tone: "success",
        text: `${pipelineLabel} finished. ${payload.batch.okCount} article runs completed successfully.`,
      });
    } else if (previousBatch.status === "running" && payload.batch.status === "failed") {
      if (payload.batch.errorMessage === STOPPED_PIPELINE_MESSAGE) {
        setFeedback({
          tone: "success",
          text: "Pipeline stopped.",
        });
      } else {
        setFeedback({
          tone: "error",
          text:
            payload.batch.errorMessage ??
            "The complete pipeline finished with one or more failed article runs.",
        });
      }
    }

    setBatch(payload.batch);
    setReset(payload.reset);
    setActiveRuns(payload.activeRuns);
    setStageCounts(payload.stageCounts);
    return payload;
  });

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    let cancelled = false;
    const initialTimer = window.setTimeout(() => {
      void refreshStatus().catch(() => undefined);
    }, 0);
    const interval = window.setInterval(async () => {
      try {
        const payload = await refreshStatus();

        if (!cancelled && payload.batch.status !== "running" && payload.activeRuns.length === 0) {
          router.refresh();
        }
      } catch {
        // Ignore transient polling failures and keep the last visible state.
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [router, shouldPoll]);

  async function runCompletePipeline() {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(routePath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = (await response.json()) as StatusPayload & {
        accepted?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "The full pipeline could not be started.",
        });
        return;
      }

      setBatch(payload.batch);
      setReset(payload.reset);
      setActiveRuns(payload.activeRuns);
      setStageCounts(payload.stageCounts);
      setFeedback({
        tone: "success",
        text: `${pipelineLabel} started. The dashboard will keep polling live stage progress.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "The full pipeline could not be started.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resetClusteringState() {
    const confirmed = window.confirm(
      `Delete all persisted state for ${pipelineLabel.toLowerCase()}? This removes generated pipeline output, but leaves source hackathon data untouched.`,
    );

    if (!confirmed) {
      return;
    }

    setIsResetting(true);
    setFeedback(null);

    try {
      const response = await fetch(routePath, {
        method: "DELETE",
      });

      const payload = (await response.json()) as StatusPayload & {
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "Clustering state could not be reset.",
        });
        return;
      }

      setBatch(payload.batch);
      setReset(payload.reset);
      setActiveRuns(payload.activeRuns);
      setStageCounts(payload.stageCounts);
      setFeedback({
        tone: "success",
        text: buildResetSuccessText(payload.reset.summary),
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Clustering state could not be reset.",
      });
    } finally {
      setIsResetting(false);
    }
  }

  async function stopPipeline() {
    setIsStopping(true);
    setFeedback(null);

    try {
      const response = await fetch(routePath, {
        method: "PATCH",
      });

      const payload = (await response.json()) as StatusPayload;

      if (!response.ok || !payload.ok) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "The pipeline could not be stopped.",
        });
        return;
      }

      setBatch(payload.batch);
      setReset(payload.reset);
      setActiveRuns(payload.activeRuns);
      setStageCounts(payload.stageCounts);
      setFeedback({
        tone: "success",
        text: payload.message ?? "Pipeline stopped.",
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error ? error.message : "The pipeline could not be stopped.",
      });
    } finally {
      setIsStopping(false);
    }
  }

  const totalArticleCount = batch.totalArticleCount || batch.requestedArticleIds.length;
  const finishedArticleCount = batch.okCount + batch.errorCount;
  const queuedArticleCount = Math.max(
    0,
    totalArticleCount - activeRuns.length - finishedArticleCount,
  );
  const progressValue = totalArticleCount
    ? Math.round((finishedArticleCount / totalArticleCount) * 100)
    : 0;

  const headline = useMemo(() => {
    if (batch.status === "running" || activeRuns.length > 0) {
      return `${activeRuns.length} active article runs`;
    }

    if (batch.status === "completed") {
      return `Last batch finished with ${batch.okCount} successful article runs`;
    }

    if (batch.status === "failed") {
      return "Last batch finished with errors";
    }

    return "No full pipeline batch is running";
  }, [activeRuns.length, batch.okCount, batch.status]);

  const progressCaption = useMemo(() => {
    if (batch.status === "running" || activeRuns.length > 0) {
      if (totalArticleCount) {
        return `${finishedArticleCount} of ${totalArticleCount} articles have finished. The board keeps polling until the batch settles.`;
      }

      return "The board is polling for live article-level stage updates.";
    }

    if (batch.status === "completed") {
      return batch.completedAt
        ? `Last completed ${formatUiDateTime(batch.completedAt)}.`
        : "The last batch completed successfully.";
    }

    if (batch.status === "failed") {
      if (batch.errorMessage === STOPPED_PIPELINE_MESSAGE) {
        return "The most recent batch was stopped before it finished.";
      }

      return batch.errorMessage ?? "The most recent batch finished with one or more article failures.";
    }

    return "Start a new run to refresh the shared global inventory from the latest article outputs.";
  }, [
    activeRuns.length,
    batch.completedAt,
    batch.errorMessage,
    batch.status,
    finishedArticleCount,
    totalArticleCount,
  ]);

  return (
    <div className="surface-sheet ghost-border space-y-5 rounded-[32px] p-5 sm:p-6">
      <div className="rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="eyebrow">{pipelineLabel}</div>
            <div className="font-heading text-[1.9rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance">
              Run every article end to end
            </div>
            <p className="max-w-[32rem] text-sm leading-6 text-[var(--muted-foreground)]">
              {pipelineDescription}
            </p>
          </div>
          <div className="flex size-13 shrink-0 items-center justify-center rounded-[1.6rem] bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
            <Workflow className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{hasAi ? "GPT pipeline enabled" : "OpenAI key missing"}</Badge>
          <Badge variant="outline">{headline}</Badge>
          {totalArticleCount ? <Badge variant="outline">{totalArticleCount} articles</Badge> : null}
          {batch.concurrency ? (
            <Badge variant="outline">Concurrency {batch.concurrency}</Badge>
          ) : null}
        </div>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-black/8 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-base font-semibold">Batch progress</div>
            <p className="max-w-[30rem] text-sm leading-6 text-[var(--muted-foreground)]">
              {progressCaption}
            </p>
          </div>
          <div className="rounded-full bg-[color:rgba(0,92,151,0.08)] px-3 py-1 text-sm font-semibold text-[var(--primary)]">
            {progressValue}%
          </div>
        </div>
        <div className="mt-4">
          <Progress value={progressValue} />
        </div>

        <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
          <div className="rounded-[22px] border border-white/8 bg-[color:var(--surface-lowest)] px-4 py-4">
            <div className="eyebrow">Queued</div>
            <div className="mt-2 text-2xl font-semibold">{queuedArticleCount}</div>
          </div>
          <div className="rounded-[22px] border border-white/8 bg-[color:var(--surface-lowest)] px-4 py-4">
            <div className="eyebrow">Running</div>
            <div className="mt-2 text-2xl font-semibold">{activeRuns.length}</div>
          </div>
          <div className="rounded-[22px] border border-white/8 bg-[color:var(--surface-lowest)] px-4 py-4">
            <div className="eyebrow">Completed</div>
            <div className="mt-2 text-2xl font-semibold">{batch.okCount}</div>
          </div>
          <div className="rounded-[22px] border border-white/8 bg-[color:var(--surface-lowest)] px-4 py-4">
            <div className="eyebrow">Failed</div>
            <div className="mt-2 text-2xl font-semibold">{batch.errorCount}</div>
          </div>
        </div>

        {Object.entries(stageCounts).length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(stageCounts).map(([stage, count]) => (
              <Badge key={stage} variant="outline">
                {formatStage(stage)}: {count}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-5">
        <div className="space-y-1">
          <div className="eyebrow">Controls</div>
          <div className="text-base font-semibold">Start, stop, or clear generated pipeline state</div>
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            Stop halts the active batch gracefully. Reset removes only persisted pipeline artifacts and leaves the source hackathon data untouched.
          </p>
        </div>

        <Button
          size="lg"
          onClick={runCompletePipeline}
          disabled={
            isSubmitting ||
            isStopping ||
            isResetting ||
            batch.status === "running" ||
            !hasAi
          }
          className={`mt-4 ${actionButtonClass}`}
        >
          {isSubmitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Starting batch
            </>
          ) : batch.status === "running" ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Batch running
            </>
          ) : (
            <>
              <Play className="size-4" />
              {startButtonLabel}
            </>
          )}
        </Button>

        <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          {supportsStop ? (
            <Button
              size="lg"
              variant="outline"
              onClick={stopPipeline}
              disabled={
                isSubmitting ||
                isResetting ||
                isStopping ||
                (batch.status !== "running" && activeRuns.length === 0)
              }
              className={actionButtonClass}
            >
              {isStopping ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Stopping pipeline
                </>
              ) : (
                <>
                  <Square className="size-4" />
                  Stop pipeline
                </>
              )}
            </Button>
          ) : null}

          <Button
            size="lg"
            variant="destructive"
            onClick={resetClusteringState}
            disabled={
              isSubmitting ||
              isStopping ||
              isResetting ||
              batch.status === "running" ||
              activeRuns.length > 0
            }
            className={actionButtonClass}
          >
            {isResetting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Resetting clustering state
              </>
            ) : (
              <>
                <Trash2 className="size-4" />
                Reset clustering state
              </>
            )}
          </Button>
        </div>
      </div>

      {activeRuns.length ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Live article runs</div>
            <Badge variant="outline">{activeRuns.length} active</Badge>
          </div>
          {activeRuns.map((run) => (
            <div
              key={run.id}
              className="rounded-[22px] border border-white/10 bg-black/8 px-4 py-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{run.articleId}</Badge>
                <Badge variant="outline">{formatStage(run.currentStage)}</Badge>
                {run.issueCount ? (
                  <Badge variant="outline">{run.issueCount} issues</Badge>
                ) : null}
                <Badge variant="outline">{run.candidateCount} cases</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                {run.stageDetail ?? "Pipeline is running."}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Updated {formatUiDateTime(run.stageUpdatedAt ?? run.startedAt)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {batch.articleResults.length ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Recent article outcomes</div>
            <Badge variant="outline">{batch.articleResults.length} recorded</Badge>
          </div>
          {batch.articleResults.slice(0, 6).map((result) => (
            <div
              key={`${result.articleId}:${result.completedAt}`}
              className="rounded-[22px] border border-white/10 bg-black/8 px-4 py-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{result.articleId}</Badge>
                <Badge variant={result.ok ? "default" : "destructive"}>
                  {result.ok ? "Completed" : "Failed"}
                </Badge>
                {result.issueCount ? (
                  <Badge variant="outline">{result.issueCount} issues</Badge>
                ) : null}
                <Badge variant="outline">{result.caseCount} cases</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                {result.ok
                  ? `${result.validatedCount} validated, ${result.watchlistCount} watchlists, ${result.noiseCount} noise buckets.`
                  : (result.error ?? "This article run failed.")}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Completed {formatUiDateTime(result.completedAt)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {reset.completedAt ? (
        <div className="rounded-[22px] border border-white/10 bg-black/8 px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
          Last reset {formatUiDateTime(reset.completedAt)}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={
            feedback.tone === "success"
              ? "rounded-[22px] bg-[color:rgba(0,92,151,0.08)] px-4 py-3 text-sm text-[var(--primary)]"
              : "rounded-[22px] bg-[color:rgba(178,69,63,0.08)] px-4 py-3 text-sm text-[var(--destructive)]"
          }
        >
          {feedback.text}
        </div>
      ) : null}

      {batch.errorMessage && batch.errorMessage !== STOPPED_PIPELINE_MESSAGE ? (
        <div className="rounded-[22px] bg-[color:rgba(178,69,63,0.08)] px-4 py-3 text-sm text-[var(--destructive)]">
          {batch.errorMessage}
        </div>
      ) : null}
    </div>
  );
}
