import { z } from "zod";

import { capabilities } from "@/lib/env";
import { ensureConfirmedCaseReport } from "@/lib/manex-confirmed-case-report";
import { qualityNotificationTeamIdSchema } from "@/lib/manex-confirmed-case-report-schema";
import { queueConfirmedCaseReportNotifications } from "@/lib/manex-confirmed-case-report-state";

export const runtime = "nodejs";

const pipelineModeSchema = z.enum([
  "current",
  "deterministic",
  "hypothesis",
  "investigate",
  "dummy",
]);

const createRequestSchema = z.object({
  pipelineMode: pipelineModeSchema,
  candidateTitle: z.string().trim().min(1).max(180).optional(),
  force: z.boolean().optional(),
});

const notificationRequestSchema = z.object({
  pipelineMode: pipelineModeSchema,
  selectedTeamIds: z
    .array(qualityNotificationTeamIdSchema)
    .min(1)
    .max(8),
});

type RouteContext = {
  params: Promise<{ articleId: string; candidateId: string }>;
};

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not prepare the confirmed case report.";
}

export async function POST(request: Request, context: RouteContext) {
  const parsed = createRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Provide a valid confirmed report request.",
      },
      { status: 400 },
    );
  }

  const { articleId, candidateId } = await context.params;

  try {
    const record = await ensureConfirmedCaseReport({
      articleId,
      candidateId,
      pipelineMode: parsed.data.pipelineMode,
      candidateTitle: parsed.data.candidateTitle ?? null,
      force: parsed.data.force ?? false,
    });

    return Response.json({
      ok: true,
      record,
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

export async function PATCH(request: Request, context: RouteContext) {
  if (!capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error:
          "Notification queueing requires DATABASE_URL because the selected team handoff is stored in app-owned Postgres tables.",
      },
      { status: 503 },
    );
  }

  const parsed = notificationRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Select at least one valid team before queuing notifications.",
      },
      { status: 400 },
    );
  }

  const { articleId, candidateId } = await context.params;

  try {
    await ensureConfirmedCaseReport({
      articleId,
      candidateId,
      pipelineMode: parsed.data.pipelineMode,
    });

    const record = await queueConfirmedCaseReportNotifications({
      articleId,
      candidateId,
      pipelineMode: parsed.data.pipelineMode,
      selectedTeamIds: parsed.data.selectedTeamIds,
      requestedBy: "forensic_lens",
    });

    return Response.json({
      ok: true,
      record,
      queued: true,
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
