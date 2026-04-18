import type { PoolClient, QueryResultRow } from "pg";

import {
  connectPostgresClient,
  getPostgresPool,
  queryPostgres,
} from "@/lib/postgres";

export type TeamCaseRunStatus = "building" | "completed" | "failed";
export type TeamCaseRunStrategy = "single" | "chunked";
export type TeamCaseCandidateLifecycle = "proposed" | "accepted" | "rejected" | "merged";
export type TeamCaseCandidatePriority = "low" | "medium" | "high" | "critical";

export type TeamArticleClusterCard = {
  articleId: string;
  articleName: string | null;
  productCount: number;
  totalSignals: number;
  defectCount: number;
  claimCount: number;
  badTestCount: number;
  marginalTestCount: number;
  latestSignalAt: string | null;
  latestRun: TeamCaseRunSummary | null;
  proposedCaseCount: number;
};

export type TeamCaseRunSummary = {
  id: string;
  articleId: string;
  articleName: string | null;
  model: string;
  status: TeamCaseRunStatus;
  strategy: TeamCaseRunStrategy;
  schemaVersion: string;
  promptVersion: string;
  productCount: number;
  signalCount: number;
  candidateCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
};

export type TeamPersistedProductDossierRecord<TPayload = unknown> = {
  productId: string;
  articleId: string;
  articleName: string | null;
  buildTs: string | null;
  orderId: string | null;
  signalCount: number;
  sourceCounts: Record<string, number>;
  summaryFeatures: Record<string, unknown>;
  payload: TPayload;
  generatedAt: string;
  updatedAt: string;
};

export type TeamPersistedArticleDossierRecord<TPayload = unknown> = {
  articleId: string;
  articleName: string | null;
  productCount: number;
  signalCount: number;
  summaryPayload: Record<string, unknown>;
  payload: TPayload;
  generatedAt: string;
  updatedAt: string;
};

export type TeamCaseCandidateMember = {
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

export type TeamCaseCandidateRecord<TPayload = unknown> = {
  id: string;
  runId: string;
  articleId: string;
  title: string;
  lifecycleStatus: TeamCaseCandidateLifecycle;
  caseKind: string;
  summary: string;
  suspectedCommonRootCause: string;
  suspectedRootCauseFamily: string | null;
  confidence: number | null;
  priority: TeamCaseCandidatePriority;
  strongestEvidence: string[];
  weakestEvidence: string[];
  sharedEvidence: string[];
  conflictingEvidence: string[];
  recommendedNextTraceChecks: string[];
  includedProductIds: string[];
  includedSignalIds: string[];
  payload: TPayload;
  createdAt: string;
  updatedAt: string;
  members: TeamCaseCandidateMember[];
};

type ProductDossierRow = QueryResultRow & {
  product_id: string;
  article_id: string;
  article_name: string | null;
  build_ts: string | null;
  order_id: string | null;
  signal_count: number | string | null;
  source_counts: Record<string, number> | null;
  summary_features: Record<string, unknown> | null;
  dossier_payload: unknown;
  generated_at: string;
  updated_at: string;
};

type ArticleDossierRow = QueryResultRow & {
  article_id: string;
  article_name: string | null;
  product_count: number | string | null;
  signal_count: number | string | null;
  summary_payload: Record<string, unknown> | null;
  dossier_payload: unknown;
  generated_at: string;
  updated_at: string;
};

type CaseRunRow = QueryResultRow & {
  run_id: string;
  article_id: string;
  article_name: string | null;
  model_name: string;
  status: TeamCaseRunStatus;
  strategy: TeamCaseRunStrategy;
  schema_version: string;
  prompt_version: string;
  product_count: number | string | null;
  signal_count: number | string | null;
  candidate_count: number | string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
};

type CaseCandidateRow = QueryResultRow & {
  candidate_id: string;
  run_id: string;
  article_id: string;
  title: string;
  lifecycle_status: TeamCaseCandidateLifecycle;
  case_kind: string;
  summary: string | null;
  suspected_common_root_cause: string | null;
  suspected_root_cause_family: string | null;
  confidence: number | string | null;
  priority: TeamCaseCandidatePriority;
  strongest_evidence: string[] | null;
  weakest_evidence: string[] | null;
  shared_evidence: string[] | null;
  conflicting_evidence: string[] | null;
  recommended_next_trace_checks: string[] | null;
  included_product_ids: string[] | null;
  included_signal_ids: string[] | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

type CaseCandidateMemberRow = QueryResultRow & {
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

type ArticleClusterCardRow = QueryResultRow & {
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
  status: TeamCaseRunStatus | null;
  strategy: TeamCaseRunStrategy | null;
  schema_version: string | null;
  prompt_version: string | null;
  run_product_count: number | string | null;
  run_signal_count: number | string | null;
  candidate_count: number | string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

const CLUSTERING_SCHEMA_SQL = `
CREATE OR REPLACE VIEW team_signal_inbox AS
  SELECT
    'defect'::text AS signal_type,
    defect_id::text AS signal_id,
    article_id::text AS article_id,
    article_name::text AS article_name,
    product_id::text AS product_id,
    defect_ts AS occurred_at,
    defect_code::text AS signal_code,
    severity::text AS severity,
    reported_part_number::text AS reported_part_number,
    notes::text AS narrative_text,
    image_url::text AS image_url
  FROM v_defect_detail
  UNION ALL
  SELECT
    'field_claim'::text AS signal_type,
    field_claim_id::text AS signal_id,
    article_id::text AS article_id,
    article_name::text AS article_name,
    product_id::text AS product_id,
    claim_ts AS occurred_at,
    COALESCE(mapped_defect_code, reported_part_number, field_claim_id)::text AS signal_code,
    mapped_defect_severity::text AS severity,
    reported_part_number::text AS reported_part_number,
    COALESCE(complaint_text, notes, '')::text AS narrative_text,
    image_url::text AS image_url
  FROM v_field_claim_detail
  UNION ALL
  SELECT
    CASE
      WHEN tr.overall_result = 'FAIL' THEN 'bad_test'
      ELSE 'marginal_test'
    END::text AS signal_type,
    tr.test_result_id::text AS signal_id,
    p.article_id::text AS article_id,
    a.name::text AS article_name,
    tr.product_id::text AS product_id,
    tr.ts AS occurred_at,
    tr.test_key::text AS signal_code,
    CASE
      WHEN tr.overall_result = 'FAIL' THEN 'high'
      WHEN tr.overall_result = 'MARGINAL' THEN 'medium'
      ELSE NULL
    END::text AS severity,
    NULL::text AS reported_part_number,
    COALESCE(tr.notes, tr.test_key, '')::text AS narrative_text,
    NULL::text AS image_url
  FROM test_result tr
  JOIN product p ON p.product_id = tr.product_id
  LEFT JOIN article a ON a.article_id = p.article_id
  WHERE tr.overall_result IN ('FAIL', 'MARGINAL');

CREATE TABLE IF NOT EXISTS team_product_dossier (
  product_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  article_name TEXT,
  build_ts TIMESTAMPTZ,
  order_id TEXT,
  signal_count INTEGER NOT NULL DEFAULT 0,
  source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_features JSONB NOT NULL DEFAULT '{}'::jsonb,
  dossier_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_product_dossier_article_id
  ON team_product_dossier (article_id);

CREATE TABLE IF NOT EXISTS team_article_dossier (
  article_id TEXT PRIMARY KEY,
  article_name TEXT,
  product_count INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  summary_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dossier_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_case_run (
  run_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  article_name TEXT,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'completed', 'failed')),
  strategy TEXT NOT NULL DEFAULT 'single'
    CHECK (strategy IN ('single', 'chunked')),
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  builder_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_team_case_run_article_id
  ON team_case_run (article_id, started_at DESC);

CREATE TABLE IF NOT EXISTS team_case_candidate (
  candidate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_case_run(run_id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  title TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (lifecycle_status IN ('proposed', 'accepted', 'rejected', 'merged')),
  case_kind TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  suspected_common_root_cause TEXT NOT NULL DEFAULT '',
  suspected_root_cause_family TEXT,
  confidence DOUBLE PRECISION,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  strongest_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  weakest_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  shared_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_next_trace_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_case_candidate_run_id
  ON team_case_candidate (run_id);

CREATE INDEX IF NOT EXISTS idx_team_case_candidate_article_id
  ON team_case_candidate (article_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_case_candidate_member (
  member_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES team_case_candidate(candidate_id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES team_case_run(run_id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_team_case_candidate_member_candidate_id
  ON team_case_candidate_member (candidate_id);

CREATE INDEX IF NOT EXISTS idx_team_case_candidate_member_product_id
  ON team_case_candidate_member (product_id);

CREATE INDEX IF NOT EXISTS idx_team_case_candidate_member_signal_id
  ON team_case_candidate_member (signal_id);
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

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "")))
        .filter(Boolean)
    : [];

function getRequiredPool() {
  const pool = getPostgresPool();

  if (!pool) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  return pool;
}

async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await connectPostgresClient();

  if (!client) {
    throw new Error("Case clustering requires DATABASE_URL.");
  }

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function ensureTeamCaseClusteringState() {
  if (!ensurePromise) {
    getRequiredPool();
    ensurePromise = queryPostgres(CLUSTERING_SCHEMA_SQL).then(() => undefined);
  }

  return ensurePromise;
}

const mapRunSummary = (row: CaseRunRow): TeamCaseRunSummary => ({
  id: row.run_id,
  articleId: row.article_id,
  articleName: normalizeNullableText(row.article_name),
  model: row.model_name,
  status: row.status,
  strategy: row.strategy,
  schemaVersion: row.schema_version,
  promptVersion: row.prompt_version,
  productCount: normalizeInteger(row.product_count),
  signalCount: normalizeInteger(row.signal_count),
  candidateCount: normalizeInteger(row.candidate_count),
  startedAt: new Date(row.started_at).toISOString(),
  completedAt: normalizeIso(row.completed_at),
  errorMessage: normalizeNullableText(row.error_message),
});

const mapCandidateMember = (
  row: CaseCandidateMemberRow,
): TeamCaseCandidateMember => ({
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
  row: CaseCandidateRow,
  members: TeamCaseCandidateMember[],
): TeamCaseCandidateRecord => ({
  id: row.candidate_id,
  runId: row.run_id,
  articleId: row.article_id,
  title: normalizeText(row.title),
  lifecycleStatus: row.lifecycle_status,
  caseKind: normalizeText(row.case_kind),
  summary: normalizeText(row.summary),
  suspectedCommonRootCause: normalizeText(row.suspected_common_root_cause),
  suspectedRootCauseFamily: normalizeNullableText(row.suspected_root_cause_family),
  confidence: normalizeNullableNumber(row.confidence),
  priority: row.priority,
  strongestEvidence: toStringArray(row.strongest_evidence),
  weakestEvidence: toStringArray(row.weakest_evidence),
  sharedEvidence: toStringArray(row.shared_evidence),
  conflictingEvidence: toStringArray(row.conflicting_evidence),
  recommendedNextTraceChecks: toStringArray(row.recommended_next_trace_checks),
  includedProductIds: toStringArray(row.included_product_ids),
  includedSignalIds: toStringArray(row.included_signal_ids),
  payload: row.payload,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  members,
});

export async function listTeamArticleClusterCards() {
  await ensureTeamCaseClusteringState();

  const rows =
    (await queryPostgres<ArticleClusterCardRow>(
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
          strategy,
          schema_version,
          prompt_version,
          product_count AS run_product_count,
          signal_count AS run_signal_count,
          candidate_count,
          started_at,
          completed_at,
          error_message
        FROM team_case_run
        ORDER BY article_id, started_at DESC
      ),
      latest_proposed_cases AS (
        SELECT
          article_id,
          COUNT(*)::int AS proposed_case_count
        FROM team_case_candidate
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
        lr.strategy,
        lr.schema_version,
        lr.prompt_version,
        lr.run_product_count,
        lr.run_signal_count,
        lr.candidate_count,
        lr.started_at,
        lr.completed_at,
        lr.error_message
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
          strategy: row.strategy ?? "single",
          schemaVersion: normalizeText(row.schema_version),
          promptVersion: normalizeText(row.prompt_version),
          productCount: normalizeInteger(row.run_product_count),
          signalCount: normalizeInteger(row.run_signal_count),
          candidateCount: normalizeInteger(row.candidate_count),
          startedAt: normalizeIso(row.started_at) ?? new Date(0).toISOString(),
          completedAt: normalizeIso(row.completed_at),
          errorMessage: normalizeNullableText(row.error_message),
        }
      : null,
  }));
}

export async function getLatestTeamCaseRun(articleId: string) {
  await ensureTeamCaseClusteringState();

  const rows =
    (await queryPostgres<CaseRunRow>(
      `
      SELECT *
      FROM team_case_run
      WHERE article_id = $1
      ORDER BY started_at DESC
      LIMIT 1
    `,
      [articleId],
    )) ?? [];

  return rows[0] ? mapRunSummary(rows[0]) : null;
}

export async function getTeamArticleDossierRecord<TPayload = unknown>(
  articleId: string,
) {
  await ensureTeamCaseClusteringState();

  const rows =
    (await queryPostgres<ArticleDossierRow>(
      `
      SELECT *
      FROM team_article_dossier
      WHERE article_id = $1
      LIMIT 1
    `,
      [articleId],
    )) ?? [];

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    articleId: row.article_id,
    articleName: normalizeNullableText(row.article_name),
    productCount: normalizeInteger(row.product_count),
    signalCount: normalizeInteger(row.signal_count),
    summaryPayload: toRecord(row.summary_payload),
    payload: row.dossier_payload as TPayload,
    generatedAt: new Date(row.generated_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  } satisfies TeamPersistedArticleDossierRecord<TPayload>;
}

export async function getTeamProductDossierRecord<TPayload = unknown>(
  productId: string,
) {
  await ensureTeamCaseClusteringState();

  const rows =
    (await queryPostgres<ProductDossierRow>(
      `
      SELECT *
      FROM team_product_dossier
      WHERE product_id = $1
      LIMIT 1
    `,
      [productId],
    )) ?? [];

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    productId: row.product_id,
    articleId: row.article_id,
    articleName: normalizeNullableText(row.article_name),
    buildTs: normalizeIso(row.build_ts),
    orderId: normalizeNullableText(row.order_id),
    signalCount: normalizeInteger(row.signal_count),
    sourceCounts: toRecord(row.source_counts) as Record<string, number>,
    summaryFeatures: toRecord(row.summary_features),
    payload: row.dossier_payload as TPayload,
    generatedAt: new Date(row.generated_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  } satisfies TeamPersistedProductDossierRecord<TPayload>;
}

export async function upsertTeamProductDossier(input: {
  productId: string;
  articleId: string;
  articleName?: string | null;
  buildTs?: string | null;
  orderId?: string | null;
  signalCount: number;
  sourceCounts: Record<string, number>;
  summaryFeatures: Record<string, unknown>;
  payload: unknown;
}) {
  await ensureTeamCaseClusteringState();

  await queryPostgres(
    `
      INSERT INTO team_product_dossier (
        product_id,
        article_id,
        article_name,
        build_ts,
        order_id,
        signal_count,
        source_counts,
        summary_features,
        dossier_payload,
        generated_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, NOW(), NOW())
      ON CONFLICT (product_id)
      DO UPDATE SET
        article_id = EXCLUDED.article_id,
        article_name = EXCLUDED.article_name,
        build_ts = EXCLUDED.build_ts,
        order_id = EXCLUDED.order_id,
        signal_count = EXCLUDED.signal_count,
        source_counts = EXCLUDED.source_counts,
        summary_features = EXCLUDED.summary_features,
        dossier_payload = EXCLUDED.dossier_payload,
        generated_at = NOW(),
        updated_at = NOW()
    `,
    [
      input.productId,
      input.articleId,
      input.articleName ?? null,
      input.buildTs ?? null,
      input.orderId ?? null,
      input.signalCount,
      JSON.stringify(input.sourceCounts),
      JSON.stringify(input.summaryFeatures),
      JSON.stringify(input.payload),
    ],
  );
}

export async function upsertTeamArticleDossier(input: {
  articleId: string;
  articleName?: string | null;
  productCount: number;
  signalCount: number;
  summaryPayload: Record<string, unknown>;
  payload: unknown;
}) {
  await ensureTeamCaseClusteringState();

  await queryPostgres(
    `
      INSERT INTO team_article_dossier (
        article_id,
        article_name,
        product_count,
        signal_count,
        summary_payload,
        dossier_payload,
        generated_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())
      ON CONFLICT (article_id)
      DO UPDATE SET
        article_name = EXCLUDED.article_name,
        product_count = EXCLUDED.product_count,
        signal_count = EXCLUDED.signal_count,
        summary_payload = EXCLUDED.summary_payload,
        dossier_payload = EXCLUDED.dossier_payload,
        generated_at = NOW(),
        updated_at = NOW()
    `,
    [
      input.articleId,
      input.articleName ?? null,
      input.productCount,
      input.signalCount,
      JSON.stringify(input.summaryPayload),
      JSON.stringify(input.payload),
    ],
  );
}

export async function createTeamCaseRun(input: {
  id: string;
  articleId: string;
  articleName?: string | null;
  model: string;
  strategy: TeamCaseRunStrategy;
  schemaVersion: string;
  promptVersion: string;
  productCount: number;
  signalCount: number;
  builderPayload: unknown;
  requestPayload: unknown;
}) {
  await ensureTeamCaseClusteringState();

  await queryPostgres(
    `
      INSERT INTO team_case_run (
        run_id,
        article_id,
        article_name,
        model_name,
        status,
        strategy,
        schema_version,
        prompt_version,
        product_count,
        signal_count,
        builder_payload,
        request_payload
      )
      VALUES ($1, $2, $3, $4, 'building', $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
    `,
    [
      input.id,
      input.articleId,
      input.articleName ?? null,
      input.model,
      input.strategy,
      input.schemaVersion,
      input.promptVersion,
      input.productCount,
      input.signalCount,
      JSON.stringify(input.builderPayload),
      JSON.stringify(input.requestPayload),
    ],
  );
}

export async function completeTeamCaseRun(input: {
  id: string;
  candidateCount: number;
  proposalPayload: unknown;
  reviewPayload: unknown;
}) {
  await ensureTeamCaseClusteringState();

  await queryPostgres(
    `
      UPDATE team_case_run
      SET
        status = 'completed',
        candidate_count = $2,
        proposal_payload = $3::jsonb,
        review_payload = $4::jsonb,
        completed_at = NOW(),
        error_message = NULL
      WHERE run_id = $1
    `,
    [
      input.id,
      input.candidateCount,
      JSON.stringify(input.proposalPayload),
      JSON.stringify(input.reviewPayload),
    ],
  );
}

export async function failTeamCaseRun(input: {
  id: string;
  errorMessage: string;
  proposalPayload?: unknown;
  reviewPayload?: unknown;
}) {
  await ensureTeamCaseClusteringState();

  await queryPostgres(
    `
      UPDATE team_case_run
      SET
        status = 'failed',
        proposal_payload = $3::jsonb,
        review_payload = $4::jsonb,
        completed_at = NOW(),
        error_message = $2
      WHERE run_id = $1
    `,
    [
      input.id,
      input.errorMessage,
      JSON.stringify(input.proposalPayload ?? {}),
      JSON.stringify(input.reviewPayload ?? {}),
    ],
  );
}

export async function replaceTeamCaseCandidatesForRun(input: {
  runId: string;
  articleId: string;
  candidates: Array<{
    id: string;
    title: string;
    lifecycleStatus?: TeamCaseCandidateLifecycle;
    caseKind: string;
    summary: string;
    suspectedCommonRootCause: string;
    suspectedRootCauseFamily?: string | null;
    confidence?: number | null;
    priority?: TeamCaseCandidatePriority;
    strongestEvidence: string[];
    weakestEvidence: string[];
    sharedEvidence: string[];
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
  await ensureTeamCaseClusteringState();

  await withClient(async (client) => {
    await client.query("BEGIN");

    try {
      await client.query(
        `
          DELETE FROM team_case_candidate
          WHERE run_id = $1
        `,
        [input.runId],
      );

      for (const candidate of input.candidates) {
        await client.query(
          `
            INSERT INTO team_case_candidate (
              candidate_id,
              run_id,
              article_id,
              title,
              lifecycle_status,
              case_kind,
              summary,
              suspected_common_root_cause,
              suspected_root_cause_family,
              confidence,
              priority,
              strongest_evidence,
              weakest_evidence,
              shared_evidence,
              conflicting_evidence,
              recommended_next_trace_checks,
              included_product_ids,
              included_signal_ids,
              payload
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb,
              $17::jsonb, $18::jsonb, $19::jsonb
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
            candidate.suspectedRootCauseFamily ?? null,
            candidate.confidence ?? null,
            candidate.priority ?? "medium",
            JSON.stringify(candidate.strongestEvidence),
            JSON.stringify(candidate.weakestEvidence),
            JSON.stringify(candidate.sharedEvidence),
            JSON.stringify(candidate.conflictingEvidence),
            JSON.stringify(candidate.recommendedNextTraceChecks),
            JSON.stringify(candidate.includedProductIds),
            JSON.stringify(candidate.includedSignalIds),
            JSON.stringify(candidate.payload),
          ],
        );

        for (const member of candidate.members) {
          await client.query(
            `
              INSERT INTO team_case_candidate_member (
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

export async function listTeamCaseCandidatesForRun(runId: string) {
  await ensureTeamCaseClusteringState();

  const [candidateRows, memberRows] = await Promise.all([
    queryPostgres<CaseCandidateRow>(
      `
        SELECT *
        FROM team_case_candidate
        WHERE run_id = $1
        ORDER BY confidence DESC NULLS LAST, created_at ASC
      `,
      [runId],
    ).then((rows) => rows ?? []),
    queryPostgres<CaseCandidateMemberRow>(
      `
        SELECT *
        FROM team_case_candidate_member
        WHERE run_id = $1
        ORDER BY created_at ASC
      `,
      [runId],
    ).then((rows) => rows ?? []),
  ]);

  const memberMap = memberRows.reduce(
    (map, row) => {
      const current = map.get(row.candidate_id) ?? [];
      current.push(mapCandidateMember(row));
      map.set(row.candidate_id, current);
      return map;
    },
    new Map<string, TeamCaseCandidateMember[]>(),
  );

  return candidateRows.map((row) =>
    mapCandidate(row, memberMap.get(row.candidate_id) ?? []),
  );
}

export async function listTeamCaseCandidatesForProduct(productId: string) {
  await ensureTeamCaseClusteringState();

  const [candidateRows, memberRows] = await Promise.all([
    queryPostgres<CaseCandidateRow>(
      `
        SELECT DISTINCT c.*
        FROM team_case_candidate c
        JOIN team_case_candidate_member m
          ON m.candidate_id = c.candidate_id
        WHERE m.product_id = $1
        ORDER BY c.created_at DESC
      `,
      [productId],
    ).then((rows) => rows ?? []),
    queryPostgres<CaseCandidateMemberRow>(
      `
        SELECT m.*
        FROM team_case_candidate_member m
        WHERE m.product_id = $1
           OR m.candidate_id IN (
             SELECT candidate_id
             FROM team_case_candidate_member
             WHERE product_id = $1
           )
        ORDER BY m.created_at ASC
      `,
      [productId],
    ).then((rows) => rows ?? []),
  ]);

  const memberMap = memberRows.reduce(
    (map, row) => {
      const current = map.get(row.candidate_id) ?? [];
      current.push(mapCandidateMember(row));
      map.set(row.candidate_id, current);
      return map;
    },
    new Map<string, TeamCaseCandidateMember[]>(),
  );

  return candidateRows.map((row) =>
    mapCandidate(row, memberMap.get(row.candidate_id) ?? []),
  );
}
