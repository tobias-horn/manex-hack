import { z } from "zod";

import { performInvestigateAnalysis, MANEX_INVESTIGATE_PROMPT_VERSION } from "@/lib/manex-investigate";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    articleId: z.string().trim().min(1).optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    const parsed = request.headers.get("content-length")
      ? requestSchema.parse(await request.json())
      : undefined;

    const analysis = await performInvestigateAnalysis({
      articleId: parsed?.articleId,
    });

    return Response.json(analysis.result, {
      headers: {
        "x-manex-investigate-prompt-version": MANEX_INVESTIGATE_PROMPT_VERSION,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The investigation route failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
