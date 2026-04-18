import { capabilities } from "@/lib/env";
import { runArticleCaseClustering } from "@/lib/manex-case-clustering";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ articleId: string }>;
};

export async function POST(_request: Request, { params }: RouteParams) {
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

  const { articleId: rawArticleId } = await params;
  const articleId = normalizeUiIdentifier(rawArticleId);

  if (!articleId) {
    return Response.json(
      {
        ok: false,
        error: "Provide a valid article identifier.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runArticleCaseClustering(articleId);

    return Response.json({
      ok: true,
      mode: "live",
      articleId: result.articleId,
      runId: result.latestRun?.id ?? null,
      caseCount: result.proposedCases.length,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The clustering engine failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
