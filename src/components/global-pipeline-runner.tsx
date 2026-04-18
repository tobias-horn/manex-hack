"use client";

import { LoaderCircle, Play, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TeamCaseRunSummary } from "@/lib/manex-case-clustering-state";
import { formatUiDateTime } from "@/lib/ui-format";

type BatchStatus = {
  status: "idle" | "running" | "completed" | "failed";
  requestedArticleIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  concurrency: number | null;
  okCount: number;
  errorCount: number;
  errorMessage: string | null;
};

type StatusPayload = {
  ok: boolean;
  batch: BatchStatus;
  activeRuns: TeamCaseRunSummary[];
  runningArticleCount: number;
  stageCounts: Record<string, number>;
  error?: string;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type GlobalPipelineRunnerProps = {
  hasAi: boolean;
  initialActiveRuns: TeamCaseRunSummary[];
};

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

function formatStage(stage: string) {
  return stageLabels[stage] ?? stage.replaceAll("_", " ");
}

export function GlobalPipelineRunner({
  hasAi,
  initialActiveRuns,
}: GlobalPipelineRunnerProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [activeRuns, setActiveRuns] = useState(initialActiveRuns);
  const [batch, setBatch] = useState<BatchStatus>({
    status: initialActiveRuns.length ? "running" : "idle",
    requestedArticleIds: [],
    startedAt: null,
    completedAt: null,
    concurrency: null,
    okCount: 0,
    errorCount: 0,
    errorMessage: null,
  });

  const shouldPoll = batch.status === "running" || activeRuns.length > 0 || isSubmitting;

  async function refreshStatus() {
    const response = await fetch("/api/articles/cluster-all", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as StatusPayload;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Could not refresh pipeline status.");
    }

    setBatch(payload.batch);
    setActiveRuns(payload.activeRuns);
    return payload;
  }

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
    }, 3000);

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
      const response = await fetch("/api/articles/cluster-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = (await response.json()) as StatusPayload & { accepted?: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "The full pipeline could not be started.",
        });
        return;
      }

      setBatch(payload.batch);
      setActiveRuns(payload.activeRuns);
      setFeedback({
        tone: "success",
        text: "Complete pipeline started. The dashboard will keep polling live stage progress.",
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

  return (
    <div className="space-y-4 rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Complete pipeline</div>
          <div className="mt-2 text-lg font-semibold">Run every article end to end</div>
        </div>
        <div className="flex size-11 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
          <Workflow className="size-4.5" />
        </div>
      </div>

      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        Launch the full dataset pipeline from Global Intelligence. This triggers all
        article runs with bounded concurrency and keeps the dashboard updated with the
        current stage for every active article run.
      </p>

      <div className="flex flex-wrap gap-2">
        <Badge>{hasAi ? "GPT pipeline enabled" : "OpenAI key missing"}</Badge>
        <Badge variant="outline">{headline}</Badge>
        {batch.concurrency ? (
          <Badge variant="outline">Concurrency {batch.concurrency}</Badge>
        ) : null}
      </div>

      <Button
        size="lg"
        onClick={runCompletePipeline}
        disabled={isSubmitting || batch.status === "running" || !hasAi}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Starting complete pipeline
          </>
        ) : batch.status === "running" ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Complete pipeline running
          </>
        ) : (
          <>
            <Play className="size-4" />
            Run complete pipeline
          </>
        )}
      </Button>

      <div className="space-y-3">
        {activeRuns.length ? (
          activeRuns.map((run) => (
            <div
              key={run.id}
              className="rounded-[22px] border border-white/10 bg-black/8 px-4 py-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{run.articleId}</Badge>
                <Badge variant="outline">{formatStage(run.currentStage)}</Badge>
                <Badge variant="outline">{run.model}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                {run.stageDetail ?? "Pipeline stage is updating."}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Updated {formatUiDateTime(run.stageUpdatedAt ?? run.startedAt)}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-[22px] border border-dashed border-white/10 bg-black/8 px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
            {batch.status === "completed"
              ? `Last batch completed at ${
                  batch.completedAt ? formatUiDateTime(batch.completedAt) : "an unknown time"
                }.`
              : "No active article runs right now."}
          </div>
        )}
      </div>

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

      {batch.errorMessage ? (
        <div className="rounded-[22px] bg-[color:rgba(178,69,63,0.08)] px-4 py-3 text-sm text-[var(--destructive)]">
          {batch.errorMessage}
        </div>
      ) : null}
    </div>
  );
}
