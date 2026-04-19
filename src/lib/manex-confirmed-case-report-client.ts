"use client";

import type { ClusteringMode } from "@/lib/manex-clustering-mode";
import type {
  ConfirmedCaseReportRecord,
  QualityNotificationTeamId,
} from "@/lib/manex-confirmed-case-report-schema";

export type ConfirmedReportResponse = {
  ok?: boolean;
  error?: string;
  queued?: boolean;
  record?: ConfirmedCaseReportRecord;
};

export async function fetchConfirmedCaseReport(input: {
  articleId: string;
  candidateId: string;
  pipelineMode: ClusteringMode;
  candidateTitle?: string | null;
  force?: boolean;
}) {
  const response = await fetch(
    `/api/articles/${input.articleId}/hypotheses/${input.candidateId}/confirmed-report`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pipelineMode: input.pipelineMode,
        candidateTitle: input.candidateTitle ?? undefined,
        force: input.force ?? false,
      }),
    },
  );

  const payload = (await response.json()) as ConfirmedReportResponse;

  if (!response.ok || !payload.ok || !payload.record) {
    throw new Error(payload.error ?? "Could not prepare the confirmed case report.");
  }

  return payload.record;
}

export async function queueConfirmedCaseReport(input: {
  articleId: string;
  candidateId: string;
  pipelineMode: ClusteringMode;
  selectedTeamIds: QualityNotificationTeamId[];
}) {
  const response = await fetch(
    `/api/articles/${input.articleId}/hypotheses/${input.candidateId}/confirmed-report`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pipelineMode: input.pipelineMode,
        selectedTeamIds: input.selectedTeamIds,
      }),
    },
  );

  const payload = (await response.json()) as ConfirmedReportResponse;

  if (!response.ok || !payload.ok || !payload.record) {
    throw new Error(payload.error ?? "Could not queue the confirmed case report.");
  }

  return payload.record;
}
