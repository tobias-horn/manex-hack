import { capabilities } from "@/lib/env";
import { runDeterministicArticleCaseClustering } from "@/lib/manex-deterministic-case-clustering";
import { getLatestDeterministicCaseRun } from "@/lib/manex-deterministic-case-clustering-state";
import {
  clearDeterministicArticleExecution,
  hasActiveDeterministicArticleExecution,
  registerDeterministicArticleExecution,
} from "@/lib/manex-deterministic-case-clustering-runtime";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ articleId: string }>;
};

function extractInventoryCounts(
  latestRun: Awaited<ReturnType<typeof getLatestDeterministicCaseRun>>,
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
  const latestRun = await getLatestDeterministicCaseRun(articleId);
  const inventoryCounts = extractInventoryCounts(latestRun);

  return {
    articleId,
    isRunning:
      latestRun?.status === "building" || hasActiveDeterministicArticleExecution(articleId),
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
          "Deterministic case clustering requires DATABASE_URL for run and candidate persistence.",
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
          "Deterministic case clustering requires DATABASE_URL for run and candidate persistence.",
      },
      { status: 503 },
    );
  }

  if (!capabilities.hasAi) {
    return Response.json(
      {
        ok: false,
        error: "Set OPENAI_API_KEY before running deterministic case clustering.",
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
        await runDeterministicArticleCaseClustering(articleId, {
          abortSignal: abortController.signal,
        });
      } finally {
        clearDeterministicArticleExecution(articleId, abortController);
      }
    })();
    registerDeterministicArticleExecution({
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
            : "The deterministic clustering engine failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
