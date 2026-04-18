import { capabilities } from "@/lib/env";
import { runArticleCaseClustering } from "@/lib/manex-case-clustering";
import { getLatestTeamCaseRun } from "@/lib/manex-case-clustering-state";
import {
  clearArticleExecution,
  hasActiveArticleExecution,
  registerArticleExecution,
} from "@/lib/manex-case-clustering-runtime";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ articleId: string }>;
};

function extractInventoryCounts(latestRun: Awaited<ReturnType<typeof getLatestTeamCaseRun>>) {
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

async function buildArticleStatusPayload(articleId: string) {
  const latestRun = await getLatestTeamCaseRun(articleId);
  const inventoryCounts = extractInventoryCounts(latestRun);

  return {
    articleId,
    isRunning: latestRun?.status === "building" || hasActiveArticleExecution(articleId),
    latestRun,
    runId: latestRun?.id ?? null,
    caseCount: latestRun?.candidateCount ?? 0,
    ...inventoryCounts,
  };
}

async function normalizeArticleId(params: RouteParams["params"]) {
  const { articleId: rawArticleId } = await params;
  return normalizeUiIdentifier(rawArticleId);
}

export async function GET(_request: Request, { params }: RouteParams) {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Case clustering requires DATABASE_URL for dossier and candidate persistence.",
      },
      { status: 503 },
    );
  }

  const articleId = await normalizeArticleId(params);

  if (!articleId) {
    return Response.json(
      {
        ok: false,
        error: "Provide a valid article identifier.",
      },
      { status: 400 },
    );
  }

  return Response.json({
    ok: true,
    ...(await buildArticleStatusPayload(articleId)),
  });
}

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

  const articleId = await normalizeArticleId(params);

  if (!articleId) {
    return Response.json(
      {
        ok: false,
        error: "Provide a valid article identifier.",
      },
      { status: 400 },
    );
  }

  const existingStatus = await buildArticleStatusPayload(articleId);

  if (existingStatus.isRunning) {
    return Response.json({
      ok: true,
      accepted: false,
      ...existingStatus,
    });
  }

  try {
    const abortController = new AbortController();
    const activePromise = (async () => {
      try {
        await runArticleCaseClustering(articleId, {
          abortSignal: abortController.signal,
        });
      } finally {
        clearArticleExecution(articleId, abortController);
      }
    })();
    registerArticleExecution({
      articleId,
      abortController,
      promise: activePromise,
      scope: "single",
    });

    return Response.json({
      ok: true,
      ...(await buildArticleStatusPayload(articleId)),
      accepted: true,
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
