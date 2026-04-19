import type { QueryResultRow } from "pg";

import { connectPostgresClient, getPostgresPool, queryPostgres } from "@/lib/postgres";

export type ArticleHypothesisReviewStatus =
  | "leading"
  | "plausible"
  | "weak"
  | "ruled_out"
  | "confirmed";

export type ArticleHypothesisReviewPipelineMode =
  | "current"
  | "deterministic"
  | "hypothesis"
  | "investigate"
  | "dummy";

export type ArticleHypothesisReview = {
  id: string;
  articleId: string;
  candidateId: string;
  pipelineMode: ArticleHypothesisReviewPipelineMode;
  status: ArticleHypothesisReviewStatus;
  candidateTitle: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReviewRow = QueryResultRow & {
  review_id: string;
  article_id: string;
  candidate_id: string;
  pipeline_mode: ArticleHypothesisReviewPipelineMode;
  status: ArticleHypothesisReviewStatus;
  candidate_title: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const REVIEW_STATE_SQL = `
CREATE TABLE IF NOT EXISTS team_hypothesis_review (
  review_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  pipeline_mode TEXT NOT NULL
    CHECK (pipeline_mode IN ('current', 'deterministic', 'hypothesis', 'investigate', 'dummy')),
  status TEXT NOT NULL
    CHECK (status IN ('leading', 'plausible', 'weak', 'ruled_out', 'confirmed')),
  candidate_title TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, pipeline_mode, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_team_hypothesis_review_article_mode
  ON team_hypothesis_review (article_id, pipeline_mode, updated_at DESC);
`;

let ensurePromise: Promise<void> | null = null;

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function mapReview(row: ReviewRow): ArticleHypothesisReview {
  return {
    id: row.review_id,
    articleId: row.article_id,
    candidateId: row.candidate_id,
    pipelineMode: row.pipeline_mode,
    status: row.status,
    candidateTitle: normalizeNullableText(row.candidate_title),
    createdBy: normalizeNullableText(row.created_by),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function withClient<T>(callback: (client: NonNullable<Awaited<ReturnType<typeof connectPostgresClient>>>) => Promise<T>) {
  const client = await connectPostgresClient();

  if (!client) {
    throw new Error("Hypothesis review state requires DATABASE_URL.");
  }

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function ensureArticleHypothesisReviewState() {
  if (!ensurePromise) {
    const pool = getPostgresPool();

    if (!pool) {
      return;
    }

    ensurePromise = queryPostgres(REVIEW_STATE_SQL).then(() => undefined);
  }

  return ensurePromise;
}

export async function listArticleHypothesisReviews(
  articleId: string,
  pipelineMode: ArticleHypothesisReviewPipelineMode,
) {
  if (!getPostgresPool()) {
    return [] as ArticleHypothesisReview[];
  }

  await ensureArticleHypothesisReviewState();

  const rows =
    (await queryPostgres<ReviewRow>(
      `
        SELECT *
        FROM team_hypothesis_review
        WHERE article_id = $1
          AND pipeline_mode = $2
        ORDER BY updated_at DESC, created_at DESC
      `,
      [articleId, pipelineMode],
    )) ?? [];

  return rows.map(mapReview);
}

export async function upsertArticleHypothesisReview(input: {
  id: string;
  articleId: string;
  candidateId: string;
  pipelineMode: ArticleHypothesisReviewPipelineMode;
  status: ArticleHypothesisReviewStatus;
  candidateTitle?: string | null;
  createdBy?: string | null;
}) {
  await ensureArticleHypothesisReviewState();

  return withClient<ArticleHypothesisReview>(async (client) => {
    const result = await client.query<ReviewRow>(
      `
        INSERT INTO team_hypothesis_review (
          review_id,
          article_id,
          candidate_id,
          pipeline_mode,
          status,
          candidate_title,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (article_id, pipeline_mode, candidate_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          candidate_title = EXCLUDED.candidate_title,
          updated_at = NOW()
        RETURNING *
      `,
      [
        input.id,
        input.articleId,
        input.candidateId,
        input.pipelineMode,
        input.status,
        normalizeNullableText(input.candidateTitle),
        normalizeNullableText(input.createdBy),
      ],
    );

    return mapReview(result.rows[0]);
  });
}
