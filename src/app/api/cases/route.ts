import { z } from "zod";

import {
  createManexCase,
  listManexCases,
  type ManexCasePriority,
  type ManexCaseSignalType,
  type ManexCaseStatus,
} from "@/lib/manex-case-state";
import { capabilities } from "@/lib/env";

export const runtime = "nodejs";

const caseStatusSchema = z.enum([
  "open",
  "triage",
  "in_progress",
  "monitoring",
  "closed",
]);

const casePrioritySchema = z.enum(["low", "medium", "high", "critical"]);

const caseSignalTypeSchema = z.enum([
  "defect",
  "field_claim",
  "bad_test",
  "marginal_test",
  "product_action",
  "rework",
  "part_install",
  "custom",
]);

const createCaseSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().max(1600).optional(),
    productId: z.string().trim().max(80).optional(),
    articleId: z.string().trim().max(80).optional(),
    status: caseStatusSchema.optional(),
    priority: casePrioritySchema.optional(),
    initialSignalType: caseSignalTypeSchema.optional(),
    initialSignalId: z.string().trim().max(120).optional(),
    initialSignalNote: z.string().trim().max(400).optional(),
    openingHypothesis: z.string().trim().max(1000).optional(),
    openingNote: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, context) => {
    const hasSignalType = Boolean(value.initialSignalType);
    const hasSignalId = Boolean(value.initialSignalId);

    if (hasSignalType !== hasSignalId) {
      context.addIssue({
        code: "custom",
        message:
          "Provide both initialSignalType and initialSignalId together, or leave both empty.",
        path: hasSignalType ? ["initialSignalId"] : ["initialSignalType"],
      });
    }
  });

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const cleanOptional = (value: string | undefined) => {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
};

const formatCaseError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Custom case-state write failed.";
};

const hasCaseStateAccess = () => capabilities.hasPostgres;

export async function GET() {
  if (!hasCaseStateAccess()) {
    return Response.json(
      {
        ok: false,
        error:
          "Custom case-state tables require DATABASE_URL because they are created and managed in Postgres.",
      },
      { status: 503 },
    );
  }

  try {
    const cases = await listManexCases(24);

    return Response.json({
      ok: true,
      mode: "live",
      cases,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: formatCaseError(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasCaseStateAccess()) {
    return Response.json(
      {
        ok: false,
        error:
          "Custom case-state tables require DATABASE_URL because they are created and managed in Postgres.",
      },
      { status: 503 },
    );
  }

  const parsed = createCaseSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error:
          "Provide a title and keep the optional initial signal paired as type plus id.",
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const createdCase = await createManexCase({
      id: createId("CASE"),
      title: input.title,
      summary: cleanOptional(input.summary),
      productId: cleanOptional(input.productId),
      articleId: cleanOptional(input.articleId),
      status: (input.status as ManexCaseStatus | undefined) ?? "triage",
      priority: (input.priority as ManexCasePriority | undefined) ?? "medium",
      createdBy: "forensic_lens",
      signalLinks: input.initialSignalType && input.initialSignalId
        ? [
            {
              id: createId("CSL"),
              signalType: input.initialSignalType as ManexCaseSignalType,
              signalId: input.initialSignalId,
              productId: cleanOptional(input.productId),
              articleId: cleanOptional(input.articleId),
              note: cleanOptional(input.initialSignalNote) ?? null,
            },
          ]
        : [],
      openingHypothesis: cleanOptional(input.openingHypothesis)
        ? {
            id: createId("HYP"),
            statement: input.openingHypothesis!,
            createdBy: "forensic_lens",
          }
        : null,
      openingNote: cleanOptional(input.openingNote)
        ? {
            id: createId("NOTE"),
            body: input.openingNote!,
            noteType: "note",
            createdBy: "forensic_lens",
          }
        : null,
    });

    return Response.json({
      ok: true,
      mode: "live",
      case: createdCase,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: formatCaseError(error),
      },
      { status: 500 },
    );
  }
}
