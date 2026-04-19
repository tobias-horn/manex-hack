import { capabilities } from "@/lib/env";
import { runHypothesisArticleCaseClustering } from "@/lib/manex-hypothesis-case-clustering";
import { getLatestHypothesisCaseRun } from "@/lib/manex-hypothesis-case-clustering-state";
import {
  clearHypothesisArticleExecution,
  hasActiveHypothesisArticleExecution,
  registerHypothesisArticleExecution,
} from "@/lib/manex-hypothesis-case-clustering-runtime";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ articleId: string }>;
};

function extractInventoryCounts(
  latestRun: Awaited<ReturnType<typeof getLatestHypothesisCaseRun>>,
) {
  const reviewPayload =
    latestRun?.reviewPayload && typeof latestRun.reviewPayload === "object"
      ? (latestRun.reviewPayload as {
          globalInventory?: {
            validatedCases?: unknown[];
            watchlists?: unknown[];
            noiseBuckets?: unknown[];
          };
        })
      : null;

  return {
    validatedCount: Array.isArray(reviewPayload?.globalInventory?.validatedCases)
      ? reviewPayload.globalInventory.validatedCases.length
      : 0,
    watchlistCount: Array.isArray(reviewPayload?.globalInventory?.watchlists)
      ? reviewPayload.globalInventory.watchlists.length
      : 0,
    noiseCount: Array.isArray(reviewPayload?.globalInventory?.noiseBuckets)
      ? reviewPayload.globalInventory.noiseBuckets.length
      : 0,
  };
}

async function buildArticleStatusPayload(articleId: string) {
  const latestRun = await getLatestHypothesisCaseRun(articleId);
  const inventoryCounts = extractInventoryCounts(latestRun);

  return {
    articleId,
    isRunning:
      latestRun?.status === "building" || hasActiveHypothesisArticleExecution(articleId),
    latestRun,
    runId: latestRun?.id ?? null,
    caseCount: latestRun?.candidateCount ?? 0,
    issueCount: latestRun?.issueCount ?? 0,
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
        error:
          "Hypothesis case clustering requires DATABASE_URL for run and candidate persistence.",
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
        error:
          "Hypothesis case clustering requires DATABASE_URL for run and candidate persistence.",
      },
      { status: 503 },
    );
  }

  if (!capabilities.hasAi) {
    return Response.json(
      {
        ok: false,
        error: "Set OPENAI_API_KEY before running hypothesis case clustering.",
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
        await runHypothesisArticleCaseClustering(articleId, {
          abortSignal: abortController.signal,
        });
      } finally {
        clearHypothesisArticleExecution(articleId, abortController);
      }
    })();
    registerHypothesisArticleExecution({
      articleId,
      abortController,
      promise: activePromise,
      scope: "single",
    });

    return Response.json({
      ok: true,
      accepted: true,
      ...(await buildArticleStatusPayload(articleId)),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The hypothesis clustering engine failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
