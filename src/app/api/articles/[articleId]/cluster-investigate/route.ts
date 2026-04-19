import { capabilities } from "@/lib/env";
import { runInvestigateArticleCaseClustering } from "@/lib/manex-investigate";
import { clearInvestigateArticleExecution, hasActiveInvestigateArticleExecution, registerInvestigateArticleExecution } from "@/lib/manex-investigate-runtime";
import { getLatestInvestigateRun } from "@/lib/manex-investigate-state";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ articleId: string }>;
};

function extractInventoryCounts(
  latestRun: Awaited<ReturnType<typeof getLatestInvestigateRun>>,
) {
  const reviewPayload =
    latestRun?.reviewPayload && typeof latestRun.reviewPayload === "object"
      ? (latestRun.reviewPayload as {
          result?: {
            stories?: unknown[];
            near_miss_warnings?: unknown[];
            noise_and_distractors?: unknown[];
          };
        })
      : null;

  return {
    validatedCount: Array.isArray(reviewPayload?.result?.stories)
      ? reviewPayload.result.stories.length
      : 0,
    watchlistCount: Array.isArray(reviewPayload?.result?.near_miss_warnings)
      ? reviewPayload.result.near_miss_warnings.length
      : 0,
    noiseCount: Array.isArray(reviewPayload?.result?.noise_and_distractors)
      ? reviewPayload.result.noise_and_distractors.length
      : 0,
  };
}

async function buildArticleStatusPayload(articleId: string) {
  const latestRun = await getLatestInvestigateRun(articleId);
  const inventoryCounts = extractInventoryCounts(latestRun);

  return {
    articleId,
    isRunning:
      latestRun?.status === "building" || hasActiveInvestigateArticleExecution(articleId),
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
        error: "Statistical investigation requires DATABASE_URL for run persistence.",
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
        error: "Statistical investigation requires DATABASE_URL for run persistence.",
      },
      { status: 503 },
    );
  }

  if (!capabilities.hasAi) {
    return Response.json(
      {
        ok: false,
        error: "Set OPENAI_API_KEY before running statistical investigation.",
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
        await runInvestigateArticleCaseClustering(articleId, {
          abortSignal: abortController.signal,
        });
      } finally {
        clearInvestigateArticleExecution(articleId, abortController);
      }
    })();
    registerInvestigateArticleExecution({
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
            : "The statistical investigation failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
