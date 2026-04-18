"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TeamCaseRunSummary } from "@/lib/manex-case-clustering-state";
import { formatUiDateTime } from "@/lib/ui-format";

type ArticleClusterRunnerProps = {
  articleId: string;
  hasAi: boolean;
  latestRun: TeamCaseRunSummary | null;
  proposedCaseCount: number;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type StatusPayload = {
  ok?: boolean;
  accepted?: boolean;
  articleId: string;
  isRunning: boolean;
  latestRun: TeamCaseRunSummary | null;
  runId: string | null;
  caseCount: number;
  validatedCount: number;
  watchlistCount: number;
  noiseCount: number;
  error?: string;
};

type RunnerStatus = Omit<StatusPayload, "ok" | "error">;

const stageLabels: Record<string, string> = {
  queued: "Queued",
  stage1_loading: "Stage 1: loading",
  stage1_synthesis: "Stage 1: synthesis",
  stage2_draft: "Stage 2: draft clustering",
  stage2_review: "Stage 2: review",
  stage2_persisting: "Stage 2: persisting",
  stage3_reconciliation: "Stage 3: reconciliation",
  completed: "Completed",
  failed: "Failed",
};

const stageProgress: Record<string, number> = {
  queued: 4,
  stage1_loading: 12,
  stage1_synthesis: 30,
  stage2_draft: 56,
  stage2_review: 74,
  stage2_persisting: 88,
  stage3_reconciliation: 96,
  completed: 100,
  failed: 100,
};

function formatStage(stage: string | null | undefined) {
  if (!stage) {
    return "Queued";
  }

  return stageLabels[stage] ?? stage.replaceAll("_", " ");
}

function getProgress(stage: string | null | undefined) {
  if (!stage) {
    return stageProgress.queued;
  }

  return stageProgress[stage] ?? stageProgress.queued;
}

function extractInventoryCounts(latestRun: TeamCaseRunSummary | null) {
  const reviewPayload =
    latestRun?.reviewPayload && typeof latestRun.reviewPayload === "object"
      ? (latestRun.reviewPayload as {
          stage3?: {
            validatedCases?: unknown[];
            watchlists?: unknown[];
            noiseBuckets?: unknown[];
          };
        })
      : null;

  return {
    validatedCount: Array.isArray(reviewPayload?.stage3?.validatedCases)
      ? reviewPayload.stage3.validatedCases.length
      : 0,
    watchlistCount: Array.isArray(reviewPayload?.stage3?.watchlists)
      ? reviewPayload.stage3.watchlists.length
      : 0,
    noiseCount: Array.isArray(reviewPayload?.stage3?.noiseBuckets)
      ? reviewPayload.stage3.noiseBuckets.length
      : 0,
  };
}

function buildInitialStatus(
  articleId: string,
  latestRun: TeamCaseRunSummary | null,
  proposedCaseCount: number,
): RunnerStatus {
  const inventoryCounts = extractInventoryCounts(latestRun);

  return {
    accepted: false,
    articleId,
    isRunning: latestRun?.status === "building",
    latestRun,
    runId: latestRun?.id ?? null,
    caseCount: latestRun?.candidateCount ?? proposedCaseCount,
    ...inventoryCounts,
  };
}

function mapPayloadToStatus(payload: StatusPayload): RunnerStatus {
  return {
    accepted: Boolean(payload.accepted),
    articleId: payload.articleId,
    isRunning: payload.isRunning,
    latestRun: payload.latestRun,
    runId: payload.runId,
    caseCount: payload.caseCount,
    validatedCount: payload.validatedCount,
    watchlistCount: payload.watchlistCount,
    noiseCount: payload.noiseCount,
  };
}

export function ArticleClusterRunner({
  articleId,
  hasAi,
  latestRun,
  proposedCaseCount,
}: ArticleClusterRunnerProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [status, setStatus] = useState<RunnerStatus>(() =>
    buildInitialStatus(articleId, latestRun, proposedCaseCount),
  );
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refreshStatus = useEffectEvent(async () => {
    const response = await fetch(`/api/articles/${articleId}/cluster`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as StatusPayload;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "The clustering status could not be refreshed.");
    }

    const nextStatus = mapPayloadToStatus(payload);
    const previousStatus = statusRef.current;

    if (previousStatus.isRunning && !nextStatus.isRunning) {
      if (nextStatus.latestRun?.status === "completed") {
        setFeedback({
          tone: "success",
          text: `Pipeline finished with ${nextStatus.caseCount} proposed cases, ${nextStatus.validatedCount} validated cases, ${nextStatus.watchlistCount} watchlists, and ${nextStatus.noiseCount} noise buckets.`,
        });
      } else if (nextStatus.latestRun?.status === "failed") {
        setFeedback({
          tone: "error",
          text:
            nextStatus.latestRun.errorMessage ??
            "The clustering run failed unexpectedly.",
        });
      }

      router.refresh();
    }

    setStatus(nextStatus);
    return nextStatus;
  });

  useEffect(() => {
    if (!status.isRunning && !isSubmitting) {
      return;
    }

    const initialTimer = window.setTimeout(() => {
      void refreshStatus().catch(() => undefined);
    }, 0);
    const interval = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
    }, 1500);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [articleId, isSubmitting, status.isRunning]);

  async function runClustering() {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/articles/${articleId}/cluster`, {
        method: "POST",
      });
      const payload = (await response.json()) as StatusPayload;

      if (!response.ok || !payload.ok) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "The clustering run could not be started.",
        });
        return;
      }

      const nextStatus = mapPayloadToStatus(payload);

      setStatus({
        ...nextStatus,
        isRunning: payload.accepted ? true : nextStatus.isRunning,
      });
      setFeedback({
        tone: "success",
        text: payload.accepted
          ? "Article pipeline started. This card will keep polling live stage progress."
          : "This article already has an active clustering run. Live status is shown below.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "The clustering run failed unexpectedly.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const run = status.latestRun;
  const progress = getProgress(run?.currentStage);

  return (
    <div className="space-y-4 rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Three-stage clustering</div>
          <div className="mt-2 text-lg font-semibold">Persist proposed case groups</div>
        </div>
        <div className="flex size-11 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
          <Sparkles className="size-4.5" />
        </div>
      </div>

      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        Stage 1 builds deterministic product and article dossiers, Stage 2 drafts and
        reviews article-local cases, and Stage 3 reconciles the article against the
        latest global inventory. The output stays investigative and proposed.
      </p>

      <div className="flex flex-wrap gap-2">
        <Badge>{hasAi ? "GPT clustering enabled" : "OpenAI key missing"}</Badge>
        {run ? <Badge variant="outline">{run.model}</Badge> : null}
        {run ? <Badge variant="outline">{run.strategy}</Badge> : null}
        <Badge variant="outline">{status.caseCount || proposedCaseCount} proposed cases</Badge>
      </div>

      <div className="rounded-[22px] border border-white/10 bg-black/8 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{formatStage(run?.currentStage)}</Badge>
          <Badge variant="outline">{progress}%</Badge>
          {run?.status === "failed" ? (
            <Badge variant="outline">Needs attention</Badge>
          ) : null}
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Pipeline progress</span>
            <span className="text-[var(--muted-foreground)]">{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>

        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          {run?.stageDetail ??
            (status.isRunning
              ? "Preparing the article pipeline."
              : "No live run is active for this article right now.")}
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
          Updated {formatUiDateTime(run?.stageUpdatedAt ?? run?.startedAt ?? new Date().toISOString())}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[22px] bg-black/8 px-4 py-4">
          <div className="eyebrow">Proposed</div>
          <div className="mt-2 text-2xl font-semibold">{status.caseCount || proposedCaseCount}</div>
        </div>
        <div className="rounded-[22px] bg-black/8 px-4 py-4">
          <div className="eyebrow">Validated</div>
          <div className="mt-2 text-2xl font-semibold">{status.validatedCount}</div>
        </div>
        <div className="rounded-[22px] bg-black/8 px-4 py-4">
          <div className="eyebrow">Watchlists</div>
          <div className="mt-2 text-2xl font-semibold">{status.watchlistCount}</div>
        </div>
        <div className="rounded-[22px] bg-black/8 px-4 py-4">
          <div className="eyebrow">Noise</div>
          <div className="mt-2 text-2xl font-semibold">{status.noiseCount}</div>
        </div>
      </div>

      <Button
        size="lg"
        onClick={runClustering}
        disabled={isSubmitting || status.isRunning || !hasAi}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Starting clustering
          </>
        ) : status.isRunning ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Clustering in progress
          </>
        ) : latestRun ? (
          "Refresh article clustering"
        ) : (
          "Run article clustering"
        )}
      </Button>

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
    </div>
  );
}
