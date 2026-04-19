import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleHypothesisBoard } from "@/components/article-hypothesis-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildArticleHypothesisBoardViewModel,
  type ArticleHypothesisBoardCaseboard,
} from "@/lib/article-hypothesis-view";
import { listArticleHypothesisReviews } from "@/lib/article-hypothesis-review-state";
import { capabilities } from "@/lib/env";
import {
  buildEconomicBlastRadiusForCase,
  getArticleCaseboard,
  type EconomicBlastRadius,
} from "@/lib/manex-case-clustering";
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

async function buildEconomicBlastRadiusByHypothesisId(input: {
  caseboard: ArticleHypothesisBoardCaseboard;
  viewModel: ReturnType<typeof buildArticleHypothesisBoardViewModel>;
}) {
  const { dossier } = input.caseboard;

  if (!dossier) {
    return Object.fromEntries(
      input.viewModel.hypotheses.map((hypothesis) => [hypothesis.id, null]),
    ) as Record<string, EconomicBlastRadius | null>;
  }

  const entries = await Promise.all(
    input.viewModel.hypotheses.map(async (hypothesis) => [
      hypothesis.id,
      hypothesis.productIds.length
        ? await buildEconomicBlastRadiusForCase({
            threads: dossier.productThreads.filter((thread) =>
              hypothesis.productIds.includes(thread.productId),
            ),
          })
        : null,
    ] as const),
  );

  return Object.fromEntries(entries) as Record<string, EconomicBlastRadius | null>;
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
  const economicBlastRadiusByHypothesisId =
    await buildEconomicBlastRadiusByHypothesisId({
      caseboard,
      viewModel,
    });
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
        <header className="glass-panel ghost-border spec-grid overflow-hidden rounded-[30px] px-5 py-5 sm:px-6">
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
                Compare the top hypotheses for one article, then open proof when needed.
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
                    Back to cases
                  </Link>
                }
              />
              <Button size="lg" variant="outline" render={<Link href="/">Back to home</Link>} />
            </div>
          </div>
        </header>

        <ArticleHypothesisBoard
          mode={mode}
          viewModel={viewModel}
          economicBlastRadiusByHypothesisId={economicBlastRadiusByHypothesisId}
          hasPostgres={capabilities.hasPostgres}
        />
      </div>
    </main>
  );
}
