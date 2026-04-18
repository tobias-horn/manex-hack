import { capabilities } from "@/lib/env";
import { runArticleCaseClusteringBatch } from "@/lib/manex-case-clustering";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type BatchRequestBody = {
  articleIds?: string[];
};

export async function POST(request: Request) {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Case clustering requires DATABASE_URL for dossier and candidate persistence.",
      },
      { status: 503 },
    );
  }

  if (!capabilities.hasAi) {
    return Response.json(
      {
        ok: false,
        error: "Set OPENAI_API_KEY before running article clustering.",
      },
      { status: 503 },
    );
  }

  let body: BatchRequestBody = {};

  try {
    body = (await request.json()) as BatchRequestBody;
  } catch {
    body = {};
  }

  const normalizedArticleIds =
    body.articleIds
      ?.map((articleId) => normalizeUiIdentifier(articleId))
      .filter((articleId): articleId is string => Boolean(articleId)) ?? [];

  try {
    const result = await runArticleCaseClusteringBatch(
      normalizedArticleIds.length ? normalizedArticleIds : undefined,
    );

    return Response.json({
      ok: result.errorCount === 0,
      articleCount: result.requestedArticleIds.length,
      concurrency: result.concurrency,
      okCount: result.okCount,
      errorCount: result.errorCount,
      results: result.results,
      latestGlobalRunId: result.latestGlobalRun?.id ?? null,
      validatedCount: result.globalInventory?.validatedCases.length ?? 0,
      watchlistCount: result.globalInventory?.watchlists.length ?? 0,
      noiseCount: result.globalInventory?.noiseBuckets.length ?? 0,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The batch clustering engine failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
