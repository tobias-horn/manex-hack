import { z } from "zod";

import { addInvestigationNote } from "@/lib/manex-case-state";
import { capabilities } from "@/lib/env";

export const runtime = "nodejs";

const noteTypeSchema = z.enum(["note", "finding", "timeline", "decision"]);

const noteSchema = z.object({
  body: z.string().trim().min(3).max(2000),
  noteType: noteTypeSchema.optional(),
});

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not save the investigation note.";
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

  const parsed = noteSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Provide note text before saving.",
      },
      { status: 400 },
    );
  }

  const { caseId } = await context.params;

  try {
    const updatedCase = await addInvestigationNote({
      id: createId("NOTE"),
      caseId,
      body: parsed.data.body,
      noteType: parsed.data.noteType ?? "note",
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
