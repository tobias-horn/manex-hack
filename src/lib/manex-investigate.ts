import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";

import {
  buildArticleDossier,
  type ClusteredArticleDossier,
} from "@/lib/manex-case-clustering";
import { getTeamArticleDossierRecord } from "@/lib/manex-case-clustering-state";
import { capabilities, env } from "@/lib/env";
import {
  completeInvestigateRun,
  createInvestigateRun,
  failInvestigateRun,
  getLatestInvestigateBatch,
  getLatestInvestigateRun,
  listActiveInvestigateRuns,
  listLatestCompletedInvestigateRunsByArticle,
  type InvestigateBatchArticleResult,
  type InvestigateBatchSummary,
  type InvestigateRunSummary,
  updateInvestigateRunStage,
} from "@/lib/manex-investigate-state";
import { queryPostgres } from "@/lib/postgres";
import {
  buildManexInvestigateUserPrompt,
  MANEX_INVESTIGATE_PROMPT_VERSION,
  MANEX_INVESTIGATE_SYSTEM_PROMPT,
} from "@/prompts/manex-investigate";
import { parseJsonFromModelText, throttleOpenAiRequest } from "@/lib/openai-resilience";
import { memoizeWithTtl } from "@/lib/server-cache";
import { normalizeUiIdentifier } from "@/lib/ui-format";

const INVESTIGATE_ARTICLE_PIPELINE_CONCURRENCY = (() => {
  const parsed = Number.parseInt(process.env.MANEX_INVESTIGATE_ARTICLE_PIPELINE_CONCURRENCY ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
})();

const investigateResponseSchema = z.object({
  overall_summary: z.string(),
  total_cost_impact: z.number(),
  stories: z.array(
    z.object({
      title: z.string(),
      category: z.enum(["supplier", "process", "design", "operator", "unknown"]),
      confidence: z.enum(["high", "medium", "low"]),
      affected_product_count: z.number(),
      key_evidence: z.array(z.string()),
      total_cost: z.number(),
      root_cause: z.string(),
      d1_team: z.string(),
      d2_problem: z.string(),
      d3_containment: z.string(),
      d4_root_cause: z.string(),
      d5_corrective_actions: z.string(),
    }),
  ),
  noise_and_distractors: z.array(z.string()),
  near_miss_warnings: z.array(z.string()),
});

export type InvestigateResult = z.infer<typeof investigateResponseSchema>;
export type InvestigateStory = InvestigateResult["stories"][number];

type InvestigationQueryRow = Record<string, unknown>;

type InvestigationPayload = {
  query1_defect_landscape: InvestigationQueryRow[];
  query2_product_fingerprints: InvestigationQueryRow[];
  query3_claims_with_context: InvestigationQueryRow[];
  query4_test_results_by_week: InvestigationQueryRow[];
  query5_rework_action_texts: InvestigationQueryRow[];
  query6_bom_positions: InvestigationQueryRow[];
};

export type InvestigateProposedCase = {
  id: string;
  articleId: string;
  title: string;
  caseKind: string;
  summary: string;
  suspectedCommonRootCause: string;
  confidence: number;
  priority: "low" | "medium" | "high" | "critical";
  includedProductIds: string[];
  includedSignalIds: string[];
  strongestEvidence: string[];
  conflictingEvidence: string[];
  recommendedNextTraceChecks: string[];
  payload: {
    category: string;
    d1_team: string;
    d2_problem: string;
    d3_containment: string;
    d4_root_cause: string;
    d5_corrective_actions: string;
  };
};

export type InvestigateGlobalInventoryItem = {
  inventoryTempId: string;
  title: string;
  inventoryKind: "validated_case" | "watchlist" | "noise_bucket" | "rejected_case";
  caseTypeHint: string;
  oneLineExplanation: string;
  summary: string;
  confidence: number;
  priority: "low" | "medium" | "high" | "critical";
  articleIds: string[];
  linkedCandidateIds: string[];
  strongestEvidence: string[];
};

export type InvestigateDashboardReadModel = {
  activeRuns: InvestigateRunSummary[];
  articleQueues: Array<{
    articleId: string;
    articleName: string | null;
    proposedCaseCount: number;
    affectedProductCount: number;
    highestPriority: "low" | "medium" | "high" | "critical" | null;
    topConfidence: number | null;
    summary: string | null;
    leadingCaseTitle: string | null;
    latestRun: InvestigateRunSummary;
  }>;
  latestBatch: InvestigateBatchSummary | null;
  globalInventory: {
    inventorySummary: string;
    validatedCases: InvestigateGlobalInventoryItem[];
    watchlists: InvestigateGlobalInventoryItem[];
    noiseBuckets: InvestigateGlobalInventoryItem[];
    rejectedCases: InvestigateGlobalInventoryItem[];
    confidenceNotes: string[];
    caseMergeLog: string[];
  };
};

export type InvestigateArticleCaseboardReadModel = {
  articleId: string;
  articleName: string | null;
  dashboardCard: {
    articleId: string;
    articleName: string | null;
    productCount: number;
    totalSignals: number;
  } | null;
  dossier: ClusteredArticleDossier | null;
  latestRun: InvestigateRunSummary | null;
  proposedCases: InvestigateProposedCase[];
  incidents: Array<{ title: string; summary: string }>;
  watchlists: Array<{ title: string; summary: string }>;
  noise: Array<{ title: string; summary: string }>;
  unassignedProducts: Array<{ productId: string; reason: string }>;
  globalObservations: string[];
  globalInventory: InvestigateDashboardReadModel["globalInventory"] | null;
};

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error(signal.reason ? String(signal.reason) : "Pipeline stopped by user.");
  }
}

function normalizeArticleId(articleId: string) {
  return normalizeUiIdentifier(articleId) ?? articleId.replace(/\s+/g, "").trim().toUpperCase();
}

function toConfidenceScore(confidence: InvestigateStory["confidence"]) {
  if (confidence === "high") {
    return 0.88;
  }

  if (confidence === "medium") {
    return 0.64;
  }

  return 0.38;
}

function toPriority(story: InvestigateStory): "low" | "medium" | "high" | "critical" {
  if (story.confidence === "high" && story.total_cost >= 1000) {
    return "critical";
  }

  if (story.confidence === "high" || story.total_cost >= 500) {
    return "high";
  }

  if (story.confidence === "medium" || story.total_cost >= 100) {
    return "medium";
  }

  return "low";
}

function loadProductIdsForStory(
  payload: InvestigationPayload | null | undefined,
  count: number,
) {
  if (!payload) {
    return [] as string[];
  }

  return payload.query2_product_fingerprints
    .map((row) => row.product_id)
    .filter((value): value is string => typeof value === "string")
    .slice(0, Math.max(0, count));
}

function mapStoryToCandidate(
  articleId: string,
  payload: InvestigationPayload | null | undefined,
  story: InvestigateStory,
  index: number,
): InvestigateProposedCase {
  return {
    id: `INVCASE_${articleId}_${index}`,
    articleId,
    title: story.title,
    caseKind: story.category,
    summary: story.d2_problem || story.root_cause,
    suspectedCommonRootCause: story.root_cause,
    confidence: toConfidenceScore(story.confidence),
    priority: toPriority(story),
    includedProductIds: loadProductIdsForStory(payload, story.affected_product_count),
    includedSignalIds: [],
    strongestEvidence: story.key_evidence,
    conflictingEvidence: [],
    recommendedNextTraceChecks: [story.d3_containment, story.d5_corrective_actions].filter(Boolean),
    payload: {
      category: story.category,
      d1_team: story.d1_team,
      d2_problem: story.d2_problem,
      d3_containment: story.d3_containment,
      d4_root_cause: story.d4_root_cause,
      d5_corrective_actions: story.d5_corrective_actions,
    },
  };
}

function parseRunPayload(run: InvestigateRunSummary | null) {
  if (!run?.reviewPayload || typeof run.reviewPayload !== "object") {
    return null;
  }

  const review = run.reviewPayload as {
    result?: InvestigateResult;
    payload?: InvestigationPayload;
  };

  return {
    result:
      review.result && investigateResponseSchema.safeParse(review.result).success
        ? review.result
        : null,
    payload: review.payload ?? null,
  };
}

function buildGlobalInventory(
  runs: InvestigateRunSummary[],
): InvestigateDashboardReadModel["globalInventory"] {
  const validatedCases: InvestigateGlobalInventoryItem[] = [];
  const watchlists: InvestigateGlobalInventoryItem[] = [];
  const noiseBuckets: InvestigateGlobalInventoryItem[] = [];
  const confidenceNotes: string[] = [];
  const caseMergeLog: string[] = [];

  for (const run of runs) {
    const parsed = parseRunPayload(run);
    const result = parsed?.result;

    if (!result) {
      continue;
    }

    for (const [index, story] of result.stories.entries()) {
      validatedCases.push({
        inventoryTempId: `INVGLOB_${run.articleId}_${index}`,
        title: story.title,
        inventoryKind: "validated_case",
        caseTypeHint: story.category,
        oneLineExplanation: story.root_cause,
        summary: story.d2_problem,
        confidence: toConfidenceScore(story.confidence),
        priority: toPriority(story),
        articleIds: [run.articleId],
        linkedCandidateIds: [`INVCASE_${run.articleId}_${index}`],
        strongestEvidence: story.key_evidence,
      });
    }

    for (const [index, warning] of result.near_miss_warnings.entries()) {
      watchlists.push({
        inventoryTempId: `INVWARN_${run.articleId}_${index}`,
        title: `Near miss ${index + 1}`,
        inventoryKind: "watchlist",
        caseTypeHint: "watchlist",
        oneLineExplanation: warning,
        summary: warning,
        confidence: 0.4,
        priority: "medium",
        articleIds: [run.articleId],
        linkedCandidateIds: [],
        strongestEvidence: [warning],
      });
    }

    for (const [index, noise] of result.noise_and_distractors.entries()) {
      noiseBuckets.push({
        inventoryTempId: `INVNOISE_${run.articleId}_${index}`,
        title: `Distractor ${index + 1}`,
        inventoryKind: "noise_bucket",
        caseTypeHint: "noise",
        oneLineExplanation: noise,
        summary: noise,
        confidence: 0.2,
        priority: "low",
        articleIds: [run.articleId],
        linkedCandidateIds: [],
        strongestEvidence: [noise],
      });
    }

    confidenceNotes.push(
      `${run.articleId}: ${result.stories.length} statistical stories, ${result.near_miss_warnings.length} near misses, ${result.noise_and_distractors.length} distractors.`,
    );
    caseMergeLog.push(
      `${run.articleId}: direct SQL investigation kept ${result.stories.length} surfaced stories without cross-article merging.`,
    );
  }

  return {
    inventorySummary:
      validatedCases.length > 0
        ? `${validatedCases.length} statistical investigation stories are currently visible across ${runs.length} article runs.`
        : "No completed statistical investigation runs have produced surfaced stories yet.",
    validatedCases,
    watchlists,
    noiseBuckets,
    rejectedCases: [],
    confidenceNotes: confidenceNotes.slice(0, 12),
    caseMergeLog: caseMergeLog.slice(0, 12),
  };
}

async function loadArticleName(articleId: string) {
  const rows = await queryPostgres<{ name: string | null }>(
    `
      SELECT name
      FROM article
      WHERE article_id = $1
      LIMIT 1
    `,
    [articleId],
  );

  return rows?.[0]?.name ?? null;
}

function buildQueryBundle(articleId?: string) {
  const values = articleId ? [articleId] : [];
  const articleFilter = articleId ? "WHERE pr.article_id = $1" : "";
  const testFilter = articleId ? "WHERE p.article_id = $1" : "";
  const defectCteFilter = articleId
    ? `
      SELECT DISTINCT d.product_id
      FROM defect d
      JOIN product pr ON d.product_id = pr.product_id
      WHERE pr.article_id = $1
      UNION
      SELECT DISTINCT fc.product_id
      FROM field_claim fc
      JOIN product pr ON fc.product_id = pr.product_id
      WHERE pr.article_id = $1
    `
    : `
      SELECT DISTINCT product_id FROM defect
      UNION
      SELECT DISTINCT product_id FROM field_claim
    `;

  const query1 = `
    SELECT
      d.defect_code,
      TO_CHAR(d.ts, 'IYYY-IW') AS iso_week,
      s_occ.name AS occurrence_section,
      s_det.name AS detected_section,
      d.severity,
      d.reported_part_number AS part_number,
      a.name AS article_name,
      COUNT(*) AS defect_count,
      ROUND(SUM(COALESCE(d.cost, 0))::numeric, 2) AS total_cost,
      STRING_AGG(DISTINCT LEFT(d.notes, 40), ' | ') AS sample_notes
    FROM defect d
    JOIN product pr ON d.product_id = pr.product_id
    JOIN article a ON pr.article_id = a.article_id
    LEFT JOIN section s_occ ON d.occurrence_section_id = s_occ.section_id
    LEFT JOIN section s_det ON d.detected_section_id = s_det.section_id
    ${articleFilter}
    GROUP BY
      d.defect_code,
      TO_CHAR(d.ts, 'IYYY-IW'),
      s_occ.name,
      s_det.name,
      d.severity,
      d.reported_part_number,
      a.name
    ORDER BY defect_count DESC
  `;

  const query2 = `
    WITH affected AS (
      ${defectCteFilter}
    ),
    prod_defects AS (
      SELECT
        product_id,
        STRING_AGG(DISTINCT defect_code, ', ' ORDER BY defect_code) AS defect_codes,
        STRING_AGG(DISTINCT severity, ', ') AS severities,
        COUNT(*) AS defect_count,
        ROUND(SUM(COALESCE(cost, 0))::numeric, 2) AS defect_cost
      FROM defect
      GROUP BY product_id
    ),
    prod_batches AS (
      SELECT
        ppi.product_id,
        STRING_AGG(DISTINCT sb.batch_id, ', ' ORDER BY sb.batch_id) AS batch_ids
      FROM product_part_install ppi
      JOIN part p ON ppi.part_id = p.part_id
      LEFT JOIN supplier_batch sb ON p.batch_id = sb.batch_id
      WHERE ppi.product_id IN (SELECT product_id FROM affected)
      GROUP BY ppi.product_id
    ),
    prod_rework AS (
      SELECT
        product_id,
        STRING_AGG(DISTINCT user_id, ', ' ORDER BY user_id) AS rework_operators,
        COUNT(*) AS rework_count,
        ROUND(SUM(COALESCE(cost, 0))::numeric, 2) AS rework_cost
      FROM rework
      GROUP BY product_id
    ),
    prod_claims AS (
      SELECT
        product_id,
        COUNT(*) AS claim_count,
        ROUND(SUM(COALESCE(cost, 0))::numeric, 2) AS claim_cost,
        STRING_AGG(DISTINCT reported_part_number, ', ') AS claimed_parts,
        LEFT(STRING_AGG(DISTINCT LEFT(complaint_text, 60), ' | '), 200) AS complaint_snippets
      FROM field_claim
      GROUP BY product_id
    )
    SELECT
      pr.product_id,
      a.name AS article_name,
      pr.order_id,
      TO_CHAR(pr.build_ts, 'IYYY-IW') AS build_week,
      COALESCE(pd.defect_codes, '') AS defect_codes,
      COALESCE(pd.severities, '') AS severities,
      COALESCE(pd.defect_count, 0) AS defect_count,
      COALESCE(pd.defect_cost, 0) AS defect_cost,
      COALESCE(pb.batch_ids, 'none') AS batch_ids,
      COALESCE(pr2.rework_operators, 'none') AS rework_operators,
      COALESCE(pr2.rework_count, 0) AS rework_count,
      COALESCE(pr2.rework_cost, 0) AS rework_cost,
      COALESCE(pc.claim_count, 0) AS claim_count,
      COALESCE(pc.claim_cost, 0) AS claim_cost,
      COALESCE(pc.claimed_parts, '') AS claimed_parts,
      COALESCE(pc.complaint_snippets, '') AS complaint_snippets,
      ROUND((COALESCE(pd.defect_cost, 0) + COALESCE(pr2.rework_cost, 0) + COALESCE(pc.claim_cost, 0))::numeric, 2) AS total_cost
    FROM affected ap
    JOIN product pr ON ap.product_id = pr.product_id
    JOIN article a ON pr.article_id = a.article_id
    LEFT JOIN prod_defects pd ON ap.product_id = pd.product_id
    LEFT JOIN prod_batches pb ON ap.product_id = pb.product_id
    LEFT JOIN prod_rework pr2 ON ap.product_id = pr2.product_id
    LEFT JOIN prod_claims pc ON ap.product_id = pc.product_id
    ORDER BY total_cost DESC
  `;

  const query3 = `
    SELECT
      fc.field_claim_id,
      fc.product_id,
      a.name AS article_name,
      pr.order_id,
      TO_CHAR(pr.build_ts, 'IYYY-IW') AS build_week,
      TO_CHAR(fc.claim_ts, 'IYYY-IW') AS claim_week,
      EXTRACT(DAY FROM fc.claim_ts - pr.build_ts)::int AS days_build_to_claim,
      fc.reported_part_number AS claimed_part,
      fc.market,
      LEFT(fc.complaint_text, 100) AS complaint_text,
      ROUND(COALESCE(fc.cost, 0)::numeric, 2) AS claim_cost,
      COUNT(DISTINCT d.defect_id) AS factory_defect_count,
      STRING_AGG(DISTINCT d.defect_code, ', ') AS factory_defect_codes
    FROM field_claim fc
    JOIN product pr ON fc.product_id = pr.product_id
    JOIN article a ON pr.article_id = a.article_id
    LEFT JOIN defect d ON fc.product_id = d.product_id
    ${articleFilter}
    GROUP BY
      fc.field_claim_id,
      fc.product_id,
      a.name,
      pr.order_id,
      pr.build_ts,
      fc.claim_ts,
      fc.reported_part_number,
      fc.market,
      fc.complaint_text,
      fc.cost
    ORDER BY fc.claim_ts
  `;

  const query4 = `
    SELECT
      tr.test_key,
      tr.overall_result,
      TO_CHAR(tr.ts, 'IYYY-IW') AS iso_week,
      COUNT(*) AS result_count,
      ROUND(AVG(CASE WHEN tr.test_value ~ '^-?[0-9]+\\.?[0-9]*$' THEN tr.test_value::numeric END), 4) AS avg_value,
      ROUND(MIN(CASE WHEN tr.test_value ~ '^-?[0-9]+\\.?[0-9]*$' THEN tr.test_value::numeric END), 4) AS min_value,
      ROUND(MAX(CASE WHEN tr.test_value ~ '^-?[0-9]+\\.?[0-9]*$' THEN tr.test_value::numeric END), 4) AS max_value
    FROM test_result tr
    JOIN product p ON tr.product_id = p.product_id
    ${testFilter}
    GROUP BY tr.test_key, tr.overall_result, TO_CHAR(tr.ts, 'IYYY-IW')
    ORDER BY iso_week, tr.test_key, tr.overall_result
  `;

  const query5 = `
    SELECT
      r.user_id,
      TO_CHAR(r.ts, 'IYYY-IW') AS iso_week,
      s.name AS rework_section,
      pr.order_id,
      a.name AS article_name,
      COUNT(*) AS rework_count,
      ROUND(SUM(COALESCE(r.cost, 0))::numeric, 2) AS total_cost,
      ROUND(AVG(r.time_minutes)::numeric, 1) AS avg_time_minutes,
      LEFT(
        STRING_AGG(DISTINCT LEFT(r.action_text, 80), ' | ' ORDER BY LEFT(r.action_text, 80)),
        300
      ) AS action_texts,
      STRING_AGG(DISTINCT r.reported_part_number, ', ') AS reworked_parts
    FROM rework r
    JOIN product pr ON r.product_id = pr.product_id
    JOIN article a ON pr.article_id = a.article_id
    LEFT JOIN section s ON r.rework_section_id = s.section_id
    ${articleFilter}
    GROUP BY r.user_id, TO_CHAR(r.ts, 'IYYY-IW'), s.name, pr.order_id, a.name
    ORDER BY rework_count DESC
  `;

  const query6 = articleId
    ? `
      WITH filtered_defect AS (
        SELECT d.*
        FROM defect d
        JOIN product pr ON d.product_id = pr.product_id
        WHERE pr.article_id = $1
      ),
      filtered_claim AS (
        SELECT fc.*
        FROM field_claim fc
        JOIN product pr ON fc.product_id = pr.product_id
        WHERE pr.article_id = $1
      ),
      referenced_parts AS (
        SELECT DISTINCT reported_part_number AS part_number
        FROM filtered_defect
        WHERE reported_part_number IS NOT NULL
        UNION
        SELECT DISTINCT reported_part_number
        FROM filtered_claim
        WHERE reported_part_number IS NOT NULL
      )
      SELECT
        rp.part_number,
        pm.title AS part_title,
        bn.find_number,
        bn.node_type,
        bn_par.part_number AS assembly_part_number,
        a.name AS article_name,
        COUNT(DISTINCT d.defect_id) AS defect_count,
        COUNT(DISTINCT fc.field_claim_id) AS claim_count
      FROM referenced_parts rp
      JOIN part_master pm ON rp.part_number = pm.part_number
      LEFT JOIN bom_node bn ON bn.part_number = rp.part_number
      LEFT JOIN bom b ON bn.bom_id = b.bom_id
      LEFT JOIN article a ON b.article_id = a.article_id
      LEFT JOIN bom_node bn_par ON bn.parent_bom_node_id = bn_par.bom_node_id
      LEFT JOIN filtered_defect d ON d.reported_part_number = rp.part_number
      LEFT JOIN filtered_claim fc ON fc.reported_part_number = rp.part_number
      GROUP BY
        rp.part_number,
        pm.title,
        bn.find_number,
        bn.node_type,
        bn_par.part_number,
        a.name
      ORDER BY (COUNT(DISTINCT d.defect_id) + COUNT(DISTINCT fc.field_claim_id)) DESC
    `
    : `
      WITH referenced_parts AS (
        SELECT DISTINCT reported_part_number AS part_number
        FROM defect
        WHERE reported_part_number IS NOT NULL
        UNION
        SELECT DISTINCT reported_part_number
        FROM field_claim
        WHERE reported_part_number IS NOT NULL
      )
      SELECT
        rp.part_number,
        pm.title AS part_title,
        bn.find_number,
        bn.node_type,
        bn_par.part_number AS assembly_part_number,
        a.name AS article_name,
        COUNT(DISTINCT d.defect_id) AS defect_count,
        COUNT(DISTINCT fc.field_claim_id) AS claim_count
      FROM referenced_parts rp
      JOIN part_master pm ON rp.part_number = pm.part_number
      LEFT JOIN bom_node bn ON bn.part_number = rp.part_number
      LEFT JOIN bom b ON bn.bom_id = b.bom_id
      LEFT JOIN article a ON b.article_id = a.article_id
      LEFT JOIN bom_node bn_par ON bn.parent_bom_node_id = bn_par.bom_node_id
      LEFT JOIN defect d ON d.reported_part_number = rp.part_number
      LEFT JOIN field_claim fc ON fc.reported_part_number = rp.part_number
      GROUP BY
        rp.part_number,
        pm.title,
        bn.find_number,
        bn.node_type,
        bn_par.part_number,
        a.name
      ORDER BY (COUNT(DISTINCT d.defect_id) + COUNT(DISTINCT fc.field_claim_id)) DESC
    `;

  return {
    values,
    query1,
    query2,
    query3,
    query4,
    query5,
    query6,
  };
}

async function buildInvestigationPayload(articleId?: string): Promise<InvestigationPayload> {
  const bundle = buildQueryBundle(articleId);

  const [
    query1_defect_landscape,
    query2_product_fingerprints,
    query3_claims_with_context,
    query4_test_results_by_week,
    query5_rework_action_texts,
    query6_bom_positions,
  ] = await Promise.all([
    queryPostgres<InvestigationQueryRow>(bundle.query1, bundle.values),
    queryPostgres<InvestigationQueryRow>(bundle.query2, bundle.values),
    queryPostgres<InvestigationQueryRow>(bundle.query3, bundle.values),
    queryPostgres<InvestigationQueryRow>(bundle.query4, bundle.values),
    queryPostgres<InvestigationQueryRow>(bundle.query5, bundle.values),
    queryPostgres<InvestigationQueryRow>(bundle.query6, bundle.values),
  ]);

  return {
    query1_defect_landscape: query1_defect_landscape ?? [],
    query2_product_fingerprints: query2_product_fingerprints ?? [],
    query3_claims_with_context: query3_claims_with_context ?? [],
    query4_test_results_by_week: query4_test_results_by_week ?? [],
    query5_rework_action_texts: query5_rework_action_texts ?? [],
    query6_bom_positions: query6_bom_positions ?? [],
  };
}

export async function performInvestigateAnalysis(input?: {
  articleId?: string;
  abortSignal?: AbortSignal;
}) {
  if (!capabilities.hasPostgres || !env.DATABASE_URL) {
    throw new Error("Set DATABASE_URL before running the investigation route.");
  }

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY before running the investigation route.");
  }

  throwIfAborted(input?.abortSignal);
  const payload = await buildInvestigationPayload(input?.articleId);
  throwIfAborted(input?.abortSignal);

  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

  const result = await throttleOpenAiRequest(() =>
    generateText({
      model: openai(env.OPENAI_MODEL),
      system: MANEX_INVESTIGATE_SYSTEM_PROMPT,
      prompt: buildManexInvestigateUserPrompt(payload),
      temperature: 0,
    }),
  );

  throwIfAborted(input?.abortSignal);

  const parsedJson = parseJsonFromModelText(result.text);
  const parsed = investigateResponseSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error("The investigation model did not return the expected JSON schema.");
  }

  return {
    payload,
    result: parsed.data,
    raw: result.text,
  };
}

export async function runInvestigateArticleCaseClustering(
  articleId: string,
  input?: { abortSignal?: AbortSignal },
) {
  const normalizedArticleId = normalizeArticleId(articleId);
  const articleName = await loadArticleName(normalizedArticleId);
  const runId = createId("INVRUN");

  await createInvestigateRun({
    id: runId,
    articleId: normalizedArticleId,
    articleName,
    model: env.OPENAI_MODEL,
    currentStage: "stage1_loading",
    stageDetail: "Running direct statistical SQL sweep.",
  });

  try {
    await updateInvestigateRunStage({
      id: runId,
      currentStage: "stage1_loading",
      stageDetail: "Collecting the six SQL payload tables.",
    });

    const analysis = await performInvestigateAnalysis({
      articleId: normalizedArticleId,
      abortSignal: input?.abortSignal,
    });

    await updateInvestigateRunStage({
      id: runId,
      currentStage: "stage2_review",
      stageDetail: "Validating OpenAI statistical anomaly findings.",
    });

    await completeInvestigateRun({
      id: runId,
      candidateCount: analysis.result.stories.length,
      issueCount: analysis.result.stories.length,
      reviewPayload: analysis,
      stageDetail: `Finished with ${analysis.result.stories.length} statistical stories.`,
    });

    return {
      articleId: normalizedArticleId,
      latestRun: await getLatestInvestigateRun(normalizedArticleId),
      result: analysis.result,
      payload: analysis.payload,
    };
  } catch (error) {
    await failInvestigateRun({
      id: runId,
      errorMessage: error instanceof Error ? error.message : "The statistical investigation failed unexpectedly.",
      stageDetail: "Statistical investigation failed before completion.",
    });
    throw error;
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => worker()),
  );

  return results;
}

export async function runInvestigateArticleCaseClusteringBatch(input?: {
  articleIds?: string[];
  abortSignal?: AbortSignal;
  onStart?: (input: {
    requestedArticleIds: string[];
    concurrency: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
  onArticleComplete?: (input: {
    result: InvestigateBatchArticleResult;
    okCount: number;
    errorCount: number;
    completedCount: number;
    totalArticleCount: number;
  }) => Promise<void> | void;
}) {
  if (!capabilities.hasPostgres) {
    throw new Error("Statistical investigation requires DATABASE_URL.");
  }

  const targetArticleIds =
    input?.articleIds?.length
      ? [...new Set(input.articleIds.map(normalizeArticleId))]
      : (
          await queryPostgres<{ article_id: string }>(
            `
              SELECT article_id
              FROM article
              ORDER BY article_id
            `,
          )
        )?.map((row) => row.article_id) ?? [];

  await input?.onStart?.({
    requestedArticleIds: targetArticleIds,
    concurrency: INVESTIGATE_ARTICLE_PIPELINE_CONCURRENCY,
    totalArticleCount: targetArticleIds.length,
  });

  let okCount = 0;
  let errorCount = 0;
  let completedCount = 0;

  const results = await mapWithConcurrency(
    targetArticleIds,
    INVESTIGATE_ARTICLE_PIPELINE_CONCURRENCY,
    async (articleId) => {
      let result: InvestigateBatchArticleResult;

      try {
        const articleResult = await runInvestigateArticleCaseClustering(articleId, {
          abortSignal: input?.abortSignal,
        });
        result = {
          articleId,
          ok: true,
          runId: articleResult.latestRun?.id ?? null,
          issueCount: articleResult.result.stories.length,
          caseCount: articleResult.result.stories.length,
          validatedCount: articleResult.result.stories.length,
          watchlistCount: articleResult.result.near_miss_warnings.length,
          noiseCount: articleResult.result.noise_and_distractors.length,
          error: null,
          completedAt: new Date().toISOString(),
        };
      } catch (error) {
        result = {
          articleId,
          ok: false,
          runId: null,
          issueCount: 0,
          caseCount: 0,
          validatedCount: 0,
          watchlistCount: 0,
          noiseCount: 0,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString(),
        };
      }

      completedCount += 1;
      if (result.ok) {
        okCount += 1;
      } else {
        errorCount += 1;
      }

      await input?.onArticleComplete?.({
        result,
        okCount,
        errorCount,
        completedCount,
        totalArticleCount: targetArticleIds.length,
      });

      return result;
    },
  );

  return {
    requestedArticleIds: targetArticleIds,
    concurrency: INVESTIGATE_ARTICLE_PIPELINE_CONCURRENCY,
    okCount,
    errorCount,
    results,
  };
}

export const getInvestigateDashboard = memoizeWithTtl(
  "investigate-dashboard",
  15_000,
  () => "dashboard",
  async (): Promise<InvestigateDashboardReadModel> => {
    if (!capabilities.hasPostgres) {
      return {
        activeRuns: [],
        articleQueues: [],
        latestBatch: null,
        globalInventory: {
          inventorySummary: "Statistical investigation is unavailable without DATABASE_URL.",
          validatedCases: [],
          watchlists: [],
          noiseBuckets: [],
          rejectedCases: [],
          confidenceNotes: [],
          caseMergeLog: [],
        },
      };
    }

    const [activeRuns, latestRuns, latestBatch] = await Promise.all([
      listActiveInvestigateRuns(),
      listLatestCompletedInvestigateRunsByArticle(),
      getLatestInvestigateBatch(),
    ]);

    const articleQueues = latestRuns
      .map((run) => {
        const parsed = parseRunPayload(run);
        const result = parsed?.result;
        const leadStory = result?.stories[0] ?? null;

        return {
          articleId: run.articleId,
          articleName: run.articleName,
          proposedCaseCount: result?.stories.length ?? 0,
          affectedProductCount:
            leadStory?.affected_product_count ??
            parsed?.payload?.query2_product_fingerprints.length ??
            0,
          highestPriority: leadStory ? toPriority(leadStory) : null,
          topConfidence: leadStory ? toConfidenceScore(leadStory.confidence) : null,
          summary: leadStory?.d2_problem ?? result?.overall_summary ?? null,
          leadingCaseTitle: leadStory?.title ?? null,
          latestRun: run,
        };
      })
      .filter((item) => item.proposedCaseCount > 0)
      .sort((left, right) => (right.topConfidence ?? 0) - (left.topConfidence ?? 0));

    return {
      activeRuns,
      articleQueues,
      latestBatch,
      globalInventory: buildGlobalInventory(latestRuns),
    };
  },
);

export const getInvestigateArticleCaseboard = memoizeWithTtl(
  "investigate-article-caseboard",
  15_000,
  (articleId: string) => articleId,
  async (articleId: string): Promise<InvestigateArticleCaseboardReadModel | null> => {
    if (!capabilities.hasPostgres) {
      return null;
    }

    const normalizedArticleId = normalizeArticleId(articleId);
    const [latestRun, persistedDossier, dashboard] = await Promise.all([
      getLatestInvestigateRun(normalizedArticleId),
      getTeamArticleDossierRecord<ClusteredArticleDossier>(normalizedArticleId),
      getInvestigateDashboard(),
    ]);

    const dossier =
      persistedDossier?.payload ??
      (await buildArticleDossier(normalizedArticleId).catch(() => null));

    if (!latestRun && !dossier) {
      return null;
    }

    const parsed = parseRunPayload(latestRun);
    const result = parsed?.result;
    const proposedCases = result
      ? result.stories.map((story, index) =>
          mapStoryToCandidate(normalizedArticleId, parsed?.payload, story, index),
        )
      : [];
    const includedProductIds = new Set(proposedCases.flatMap((candidate) => candidate.includedProductIds));
    const unassignedProducts =
      dossier?.productThreads
        .filter((thread) => !includedProductIds.has(thread.productId))
        .map((thread) => ({
          productId: thread.productId,
          reason: "No statistical story mapped this product into the surfaced top findings.",
        })) ?? [];

    return {
      articleId: normalizedArticleId,
      articleName: latestRun?.articleName ?? dossier?.article.articleName ?? null,
      dashboardCard: dossier
        ? {
            articleId: normalizedArticleId,
            articleName: latestRun?.articleName ?? dossier.article.articleName ?? null,
            productCount: dossier.productThreads.length,
            totalSignals: dossier.productThreads.reduce(
              (sum, thread) => sum + thread.signals.length,
              0,
            ),
          }
        : null,
      dossier,
      latestRun,
      proposedCases,
      incidents: (result?.near_miss_warnings ?? []).map((item, index) => ({
        title: `Near miss ${index + 1}`,
        summary: item,
      })),
      watchlists: (result?.near_miss_warnings ?? []).map((item, index) => ({
        title: `Watchlist ${index + 1}`,
        summary: item,
      })),
      noise: (result?.noise_and_distractors ?? []).map((item, index) => ({
        title: `Noise ${index + 1}`,
        summary: item,
      })),
      unassignedProducts,
      globalObservations: result ? [result.overall_summary] : [],
      globalInventory: dashboard.globalInventory,
    };
  },
);

export const getInvestigateProposedCasesForProduct = memoizeWithTtl(
  "investigate-product-stories",
  15_000,
  (productId: string) => productId,
  async (productId: string) => {
    if (!capabilities.hasPostgres) {
      return [] as InvestigateProposedCase[];
    }

    const normalizedProductId =
      normalizeUiIdentifier(productId) ?? productId.replace(/\s+/g, "").trim().toUpperCase();
    const rows = await queryPostgres<{ article_id: string }>(
      `
        SELECT article_id
        FROM product
        WHERE product_id = $1
        LIMIT 1
      `,
      [normalizedProductId],
    );
    const articleId = rows?.[0]?.article_id;

    if (!articleId) {
      return [] as InvestigateProposedCase[];
    }

    const caseboard = await getInvestigateArticleCaseboard(articleId);
    return caseboard?.proposedCases ?? [];
  },
);

export { MANEX_INVESTIGATE_PROMPT_VERSION };
