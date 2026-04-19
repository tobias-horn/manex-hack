import type { QueryResultRow } from "pg";

import {
  confirmedCaseReportSchema,
  qualityNotificationTeamIdSchema,
  type ConfirmedCaseReport,
  type ConfirmedCaseReportRecord,
  type ConfirmedCaseReportRuntimeMode,
  type QualityNotificationTeamId,
} from "@/lib/manex-confirmed-case-report-schema";
import { connectPostgresClient, getPostgresPool, queryPostgres } from "@/lib/postgres";

type ConfirmedCaseReportRow = QueryResultRow & {
  report_id: string;
  article_id: string;
  candidate_id: string;
  pipeline_mode: ConfirmedCaseReportRecord["pipelineMode"];
  candidate_title: string | null;
  runtime_mode: ConfirmedCaseReportRuntimeMode;
  model_name: string | null;
  prompt_version: string;
  report_payload: unknown;
  selected_team_ids: string[] | null;
  notify_requested_at: string | null;
  notify_requested_by: string | null;
  created_at: string;
  updated_at: string;
};

const CONFIRMED_CASE_REPORT_SQL = `
CREATE TABLE IF NOT EXISTS team_quality_case_report (
  report_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  pipeline_mode TEXT NOT NULL
    CHECK (pipeline_mode IN ('current', 'deterministic', 'hypothesis', 'investigate', 'dummy')),
  candidate_title TEXT,
  runtime_mode TEXT NOT NULL
    CHECK (runtime_mode IN ('live_ai', 'template')),
  model_name TEXT,
  prompt_version TEXT NOT NULL,
  report_payload JSONB NOT NULL,
  selected_team_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  notify_requested_at TIMESTAMPTZ,
  notify_requested_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, pipeline_mode, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_team_quality_case_report_article_mode
  ON team_quality_case_report (article_id, pipeline_mode, updated_at DESC);
`;

let ensurePromise: Promise<void> | null = null;

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function parseSelectedTeamIds(value: string[] | null | undefined) {
  return (value ?? [])
    .map((item) => qualityNotificationTeamIdSchema.safeParse(item))
    .filter((item) => item.success)
    .map((item) => item.data);
}

function mapConfirmedCaseReport(row: ConfirmedCaseReportRow): ConfirmedCaseReportRecord {
  return {
    id: row.report_id,
    articleId: row.article_id,
    candidateId: row.candidate_id,
    pipelineMode: row.pipeline_mode,
    candidateTitle: normalizeNullableText(row.candidate_title),
    runtimeMode: row.runtime_mode,
    modelName: normalizeNullableText(row.model_name),
    promptVersion: row.prompt_version,
    report: confirmedCaseReportSchema.parse(row.report_payload) as ConfirmedCaseReport,
    selectedTeamIds: parseSelectedTeamIds(row.selected_team_ids),
    notifyRequestedAt: row.notify_requested_at ? new Date(row.notify_requested_at).toISOString() : null,
    notifyRequestedBy: normalizeNullableText(row.notify_requested_by),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function withClient<T>(
  callback: (
    client: NonNullable<Awaited<ReturnType<typeof connectPostgresClient>>>,
  ) => Promise<T>,
) {
  const client = await connectPostgresClient();

  if (!client) {
    throw new Error("Confirmed case report persistence requires DATABASE_URL.");
  }

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function ensureConfirmedCaseReportState() {
  if (!ensurePromise) {
    const pool = getPostgresPool();

    if (!pool) {
      return;
    }

    ensurePromise = queryPostgres(CONFIRMED_CASE_REPORT_SQL).then(() => undefined);
  }

  return ensurePromise;
}

export async function getConfirmedCaseReportRecord(input: {
  articleId: string;
  candidateId: string;
  pipelineMode: ConfirmedCaseReportRecord["pipelineMode"];
}) {
  if (!getPostgresPool()) {
    return null;
  }

  await ensureConfirmedCaseReportState();

  const rows =
    (await queryPostgres<ConfirmedCaseReportRow>(
      `
        SELECT *
        FROM team_quality_case_report
        WHERE article_id = $1
          AND candidate_id = $2
          AND pipeline_mode = $3
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [input.articleId, input.candidateId, input.pipelineMode],
    )) ?? [];

  return rows[0] ? mapConfirmedCaseReport(rows[0]) : null;
}

export async function upsertConfirmedCaseReportRecord(input: {
  id: string;
  articleId: string;
  candidateId: string;
  pipelineMode: ConfirmedCaseReportRecord["pipelineMode"];
  candidateTitle?: string | null;
  runtimeMode: ConfirmedCaseReportRuntimeMode;
  modelName?: string | null;
  promptVersion: string;
  report: ConfirmedCaseReport;
}) {
  await ensureConfirmedCaseReportState();

  return withClient<ConfirmedCaseReportRecord>(async (client) => {
    const result = await client.query<ConfirmedCaseReportRow>(
      `
        INSERT INTO team_quality_case_report (
          report_id,
          article_id,
          candidate_id,
          pipeline_mode,
          candidate_title,
          runtime_mode,
          model_name,
          prompt_version,
          report_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (article_id, pipeline_mode, candidate_id)
        DO UPDATE SET
          candidate_title = EXCLUDED.candidate_title,
          runtime_mode = EXCLUDED.runtime_mode,
          model_name = EXCLUDED.model_name,
          prompt_version = EXCLUDED.prompt_version,
          report_payload = EXCLUDED.report_payload,
          updated_at = NOW()
        RETURNING *
      `,
      [
        input.id,
        input.articleId,
        input.candidateId,
        input.pipelineMode,
        normalizeNullableText(input.candidateTitle),
        input.runtimeMode,
        normalizeNullableText(input.modelName),
        input.promptVersion,
        JSON.stringify(input.report),
      ],
    );

    return mapConfirmedCaseReport(result.rows[0]);
  });
}

export async function queueConfirmedCaseReportNotifications(input: {
  articleId: string;
  candidateId: string;
  pipelineMode: ConfirmedCaseReportRecord["pipelineMode"];
  selectedTeamIds: QualityNotificationTeamId[];
  requestedBy?: string | null;
}) {
  await ensureConfirmedCaseReportState();

  return withClient<ConfirmedCaseReportRecord>(async (client) => {
    const result = await client.query<ConfirmedCaseReportRow>(
      `
        UPDATE team_quality_case_report
        SET
          selected_team_ids = $4::text[],
          notify_requested_at = NOW(),
          notify_requested_by = $5,
          updated_at = NOW()
        WHERE article_id = $1
          AND candidate_id = $2
          AND pipeline_mode = $3
        RETURNING *
      `,
      [
        input.articleId,
        input.candidateId,
        input.pipelineMode,
        input.selectedTeamIds,
        normalizeNullableText(input.requestedBy),
      ],
    );

    if (!result.rows[0]) {
      throw new Error("Generate the confirmed report before queuing notifications.");
    }

    return mapConfirmedCaseReport(result.rows[0]);
  });
}
