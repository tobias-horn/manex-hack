import { z } from "zod";

import { capabilities } from "@/lib/env";
import { createManexDataAccess } from "@/lib/manex-data-access";
import { normalizeUiIdentifier } from "@/lib/ui-format";

export const runtime = "nodejs";

const data = createManexDataAccess();

const nextActionId = () =>
  `PA-${Math.floor(Date.now() % 100_000)
    .toString()
    .padStart(5, "0")}`;

function safeSectionId(raw?: string) {
  const normalized = normalizeUiIdentifier(raw);
  return normalized && /^SEC-\d{5}$/.test(normalized) ? normalized : undefined;
}

function safeDefectId(raw?: string) {
  const normalized = normalizeUiIdentifier(raw);
  return normalized && /^DEF-\d{5}$/.test(normalized) ? normalized : undefined;
}

function safeProductId(raw: string) {
  return normalizeUiIdentifier(raw) ?? raw;
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
      .array(
        z.object({
          role: z.string(),
          userId: z.string().optional(),
          note: z.string().optional(),
        }),
      )
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
  lines.push(`8D REPORT - ${payload.title}`);
  lines.push(`Story: ${payload.story}`);
  lines.push("");
  lines.push(`Symptom: ${payload.symptom}`);
  lines.push(`Scope: ${payload.scope}`);
  lines.push("");
  lines.push("Evidence:");
  for (const evidence of payload.evidence) lines.push(`  - ${evidence}`);
  lines.push("");
  lines.push(`Root cause: ${payload.rootCause}`);
  lines.push("");
  lines.push("Containment:");
  for (const item of payload.containment) lines.push(`  - ${item}`);
  lines.push("Corrective actions:");
  for (const action of payload.correctiveActions) lines.push(`  - ${action}`);
  lines.push(`Verification: ${payload.verification}`);
  if (payload.owners.length > 0) {
    lines.push("Owners:");
    for (const owner of payload.owners) {
      lines.push(
        `  - ${owner.role}${owner.userId ? ` (${owner.userId})` : ""}${owner.note ? ` - ${owner.note}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export async function POST(request: Request) {
  if (!capabilities.hasPostgres && !capabilities.hasRest) {
    return Response.json(
      {
        error:
          "Workflow writes are not configured in this environment. Add DATABASE_URL or MANEX_REST_API_URL with MANEX_REST_API_KEY.",
      },
      { status: 503 },
    );
  }

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
      const proposal = parsed.data.payload;
      const comments = proposal.rationale
        ? `${proposal.comments}\n\n- Rationale -\n${proposal.rationale}`
        : proposal.comments;
      const result = await data.workflow.recordAction({
        id: nextActionId(),
        productId: safeProductId(proposal.productId),
        recordedAt: nowIso(),
        actionType: proposal.actionType,
        status: proposal.status,
        userId: proposal.assigneeUserId ?? "user_agent",
        sectionId: safeSectionId(proposal.sectionId),
        comments,
        defectId: safeDefectId(proposal.defectId),
      });
      return Response.json({ ok: true, kind: "product_action", result });
    }

    if (parsed.data.proposalType === "assignment") {
      const proposal = parsed.data.payload;
      const result = await data.workflow.recordAction({
        id: nextActionId(),
        productId: safeProductId(proposal.productId),
        recordedAt: nowIso(),
        actionType: proposal.actionType,
        status: "open",
        userId: proposal.userId,
        comments: `Assigned ${proposal.userId} as ${proposal.role}. ${proposal.comments}`,
        defectId: safeDefectId(proposal.defectId),
      });
      return Response.json({ ok: true, kind: "assignment", result });
    }

    if (parsed.data.proposalType === "report") {
      const proposal = parsed.data.payload;
      const ownerUserId = proposal.owners.find((owner) => owner.userId)?.userId ?? "user_agent";
      const result = await data.workflow.recordAction({
        id: nextActionId(),
        productId: safeProductId(proposal.anchorProductId),
        recordedAt: nowIso(),
        actionType: "initiate_8d",
        status: "open",
        userId: ownerUserId,
        comments: formatReportComments(proposal),
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
