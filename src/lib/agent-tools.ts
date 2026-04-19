import { tool } from "ai";
import { z } from "zod";

import { createManexDataAccess } from "@/lib/manex-data-access";

const data = createManexDataAccess();

const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const testOutcomeSchema = z.enum(["PASS", "MARGINAL", "FAIL"]);
const sortSchema = z.enum(["newest", "oldest"]);

function trimResult<T>(items: T[], limit = 25) {
  return items.slice(0, limit);
}

const DATE_FIELDS = new Set([
  "detectedAfter",
  "detectedBefore",
  "claimedAfter",
  "claimedBefore",
  "observedAfter",
  "observedBefore",
  "weekStartAfter",
]);
const EARLIEST_VALID = Date.parse("2024-01-01T00:00:00Z");

function clean<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;

    if (DATE_FIELDS.has(key) && typeof value === "string") {
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp) || timestamp < EARLIEST_VALID) continue;
    }

    out[key] = value;
  }

  return out as T;
}

export const searchDefectsTool = tool({
  description:
    "Search in-factory DEFECT rows. Use for codes like SOLDER_COLD, VIB_FAIL, VISUAL_SCRATCH, LABEL_MISALIGN, TEST_TOOL. Filters stack (AND).",
  inputSchema: z.object({
    articleId: z.string().optional(),
    productId: z.string().optional(),
    defectCodes: z.array(z.string()).optional(),
    severities: z.array(severitySchema).optional(),
    reportedPartNumbers: z.array(z.string()).optional(),
    detectedAfter: z.string().datetime().optional(),
    detectedBefore: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    sort: sortSchema.default("newest"),
  }),
  execute: async (input) => {
    const result = await data.investigation.findDefects(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: trimResult(result.items, input.limit ?? 25).map((defect) => ({
        id: defect.id,
        productId: defect.productId,
        articleId: defect.articleId,
        code: defect.code,
        severity: defect.severity,
        occurredAt: defect.occurredAt,
        detectedSection: defect.detectedSectionName,
        occurrenceSection: defect.occurrenceSectionName,
        reportedPart: defect.reportedPartNumber,
        testOverall: defect.detectedTestOverall,
        notes: defect.notes,
      })),
    };
  },
});

export const searchFieldClaimsTool = tool({
  description:
    "Search customer FIELD_CLAIM rows. Use for post-ship failures. complaint_text is in German.",
  inputSchema: z.object({
    articleId: z.string().optional(),
    productId: z.string().optional(),
    mappedDefectCodes: z.array(z.string()).optional(),
    reportedPartNumbers: z.array(z.string()).optional(),
    claimedAfter: z.string().datetime().optional(),
    claimedBefore: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    sort: sortSchema.default("newest"),
  }),
  execute: async (input) => {
    const result = await data.investigation.findClaims(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: trimResult(result.items, input.limit ?? 25).map((claim) => ({
        id: claim.id,
        productId: claim.productId,
        articleId: claim.articleId,
        claimedAt: claim.claimedAt,
        daysFromBuild: claim.daysFromBuild,
        market: claim.market,
        complaint: claim.complaintText,
        reportedPart: claim.reportedPartNumber,
        mappedDefectCode: claim.mappedDefectCode,
      })),
    };
  },
});

export const searchTestSignalsTool = tool({
  description:
    "Search TEST_RESULT rows. Filter by outcome (PASS/MARGINAL/FAIL) and test_key (e.g. VIB_TEST, ESR_TEST). MARGINAL values near the limit are leading indicators.",
  inputSchema: z.object({
    articleId: z.string().optional(),
    productId: z.string().optional(),
    outcomes: z.array(testOutcomeSchema).optional(),
    testKeys: z.array(z.string()).optional(),
    observedAfter: z.string().datetime().optional(),
    observedBefore: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    sort: sortSchema.default("newest"),
  }),
  execute: async (input) => {
    const result = await data.investigation.findTestSignals(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: trimResult(result.items, input.limit ?? 25).map((signal) => ({
        id: signal.id,
        productId: signal.productId,
        articleId: signal.articleId,
        testKey: signal.testKey,
        outcome: signal.overallResult,
        value: signal.testValue,
        unit: signal.unit,
        section: signal.sectionName,
        occurredAt: signal.occurredAt,
      })),
    };
  },
});

export const findInstalledPartsTool = tool({
  description:
    "Trace physical parts installed in products. Use batchId / supplierName to follow a supplier incident (e.g. SB-00007).",
  inputSchema: z.object({
    productId: z.string().optional(),
    supplierName: z.string().optional(),
    supplierId: z.string().optional(),
    batchId: z.string().optional(),
    batchNumber: z.string().optional(),
    partId: z.string().optional(),
    partNumber: z.string().optional(),
    positionCode: z.string().optional(),
    findNumber: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  execute: async (input) => {
    const result = await data.traceability.findInstalledParts(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: trimResult(result.items, input.limit ?? 50).map((part) => ({
        productId: part.productId,
        articleId: part.articleId,
        findNumber: part.findNumber,
        partNumber: part.partNumber,
        partTitle: part.partTitle,
        batchId: part.batchId,
        batchNumber: part.batchNumber,
        supplier: part.supplierName,
        installedAt: part.installedAt,
      })),
    };
  },
});

export const weeklyQualitySummaryTool = tool({
  description:
    "Aggregated weekly defect / claim / rework counts per article. Fast overview for detecting spikes.",
  inputSchema: z.object({
    articleId: z.string().optional(),
    weekStartAfter: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: sortSchema.default("newest"),
  }),
  execute: async (input) => {
    const result = await data.quality.findWeeklySummaries(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: result.items,
    };
  },
});

export const findReworkTool = tool({
  description:
    "Search REWORK rows (corrective actions). Useful for operator patterns and for verifying a defect was actually fixed.",
  inputSchema: z.object({
    productId: z.string().optional(),
    defectId: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  execute: async (input) => {
    const result = await data.workflow.findRework(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: trimResult(result.items, input.limit ?? 25).map((rework) => ({
        id: rework.id,
        defectId: rework.defectId,
        productId: rework.productId,
        recordedAt: rework.recordedAt,
        actionText: rework.actionText,
        userId: rework.userId,
        timeMinutes: rework.timeMinutes,
        cost: rework.cost,
      })),
    };
  },
});

export const findActionsTool = tool({
  description:
    "List existing PRODUCT_ACTION rows (8D, investigations, initiatives) for a product or defect.",
  inputSchema: z.object({
    productId: z.string().optional(),
    defectId: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  execute: async (input) => {
    const result = await data.workflow.findActions(clean(input));

    return {
      total: result.total,
      transport: result.transport,
      items: result.items,
    };
  },
});

export const proposeProductActionTool = tool({
  description:
    "Propose a new PRODUCT_ACTION (8D / investigation / containment / initiative). DOES NOT WRITE. Returns a proposal the human approves or denies.",
  inputSchema: z.object({
    productId: z.string().describe("Target product_id the action is anchored to (must exist)."),
    actionType: z
      .enum([
        "initiate_8d",
        "investigate",
        "containment",
        "corrective",
        "preventive",
        "verify_fix",
        "supplier_containment",
      ])
      .describe("Allowed action types in the DB."),
    status: z.enum(["open", "in_progress", "done"]).default("open"),
    comments: z.string().min(10),
    defectId: z.string().optional(),
    sectionId: z.string().optional(),
    assigneeUserId: z
      .string()
      .optional()
      .describe("Optional user_id to assign as owner."),
    story: z
      .enum([
        "STORY_1_SUPPLIER",
        "STORY_2_PROCESS_DRIFT",
        "STORY_3_DESIGN",
        "STORY_4_OPERATOR",
        "NOISE",
        "UNCLEAR",
      ])
      .describe("Which internal story label the agent used for reasoning."),
    rationale: z
      .string()
      .min(10)
      .describe("Short human-readable justification with cited evidence the human can audit."),
  }),
  execute: async (input) => {
    return {
      kind: "proposal" as const,
      proposalType: "product_action" as const,
      status: "pending_approval" as const,
      payload: input,
    };
  },
});

export const assignEmployeeTool = tool({
  description:
    "Propose assigning an employee (user_id) as owner of an action. DOES NOT WRITE. Returns a proposal for human approval.",
  inputSchema: z.object({
    productId: z.string(),
    userId: z.string(),
    role: z
      .string()
      .default("owner")
      .describe("e.g. 'owner', 'containment_lead', 'verification_lead'."),
    actionType: z
      .enum([
        "initiate_8d",
        "investigate",
        "containment",
        "corrective",
        "preventive",
        "verify_fix",
        "supplier_containment",
      ])
      .default("investigate"),
    comments: z.string().min(5),
    defectId: z.string().optional(),
    story: z
      .enum([
        "STORY_1_SUPPLIER",
        "STORY_2_PROCESS_DRIFT",
        "STORY_3_DESIGN",
        "STORY_4_OPERATOR",
        "NOISE",
        "UNCLEAR",
      ])
      .optional(),
  }),
  execute: async (input) => {
    return {
      kind: "proposal" as const,
      proposalType: "assignment" as const,
      status: "pending_approval" as const,
      payload: input,
    };
  },
});

export const draftReportTool = tool({
  description:
    "Compile a structured 8D-style report from gathered evidence. DOES NOT PERSIST. Returns a proposal; human can approve to open a matching PRODUCT_ACTION.",
  inputSchema: z.object({
    story: z.enum([
      "STORY_1_SUPPLIER",
      "STORY_2_PROCESS_DRIFT",
      "STORY_3_DESIGN",
      "STORY_4_OPERATOR",
      "NOISE",
      "UNCLEAR",
    ]),
    title: z.string().min(5).max(160),
    symptom: z.string().min(10),
    evidence: z.array(z.string()).min(1).describe("Bullet list of factual observations with IDs/dates."),
    rootCause: z.string().min(10),
    scope: z.string().describe("Affected products / articles / date window."),
    containment: z.array(z.string()).min(1),
    correctiveActions: z.array(z.string()).min(1),
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
    anchorProductId: z.string().describe("product_id to anchor the follow-up PRODUCT_ACTION to."),
  }),
  execute: async (input) => {
    return {
      kind: "proposal" as const,
      proposalType: "report" as const,
      status: "pending_approval" as const,
      payload: input,
    };
  },
});

export const agentTools = {
  search_defects: searchDefectsTool,
  search_field_claims: searchFieldClaimsTool,
  search_test_signals: searchTestSignalsTool,
  find_installed_parts: findInstalledPartsTool,
  weekly_quality_summary: weeklyQualitySummaryTool,
  find_rework: findReworkTool,
  find_actions: findActionsTool,
  propose_product_action: proposeProductActionTool,
  assign_employee: assignEmployeeTool,
  draft_report: draftReportTool,
};

export type AgentProposal =
  | {
      kind: "proposal";
      proposalType: "product_action";
      status: "pending_approval";
      payload: z.infer<typeof proposeProductActionTool.inputSchema>;
    }
  | {
      kind: "proposal";
      proposalType: "assignment";
      status: "pending_approval";
      payload: z.infer<typeof assignEmployeeTool.inputSchema>;
    }
  | {
      kind: "proposal";
      proposalType: "report";
      status: "pending_approval";
      payload: z.infer<typeof draftReportTool.inputSchema>;
    };
