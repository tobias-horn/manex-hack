import { z } from "zod";

import {
  upsertArticleHypothesisReview,
  type ArticleHypothesisReviewPipelineMode,
} from "@/lib/article-hypothesis-review-state";
import { capabilities } from "@/lib/env";

export const runtime = "nodejs";

const requestSchema = z.object({
  pipelineMode: z.enum([
    "current",
    "deterministic",
    "hypothesis",
    "investigate",
    "dummy",
  ] satisfies [ArticleHypothesisReviewPipelineMode, ...ArticleHypothesisReviewPipelineMode[]]),
  status: z.enum(["leading", "plausible", "weak", "ruled_out", "confirmed"]),
  candidateTitle: z.string().trim().min(1).max(180).optional(),
});

type RouteContext = {
  params: Promise<{ articleId: string; candidateId: string }>;
};

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not save the hypothesis review.";
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error:
          "Hypothesis review state requires DATABASE_URL because it is stored in app-owned Postgres tables.",
      },
      { status: 503 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Provide a valid hypothesis status update.",
      },
      { status: 400 },
    );
  }

  const { articleId, candidateId } = await context.params;

  try {
    const review = await upsertArticleHypothesisReview({
      id: createId("HREV"),
      articleId,
      candidateId,
      pipelineMode: parsed.data.pipelineMode,
      status: parsed.data.status,
      candidateTitle: parsed.data.candidateTitle ?? null,
      createdBy: "forensic_lens",
    });

    return Response.json({
      ok: true,
      review,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: formatError(error),
      },
      { status: 500 },
    );
  }
}
