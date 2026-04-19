import { z } from "zod";

export const qualityNotificationTeamIds = [
  "quality_management",
  "supplier_quality",
  "manufacturing_engineering",
  "design_engineering",
  "field_quality",
  "operations_training",
  "procurement",
  "customer_support",
] as const;

export const qualityNotificationTeamIdSchema = z.enum(qualityNotificationTeamIds);

export type QualityNotificationTeamId = z.infer<typeof qualityNotificationTeamIdSchema>;

export const QUALITY_NOTIFICATION_TEAMS = [
  {
    id: "quality_management",
    label: "Quality Management",
    description:
      "Owns the formal quality alert, cross-functional coordination, and 8D-style closeout.",
  },
  {
    id: "supplier_quality",
    label: "Supplier Quality",
    description:
      "Handles supplier containment, batch traceability, and supplier corrective actions.",
  },
  {
    id: "manufacturing_engineering",
    label: "Manufacturing Engineering",
    description:
      "Investigates process drift, station behavior, calibration, and in-factory controls.",
  },
  {
    id: "design_engineering",
    label: "Design Engineering",
    description:
      "Owns design weaknesses, latent field failures, and product-level corrective changes.",
  },
  {
    id: "field_quality",
    label: "Field Quality",
    description:
      "Coordinates field claims, service feedback, and failure evidence coming back from customers.",
  },
  {
    id: "operations_training",
    label: "Operations & Training",
    description:
      "Handles operator behavior, packaging/handling patterns, and work-instruction reinforcement.",
  },
  {
    id: "procurement",
    label: "Procurement",
    description:
      "Supports incoming-material holds, supplier communication, and sourcing decisions.",
  },
  {
    id: "customer_support",
    label: "Customer Support",
    description:
      "Prepares external communication when confirmed cases can affect shipped units or customers.",
  },
] as const satisfies ReadonlyArray<{
  id: QualityNotificationTeamId;
  label: string;
  description: string;
}>;

export const confirmedCaseReportRuntimeModeSchema = z.enum(["live_ai", "template"]);

export type ConfirmedCaseReportRuntimeMode = z.infer<
  typeof confirmedCaseReportRuntimeModeSchema
>;

export const confirmedCaseReportTeamSuggestionSchema = z.object({
  teamId: qualityNotificationTeamIdSchema,
  rationale: z.string().trim().min(1).max(320),
  urgency: z.enum(["primary", "secondary", "monitor"]),
  preselected: z.boolean(),
});

export type ConfirmedCaseReportTeamSuggestion = z.infer<
  typeof confirmedCaseReportTeamSuggestionSchema
>;

export const confirmedCaseReportScopeSchema = z.object({
  affectedProductCount: z.number().int().nonnegative(),
  signalCount: z.number().int().nonnegative(),
  productIds: z.array(z.string().trim().min(1)).max(24),
  reportedParts: z.array(z.string().trim().min(1)).max(12),
  findNumbers: z.array(z.string().trim().min(1)).max(12),
  supplierBatches: z.array(z.string().trim().min(1)).max(12),
  sections: z.array(z.string().trim().min(1)).max(12),
});

export type ConfirmedCaseReportScope = z.infer<typeof confirmedCaseReportScopeSchema>;

export const confirmedCaseReportTimelineItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1).max(140),
  detail: z.string().trim().min(1).max(320),
  timestamp: z.string().datetime().nullable(),
  context: z.string().trim().min(1).max(180).nullable(),
});

export type ConfirmedCaseReportTimelineItem = z.infer<
  typeof confirmedCaseReportTimelineItemSchema
>;

export const confirmedCaseReportSchema = z.object({
  headline: z.string().trim().min(1).max(180),
  executiveSummary: z.string().trim().min(1).max(900),
  problemStatement: z.string().trim().min(1).max(900),
  confirmedMechanism: z.string().trim().min(1).max(900),
  severityAssessment: z.string().trim().min(1).max(500),
  scope: confirmedCaseReportScopeSchema,
  evidenceHighlights: z.array(z.string().trim().min(1).max(240)).min(2).max(6),
  containmentActions: z.array(z.string().trim().min(1).max(240)).min(1).max(5),
  correctiveActions: z.array(z.string().trim().min(1).max(240)).min(1).max(5),
  validationPlan: z.array(z.string().trim().min(1).max(240)).min(1).max(4),
  watchouts: z.array(z.string().trim().min(1).max(240)).max(4),
  timeline: z.array(confirmedCaseReportTimelineItemSchema).max(6),
  suggestedTeams: z
    .array(confirmedCaseReportTeamSuggestionSchema)
    .min(2)
    .max(qualityNotificationTeamIds.length),
});

export type ConfirmedCaseReport = z.infer<typeof confirmedCaseReportSchema>;

export type ConfirmedCaseReportRecord = {
  id: string;
  articleId: string;
  candidateId: string;
  pipelineMode: "current" | "deterministic" | "hypothesis" | "investigate" | "dummy";
  candidateTitle: string | null;
  runtimeMode: ConfirmedCaseReportRuntimeMode;
  modelName: string | null;
  promptVersion: string;
  report: ConfirmedCaseReport;
  selectedTeamIds: QualityNotificationTeamId[];
  notifyRequestedAt: string | null;
  notifyRequestedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
