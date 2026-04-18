"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TeamCaseRunSummary } from "@/lib/manex-case-clustering-state";

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

export function ArticleClusterRunner({
  articleId,
  hasAi,
  latestRun,
  proposedCaseCount,
}: ArticleClusterRunnerProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  async function runClustering() {
    setIsRunning(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/articles/${articleId}/cluster`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        caseCount?: number;
        runId?: string;
      };

      if (!response.ok || !payload.ok) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "The clustering run could not be completed.",
        });
        return;
      }

      setFeedback({
        tone: "success",
        text: `Clustering run finished with ${payload.caseCount ?? 0} proposed cases.`,
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "The clustering run failed unexpectedly.",
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-4 rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Two-pass clustering</div>
          <div className="mt-2 text-lg font-semibold">Persist proposed case groups</div>
        </div>
        <div className="flex size-11 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
          <Sparkles className="size-4.5" />
        </div>
      </div>

      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        This run builds deterministic product threads and article dossiers first, then
        asks the model to propose and refine case candidates. The results are stored
        as proposed clusters, not accepted conclusions.
      </p>

      <div className="flex flex-wrap gap-2">
        <Badge>{hasAi ? "GPT clustering enabled" : "OpenAI key missing"}</Badge>
        {latestRun ? <Badge variant="outline">{latestRun.model}</Badge> : null}
        <Badge variant="outline">{proposedCaseCount} proposed cases</Badge>
      </div>

      <Button
        size="lg"
        onClick={runClustering}
        disabled={isRunning || !hasAi}
        className="w-full"
      >
        {isRunning ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Running clustering
          </>
        ) : latestRun ? (
          "Refresh proposed cases"
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
