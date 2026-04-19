import type { PoolClient, QueryResultRow } from "pg";

import { stringifyUnicodeSafe } from "@/lib/json-unicode";
import { connectPostgresClient, getPostgresPool, queryPostgres } from "@/lib/postgres";

export type HypothesisCaseRunStatus = "building" | "completed" | "failed";
export type HypothesisCaseCandidateLifecycle =
  | "proposed"
  | "accepted"
  | "rejected"
  | "merged";
export type HypothesisCaseCandidatePriority = "low" | "medium" | "high" | "critical";
export type HypothesisCaseRunStage =
  | "queued"
  | "stage1_loading"
  | "stage1_synthesis"
  | "stage1_issue_extraction"
  | "stage2_grouping"
  | "stage2_final_judge"
  | "stage2_persisting"
  | "stage3_reconciliation"
  | "completed"
  | "failed";

export type HypothesisCaseRunSummary = {
  id: string;
  articleId: string;
  articleName: string | null;
  model: string;
  status: HypothesisCaseRunStatus;
  schemaVersion: string;
  promptVersion: string;
  productCount: number;
  signalCount: number;
  issueCount: number;
  candidateCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  currentStage: HypothesisCaseRunStage;
  stageDetail: string | null;
  stageUpdatedAt: string | null;
  requestPayload?: unknown;
  proposalPayload?: unknown;
  reviewPayload?: unknown;
};

export type HypothesisArticleClusterCard = {
  articleId: string;
  articleName: string | null;
  productCount: number;
  totalSignals: number;
  defectCount: number;
  claimCount: number;
  badTestCount: number;
  marginalTestCount: number;
  latestSignalAt: string | null;
  latestRun: HypothesisCaseRunSummary | null;
  proposedCaseCount: number;
};

export type HypothesisClusteringResetSummary = {
  runs: number;
  batches: number;
  candidates: number;
  candidateMembers: number;
};

export type HypothesisClusteringStopSummary = {
  stoppedRuns: number;
  stoppedBatches: number;
  runIds: string[];
  batchIds: string[];
};

export type HypothesisCaseBatchArticleResult = {
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

export type HypothesisCaseBatchSummary = {
  id: string;
  status: "idle" | "running" | "completed" | "failed";
  requestedArticleIds: string[];
  totalArticleCount: number;
  startedAt: string | null;
  completedAt: string | null;
  lastUpdatedAt: string | null;
  concurrency: number | null;
  okCount: number;
  errorCount: number;
  errorMessage: string | null;
  articleResults: HypothesisCaseBatchArticleResult[];
};

export type HypothesisCaseCandidateMember = {
  id: string;
  candidateId: string;
  runId: string;
  articleId: string;
  memberType: "product" | "signal";
  entityId: string;
  productId: string | null;
  signalId: string | null;
  signalType: string | null;
  rationale: string | null;
  createdAt: string;
};

export type HypothesisCaseCandidateRecord<TPayload = unknown> = {
  id: string;
  runId: string;
  articleId: string;
  title: string;
  lifecycleStatus: HypothesisCaseCandidateLifecycle;
  caseKind: string;
  summary: string;
  suspectedCommonRootCause: string;
  confidence: number | null;
  priority: HypothesisCaseCandidatePriority;
  strongestEvidence: string[];
  conflictingEvidence: string[];
  recommendedNextTraceChecks: string[];
  includedProductIds: string[];
  includedSignalIds: string[];
  payload: TPayload;
  createdAt: string;
  updatedAt: string;
  members: HypothesisCaseCandidateMember[];
};

type HypothesisRunRow = QueryResultRow & {
  run_id: string;
  article_id: string;
  article_name: string | null;
  model_name: string;
  status: HypothesisCaseRunStatus;
  schema_version: string;
  prompt_version: string;
  product_count: number | string | null;
  signal_count: number | string | null;
  issue_count: number | string | null;
  candidate_count: number | string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  current_stage: HypothesisCaseRunStage;
  stage_detail: string | null;
  stage_updated_at: string | null;
  request_payload: unknown;
  proposal_payload: unknown;
  review_payload: unknown;
};

type HypothesisCandidateRow = QueryResultRow & {
  candidate_id: string;
  run_id: string;
  article_id: string;
  title: string;
  lifecycle_status: HypothesisCaseCandidateLifecycle;
  case_kind: string;
  summary: string | null;
  suspected_common_root_cause: string | null;
  confidence: number | string | null;
  priority: HypothesisCaseCandidatePriority;
  strongest_evidence: string[] | null;
  conflicting_evidence: string[] | null;
  recommended_next_trace_checks: string[] | null;
  included_product_ids: string[] | null;
  included_signal_ids: string[] | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

type HypothesisCandidateMemberRow = QueryResultRow & {
  member_id: string;
  candidate_id: string;
  run_id: string;
  article_id: string;
  member_type: "product" | "signal";
  entity_id: string;
  product_id: string | null;
  signal_id: string | null;
  signal_type: string | null;
  rationale: string | null;
  created_at: string;
};

type HypothesisBatchRow = QueryResultRow & {
  batch_id: string;
  status: HypothesisCaseBatchSummary["status"];
  requested_article_ids: string[] | null;
  total_article_count: number | string | null;
  started_at: string | null;
  completed_at: string | null;
  last_updated_at: string | null;
  concurrency: number | string | null;
  ok_count: number | string | null;
  error_count: number | string | null;
  error_message: string | null;
  article_results: unknown;
};

type HypothesisArticleClusterCardRow = QueryResultRow & {
  article_id: string;
  article_name: string | null;
  product_count: number | string | null;
  total_signals: number | string | null;
  defect_count: number | string | null;
  claim_count: number | string | null;
  bad_test_count: number | string | null;
  marginal_test_count: number | string | null;
  latest_signal_at: string | null;
  proposed_case_count: number | string | null;
  run_id: string | null;
  model_name: string | null;
  status: HypothesisCaseRunStatus | null;
  schema_version: string | null;
  prompt_version: string | null;
  run_product_count: number | string | null;
  run_signal_count: number | string | null;
  issue_count: number | string | null;
  candidate_count: number | string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  current_stage: HypothesisCaseRunStage | null;
  stage_detail: string | null;
  stage_updated_at: string | null;
};

const DETERMINISTIC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS team_hyp_case_run (
  run_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  article_name TEXT,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'completed', 'failed')),
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  current_stage TEXT NOT NULL DEFAULT 'queued',
  stage_detail TEXT,
  stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_hyp_case_run_article_id
  ON team_hyp_case_run (article_id, started_at DESC);

CREATE TABLE IF NOT EXISTS team_hyp_case_batch (
  batch_id TEXT PRIMARY KEY,
  status TEXT NOT NULL
    CHECK (status IN ('idle', 'running', 'completed', 'failed')),
  requested_article_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_article_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concurrency INTEGER,
  ok_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  article_results JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_team_hyp_case_batch_started_at
  ON team_hyp_case_batch (started_at DESC NULLS LAST, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS team_hyp_case_candidate (
  candidate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_hyp_case_run(run_id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  title TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (lifecycle_status IN ('proposed', 'accepted', 'rejected', 'merged')),
  case_kind TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  suspected_common_root_cause TEXT NOT NULL DEFAULT '',
  confidence DOUBLE PRECISION,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  strongest_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_next_trace_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_hyp_case_candidate_run_id
  ON team_hyp_case_candidate (run_id);

CREATE INDEX IF NOT EXISTS idx_team_hyp_case_candidate_article_id
  ON team_hyp_case_candidate (article_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_hyp_case_candidate_member (
  member_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES team_hyp_case_candidate(candidate_id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES team_hyp_case_run(run_id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  member_type TEXT NOT NULL CHECK (member_type IN ('product', 'signal')),
  entity_id TEXT NOT NULL,
  product_id TEXT,
  signal_id TEXT,
  signal_type TEXT,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_id, member_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_team_hyp_case_candidate_member_candidate_id
  ON team_hyp_case_candidate_member (candidate_id);

CREATE INDEX IF NOT EXISTS idx_team_hyp_case_candidate_member_product_id
  ON team_hyp_case_candidate_member (product_id);
`;

let ensurePromise: Promise<void> | null = null;

const normalizeText = (value: string | null | undefined) => {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : "";
};

const normalizeNullableText = (value: string | null | undefined) => {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
};

const normalizeInteger = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  return Math.trunc(Number(value));
};

const normalizeNullableNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return Number(value);
};

const normalizeIso = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "")))
        .filter(Boolean)
    : [];

const toBatchArticleResults = (value: unknown) =>
  Array.isArray(value) ? (value as HypothesisCaseBatchArticleResult[]) : [];

function getRequiredPool() {
  const pool = getPostgresPool();

  if (!pool) {
    throw new Error("Hypothesis case clustering requires DATABASE_URL.");
  }

  return pool;
}

async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await connectPostgresClient();

  if (!client) {
    throw new Error("Hypothesis case clustering requires DATABASE_URL.");
  }

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

const mapRunSummary = (row: HypothesisRunRow): HypothesisCaseRunSummary => ({
  id: row.run_id,
  articleId: row.article_id,
  articleName: normalizeNullableText(row.article_name),
  model: row.model_name,
  status: row.status,
  schemaVersion: row.schema_version,
  promptVersion: row.prompt_version,
  productCount: normalizeInteger(row.product_count),
  signalCount: normalizeInteger(row.signal_count),
  issueCount: normalizeInteger(row.issue_count),
  candidateCount: normalizeInteger(row.candidate_count),
  startedAt: new Date(row.started_at).toISOString(),
  completedAt: normalizeIso(row.completed_at),
  errorMessage: normalizeNullableText(row.error_message),
  currentStage: row.current_stage,
  stageDetail: normalizeNullableText(row.stage_detail),
  stageUpdatedAt: normalizeIso(row.stage_updated_at),
  requestPayload: row.request_payload,
  proposalPayload: row.proposal_payload,
  reviewPayload: row.review_payload,
});

const mapCandidateMember = (
  row: HypothesisCandidateMemberRow,
): HypothesisCaseCandidateMember => ({
  id: row.member_id,
  candidateId: row.candidate_id,
  runId: row.run_id,
  articleId: row.article_id,
  memberType: row.member_type,
  entityId: row.entity_id,
  productId: normalizeNullableText(row.product_id),
  signalId: normalizeNullableText(row.signal_id),
  signalType: normalizeNullableText(row.signal_type),
  rationale: normalizeNullableText(row.rationale),
  createdAt: new Date(row.created_at).toISOString(),
});

const mapCandidate = (
  row: HypothesisCandidateRow,
  members: HypothesisCaseCandidateMember[],
): HypothesisCaseCandidateRecord => ({
  id: row.candidate_id,
  runId: row.run_id,
  articleId: row.article_id,
  title: normalizeText(row.title),
  lifecycleStatus: row.lifecycle_status,
  caseKind: normalizeText(row.case_kind),
  summary: normalizeText(row.summary),
  suspectedCommonRootCause: normalizeText(row.suspected_common_root_cause),
  confidence: normalizeNullableNumber(row.confidence),
  priority: row.priority,
  strongestEvidence: toStringArray(row.strongest_evidence),
  conflictingEvidence: toStringArray(row.conflicting_evidence),
  recommendedNextTraceChecks: toStringArray(row.recommended_next_trace_checks),
  includedProductIds: toStringArray(row.included_product_ids),
  includedSignalIds: toStringArray(row.included_signal_ids),
  payload: row.payload,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  members,
});

const mapBatchSummary = (row: HypothesisBatchRow): HypothesisCaseBatchSummary => ({
  id: row.batch_id,
  status: row.status,
  requestedArticleIds: toStringArray(row.requested_article_ids),
  totalArticleCount: normalizeInteger(row.total_article_count),
  startedAt: normalizeIso(row.started_at),
  completedAt: normalizeIso(row.completed_at),
  lastUpdatedAt: normalizeIso(row.last_updated_at),
  concurrency: normalizeNullableNumber(row.concurrency),
  okCount: normalizeInteger(row.ok_count),
  errorCount: normalizeInteger(row.error_count),
  errorMessage: normalizeNullableText(row.error_message),
  articleResults: toBatchArticleResults(row.article_results),
});

export async function ensureHypothesisCaseClusteringState() {
  if (!ensurePromise) {
    getRequiredPool();
    ensurePromise = queryPostgres(DETERMINISTIC_SCHEMA_SQL).then(() => undefined);
  }

  return ensurePromise;
}

export async function resetHypothesisCaseClusteringState() {
  await ensureHypothesisCaseClusteringState();

  return withClient<HypothesisClusteringResetSummary>(async (client) => {
    await client.query("BEGIN");

    try {
      const countRows = await client.query<
        QueryResultRow & {
          runs: number | string | null;
          batches: number | string | null;
          candidates: number | string | null;
          candidate_members: number | string | null;
        }
      >(`
        SELECT
          (SELECT COUNT(*)::int FROM team_hyp_case_run) AS runs,
          (SELECT COUNT(*)::int FROM team_hyp_case_batch) AS batches,
          (SELECT COUNT(*)::int FROM team_hyp_case_candidate) AS candidates,
          (SELECT COUNT(*)::int FROM team_hyp_case_candidate_member) AS candidate_members
      `);

      const counts = countRows.rows[0];

      await client.query("DELETE FROM team_hyp_case_candidate_member");
      await client.query("DELETE FROM team_hyp_case_candidate");
      await client.query("DELETE FROM team_hyp_case_batch");
      await client.query("DELETE FROM team_hyp_case_run");

      await client.query("COMMIT");

      return {
        runs: normalizeInteger(counts?.runs),
        batches: normalizeInteger(counts?.batches),
        candidates: normalizeInteger(counts?.candidates),
        candidateMembers: normalizeInteger(counts?.candidate_members),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function getLatestHypothesisCaseRun(articleId: string) {
  await ensureHypothesisCaseClusteringState();

  const rows =
    (await queryPostgres<HypothesisRunRow>(
      `
        SELECT *
        FROM team_hyp_case_run
        WHERE article_id = $1
        ORDER BY started_at DESC
        LIMIT 1
      `,
      [articleId],
    )) ?? [];

  return rows[0] ? mapRunSummary(rows[0]) : null;
}

export async function stopActiveHypothesisCaseClustering(
  reason = "Pipeline stopped by user.",
) {
  await ensureHypothesisCaseClusteringState();

  return withClient<HypothesisClusteringStopSummary>(async (client) => {
    await client.query("BEGIN");

    try {
      const activeRunsRows = await client.query<
        QueryResultRow & {
          run_id: string;
        }
      >(
        `
          SELECT run_id
          FROM team_hyp_case_run
          WHERE status = 'building'
          ORDER BY started_at ASC
        `,
      );

      const activeBatchRows = await client.query<
        QueryResultRow & {
          batch_id: string;
        }
      >(
        `
          SELECT batch_id
          FROM team_hyp_case_batch
          WHERE status = 'running'
          ORDER BY started_at DESC NULLS LAST, last_updated_at DESC
        `,
      );

      await client.query(
        `
          UPDATE team_hyp_case_run
          SET
            status = 'failed',
            current_stage = 'failed',
            stage_detail = $1,
            stage_updated_at = NOW(),
            completed_at = NOW(),
            error_message = $2,
            proposal_payload = COALESCE(proposal_payload, '{}'::jsonb),
            review_payload = COALESCE(review_payload, '{}'::jsonb)
          WHERE status = 'building'
        `,
        [reason, reason],
      );

      await client.query(
        `
          UPDATE team_hyp_case_batch
          SET
            status = 'failed',
            completed_at = NOW(),
            last_updated_at = NOW(),
            error_message = $1
          WHERE status = 'running'
        `,
        [reason],
      );

      await client.query("COMMIT");

      return {
        stoppedRuns: activeRunsRows.rows.length,
        stoppedBatches: activeBatchRows.rows.length,
        runIds: activeRunsRows.rows.map((row) => row.run_id),
        batchIds: activeBatchRows.rows.map((row) => row.batch_id),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function listActiveHypothesisCaseRuns() {
  await ensureHypothesisCaseClusteringState();

  const rows =
    (await queryPostgres<HypothesisRunRow>(
      `
        SELECT *
        FROM team_hyp_case_run
        WHERE status = 'building'
        ORDER BY started_at DESC
      `,
    )) ?? [];

  return rows.map(mapRunSummary);
}

export async function getLatestHypothesisCaseBatch() {
  await ensureHypothesisCaseClusteringState();

  const rows =
    (await queryPostgres<HypothesisBatchRow>(
      `
        SELECT *
        FROM team_hyp_case_batch
        ORDER BY started_at DESC NULLS LAST, last_updated_at DESC
        LIMIT 1
      `,
    )) ?? [];

  return rows[0] ? mapBatchSummary(rows[0]) : null;
}

export async function upsertHypothesisCaseBatch(input: HypothesisCaseBatchSummary) {
  await ensureHypothesisCaseClusteringState();

  await queryPostgres(
    `
      INSERT INTO team_hyp_case_batch (
        batch_id,
        status,
        requested_article_ids,
        total_article_count,
        started_at,
        completed_at,
        last_updated_at,
        concurrency,
        ok_count,
        error_count,
        error_message,
        article_results
      )
      VALUES (
        $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
      )
      ON CONFLICT (batch_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        requested_article_ids = EXCLUDED.requested_article_ids,
        total_article_count = EXCLUDED.total_article_count,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        last_updated_at = EXCLUDED.last_updated_at,
        concurrency = EXCLUDED.concurrency,
        ok_count = EXCLUDED.ok_count,
        error_count = EXCLUDED.error_count,
        error_message = EXCLUDED.error_message,
        article_results = EXCLUDED.article_results
    `,
    [
      input.id,
      input.status,
      stringifyUnicodeSafe(input.requestedArticleIds),
      input.totalArticleCount,
      input.startedAt ?? null,
      input.completedAt ?? null,
      input.lastUpdatedAt ?? null,
      input.concurrency ?? null,
      input.okCount,
      input.errorCount,
      input.errorMessage ?? null,
      stringifyUnicodeSafe(input.articleResults),
    ],
  );
}

export async function createHypothesisCaseRun(input: {
  id: string;
  articleId: string;
  articleName?: string | null;
  model: string;
  schemaVersion: string;
  promptVersion: string;
  productCount: number;
  signalCount: number;
  issueCount?: number;
  requestPayload: unknown;
  currentStage?: HypothesisCaseRunStage;
  stageDetail?: string | null;
}) {
  await ensureHypothesisCaseClusteringState();

  await queryPostgres(
    `
      INSERT INTO team_hyp_case_run (
        run_id,
        article_id,
        article_name,
        model_name,
        status,
        schema_version,
        prompt_version,
        product_count,
        signal_count,
        issue_count,
        current_stage,
        stage_detail,
        stage_updated_at,
        request_payload
      )
      VALUES (
        $1, $2, $3, $4, 'building', $5, $6, $7, $8, $9, $10, $11, NOW(), $12::jsonb
      )
    `,
    [
      input.id,
      input.articleId,
      input.articleName ?? null,
      input.model,
      input.schemaVersion,
      input.promptVersion,
      input.productCount,
      input.signalCount,
      input.issueCount ?? 0,
      input.currentStage ?? "queued",
      input.stageDetail ?? null,
      stringifyUnicodeSafe(input.requestPayload),
    ],
  );
}

export async function updateHypothesisCaseRunStage(input: {
  id: string;
  currentStage: HypothesisCaseRunStage;
  stageDetail?: string | null;
  productCount?: number;
  signalCount?: number;
  issueCount?: number;
}) {
  await ensureHypothesisCaseClusteringState();

  await queryPostgres(
    `
      UPDATE team_hyp_case_run
      SET
        product_count = COALESCE($2, product_count),
        signal_count = COALESCE($3, signal_count),
        issue_count = COALESCE($4, issue_count),
        current_stage = $5,
        stage_detail = $6,
        stage_updated_at = NOW()
      WHERE run_id = $1
    `,
    [
      input.id,
      input.productCount ?? null,
      input.signalCount ?? null,
      input.issueCount ?? null,
      input.currentStage,
      input.stageDetail ?? null,
    ],
  );
}

export async function completeHypothesisCaseRun(input: {
  id: string;
  issueCount: number;
  candidateCount: number;
  proposalPayload: unknown;
  reviewPayload: unknown;
  stageDetail?: string | null;
}) {
  await ensureHypothesisCaseClusteringState();

  await queryPostgres(
    `
      UPDATE team_hyp_case_run
      SET
        status = 'completed',
        issue_count = $2,
        candidate_count = $3,
        proposal_payload = $4::jsonb,
        review_payload = $5::jsonb,
        current_stage = 'completed',
        stage_detail = $6,
        stage_updated_at = NOW(),
        completed_at = NOW(),
        error_message = NULL
      WHERE run_id = $1
    `,
    [
      input.id,
      input.issueCount,
      input.candidateCount,
      stringifyUnicodeSafe(input.proposalPayload),
      stringifyUnicodeSafe(input.reviewPayload),
      input.stageDetail ?? null,
    ],
  );
}

export async function failHypothesisCaseRun(input: {
  id: string;
  errorMessage: string;
  proposalPayload?: unknown;
  reviewPayload?: unknown;
  stageDetail?: string | null;
}) {
  await ensureHypothesisCaseClusteringState();

  await queryPostgres(
    `
      UPDATE team_hyp_case_run
      SET
        status = 'failed',
        proposal_payload = $3::jsonb,
        review_payload = $4::jsonb,
        current_stage = 'failed',
        stage_detail = $5,
        stage_updated_at = NOW(),
        completed_at = NOW(),
        error_message = $2
      WHERE run_id = $1
    `,
    [
      input.id,
      input.errorMessage,
      stringifyUnicodeSafe(input.proposalPayload ?? {}),
      stringifyUnicodeSafe(input.reviewPayload ?? {}),
      input.stageDetail ?? null,
    ],
  );
}

export async function replaceHypothesisCaseCandidatesForRun(input: {
  runId: string;
  articleId: string;
  candidates: Array<{
    id: string;
    title: string;
    lifecycleStatus?: HypothesisCaseCandidateLifecycle;
    caseKind: string;
    summary: string;
    suspectedCommonRootCause: string;
    confidence?: number | null;
    priority?: HypothesisCaseCandidatePriority;
    strongestEvidence: string[];
    conflictingEvidence: string[];
    recommendedNextTraceChecks: string[];
    includedProductIds: string[];
    includedSignalIds: string[];
    payload: unknown;
    members: Array<{
      id: string;
      memberType: "product" | "signal";
      entityId: string;
      productId?: string | null;
      signalId?: string | null;
      signalType?: string | null;
      rationale?: string | null;
    }>;
  }>;
}) {
  await ensureHypothesisCaseClusteringState();

  await withClient(async (client) => {
    await client.query("BEGIN");

    try {
      await client.query(
        `
          DELETE FROM team_hyp_case_candidate
          WHERE run_id = $1
        `,
        [input.runId],
      );

      for (const candidate of input.candidates) {
        await client.query(
          `
            INSERT INTO team_hyp_case_candidate (
              candidate_id,
              run_id,
              article_id,
              title,
              lifecycle_status,
              case_kind,
              summary,
              suspected_common_root_cause,
              confidence,
              priority,
              strongest_evidence,
              conflicting_evidence,
              recommended_next_trace_checks,
              included_product_ids,
              included_signal_ids,
              payload
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
              $16::jsonb
            )
          `,
          [
            candidate.id,
            input.runId,
            input.articleId,
            candidate.title,
            candidate.lifecycleStatus ?? "proposed",
            candidate.caseKind,
            candidate.summary,
            candidate.suspectedCommonRootCause,
            candidate.confidence ?? null,
            candidate.priority ?? "medium",
            stringifyUnicodeSafe(candidate.strongestEvidence),
            stringifyUnicodeSafe(candidate.conflictingEvidence),
            stringifyUnicodeSafe(candidate.recommendedNextTraceChecks),
            stringifyUnicodeSafe(candidate.includedProductIds),
            stringifyUnicodeSafe(candidate.includedSignalIds),
            stringifyUnicodeSafe(candidate.payload),
          ],
        );

        for (const member of candidate.members) {
          await client.query(
            `
              INSERT INTO team_hyp_case_candidate_member (
                member_id,
                candidate_id,
                run_id,
                article_id,
                member_type,
                entity_id,
                product_id,
                signal_id,
                signal_type,
                rationale
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `,
            [
              member.id,
              candidate.id,
              input.runId,
              input.articleId,
              member.memberType,
              member.entityId,
              member.productId ?? null,
              member.signalId ?? null,
              member.signalType ?? null,
              member.rationale ?? null,
            ],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function listHypothesisCaseCandidatesForRun(runId: string) {
  await ensureHypothesisCaseClusteringState();

  const [candidateRows, memberRows] = await Promise.all([
    queryPostgres<HypothesisCandidateRow>(
      `
        SELECT *
        FROM team_hyp_case_candidate
        WHERE run_id = $1
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      `,
      [runId],
    ).then((rows) => rows ?? []),
    queryPostgres<HypothesisCandidateMemberRow>(
      `
        SELECT *
        FROM team_hyp_case_candidate_member
        WHERE run_id = $1
        ORDER BY created_at ASC
      `,
      [runId],
    ).then((rows) => rows ?? []),
  ]);

  const memberMap = memberRows.reduce((map, row) => {
    const current = map.get(row.candidate_id) ?? [];
    current.push(mapCandidateMember(row));
    map.set(row.candidate_id, current);
    return map;
  }, new Map<string, HypothesisCaseCandidateMember[]>());

  return candidateRows.map((row) => mapCandidate(row, memberMap.get(row.candidate_id) ?? []));
}

export async function listHypothesisCaseCandidatesForProduct(productId: string) {
  await ensureHypothesisCaseClusteringState();

  const [candidateRows, memberRows] = await Promise.all([
    queryPostgres<HypothesisCandidateRow>(
      `
        SELECT DISTINCT c.*
        FROM team_hyp_case_candidate c
        JOIN team_hyp_case_candidate_member m
          ON m.candidate_id = c.candidate_id
        WHERE m.product_id = $1
        ORDER BY c.created_at DESC
      `,
      [productId],
    ).then((rows) => rows ?? []),
    queryPostgres<HypothesisCandidateMemberRow>(
      `
        SELECT m.*
        FROM team_hyp_case_candidate_member m
        WHERE m.product_id = $1
           OR m.candidate_id IN (
             SELECT candidate_id
             FROM team_hyp_case_candidate_member
             WHERE product_id = $1
           )
        ORDER BY m.created_at ASC
      `,
      [productId],
    ).then((rows) => rows ?? []),
  ]);

  const memberMap = memberRows.reduce((map, row) => {
    const current = map.get(row.candidate_id) ?? [];
    current.push(mapCandidateMember(row));
    map.set(row.candidate_id, current);
    return map;
  }, new Map<string, HypothesisCaseCandidateMember[]>());

  return candidateRows.map((row) => mapCandidate(row, memberMap.get(row.candidate_id) ?? []));
}

export async function listHypothesisArticleClusterCards() {
  await ensureHypothesisCaseClusteringState();

  const rows =
    (await queryPostgres<HypothesisArticleClusterCardRow>(
      `
      WITH product_counts AS (
        SELECT
          article_id,
          COUNT(*)::int AS product_count
        FROM product
        GROUP BY article_id
      ),
      signal_counts AS (
        SELECT
          article_id,
          MAX(article_name) AS article_name,
          COUNT(*)::int AS total_signals,
          COUNT(*) FILTER (WHERE signal_type = 'defect')::int AS defect_count,
          COUNT(*) FILTER (WHERE signal_type = 'field_claim')::int AS claim_count,
          COUNT(*) FILTER (WHERE signal_type = 'bad_test')::int AS bad_test_count,
          COUNT(*) FILTER (WHERE signal_type = 'marginal_test')::int AS marginal_test_count,
          MAX(occurred_at) AS latest_signal_at
        FROM team_signal_inbox
        GROUP BY article_id
      ),
      latest_runs AS (
        SELECT DISTINCT ON (article_id)
          run_id,
          article_id,
          article_name,
          model_name,
          status,
          schema_version,
          prompt_version,
          product_count AS run_product_count,
          signal_count AS run_signal_count,
          issue_count,
          candidate_count,
          started_at,
          completed_at,
          error_message,
          current_stage,
          stage_detail,
          stage_updated_at
        FROM team_hyp_case_run
        ORDER BY article_id, started_at DESC
      ),
      latest_proposed_cases AS (
        SELECT
          article_id,
          COUNT(*)::int AS proposed_case_count
        FROM team_hyp_case_candidate
        WHERE lifecycle_status = 'proposed'
        GROUP BY article_id
      )
      SELECT
        a.article_id,
        COALESCE(a.name, sc.article_name) AS article_name,
        COALESCE(pc.product_count, 0) AS product_count,
        COALESCE(sc.total_signals, 0) AS total_signals,
        COALESCE(sc.defect_count, 0) AS defect_count,
        COALESCE(sc.claim_count, 0) AS claim_count,
        COALESCE(sc.bad_test_count, 0) AS bad_test_count,
        COALESCE(sc.marginal_test_count, 0) AS marginal_test_count,
        sc.latest_signal_at,
        COALESCE(lpc.proposed_case_count, 0) AS proposed_case_count,
        lr.run_id,
        lr.model_name,
        lr.status,
        lr.schema_version,
        lr.prompt_version,
        lr.run_product_count,
        lr.run_signal_count,
        lr.issue_count,
        lr.candidate_count,
        lr.started_at,
        lr.completed_at,
        lr.error_message,
        lr.current_stage,
        lr.stage_detail,
        lr.stage_updated_at
      FROM article a
      LEFT JOIN product_counts pc ON pc.article_id = a.article_id
      LEFT JOIN signal_counts sc ON sc.article_id = a.article_id
      LEFT JOIN latest_runs lr ON lr.article_id = a.article_id
      LEFT JOIN latest_proposed_cases lpc ON lpc.article_id = a.article_id
      WHERE pc.product_count IS NOT NULL
      ORDER BY COALESCE(sc.total_signals, 0) DESC, a.article_id
    `,
    )) ?? [];

  return rows.map((row) => ({
    articleId: row.article_id,
    articleName: normalizeNullableText(row.article_name),
    productCount: normalizeInteger(row.product_count),
    totalSignals: normalizeInteger(row.total_signals),
    defectCount: normalizeInteger(row.defect_count),
    claimCount: normalizeInteger(row.claim_count),
    badTestCount: normalizeInteger(row.bad_test_count),
    marginalTestCount: normalizeInteger(row.marginal_test_count),
    latestSignalAt: normalizeIso(row.latest_signal_at),
    proposedCaseCount: normalizeInteger(row.proposed_case_count),
    latestRun: row.run_id
      ? {
          id: row.run_id,
          articleId: row.article_id,
          articleName: normalizeNullableText(row.article_name),
          model: normalizeText(row.model_name),
          status: row.status ?? "failed",
          schemaVersion: normalizeText(row.schema_version),
          promptVersion: normalizeText(row.prompt_version),
          productCount: normalizeInteger(row.run_product_count),
          signalCount: normalizeInteger(row.run_signal_count),
          issueCount: normalizeInteger(row.issue_count),
          candidateCount: normalizeInteger(row.candidate_count),
          startedAt: normalizeIso(row.started_at) ?? new Date(0).toISOString(),
          completedAt: normalizeIso(row.completed_at),
          errorMessage: normalizeNullableText(row.error_message),
          currentStage: row.current_stage ?? "queued",
          stageDetail: normalizeNullableText(row.stage_detail),
          stageUpdatedAt: normalizeIso(row.stage_updated_at),
          requestPayload: undefined,
          proposalPayload: undefined,
          reviewPayload: undefined,
        }
      : null,
  }));
}
