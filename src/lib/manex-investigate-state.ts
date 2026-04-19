import { stringifyUnicodeSafe } from "@/lib/json-unicode";
import { connectPostgresClient, queryPostgres } from "@/lib/postgres";

export type InvestigateRunSummary = {
  id: string;
  articleId: string;
  articleName: string | null;
  model: string;
  status: "building" | "completed" | "failed";
  currentStage: string;
  stageDetail: string | null;
  stageUpdatedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  candidateCount: number;
  issueCount: number;
  reviewPayload?: unknown;
};

export type InvestigateBatchArticleResult = {
  articleId: string;
  ok: boolean;
  runId: string | null;
  issueCount: number;
  caseCount: number;
  validatedCount: number;
  watchlistCount: number;
  noiseCount: number;
  error: string | null;
  completedAt: string;
};

export type InvestigateBatchSummary = {
  id: string;
  status: "running" | "completed" | "failed";
  requestedArticleIds: string[];
  totalArticleCount: number;
  startedAt: string;
  completedAt: string | null;
  lastUpdatedAt: string | null;
  concurrency: number | null;
  okCount: number;
  errorCount: number;
  errorMessage: string | null;
  articleResults: InvestigateBatchArticleResult[];
};

type InvestigateRunRow = {
  id: string;
  article_id: string;
  article_name: string | null;
  model: string;
  status: "building" | "completed" | "failed";
  current_stage: string;
  stage_detail: string | null;
  stage_updated_at: Date | string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  error_message: string | null;
  candidate_count: number | string | null;
  issue_count: number | string | null;
  review_payload: unknown;
};

type InvestigateBatchRow = {
  id: string;
  status: "running" | "completed" | "failed";
  requested_article_ids: unknown;
  total_article_count: number | string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  last_updated_at: Date | string | null;
  concurrency: number | string | null;
  ok_count: number | string | null;
  error_count: number | string | null;
  error_message: string | null;
  article_results: unknown;
};

let ensurePromise: Promise<void> | null = null;

function safeIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function normalizeInteger(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asArticleResults(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is InvestigateBatchArticleResult =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as InvestigateBatchArticleResult).articleId === "string",
      )
    : [];
}

function mapRun(row: InvestigateRunRow): InvestigateRunSummary {
  return {
    id: row.id,
    articleId: row.article_id,
    articleName: row.article_name,
    model: row.model,
    status: row.status,
    currentStage: row.current_stage,
    stageDetail: row.stage_detail,
    stageUpdatedAt: safeIso(row.stage_updated_at),
    startedAt: safeIso(row.started_at) ?? new Date(0).toISOString(),
    completedAt: safeIso(row.completed_at),
    errorMessage: row.error_message,
    candidateCount: normalizeInteger(row.candidate_count),
    issueCount: normalizeInteger(row.issue_count),
    reviewPayload: row.review_payload,
  };
}

function mapBatch(row: InvestigateBatchRow): InvestigateBatchSummary {
  return {
    id: row.id,
    status: row.status,
    requestedArticleIds: asStringArray(row.requested_article_ids),
    totalArticleCount: normalizeInteger(row.total_article_count),
    startedAt: safeIso(row.started_at) ?? new Date(0).toISOString(),
    completedAt: safeIso(row.completed_at),
    lastUpdatedAt: safeIso(row.last_updated_at),
    concurrency: normalizeInteger(row.concurrency) || null,
    okCount: normalizeInteger(row.ok_count),
    errorCount: normalizeInteger(row.error_count),
    errorMessage: row.error_message,
    articleResults: asArticleResults(row.article_results),
  };
}

export async function ensureInvestigateState() {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = (async () => {
    const client = await connectPostgresClient();

    if (!client) {
      throw new Error("Statistical investigation requires DATABASE_URL.");
    }

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS team_inv_case_run (
          id TEXT PRIMARY KEY,
          article_id TEXT NOT NULL,
          article_name TEXT,
          model TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('building', 'completed', 'failed')),
          current_stage TEXT NOT NULL,
          stage_detail TEXT,
          stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          error_message TEXT,
          candidate_count INT NOT NULL DEFAULT 0,
          issue_count INT NOT NULL DEFAULT 0,
          review_payload JSONB
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_team_inv_case_run_article_started
          ON team_inv_case_run (article_id, started_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_team_inv_case_run_status_started
          ON team_inv_case_run (status, started_at DESC)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS team_inv_case_batch (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
          requested_article_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          total_article_count INT NOT NULL DEFAULT 0,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          concurrency INT,
          ok_count INT NOT NULL DEFAULT 0,
          error_count INT NOT NULL DEFAULT 0,
          error_message TEXT,
          article_results JSONB NOT NULL DEFAULT '[]'::jsonb
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_team_inv_case_batch_started
          ON team_inv_case_batch (started_at DESC NULLS LAST, last_updated_at DESC)
      `);
    } finally {
      client.release();
    }
  })();

  return ensurePromise;
}

export async function createInvestigateRun(input: {
  id: string;
  articleId: string;
  articleName: string | null;
  model: string;
  currentStage: string;
  stageDetail: string | null;
}) {
  await ensureInvestigateState();

  await queryPostgres(
    `
      INSERT INTO team_inv_case_run (
        id,
        article_id,
        article_name,
        model,
        status,
        current_stage,
        stage_detail
      )
      VALUES ($1, $2, $3, $4, 'building', $5, $6)
    `,
    [
      input.id,
      input.articleId,
      input.articleName,
      input.model,
      input.currentStage,
      input.stageDetail,
    ],
  );
}

export async function updateInvestigateRunStage(input: {
  id: string;
  currentStage: string;
  stageDetail: string | null;
}) {
  await ensureInvestigateState();

  await queryPostgres(
    `
      UPDATE team_inv_case_run
      SET
        current_stage = $2,
        stage_detail = $3,
        stage_updated_at = NOW()
      WHERE id = $1
    `,
    [input.id, input.currentStage, input.stageDetail],
  );
}

export async function completeInvestigateRun(input: {
  id: string;
  candidateCount: number;
  issueCount: number;
  reviewPayload: unknown;
  stageDetail: string | null;
}) {
  await ensureInvestigateState();

  await queryPostgres(
    `
      UPDATE team_inv_case_run
      SET
        status = 'completed',
        current_stage = 'completed',
        stage_detail = $2,
        stage_updated_at = NOW(),
        completed_at = NOW(),
        candidate_count = $3,
        issue_count = $4,
        review_payload = $5::jsonb
      WHERE id = $1
    `,
    [
      input.id,
      input.stageDetail,
      input.candidateCount,
      input.issueCount,
      stringifyUnicodeSafe(input.reviewPayload),
    ],
  );
}

export async function failInvestigateRun(input: {
  id: string;
  errorMessage: string;
  stageDetail: string | null;
}) {
  await ensureInvestigateState();

  await queryPostgres(
    `
      UPDATE team_inv_case_run
      SET
        status = 'failed',
        current_stage = 'failed',
        stage_detail = $2,
        stage_updated_at = NOW(),
        completed_at = NOW(),
        error_message = $3
      WHERE id = $1
    `,
    [input.id, input.stageDetail, input.errorMessage],
  );
}

export async function getLatestInvestigateRun(articleId: string) {
  await ensureInvestigateState();

  const rows = await queryPostgres<InvestigateRunRow>(
    `
      SELECT *
      FROM team_inv_case_run
      WHERE article_id = $1
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `,
    [articleId],
  );

  return rows?.[0] ? mapRun(rows[0]) : null;
}

export async function listLatestCompletedInvestigateRunsByArticle() {
  await ensureInvestigateState();

  const rows = await queryPostgres<InvestigateRunRow>(
    `
      SELECT DISTINCT ON (article_id) *
      FROM team_inv_case_run
      WHERE status = 'completed'
      ORDER BY article_id ASC, started_at DESC, id DESC
    `,
  );

  return (rows ?? []).map(mapRun);
}

export async function listActiveInvestigateRuns() {
  await ensureInvestigateState();

  const rows = await queryPostgres<InvestigateRunRow>(
    `
      SELECT *
      FROM team_inv_case_run
      WHERE status = 'building'
      ORDER BY started_at DESC, id DESC
    `,
  );

  return (rows ?? []).map(mapRun);
}

export async function clearInvestigateState() {
  await ensureInvestigateState();

  const client = await connectPostgresClient();

  if (!client) {
    throw new Error("Statistical investigation requires DATABASE_URL.");
  }

  try {
    await client.query("BEGIN");

    const countRows = await client.query<{
      runs: number;
      batches: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM team_inv_case_run) AS runs,
        (SELECT COUNT(*)::int FROM team_inv_case_batch) AS batches
    `);

    await client.query("DELETE FROM team_inv_case_batch");
    await client.query("DELETE FROM team_inv_case_run");
    await client.query("COMMIT");

    return {
      runs: countRows.rows[0]?.runs ?? 0,
      batches: countRows.rows[0]?.batches ?? 0,
      candidates: 0,
      candidateMembers: 0,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestInvestigateBatch() {
  await ensureInvestigateState();

  const rows = await queryPostgres<InvestigateBatchRow>(
    `
      SELECT *
      FROM team_inv_case_batch
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `,
  );

  return rows?.[0] ? mapBatch(rows[0]) : null;
}

export async function createInvestigateBatch(input: {
  id: string;
  requestedArticleIds: string[];
  totalArticleCount: number;
  concurrency: number;
}) {
  await ensureInvestigateState();

  await queryPostgres(
    `
      INSERT INTO team_inv_case_batch (
        id,
        status,
        requested_article_ids,
        total_article_count,
        concurrency
      )
      VALUES ($1, 'running', $2::jsonb, $3, $4)
    `,
    [
      input.id,
      stringifyUnicodeSafe(input.requestedArticleIds),
      input.totalArticleCount,
      input.concurrency,
    ],
  );
}

export async function updateInvestigateBatch(input: {
  id: string;
  status?: "running" | "completed" | "failed";
  okCount?: number;
  errorCount?: number;
  errorMessage?: string | null;
  articleResults?: InvestigateBatchArticleResult[];
  completed?: boolean;
}) {
  await ensureInvestigateState();

  await queryPostgres(
    `
      UPDATE team_inv_case_batch
      SET
        status = COALESCE($2, status),
        ok_count = COALESCE($3, ok_count),
        error_count = COALESCE($4, error_count),
        error_message = $5,
        article_results = COALESCE($6::jsonb, article_results),
        last_updated_at = NOW(),
        completed_at = CASE WHEN $7 THEN NOW() ELSE completed_at END
      WHERE id = $1
    `,
    [
      input.id,
      input.status ?? null,
      input.okCount ?? null,
      input.errorCount ?? null,
      input.errorMessage ?? null,
      input.articleResults ? stringifyUnicodeSafe(input.articleResults) : null,
      input.completed ?? false,
    ],
  );
}
