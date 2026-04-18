import { format } from "date-fns";
import { z } from "zod";

import { capabilities } from "@/lib/env";
import { createManexDataAccess } from "@/lib/manex-data-access";
import type { Initiative } from "@/lib/quality-workspace";

export const runtime = "nodejs";

const actionStatusSchema = z.enum(["open", "in_progress", "blocked", "done"]);

const actionSchema = z.object({
  productId: z.string().trim().min(1),
  defectId: z.string().trim().optional(),
  actionType: z.string().trim().min(1),
  status: actionStatusSchema,
  comments: z.string().trim().min(1).max(1000),
});

const actionUpdateSchema = z.object({
  actionId: z.string().trim().min(1),
  status: actionStatusSchema,
  comments: z.string().trim().max(1000).optional(),
});

const nextActionId = () =>
  `PA-${Math.floor(Date.now() % 100_000)
    .toString()
    .padStart(5, "0")}`;

const formatAction = (action: {
  action_id: string;
  product_id: string;
  defect_id: string | null;
  action_type: string;
  status: string;
  comments: string | null;
  ts: string;
}): Initiative => ({
  id: action.action_id,
  productId: action.product_id,
  defectId: action.defect_id,
  actionType: action.action_type,
  status: action.status,
  comments: action.comments ?? "No notes attached.",
  timestamp: format(new Date(action.ts), "dd MMM yyyy, HH:mm"),
});

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Please provide productId, actionType, status, and comments.",
      },
      { status: 400 },
    );
  }

  const data = createManexDataAccess();
  const actionId = nextActionId();
  const timestamp = new Date().toISOString();

  if (!capabilities.hasRest && !capabilities.hasPostgres) {
    return Response.json({
      ok: true,
      mode: "demo",
      action: formatAction({
        action_id: actionId,
        product_id: parsed.data.productId,
        defect_id: parsed.data.defectId || null,
        action_type: parsed.data.actionType,
        status: parsed.data.status,
        comments: parsed.data.comments,
        ts: timestamp,
      }),
    });
  }

  try {
    const result = await data.workflow.recordAction({
      id: actionId,
      productId: parsed.data.productId,
      recordedAt: timestamp,
      actionType: parsed.data.actionType,
      status: parsed.data.status,
      userId: "forensic_lens",
      defectId: parsed.data.defectId || null,
      comments: parsed.data.comments,
    });

    return Response.json({
      ok: true,
      mode: "live",
      action: formatAction({
        action_id: result.row.id,
        product_id: result.row.productId,
        defect_id: result.row.defectId,
        action_type: result.row.actionType,
        status: result.row.status,
        comments: result.row.comments,
        ts: result.row.recordedAt,
      }),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Workflow write failed. Check your REST or Postgres credentials.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const parsed = actionUpdateSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Please provide actionId and a valid status.",
      },
      { status: 400 },
    );
  }

  const data = createManexDataAccess();
  const timestamp = new Date().toISOString();

  if (!capabilities.hasRest && !capabilities.hasPostgres) {
    return Response.json(
      {
        ok: false,
        error: "Workflow writes are not configured in this environment.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await data.workflow.updateAction({
      id: parsed.data.actionId,
      recordedAt: timestamp,
      status: parsed.data.status,
      comments: parsed.data.comments?.trim() || undefined,
      userId: "forensic_lens",
    });

    return Response.json({
      ok: true,
      mode: "live",
      action: formatAction({
        action_id: result.row.id,
        product_id: result.row.productId,
        defect_id: result.row.defectId,
        action_type: result.row.actionType,
        status: result.row.status,
        comments: result.row.comments,
        ts: result.row.recordedAt,
      }),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Workflow update failed. Check your REST or Postgres credentials.",
      },
      { status: 500 },
    );
  }
}
