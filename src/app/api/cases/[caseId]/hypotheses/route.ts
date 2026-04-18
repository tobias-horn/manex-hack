import { z } from "zod";

import { addCaseHypothesis } from "@/lib/manex-case-state";
import { capabilities } from "@/lib/env";

export const runtime = "nodejs";

const hypothesisStatusSchema = z.enum([
  "open",
  "supported",
  "rejected",
  "needs_data",
]);

const hypothesisSchema = z.object({
  statement: z.string().trim().min(6).max(1000),
  status: hypothesisStatusSchema.optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not save the hypothesis.";
};

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error:
          "Custom case-state tables require DATABASE_URL because they are created and managed in Postgres.",
      },
      { status: 503 },
    );
  }

  const parsed = hypothesisSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Provide a hypothesis statement before saving.",
      },
      { status: 400 },
    );
  }

  const { caseId } = await context.params;

  try {
    const updatedCase = await addCaseHypothesis({
      id: createId("HYP"),
      caseId,
      statement: parsed.data.statement,
      status: parsed.data.status ?? "open",
      confidence: parsed.data.confidence ?? null,
      createdBy: "forensic_lens",
    });

    return Response.json({
      ok: true,
      mode: "live",
      case: updatedCase,
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
