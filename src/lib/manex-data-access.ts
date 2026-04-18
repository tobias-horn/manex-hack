import type { QueryResultRow } from "pg";
import { startOfWeek } from "date-fns";

import { env } from "@/lib/env";
import { queryPostgres } from "@/lib/postgres";

type TransportKind = "rest" | "postgres";
type SortDirection = "asc" | "desc";
type FilterOp = "eq" | "gte" | "lte" | "in";
type Primitive = string | number | boolean | null;
type RelationName =
  | "v_defect_detail"
  | "v_field_claim_detail"
  | "v_product_bom_parts"
  | "v_quality_summary"
  | "test_result"
  | "product"
  | "article"
  | "section"
  | "product_action"
  | "rework";

type QueryFilter = {
  field: string;
  op: FilterOp;
  value: Primitive | Primitive[];
};

type QuerySpec = {
  select?: string[];
  filters?: QueryFilter[];
  orderBy?: {
    field: string;
    direction: SortDirection;
  };
  limit?: number;
  count?: boolean;
};

type ReadResult<T> = {
  rows: T[];
  total: number | null;
  transport: TransportKind;
};

type WriteResult<T> = {
  row: T;
  transport: TransportKind;
};

type DefectRow = {
  defect_id: string;
  product_id: string;
  defect_ts: string;
  source_type: string | null;
  defect_code: string;
  severity: string;
  detected_section_id: string | null;
  occurrence_section_id: string | null;
  detected_test_result_id: string | null;
  reported_part_number: string | null;
  image_url: string | null;
  cost: number | string | null;
  notes: string | null;
  product_build_ts: string | null;
  article_id: string;
  article_name: string | null;
  order_id: string | null;
  detected_section_name: string | null;
  occurrence_section_name: string | null;
  reported_part_title: string | null;
  reported_part_commodity: string | null;
  detected_test_value: number | string | null;
  detected_test_overall: string | null;
  detected_test_unit: string | null;
  detected_test_name: string | null;
  detected_test_type: string | null;
  detected_test_lower: number | string | null;
  detected_test_upper: number | string | null;
};

type ClaimRow = {
  field_claim_id: string;
  product_id: string;
  claim_ts: string;
  market: string | null;
  complaint_text: string | null;
  reported_part_number: string | null;
  image_url: string | null;
  cost: number | string | null;
  detected_section_id: string | null;
  mapped_defect_id: string | null;
  notes: string | null;
  product_build_ts: string | null;
  article_id: string;
  article_name: string | null;
  mapped_defect_code: string | null;
  mapped_defect_severity: string | null;
  reported_part_title: string | null;
  reported_part_commodity: string | null;
  detected_section_name: string | null;
  days_from_build: number | string | null;
};

type InstalledPartRow = {
  product_id: string;
  install_id: string;
  installed_ts: string | null;
  installed_section_id: string | null;
  position_code: string | null;
  install_user_id: string | null;
  bom_node_id: string;
  find_number: string | null;
  node_type: string | null;
  parent_find_number: string | null;
  parent_node_type: string | null;
  part_number: string;
  part_title: string | null;
  commodity: string | null;
  drawing_number: string | null;
  part_id: string;
  serial_number: string | null;
  quality_status: string | null;
  manufacturer_name: string | null;
  batch_id: string | null;
  batch_number: string | null;
  supplier_name: string | null;
  supplier_id: string | null;
  batch_received_date: string | null;
};

type QualitySummaryRow = {
  article_id: string;
  article_name: string | null;
  week_start: string;
  products_built: number | string | null;
  defect_count: number | string | null;
  claim_count: number | string | null;
  rework_count: number | string | null;
  avg_rework_minutes: number | string | null;
  defect_cost_sum: number | string | null;
  claim_cost_sum: number | string | null;
  top_defect_code: string | null;
  top_defect_code_count: number | string | null;
};

type TestResultRow = {
  test_result_id: string;
  test_run_id: string;
  test_id: string;
  product_id: string;
  section_id: string | null;
  ts: string;
  test_time_ms: number | string | null;
  overall_result: string;
  test_key: string;
  test_value: string | null;
  unit: string | null;
  notes: string | null;
};

type ProductLookupRow = {
  product_id: string;
  article_id: string;
  order_id: string | null;
  build_ts: string | null;
};

type ArticleLookupRow = {
  article_id: string;
  name: string | null;
};

type SectionLookupRow = {
  section_id: string;
  name: string | null;
};

type ActionRow = {
  action_id: string;
  product_id: string;
  ts: string;
  action_type: string;
  status: string;
  user_id: string | null;
  section_id: string | null;
  comments: string | null;
  defect_id: string | null;
};

type ReworkRow = {
  rework_id: string;
  defect_id: string;
  product_id: string;
  ts: string;
  rework_section_id: string | null;
  action_text: string | null;
  reported_part_number: string | null;
  user_id: string | null;
  image_url: string | null;
  time_minutes: number | string | null;
  cost: number | string | null;
};

export type ManexDefect = {
  id: string;
  productId: string;
  articleId: string;
  articleName: string | null;
  orderId: string | null;
  occurredAt: string;
  productBuiltAt: string | null;
  sourceType: string | null;
  code: string;
  severity: string;
  detectedSectionId: string | null;
  detectedSectionName: string | null;
  occurrenceSectionId: string | null;
  occurrenceSectionName: string | null;
  reportedPartNumber: string | null;
  reportedPartTitle: string | null;
  reportedPartCommodity: string | null;
  detectedTestResultId: string | null;
  detectedTestName: string | null;
  detectedTestType: string | null;
  detectedTestOverall: string | null;
  detectedTestValue: number | null;
  detectedTestUnit: string | null;
  detectedTestLower: number | null;
  detectedTestUpper: number | null;
  imageUrl: string | null;
  notes: string;
  defectWeekStart: string;
};

export type ManexFieldClaim = {
  id: string;
  productId: string;
  articleId: string;
  articleName: string | null;
  claimedAt: string;
  productBuiltAt: string | null;
  market: string | null;
  complaintText: string;
  reportedPartNumber: string | null;
  reportedPartTitle: string | null;
  reportedPartCommodity: string | null;
  detectedSectionId: string | null;
  detectedSectionName: string | null;
  mappedDefectId: string | null;
  mappedDefectCode: string | null;
  mappedDefectSeverity: string | null;
  daysFromBuild: number | null;
  imageUrl: string | null;
  notes: string;
  claimWeekStart: string;
};

export type ManexInstalledPart = {
  productId: string;
  installId: string;
  installedAt: string | null;
  installedSectionId: string | null;
  positionCode: string | null;
  installUserId: string | null;
  bomNodeId: string;
  findNumber: string | null;
  nodeType: string | null;
  parentFindNumber: string | null;
  parentNodeType: string | null;
  partNumber: string;
  partTitle: string | null;
  commodity: string | null;
  drawingNumber: string | null;
  partId: string;
  serialNumber: string | null;
  qualityStatus: string | null;
  manufacturerName: string | null;
  batchId: string | null;
  batchNumber: string | null;
  supplierName: string | null;
  supplierId: string | null;
  batchReceivedDate: string | null;
};

export type ManexWeeklyQualitySummary = {
  articleId: string;
  articleName: string | null;
  weekStart: string;
  productsBuilt: number;
  defectCount: number;
  claimCount: number;
  reworkCount: number;
  avgReworkMinutes: number | null;
  defectCost: number | null;
  claimCost: number | null;
  topDefectCode: string | null;
  topDefectCodeCount: number | null;
};

export type ManexTestSignal = {
  id: string;
  runId: string;
  testId: string;
  productId: string;
  articleId: string | null;
  articleName: string | null;
  orderId: string | null;
  buildTs: string | null;
  sectionId: string | null;
  sectionName: string | null;
  occurredAt: string;
  overallResult: string;
  testKey: string;
  testValue: string | null;
  unit: string | null;
  durationMs: number | null;
  notes: string;
  severity: string | null;
};

export type ManexWorkflowAction = {
  id: string;
  productId: string;
  recordedAt: string;
  actionType: string;
  status: string;
  userId: string | null;
  sectionId: string | null;
  comments: string;
  defectId: string | null;
};

export type ManexReworkRecord = {
  id: string;
  defectId: string;
  productId: string;
  recordedAt: string;
  sectionId: string | null;
  actionText: string;
  reportedPartNumber: string | null;
  userId: string | null;
  imageUrl: string | null;
  timeMinutes: number | null;
  cost: number | null;
};

export type ManexSearchResult<T> = {
  items: T[];
  total: number | null;
  transport: TransportKind;
};

export type ManexCreateActionInput = {
  id: string;
  productId: string;
  recordedAt: string;
  actionType: string;
  status: string;
  userId: string;
  defectId?: string | null;
  sectionId?: string | null;
  comments: string;
};

export type ManexCreateReworkInput = {
  id: string;
  defectId: string;
  productId: string;
  recordedAt: string;
  actionText: string;
  userId: string;
  sectionId?: string | null;
  reportedPartNumber?: string | null;
  imageUrl?: string | null;
  timeMinutes?: number | null;
  cost?: number | null;
};

export type ManexDefectQuery = {
  productId?: string;
  articleId?: string;
  defectCodes?: string[];
  severities?: string[];
  reportedPartNumbers?: string[];
  detectedAfter?: string;
  detectedBefore?: string;
  limit?: number;
  sort?: "newest" | "oldest";
};

export type ManexClaimQuery = {
  productId?: string;
  articleId?: string;
  mappedDefectCodes?: string[];
  reportedPartNumbers?: string[];
  claimedAfter?: string;
  claimedBefore?: string;
  limit?: number;
  sort?: "newest" | "oldest";
};

export type ManexInstalledPartQuery = {
  productId: string;
  supplierName?: string;
  batchNumber?: string;
  limit?: number;
};

export type ManexQualitySummaryQuery = {
  articleId?: string;
  weekStartAfter?: string;
  limit?: number;
  sort?: "newest" | "oldest";
};

export type ManexTestSignalQuery = {
  productId?: string;
  articleId?: string;
  outcomes?: string[];
  testKeys?: string[];
  observedAfter?: string;
  observedBefore?: string;
  limit?: number;
  sort?: "newest" | "oldest";
};

export type ManexActionQuery = {
  productId?: string;
  defectId?: string;
  limit?: number;
};

export type ManexReworkQuery = {
  productId?: string;
  defectId?: string;
  limit?: number;
};

export type ManexDataAccess = {
  investigation: {
    findDefects(
      query?: ManexDefectQuery,
    ): Promise<ManexSearchResult<ManexDefect>>;
    findDefectsForProduct(
      productId: string,
      query?: Omit<ManexDefectQuery, "productId">,
    ): Promise<ManexSearchResult<ManexDefect>>;
    findClaims(
      query?: ManexClaimQuery,
    ): Promise<ManexSearchResult<ManexFieldClaim>>;
    findClaimsForArticle(
      articleId: string,
      query?: Omit<ManexClaimQuery, "articleId">,
    ): Promise<ManexSearchResult<ManexFieldClaim>>;
    findTestSignals(
      query?: ManexTestSignalQuery,
    ): Promise<ManexSearchResult<ManexTestSignal>>;
    findTestSignalsForProduct(
      productId: string,
      query?: Omit<ManexTestSignalQuery, "productId">,
    ): Promise<ManexSearchResult<ManexTestSignal>>;
  };
  traceability: {
    findInstalledParts(
      query: ManexInstalledPartQuery,
    ): Promise<ManexSearchResult<ManexInstalledPart>>;
    findInstalledPartsForProduct(
      productId: string,
      query?: Omit<ManexInstalledPartQuery, "productId">,
    ): Promise<ManexSearchResult<ManexInstalledPart>>;
  };
  quality: {
    findWeeklySummaries(
      query?: ManexQualitySummaryQuery,
    ): Promise<ManexSearchResult<ManexWeeklyQualitySummary>>;
    findWeeklySummariesForArticle(
      articleId: string,
      query?: Omit<ManexQualitySummaryQuery, "articleId">,
    ): Promise<ManexSearchResult<ManexWeeklyQualitySummary>>;
  };
  workflow: {
    findActions(
      query?: ManexActionQuery,
    ): Promise<ManexSearchResult<ManexWorkflowAction>>;
    findActionsForProduct(
      productId: string,
      query?: Omit<ManexActionQuery, "productId">,
    ): Promise<ManexSearchResult<ManexWorkflowAction>>;
    recordAction(
      input: ManexCreateActionInput,
    ): Promise<WriteResult<ManexWorkflowAction>>;
    findRework(
      query?: ManexReworkQuery,
    ): Promise<ManexSearchResult<ManexReworkRecord>>;
    findReworkForDefect(
      defectId: string,
      query?: Omit<ManexReworkQuery, "defectId">,
    ): Promise<ManexSearchResult<ManexReworkRecord>>;
    recordRework(
      input: ManexCreateReworkInput,
    ): Promise<WriteResult<ManexReworkRecord>>;
  };
};

type InternalTransport = {
  kind: TransportKind;
  read<T extends QueryResultRow>(
    relation: RelationName,
    spec: QuerySpec,
  ): Promise<Omit<ReadResult<T>, "transport">>;
  insert<T extends QueryResultRow>(
    relation: "product_action" | "rework",
    values: Record<string, Primitive>,
    returning: string[],
  ): Promise<T>;
};

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/i;

const assertIdentifier = (value: string) => {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }

  return value;
};

const normalizeText = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : "";
};

const normalizeNullableText = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

const normalizeIso = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

const normalizeNumber = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === ""
    ? null
    : Number(value);

const normalizeInteger = (value: number | string | null | undefined) => {
  const numeric = normalizeNumber(value);
  return numeric === null ? null : Math.trunc(numeric);
};

const normalizeWeekStart = (value: string) =>
  startOfWeek(new Date(value), { weekStartsOn: 1 }).toISOString();

const buildAssetUrl = (path: string | null | undefined) => {
  const normalized = normalizeNullableText(path);

  if (!normalized) {
    return null;
  }

  if (!env.MANEX_ASSET_BASE_URL) {
    return normalized;
  }

  try {
    return new URL(normalized, env.MANEX_ASSET_BASE_URL).toString();
  } catch {
    return normalized;
  }
};

const parseContentRange = (value: string | null) => {
  if (!value) {
    return null;
  }

  const total = value.split("/")[1];

  if (!total || total === "*") {
    return null;
  }

  return Number(total);
};

const serializeRestFilter = (filter: QueryFilter) => {
  switch (filter.op) {
    case "eq":
      return `eq.${filter.value}`;
    case "gte":
      return `gte.${filter.value}`;
    case "lte":
      return `lte.${filter.value}`;
    case "in":
      return `in.(${(filter.value as Primitive[])
        .map((value) => String(value))
        .join(",")})`;
  }
};

const buildWhereClause = (filters: QueryFilter[] = []) => {
  const values: unknown[] = [];
  const clauses = filters.map((filter) => {
    const field = assertIdentifier(filter.field);

    if (filter.op === "in") {
      values.push(filter.value);
      return `${field} = ANY($${values.length})`;
    }

    values.push(filter.value);
    const operator = filter.op === "eq" ? "=" : filter.op === "gte" ? ">=" : "<=";
    return `${field} ${operator} $${values.length}`;
  });

  return {
    clause: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
};

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const createFilter = (
  field: string,
  op: FilterOp,
  value: Primitive | Primitive[],
): QueryFilter => ({
  field,
  op,
  value,
});

const isPresent = <T>(value: T | null): value is T => value !== null;

function createRestTransport(): InternalTransport | null {
  if (!env.MANEX_REST_API_URL || !env.MANEX_REST_API_KEY) {
    return null;
  }

  const baseHeaders = {
    Authorization: `Bearer ${env.MANEX_REST_API_KEY}`,
    apikey: env.MANEX_REST_API_KEY,
  };

  return {
    kind: "rest",
    async read<T extends QueryResultRow>(
      relation: RelationName,
      spec: QuerySpec,
    ) {
      const url = new URL(relation, env.MANEX_REST_API_URL);

      if (spec.select?.length) {
        url.searchParams.set("select", spec.select.join(","));
      }

      for (const filter of spec.filters ?? []) {
        url.searchParams.append(filter.field, serializeRestFilter(filter));
      }

      if (spec.orderBy) {
        url.searchParams.set(
          "order",
          `${spec.orderBy.field}.${spec.orderBy.direction}`,
        );
      }

      if (typeof spec.limit === "number") {
        url.searchParams.set("limit", String(spec.limit));
      }

      const response = await fetch(url, {
        method: "GET",
        headers: spec.count
          ? {
              ...baseHeaders,
              Prefer: "count=exact",
            }
          : baseHeaders,
        cache: "no-store",
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}: ${responseText.slice(0, 300)}`,
        );
      }

      return {
        rows: JSON.parse(responseText) as T[],
        total: spec.count ? parseContentRange(response.headers.get("content-range")) : null,
      };
    },
    async insert<T extends QueryResultRow>(
      relation: "product_action" | "rework",
      values: Record<string, Primitive>,
      returning: string[],
    ) {
      const url = new URL(relation, env.MANEX_REST_API_URL);
      url.searchParams.set("select", returning.join(","));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(values),
        cache: "no-store",
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}: ${responseText.slice(0, 300)}`,
        );
      }

      const rows = JSON.parse(responseText) as T[];
      const row = Array.isArray(rows) ? rows[0] : rows;

      if (!row) {
        throw new Error(`No row returned from ${relation} insert.`);
      }

      return row;
    },
  };
}

function createPostgresTransport(): InternalTransport | null {
  if (!env.DATABASE_URL) {
    return null;
  }

  return {
    kind: "postgres",
    async read<T extends QueryResultRow>(
      relation: RelationName,
      spec: QuerySpec,
    ) {
      const fields = spec.select?.length
        ? spec.select.map(assertIdentifier).join(", ")
        : "*";
      const { clause, values } = buildWhereClause(spec.filters);
      const orderSql = spec.orderBy
        ? ` ORDER BY ${assertIdentifier(spec.orderBy.field)} ${spec.orderBy.direction.toUpperCase()}`
        : "";
      const limitSql =
        typeof spec.limit === "number" ? ` LIMIT ${Math.max(0, spec.limit)}` : "";

      const rows =
        (await queryPostgres<T>(
          `SELECT ${fields} FROM ${relation}${clause}${orderSql}${limitSql}`,
          values,
        )) ?? [];

      let total: number | null = null;

      if (spec.count) {
        const countRows =
          (await queryPostgres<{ total_count: number | string }>(
            `SELECT COUNT(*)::int AS total_count FROM ${relation}${clause}`,
            values,
          )) ?? [];
        total = normalizeInteger(countRows[0]?.total_count);
      }

      return { rows, total };
    },
    async insert<T extends QueryResultRow>(
      relation: "product_action" | "rework",
      values: Record<string, Primitive>,
      returning: string[],
    ) {
      const columns = Object.keys(values).map(assertIdentifier);
      const params = Object.values(values);
      const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
      const returningClause = returning.map(assertIdentifier).join(", ");
      const rows =
        (await queryPostgres<T>(
          `INSERT INTO ${relation} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING ${returningClause}`,
          params,
        )) ?? [];

      if (!rows[0]) {
        throw new Error(`No row returned from ${relation} insert.`);
      }

      return rows[0];
    },
  };
}

const mapDefect = (row: DefectRow): ManexDefect => ({
  id: row.defect_id,
  productId: row.product_id,
  articleId: row.article_id,
  articleName: normalizeNullableText(row.article_name),
  orderId: normalizeNullableText(row.order_id),
  occurredAt: new Date(row.defect_ts).toISOString(),
  productBuiltAt: normalizeIso(row.product_build_ts),
  sourceType: normalizeNullableText(row.source_type),
  code: row.defect_code,
  severity: row.severity,
  detectedSectionId: normalizeNullableText(row.detected_section_id),
  detectedSectionName: normalizeNullableText(row.detected_section_name),
  occurrenceSectionId: normalizeNullableText(row.occurrence_section_id),
  occurrenceSectionName: normalizeNullableText(row.occurrence_section_name),
  reportedPartNumber: normalizeNullableText(row.reported_part_number),
  reportedPartTitle: normalizeNullableText(row.reported_part_title),
  reportedPartCommodity: normalizeNullableText(row.reported_part_commodity),
  detectedTestResultId: normalizeNullableText(row.detected_test_result_id),
  detectedTestName: normalizeNullableText(row.detected_test_name),
  detectedTestType: normalizeNullableText(row.detected_test_type),
  detectedTestOverall: normalizeNullableText(row.detected_test_overall),
  detectedTestValue: normalizeNumber(row.detected_test_value),
  detectedTestUnit: normalizeNullableText(row.detected_test_unit),
  detectedTestLower: normalizeNumber(row.detected_test_lower),
  detectedTestUpper: normalizeNumber(row.detected_test_upper),
  imageUrl: buildAssetUrl(row.image_url),
  notes: normalizeText(row.notes),
  defectWeekStart: normalizeWeekStart(row.defect_ts),
});

const mapClaim = (row: ClaimRow): ManexFieldClaim => ({
  id: row.field_claim_id,
  productId: row.product_id,
  articleId: row.article_id,
  articleName: normalizeNullableText(row.article_name),
  claimedAt: new Date(row.claim_ts).toISOString(),
  productBuiltAt: normalizeIso(row.product_build_ts),
  market: normalizeNullableText(row.market),
  complaintText: normalizeText(row.complaint_text),
  reportedPartNumber: normalizeNullableText(row.reported_part_number),
  reportedPartTitle: normalizeNullableText(row.reported_part_title),
  reportedPartCommodity: normalizeNullableText(row.reported_part_commodity),
  detectedSectionId: normalizeNullableText(row.detected_section_id),
  detectedSectionName: normalizeNullableText(row.detected_section_name),
  mappedDefectId: normalizeNullableText(row.mapped_defect_id),
  mappedDefectCode: normalizeNullableText(row.mapped_defect_code),
  mappedDefectSeverity: normalizeNullableText(row.mapped_defect_severity),
  daysFromBuild: normalizeInteger(row.days_from_build),
  imageUrl: buildAssetUrl(row.image_url),
  notes: normalizeText(row.notes),
  claimWeekStart: normalizeWeekStart(row.claim_ts),
});

const mapInstalledPart = (row: InstalledPartRow): ManexInstalledPart => ({
  productId: row.product_id,
  installId: row.install_id,
  installedAt: normalizeIso(row.installed_ts),
  installedSectionId: normalizeNullableText(row.installed_section_id),
  positionCode: normalizeNullableText(row.position_code),
  installUserId: normalizeNullableText(row.install_user_id),
  bomNodeId: row.bom_node_id,
  findNumber: normalizeNullableText(row.find_number),
  nodeType: normalizeNullableText(row.node_type),
  parentFindNumber: normalizeNullableText(row.parent_find_number),
  parentNodeType: normalizeNullableText(row.parent_node_type),
  partNumber: row.part_number,
  partTitle: normalizeNullableText(row.part_title),
  commodity: normalizeNullableText(row.commodity),
  drawingNumber: normalizeNullableText(row.drawing_number),
  partId: row.part_id,
  serialNumber: normalizeNullableText(row.serial_number),
  qualityStatus: normalizeNullableText(row.quality_status),
  manufacturerName: normalizeNullableText(row.manufacturer_name),
  batchId: normalizeNullableText(row.batch_id),
  batchNumber: normalizeNullableText(row.batch_number),
  supplierName: normalizeNullableText(row.supplier_name),
  supplierId: normalizeNullableText(row.supplier_id),
  batchReceivedDate: normalizeIso(row.batch_received_date),
});

const mapWeeklySummary = (row: QualitySummaryRow): ManexWeeklyQualitySummary => ({
  articleId: row.article_id,
  articleName: normalizeNullableText(row.article_name),
  weekStart: new Date(row.week_start).toISOString(),
  productsBuilt: normalizeInteger(row.products_built) ?? 0,
  defectCount: normalizeInteger(row.defect_count) ?? 0,
  claimCount: normalizeInteger(row.claim_count) ?? 0,
  reworkCount: normalizeInteger(row.rework_count) ?? 0,
  avgReworkMinutes: normalizeNumber(row.avg_rework_minutes),
  defectCost: normalizeNumber(row.defect_cost_sum),
  claimCost: normalizeNumber(row.claim_cost_sum),
  topDefectCode: normalizeNullableText(row.top_defect_code),
  topDefectCodeCount: normalizeInteger(row.top_defect_code_count),
});

const testSeverityFromResult = (value: string) =>
  value === "FAIL" ? "high" : value === "MARGINAL" ? "medium" : null;

const mapTestSignal = (
  row: TestResultRow,
  product?: ProductLookupRow,
  article?: ArticleLookupRow,
  section?: SectionLookupRow,
): ManexTestSignal => ({
  id: row.test_result_id,
  runId: row.test_run_id,
  testId: row.test_id,
  productId: row.product_id,
  articleId: normalizeNullableText(product?.article_id),
  articleName: normalizeNullableText(article?.name),
  orderId: normalizeNullableText(product?.order_id),
  buildTs: normalizeIso(product?.build_ts),
  sectionId: normalizeNullableText(row.section_id),
  sectionName: normalizeNullableText(section?.name),
  occurredAt: new Date(row.ts).toISOString(),
  overallResult: row.overall_result,
  testKey: row.test_key,
  testValue: normalizeNullableText(row.test_value),
  unit: normalizeNullableText(row.unit),
  durationMs: normalizeInteger(row.test_time_ms),
  notes: normalizeText(row.notes),
  severity: testSeverityFromResult(row.overall_result),
});

const mapAction = (row: ActionRow): ManexWorkflowAction => ({
  id: row.action_id,
  productId: row.product_id,
  recordedAt: new Date(row.ts).toISOString(),
  actionType: row.action_type,
  status: row.status,
  userId: normalizeNullableText(row.user_id),
  sectionId: normalizeNullableText(row.section_id),
  comments: normalizeText(row.comments),
  defectId: normalizeNullableText(row.defect_id),
});

const mapRework = (row: ReworkRow): ManexReworkRecord => ({
  id: row.rework_id,
  defectId: row.defect_id,
  productId: row.product_id,
  recordedAt: new Date(row.ts).toISOString(),
  sectionId: normalizeNullableText(row.rework_section_id),
  actionText: normalizeText(row.action_text),
  reportedPartNumber: normalizeNullableText(row.reported_part_number),
  userId: normalizeNullableText(row.user_id),
  imageUrl: buildAssetUrl(row.image_url),
  timeMinutes: normalizeNumber(row.time_minutes),
  cost: normalizeNumber(row.cost),
});

const createDefectFilters = (query: ManexDefectQuery = {}): QueryFilter[] => [
  query.productId ? createFilter("product_id", "eq", query.productId) : null,
  query.articleId ? createFilter("article_id", "eq", query.articleId) : null,
  query.defectCodes?.length
    ? createFilter("defect_code", "in", query.defectCodes)
    : null,
  query.severities?.length
    ? createFilter("severity", "in", query.severities)
    : null,
  query.reportedPartNumbers?.length
    ? createFilter("reported_part_number", "in", query.reportedPartNumbers)
    : null,
  query.detectedAfter
    ? createFilter("defect_ts", "gte", query.detectedAfter)
    : null,
  query.detectedBefore
    ? createFilter("defect_ts", "lte", query.detectedBefore)
    : null,
].filter(isPresent);

const createClaimFilters = (query: ManexClaimQuery = {}): QueryFilter[] => [
  query.productId ? createFilter("product_id", "eq", query.productId) : null,
  query.articleId ? createFilter("article_id", "eq", query.articleId) : null,
  query.mappedDefectCodes?.length
    ? createFilter("mapped_defect_code", "in", query.mappedDefectCodes)
    : null,
  query.reportedPartNumbers?.length
    ? createFilter("reported_part_number", "in", query.reportedPartNumbers)
    : null,
  query.claimedAfter
    ? createFilter("claim_ts", "gte", query.claimedAfter)
    : null,
  query.claimedBefore
    ? createFilter("claim_ts", "lte", query.claimedBefore)
    : null,
].filter(isPresent);

const createInstalledPartFilters = (
  query: ManexInstalledPartQuery,
): QueryFilter[] =>
  [
    createFilter("product_id", "eq", query.productId),
    query.supplierName
      ? createFilter("supplier_name", "eq", query.supplierName)
      : null,
    query.batchNumber
      ? createFilter("batch_number", "eq", query.batchNumber)
      : null,
  ].filter(isPresent);

const createQualityFilters = (
  query: ManexQualitySummaryQuery = {},
): QueryFilter[] =>
  [
    query.articleId ? createFilter("article_id", "eq", query.articleId) : null,
    query.weekStartAfter
      ? createFilter("week_start", "gte", query.weekStartAfter)
      : null,
  ].filter(isPresent);

const createTestSignalFilters = (
  query: ManexTestSignalQuery = {},
): QueryFilter[] =>
  [
    query.productId ? createFilter("product_id", "eq", query.productId) : null,
    query.outcomes?.length
      ? createFilter("overall_result", "in", query.outcomes)
      : null,
    query.testKeys?.length ? createFilter("test_key", "in", query.testKeys) : null,
    query.observedAfter
      ? createFilter("ts", "gte", query.observedAfter)
      : null,
    query.observedBefore
      ? createFilter("ts", "lte", query.observedBefore)
      : null,
  ].filter(isPresent);

const createActionFilters = (query: ManexActionQuery = {}): QueryFilter[] =>
  [
    query.productId ? createFilter("product_id", "eq", query.productId) : null,
    query.defectId ? createFilter("defect_id", "eq", query.defectId) : null,
  ].filter(isPresent);

const createReworkFilters = (query: ManexReworkQuery = {}): QueryFilter[] =>
  [
    query.productId ? createFilter("product_id", "eq", query.productId) : null,
    query.defectId ? createFilter("defect_id", "eq", query.defectId) : null,
  ].filter(isPresent);

const defaultDefectSelect = [
  "defect_id",
  "product_id",
  "defect_ts",
  "source_type",
  "defect_code",
  "severity",
  "detected_section_id",
  "occurrence_section_id",
  "detected_test_result_id",
  "reported_part_number",
  "image_url",
  "cost",
  "notes",
  "product_build_ts",
  "article_id",
  "article_name",
  "order_id",
  "detected_section_name",
  "occurrence_section_name",
  "reported_part_title",
  "reported_part_commodity",
  "detected_test_value",
  "detected_test_overall",
  "detected_test_unit",
  "detected_test_name",
  "detected_test_type",
  "detected_test_lower",
  "detected_test_upper",
];

const defaultClaimSelect = [
  "field_claim_id",
  "product_id",
  "claim_ts",
  "market",
  "complaint_text",
  "reported_part_number",
  "image_url",
  "cost",
  "detected_section_id",
  "mapped_defect_id",
  "notes",
  "product_build_ts",
  "article_id",
  "article_name",
  "mapped_defect_code",
  "mapped_defect_severity",
  "reported_part_title",
  "reported_part_commodity",
  "detected_section_name",
  "days_from_build",
];

const defaultInstalledPartSelect = [
  "product_id",
  "install_id",
  "installed_ts",
  "installed_section_id",
  "position_code",
  "install_user_id",
  "bom_node_id",
  "find_number",
  "node_type",
  "parent_find_number",
  "parent_node_type",
  "part_number",
  "part_title",
  "commodity",
  "drawing_number",
  "part_id",
  "serial_number",
  "quality_status",
  "manufacturer_name",
  "batch_id",
  "batch_number",
  "supplier_name",
  "supplier_id",
  "batch_received_date",
];

const defaultQualitySelect = [
  "article_id",
  "article_name",
  "week_start",
  "products_built",
  "defect_count",
  "claim_count",
  "rework_count",
  "avg_rework_minutes",
  "defect_cost_sum",
  "claim_cost_sum",
  "top_defect_code",
  "top_defect_code_count",
];

const defaultTestSignalSelect = [
  "test_result_id",
  "test_run_id",
  "test_id",
  "product_id",
  "section_id",
  "ts",
  "test_time_ms",
  "overall_result",
  "test_key",
  "test_value",
  "unit",
  "notes",
];

const defaultProductLookupSelect = [
  "product_id",
  "article_id",
  "order_id",
  "build_ts",
];

const defaultArticleLookupSelect = ["article_id", "name"];

const defaultSectionLookupSelect = ["section_id", "name"];

const defaultActionSelect = [
  "action_id",
  "product_id",
  "ts",
  "action_type",
  "status",
  "user_id",
  "section_id",
  "comments",
  "defect_id",
];

const defaultReworkSelect = [
  "rework_id",
  "defect_id",
  "product_id",
  "ts",
  "rework_section_id",
  "action_text",
  "reported_part_number",
  "user_id",
  "image_url",
  "time_minutes",
  "cost",
];

const readTransports = () =>
  [createRestTransport(), createPostgresTransport()].filter(
    (transport): transport is InternalTransport => Boolean(transport),
  );

const writeTransports = readTransports;

async function readWithFallback<T extends QueryResultRow>(
  relation: RelationName,
  spec: QuerySpec,
): Promise<ReadResult<T>> {
  let lastError: unknown;

  for (const transport of readTransports()) {
    try {
      const result = await transport.read<T>(relation, spec);
      return {
        ...result,
        transport: transport.kind,
      };
    } catch (error) {
      lastError = error;
      console.error(`Manex read failed via ${transport.kind} for ${relation}`, {
        error: formatError(error),
      });
    }
  }

  throw lastError ?? new Error(`No configured transport for ${relation}.`);
}

async function insertWithFallback<T extends QueryResultRow>(
  relation: "product_action" | "rework",
  values: Record<string, Primitive>,
  returning: string[],
): Promise<WriteResult<T>> {
  let lastError: unknown;

  for (const transport of writeTransports()) {
    try {
      const row = await transport.insert<T>(relation, values, returning);
      return {
        row,
        transport: transport.kind,
      };
    } catch (error) {
      lastError = error;
      console.error(`Manex write failed via ${transport.kind} for ${relation}`, {
        error: formatError(error),
      });
    }
  }

  throw lastError ?? new Error(`No configured write transport for ${relation}.`);
}

async function findTestSignalsViaRest(
  query: ManexTestSignalQuery,
): Promise<ManexSearchResult<ManexTestSignal>> {
  const rest = createRestTransport();

  if (!rest) {
    throw new Error("REST transport is not configured.");
  }

  let scopedProductIds: string[] | undefined;

  if (query.articleId && !query.productId) {
    const productScope = await rest.read<ProductLookupRow>("product", {
      select: defaultProductLookupSelect,
      filters: [createFilter("article_id", "eq", query.articleId)],
      count: false,
    });

    scopedProductIds = productScope.rows.map((row) => row.product_id);

    if (!scopedProductIds.length) {
      return {
        items: [],
        total: 0,
        transport: "rest",
      };
    }
  }

  const testResult = await rest.read<TestResultRow>("test_result", {
    select: defaultTestSignalSelect,
    filters: [
      ...createTestSignalFilters({
        ...query,
        productId: query.productId,
      }),
      scopedProductIds?.length
        ? createFilter("product_id", "in", scopedProductIds)
        : null,
    ].filter(isPresent),
    orderBy: {
      field: "ts",
      direction: query.sort === "oldest" ? "asc" : "desc",
    },
    limit: query.limit,
    count: true,
  });

  if (!testResult.rows.length) {
    return {
      items: [],
      total: testResult.total ?? 0,
      transport: "rest",
    };
  }

  const productIds = Array.from(
    new Set(testResult.rows.map((row) => row.product_id)),
  );
  const sectionIds = Array.from(
    new Set(
      testResult.rows
        .map((row) => row.section_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [products, sections] = await Promise.all([
    rest.read<ProductLookupRow>("product", {
      select: defaultProductLookupSelect,
      filters: [createFilter("product_id", "in", productIds)],
      count: false,
    }),
    sectionIds.length
      ? rest.read<SectionLookupRow>("section", {
          select: defaultSectionLookupSelect,
          filters: [createFilter("section_id", "in", sectionIds)],
          count: false,
        })
      : Promise.resolve({ rows: [] as SectionLookupRow[], total: null }),
  ]);

  const articleIds = Array.from(
    new Set(
      products.rows
        .map((row) => row.article_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const articles = articleIds.length
    ? await rest.read<ArticleLookupRow>("article", {
        select: defaultArticleLookupSelect,
        filters: [createFilter("article_id", "in", articleIds)],
        count: false,
      })
    : { rows: [] as ArticleLookupRow[], total: null };

  const productMap = new Map(products.rows.map((row) => [row.product_id, row]));
  const articleMap = new Map(articles.rows.map((row) => [row.article_id, row]));
  const sectionMap = new Map(sections.rows.map((row) => [row.section_id, row]));

  const items = testResult.rows
    .map((row) => {
      const product = productMap.get(row.product_id);
      const article = product ? articleMap.get(product.article_id) : undefined;
      const section = row.section_id
        ? sectionMap.get(row.section_id)
        : undefined;

      return mapTestSignal(row, product, article, section);
    })
    .filter((row) => !query.articleId || row.articleId === query.articleId);

  return {
    items,
    total: testResult.total ?? items.length,
    transport: "rest",
  };
}

type PostgresTestSignalRow = TestResultRow &
  QueryResultRow & {
    article_id: string | null;
    article_name: string | null;
    order_id: string | null;
    build_ts: string | null;
    section_name: string | null;
  };

async function findTestSignalsViaPostgres(
  query: ManexTestSignalQuery,
): Promise<ManexSearchResult<ManexTestSignal>> {
  if (!env.DATABASE_URL) {
    throw new Error("Postgres transport is not configured.");
  }

  const values: unknown[] = [];
  const clauses: string[] = [];

  if (query.productId) {
    values.push(query.productId);
    clauses.push(`tr.product_id = $${values.length}`);
  }

  if (query.articleId) {
    values.push(query.articleId);
    clauses.push(`p.article_id = $${values.length}`);
  }

  if (query.outcomes?.length) {
    values.push(query.outcomes);
    clauses.push(`tr.overall_result = ANY($${values.length})`);
  }

  if (query.testKeys?.length) {
    values.push(query.testKeys);
    clauses.push(`tr.test_key = ANY($${values.length})`);
  }

  if (query.observedAfter) {
    values.push(query.observedAfter);
    clauses.push(`tr.ts >= $${values.length}`);
  }

  if (query.observedBefore) {
    values.push(query.observedBefore);
    clauses.push(`tr.ts <= $${values.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderDirection = query.sort === "oldest" ? "ASC" : "DESC";
  const limitSql =
    typeof query.limit === "number" ? `LIMIT ${Math.max(0, query.limit)}` : "";

  const baseJoin = `
    FROM test_result tr
    JOIN product p ON p.product_id = tr.product_id
    LEFT JOIN article a ON a.article_id = p.article_id
    LEFT JOIN section s ON s.section_id = tr.section_id
    ${whereClause}
  `;

  const [rows, countRows] = await Promise.all([
    queryPostgres<PostgresTestSignalRow>(
      `
        SELECT
          tr.test_result_id,
          tr.test_run_id,
          tr.test_id,
          tr.product_id,
          tr.section_id,
          tr.ts,
          tr.test_time_ms,
          tr.overall_result,
          tr.test_key,
          tr.test_value,
          tr.unit,
          tr.notes,
          p.article_id,
          p.order_id,
          p.build_ts,
          a.name AS article_name,
          s.name AS section_name
        ${baseJoin}
        ORDER BY tr.ts ${orderDirection}
        ${limitSql}
      `,
      values,
    ),
    queryPostgres<{ total_count: number | string }>(
      `SELECT COUNT(*)::int AS total_count ${baseJoin}`,
      values,
    ),
  ]);

  const items = (rows ?? []).map((row) =>
    mapTestSignal(
      row,
      {
        product_id: row.product_id,
        article_id: row.article_id ?? "",
        order_id: row.order_id,
        build_ts: row.build_ts,
      },
      row.article_id
        ? {
            article_id: row.article_id,
            name: row.article_name,
          }
        : undefined,
      row.section_id
        ? {
            section_id: row.section_id,
            name: row.section_name,
          }
        : undefined,
    ),
  );

  return {
    items,
    total: normalizeInteger(countRows?.[0]?.total_count) ?? items.length,
    transport: "postgres",
  };
}

async function findTestSignalsWithFallback(
  query: ManexTestSignalQuery,
): Promise<ManexSearchResult<ManexTestSignal>> {
  let lastError: unknown;

  try {
    return await findTestSignalsViaRest(query);
  } catch (error) {
    lastError = error;
    console.error("Manex test-signal read failed via rest", {
      error: formatError(error),
    });
  }

  try {
    return await findTestSignalsViaPostgres(query);
  } catch (error) {
    lastError = error;
    console.error("Manex test-signal read failed via postgres", {
      error: formatError(error),
    });
  }

  throw lastError ?? new Error("No configured transport for test signals.");
}

export function createManexDataAccess(): ManexDataAccess {
  return {
    investigation: {
      async findDefects(query = {}) {
        const result = await readWithFallback<DefectRow>("v_defect_detail", {
          select: defaultDefectSelect,
          filters: createDefectFilters(query),
          orderBy: {
            field: "defect_ts",
            direction: query.sort === "oldest" ? "asc" : "desc",
          },
          limit: query.limit,
          count: true,
        });

        return {
          items: result.rows.map(mapDefect),
          total: result.total,
          transport: result.transport,
        };
      },
      async findDefectsForProduct(productId, query = {}) {
        return this.findDefects({
          ...query,
          productId,
        });
      },
      async findClaims(query = {}) {
        const result = await readWithFallback<ClaimRow>("v_field_claim_detail", {
          select: defaultClaimSelect,
          filters: createClaimFilters(query),
          orderBy: {
            field: "claim_ts",
            direction: query.sort === "oldest" ? "asc" : "desc",
          },
          limit: query.limit,
          count: true,
        });

        return {
          items: result.rows.map(mapClaim),
          total: result.total,
          transport: result.transport,
        };
      },
      async findClaimsForArticle(articleId, query = {}) {
        return this.findClaims({
          ...query,
          articleId,
        });
      },
      async findTestSignals(query = {}) {
        return findTestSignalsWithFallback(query);
      },
      async findTestSignalsForProduct(productId, query = {}) {
        return this.findTestSignals({
          ...query,
          productId,
        });
      },
    },
    traceability: {
      async findInstalledParts(query) {
        const result = await readWithFallback<InstalledPartRow>(
          "v_product_bom_parts",
          {
            select: defaultInstalledPartSelect,
            filters: createInstalledPartFilters(query),
            orderBy: {
              field: "installed_ts",
              direction: "desc",
            },
            limit: query.limit,
            count: true,
          },
        );

        return {
          items: result.rows.map(mapInstalledPart),
          total: result.total,
          transport: result.transport,
        };
      },
      async findInstalledPartsForProduct(productId, query = {}) {
        return this.findInstalledParts({
          ...query,
          productId,
        });
      },
    },
    quality: {
      async findWeeklySummaries(query = {}) {
        const result = await readWithFallback<QualitySummaryRow>(
          "v_quality_summary",
          {
            select: defaultQualitySelect,
            filters: createQualityFilters(query),
            orderBy: {
              field: "week_start",
              direction: query.sort === "oldest" ? "asc" : "desc",
            },
            limit: query.limit,
            count: true,
          },
        );

        return {
          items: result.rows.map(mapWeeklySummary),
          total: result.total,
          transport: result.transport,
        };
      },
      async findWeeklySummariesForArticle(articleId, query = {}) {
        return this.findWeeklySummaries({
          ...query,
          articleId,
        });
      },
    },
    workflow: {
      async findActions(query = {}) {
        const result = await readWithFallback<ActionRow>("product_action", {
          select: defaultActionSelect,
          filters: createActionFilters(query),
          orderBy: {
            field: "ts",
            direction: "desc",
          },
          limit: query.limit,
          count: true,
        });

        return {
          items: result.rows.map(mapAction),
          total: result.total,
          transport: result.transport,
        };
      },
      async findActionsForProduct(productId, query = {}) {
        return this.findActions({
          ...query,
          productId,
        });
      },
      async recordAction(input) {
        const result = await insertWithFallback<ActionRow>(
          "product_action",
          {
            action_id: input.id,
            product_id: input.productId,
            ts: input.recordedAt,
            action_type: input.actionType,
            status: input.status,
            user_id: input.userId,
            defect_id: input.defectId ?? null,
            section_id: input.sectionId ?? null,
            comments: input.comments,
          },
          defaultActionSelect,
        );

        return {
          row: mapAction(result.row),
          transport: result.transport,
        };
      },
      async findRework(query = {}) {
        const result = await readWithFallback<ReworkRow>("rework", {
          select: defaultReworkSelect,
          filters: createReworkFilters(query),
          orderBy: {
            field: "ts",
            direction: "desc",
          },
          limit: query.limit,
          count: true,
        });

        return {
          items: result.rows.map(mapRework),
          total: result.total,
          transport: result.transport,
        };
      },
      async findReworkForDefect(defectId, query = {}) {
        return this.findRework({
          ...query,
          defectId,
        });
      },
      async recordRework(input) {
        const result = await insertWithFallback<ReworkRow>(
          "rework",
          {
            rework_id: input.id,
            defect_id: input.defectId,
            product_id: input.productId,
            ts: input.recordedAt,
            rework_section_id: input.sectionId ?? null,
            action_text: input.actionText,
            reported_part_number: input.reportedPartNumber ?? null,
            user_id: input.userId,
            image_url: input.imageUrl ?? null,
            time_minutes: input.timeMinutes ?? null,
            cost: input.cost ?? null,
          },
          defaultReworkSelect,
        );

        return {
          row: mapRework(result.row),
          transport: result.transport,
        };
      },
    },
  };
}
