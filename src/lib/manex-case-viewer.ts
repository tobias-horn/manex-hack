import { buildArticleHypothesisBoardViewModel, type ArticleHypothesisBoardCaseboard } from "@/lib/article-hypothesis-view";
import { listArticleHypothesisReviews } from "@/lib/article-hypothesis-review-state";
import { capabilities } from "@/lib/env";
import { getArticleCaseboard } from "@/lib/manex-case-clustering";
import { getDummyArticleCaseboard } from "@/lib/manex-dummy-clustering";
import type { ClusteringMode } from "@/lib/manex-clustering-mode";
import { getDeterministicArticleCaseboard } from "@/lib/manex-deterministic-case-clustering";
import { getHypothesisArticleCaseboard } from "@/lib/manex-hypothesis-case-clustering";
import { getInvestigateArticleCaseboard } from "@/lib/manex-investigate";

type CaseInventoryCandidate = {
  id: string;
  title: string;
  caseKind: string;
  summary: string;
  confidence: number | null;
  priority: string;
  strongestEvidence: string[];
  includedProductIds: string[];
  includedSignalIds: string[];
  updatedAt?: string;
};

export type CaseInventoryItem = {
  caseId: string;
  articleId: string;
  articleName: string | null;
  title: string;
  caseKind: string;
  summary: string;
  confidence: number | null;
  priority: string;
  strongestEvidence: string[];
  affectedProductCount: number;
  signalCount: number;
  articleProductCount: number;
  articleSignalCount: number;
  articleCaseCount: number;
  updatedAt: string | null;
};

function priorityWeight(priority: string) {
  if (priority === "critical") {
    return 4;
  }

  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}

export async function loadArticleCaseboard(
  articleId: string,
  mode: ClusteringMode,
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

export function buildCaseInventoryItems(
  caseboards: Array<ArticleHypothesisBoardCaseboard | null>,
): CaseInventoryItem[] {
  return caseboards
    .flatMap((caseboard) => {
      if (!caseboard) {
        return [];
      }

      return (caseboard.proposedCases as CaseInventoryCandidate[]).map((candidate) => ({
        caseId: candidate.id,
        articleId: caseboard.articleId,
        articleName: caseboard.articleName,
        title: candidate.title,
        caseKind: candidate.caseKind,
        summary: candidate.summary,
        confidence: candidate.confidence,
        priority: candidate.priority,
        strongestEvidence: candidate.strongestEvidence.slice(0, 4),
        affectedProductCount: candidate.includedProductIds.length,
        signalCount: candidate.includedSignalIds.length,
        articleProductCount: caseboard.dashboardCard?.productCount ?? caseboard.dossier?.article.productCount ?? 0,
        articleSignalCount: caseboard.dashboardCard?.totalSignals ?? caseboard.dossier?.article.totalSignals ?? 0,
        articleCaseCount: caseboard.proposedCases.length,
        updatedAt: candidate.updatedAt ?? caseboard.latestRun?.completedAt ?? null,
      }));
    })
    .sort((left, right) => {
      const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);

      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.title.localeCompare(right.title);
    });
}

export async function loadCaseViewerData(input: {
  articleId: string;
  caseId: string;
  mode: ClusteringMode;
}) {
  const caseboard = await loadArticleCaseboard(input.articleId, input.mode);

  if (!caseboard) {
    return null;
  }

  const hasCandidate = caseboard.proposedCases.some((candidate) => candidate.id === input.caseId);

  if (!hasCandidate) {
    return null;
  }

  const reviews = capabilities.hasPostgres
    ? await listArticleHypothesisReviews(caseboard.articleId, input.mode)
    : [];
  const viewModel = buildArticleHypothesisBoardViewModel({
    caseboard,
    mode: input.mode,
    initialSelectedId: input.caseId,
    reviews,
  });
  const selectedCase =
    viewModel.hypotheses.find((hypothesis) => hypothesis.id === input.caseId) ?? null;

  if (!selectedCase) {
    return null;
  }

  return {
    caseboard,
    viewModel,
    selectedCase,
    hasPostgres: capabilities.hasPostgres,
  };
}
