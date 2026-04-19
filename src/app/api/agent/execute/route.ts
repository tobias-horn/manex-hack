import { z } from "zod";

import { createManexDataAccess } from "@/lib/manex-data-access";

export const runtime = "nodejs";

const data = createManexDataAccess();

function newActionId() {
  const n = Math.floor(10000 + Math.random() * 89999);
  return `PA-${n}`;
}

function safeSectionId(raw?: string) {
  return raw && /^SEC-\d{5}$/.test(raw) ? raw : undefined;
}

function safeDefectId(raw?: string) {
  return raw && /^DEF-\d{5}$/.test(raw) ? raw : undefined;
}

const productActionSchema = z.object({
  proposalType: z.literal("product_action"),
  payload: z.object({
    productId: z.string(),
    actionType: z.string(),
    status: z.string().default("open"),
    comments: z.string(),
    defectId: z.string().optional(),
    sectionId: z.string().optional(),
    assigneeUserId: z.string().optional(),
    rationale: z.string().optional(),
    story: z.string().optional(),
  }),
});

const assignmentSchema = z.object({
  proposalType: z.literal("assignment"),
  payload: z.object({
    productId: z.string(),
    userId: z.string(),
    role: z.string().default("owner"),
    actionType: z.string().default("ASSIGNMENT"),
    comments: z.string(),
    defectId: z.string().optional(),
    story: z.string().optional(),
  }),
});

const reportSchema = z.object({
  proposalType: z.literal("report"),
  payload: z.object({
    story: z.string(),
    title: z.string(),
    symptom: z.string(),
    evidence: z.array(z.string()),
    rootCause: z.string(),
    scope: z.string(),
    containment: z.array(z.string()),
    correctiveActions: z.array(z.string()),
    verification: z.string(),
    owners: z
      .array(z.object({ role: z.string(), userId: z.string().optional(), note: z.string().optional() }))
      .default([]),
    anchorProductId: z.string(),
  }),
});

const bodySchema = z.discriminatedUnion("proposalType", [
  productActionSchema,
  assignmentSchema,
  reportSchema,
]);

function nowIso() {
  return new Date().toISOString();
}

function formatReportComments(payload: z.infer<typeof reportSchema>["payload"]) {
  const lines: string[] = [];
  lines.push(`8D REPORT — ${payload.title}`);
  lines.push(`Story: ${payload.story}`);
  lines.push("");
  lines.push(`Symptom: ${payload.symptom}`);
  lines.push(`Scope: ${payload.scope}`);
  lines.push("");
  lines.push("Evidence:");
  for (const e of payload.evidence) lines.push(`  - ${e}`);
  lines.push("");
  lines.push(`Root cause: ${payload.rootCause}`);
  lines.push("");
  lines.push("Containment:");
  for (const c of payload.containment) lines.push(`  - ${c}`);
  lines.push("Corrective actions:");
  for (const a of payload.correctiveActions) lines.push(`  - ${a}`);
  lines.push(`Verification: ${payload.verification}`);
  if (payload.owners.length > 0) {
    lines.push("Owners:");
    for (const o of payload.owners) {
      lines.push(`  - ${o.role}${o.userId ? ` (${o.userId})` : ""}${o.note ? ` — ${o.note}` : ""}`);
    }
  }
  return lines.join("\n");
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid proposal payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.proposalType === "product_action") {
      const p = parsed.data.payload;
      const comments = p.rationale
        ? `${p.comments}\n\n— Rationale —\n${p.rationale}`
        : p.comments;
      const result = await data.workflow.recordAction({
        id: newActionId(),
        productId: p.productId,
        recordedAt: nowIso(),
        actionType: p.actionType,
        status: p.status,
        userId: p.assigneeUserId ?? "user_agent",
        sectionId: safeSectionId(p.sectionId),
        comments,
        defectId: safeDefectId(p.defectId),
      });
      return Response.json({ ok: true, kind: "product_action", result });
    }

    if (parsed.data.proposalType === "assignment") {
      const p = parsed.data.payload;
      const result = await data.workflow.recordAction({
        id: newActionId(),
        productId: p.productId,
        recordedAt: nowIso(),
        actionType: p.actionType,
        status: "open",
        userId: p.userId,
        comments: `Assigned ${p.userId} as ${p.role}. ${p.comments}`,
        defectId: safeDefectId(p.defectId),
      });
      return Response.json({ ok: true, kind: "assignment", result });
    }

    if (parsed.data.proposalType === "report") {
      const p = parsed.data.payload;
      const ownerUserId = p.owners.find((o) => o.userId)?.userId ?? "user_agent";
      const result = await data.workflow.recordAction({
        id: newActionId(),
        productId: p.anchorProductId,
        recordedAt: nowIso(),
        actionType: "initiate_8d",
        status: "open",
        userId: ownerUserId,
        comments: formatReportComments(p),
      });
      return Response.json({ ok: true, kind: "report", result });
    }
  } catch (error) {
    console.error("[agent/execute] write failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Write failed." },
      { status: 500 },
    );
  }

  return Response.json({ error: "Unknown proposal type." }, { status: 400 });
}
