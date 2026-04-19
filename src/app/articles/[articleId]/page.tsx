import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleHypothesisBoard } from "@/components/article-hypothesis-board";
import { ClusteringPipelineToggle } from "@/components/clustering-pipeline-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildArticleHypothesisBoardViewModel,
  type ArticleHypothesisBoardCaseboard,
} from "@/lib/article-hypothesis-view";
import { listArticleHypothesisReviews } from "@/lib/article-hypothesis-review-state";
import { capabilities } from "@/lib/env";
import { getArticleCaseboard } from "@/lib/manex-case-clustering";
import { getDummyArticleCaseboard } from "@/lib/manex-dummy-clustering";
import {
  buildClusteringModeHref,
  parseClusteringMode,
} from "@/lib/manex-clustering-mode";
import { getDeterministicArticleCaseboard } from "@/lib/manex-deterministic-case-clustering";
import { getHypothesisArticleCaseboard } from "@/lib/manex-hypothesis-case-clustering";
import { getInvestigateArticleCaseboard } from "@/lib/manex-investigate";

export const dynamic = "force-dynamic";

type ArticleCaseboardPageProps = {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function loadCaseboard(
  articleId: string,
  mode: ReturnType<typeof parseClusteringMode>,
): Promise<ArticleHypothesisBoardCaseboard | null> {
  if (mode === "dummy") {
    return getDummyArticleCaseboard(articleId);
  }

  if (mode === "deterministic") {
    return getDeterministicArticleCaseboard(articleId);
  }

  if (mode === "hypothesis") {
    return getHypothesisArticleCaseboard(articleId);
  }

  if (mode === "investigate") {
    return getInvestigateArticleCaseboard(articleId);
  }

  return getArticleCaseboard(articleId);
}

export default async function ArticleCaseboardPage({
  params,
  searchParams,
}: ArticleCaseboardPageProps) {
  const { articleId } = await params;
  const search = await searchParams;
  const selectedCaseId = normalizeQueryValue(search.case) ?? null;
  const mode = parseClusteringMode(search.pipeline);
  const caseboard = await loadCaseboard(articleId, mode);

  if (!caseboard) {
    notFound();
  }

  const reviews = capabilities.hasPostgres
    ? await listArticleHypothesisReviews(caseboard.articleId, mode)
    : [];
  const viewModel = buildArticleHypothesisBoardViewModel({
    caseboard,
    mode,
    initialSelectedId: selectedCaseId,
    reviews,
  });

  const toggleItems = [
    {
      mode: "current" as const,
      label: "Classic three-layer clustering",
      description: "Original dossier, article-case, and global reconciliation flow.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "current"),
    },
    {
      mode: "deterministic" as const,
      label: "Deterministic issue grouping",
      description: "Small per-product issue extraction with deterministic article grouping.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "deterministic"),
    },
    {
      mode: "hypothesis" as const,
      label: "Case hypothesis engine",
      description:
        "Mechanism-family analyzers rank supplier, process, design, handling, and noise investigations before AI writes the case narrative.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "hypothesis"),
    },
    {
      mode: "investigate" as const,
      label: "Statistical anomaly RCA",
      description:
        "Direct SQL sweeps plus OpenAI root-cause narration without the clustered case pipeline.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "investigate"),
    },
    {
      mode: "dummy" as const,
      label: "Seeded dummy run",
      description:
        "Read-only completed run populated with the four published challenge stories so UI work can continue immediately.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "dummy"),
    },
  ];

  const pipelineLabel =
    mode === "deterministic"
      ? "Deterministic issue-grouping pipeline"
      : mode === "hypothesis"
        ? "Case hypothesis engine"
        : mode === "investigate"
          ? "Statistical anomaly RCA"
          : mode === "dummy"
            ? "Seeded challenge dummy mode"
            : "Classic three-layer pipeline";

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Article intelligence
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                {caseboard.articleId}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                Open one article, compare the top competing hypotheses, then dive into proof only when you need it.
              </p>
              <div className="flex flex-wrap gap-2">
                {caseboard.articleName ? <Badge variant="outline">{caseboard.articleName}</Badge> : null}
                <Badge variant="outline">{pipelineLabel}</Badge>
                {caseboard.dashboardCard ? (
                  <Badge variant="outline">
                    {caseboard.dashboardCard.productCount} products · {caseboard.dashboardCard.totalSignals} signals
                  </Badge>
                ) : null}
                <Badge variant="outline">
                  {caseboard.proposedCases.length} ranked hypotheses
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                variant="outline"
                render={
                  <Link href={buildClusteringModeHref("/articles", mode)}>
                    <ArrowLeft className="size-4" />
                    Back to proposed cases
                  </Link>
                }
              />
              <Button size="lg" variant="outline" render={<Link href="/">Back to inbox</Link>} />
            </div>
          </div>
        </header>

        <ClusteringPipelineToggle currentMode={mode} items={toggleItems} />

        <ArticleHypothesisBoard
          mode={mode}
          viewModel={viewModel}
          hasPostgres={capabilities.hasPostgres}
        />
      </div>
    </main>
  );
}
