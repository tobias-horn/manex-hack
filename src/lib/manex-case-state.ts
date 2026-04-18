import type { PoolClient, QueryResultRow } from "pg";
import { connectPostgresClient, getPostgresPool } from "@/lib/postgres";

export type ManexCaseStatus =
  | "open"
  | "triage"
  | "in_progress"
  | "monitoring"
  | "closed";

export type ManexCasePriority = "low" | "medium" | "high" | "critical";

export type ManexCaseSignalType =
  | "defect"
  | "field_claim"
  | "bad_test"
  | "marginal_test"
  | "product_action"
  | "rework"
  | "part_install"
  | "custom";

export type ManexCaseNoteType = "note" | "finding" | "timeline" | "decision";

export type ManexHypothesisStatus =
  | "open"
  | "supported"
  | "rejected"
  | "needs_data";

type CaseRow = QueryResultRow & {
  case_id: string;
  title: string;
  status: string;
  priority: string;
  summary: string | null;
  product_id: string | null;
  article_id: string | null;
  owner_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  signal_count: number | string | null;
  hypothesis_count: number | string | null;
  note_count: number | string | null;
  bookmark_count: number | string | null;
};

type CaseSignalLinkRow = QueryResultRow & {
  link_id: string;
  case_id: string;
  signal_type: string;
  signal_id: string;
  product_id: string | null;
  article_id: string | null;
  note: string | null;
  linked_at: string;
};

type HypothesisRow = QueryResultRow & {
  hypothesis_id: string;
  case_id: string;
  statement: string;
  status: string;
  confidence: number | string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type InvestigationNoteRow = QueryResultRow & {
  note_id: string;
  case_id: string;
  note_type: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type EvidenceBookmarkRow = QueryResultRow & {
  bookmark_id: string;
  case_id: string;
  entity_type: string;
  entity_id: string;
  label: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

const CASE_STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cases (
  case_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triage', 'in_progress', 'monitoring', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  summary TEXT NOT NULL DEFAULT '',
  product_id TEXT,
  article_id TEXT,
  owner_user_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_product_id ON cases (product_id);
CREATE INDEX IF NOT EXISTS idx_cases_article_id ON cases (article_id);
CREATE INDEX IF NOT EXISTS idx_cases_updated_at ON cases (updated_at DESC);

CREATE TABLE IF NOT EXISTS case_signal_links (
  link_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('defect', 'field_claim', 'bad_test', 'marginal_test', 'product_action', 'rework', 'part_install', 'custom')),
  signal_id TEXT NOT NULL,
  product_id TEXT,
  article_id TEXT,
  note TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, signal_type, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_case_signal_links_case_id ON case_signal_links (case_id);
CREATE INDEX IF NOT EXISTS idx_case_signal_links_signal ON case_signal_links (signal_type, signal_id);

CREATE TABLE IF NOT EXISTS hypotheses (
  hypothesis_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'supported', 'rejected', 'needs_data')),
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_case_id ON hypotheses (case_id);

CREATE TABLE IF NOT EXISTS investigation_notes (
  note_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'note' CHECK (note_type IN ('note', 'finding', 'timeline', 'decision')),
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigation_notes_case_id ON investigation_notes (case_id);

CREATE TABLE IF NOT EXISTS saved_filters (
  saved_filter_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'cases',
  filter_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_scope ON saved_filters (scope);

CREATE TABLE IF NOT EXISTS evidence_bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_bookmarks_case_id ON evidence_bookmarks (case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_bookmarks_entity ON evidence_bookmarks (entity_type, entity_id);
`;

let ensurePromise: Promise<void> | null = null;

export type ManexCaseSignalLink = {
  id: string;
  caseId: string;
  signalType: ManexCaseSignalType;
  signalId: string;
  productId: string | null;
  articleId: string | null;
  note: string | null;
  linkedAt: string;
};

export type ManexCaseHypothesis = {
  id: string;
  caseId: string;
  statement: string;
  status: ManexHypothesisStatus;
  confidence: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManexInvestigationNote = {
  id: string;
  caseId: string;
  noteType: ManexCaseNoteType;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManexEvidenceBookmark = {
  id: string;
  caseId: string;
  entityType: string;
  entityId: string;
  label: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type ManexCase = {
  id: string;
  title: string;
  status: ManexCaseStatus;
  priority: ManexCasePriority;
  summary: string;
  productId: string | null;
  articleId: string | null;
  ownerUserId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    signals: number;
    hypotheses: number;
    notes: number;
    bookmarks: number;
  };
  signalLinks: ManexCaseSignalLink[];
  hypotheses: ManexCaseHypothesis[];
  notes: ManexInvestigationNote[];
  evidenceBookmarks: ManexEvidenceBookmark[];
};

export type CreateManexCaseInput = {
  id: string;
  title: string;
  summary?: string;
  productId?: string | null;
  articleId?: string | null;
  status?: ManexCaseStatus;
  priority?: ManexCasePriority;
  ownerUserId?: string | null;
  createdBy?: string | null;
  signalLinks?: Array<{
    id: string;
    signalType: ManexCaseSignalType;
    signalId: string;
    productId?: string | null;
    articleId?: string | null;
    note?: string | null;
  }>;
  openingHypothesis?: {
    id: string;
    statement: string;
    status?: ManexHypothesisStatus;
    confidence?: number | null;
    createdBy?: string | null;
  } | null;
  openingNote?: {
    id: string;
    body: string;
    noteType?: ManexCaseNoteType;
    createdBy?: string | null;
  } | null;
  evidenceBookmarks?: Array<{
    id: string;
    entityType: string;
    entityId: string;
    label: string;
    notes?: string | null;
    createdBy?: string | null;
  }>;
};

export type CreateCaseHypothesisInput = {
  id: string;
  caseId: string;
  statement: string;
  status?: ManexHypothesisStatus;
  confidence?: number | null;
  createdBy?: string | null;
};

export type CreateInvestigationNoteInput = {
  id: string;
  caseId: string;
  body: string;
  noteType?: ManexCaseNoteType;
  createdBy?: string | null;
};

export type CreateEvidenceBookmarkInput = {
  id: string;
  caseId: string;
  entityType: string;
  entityId: string;
  label: string;
  notes?: string | null;
  createdBy?: string | null;
};

export type SaveFilterInput = {
  id: string;
  name: string;
  scope: string;
  filterPayload: Record<string, unknown>;
  createdBy?: string | null;
};

const normalizeText = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : "";
};

const normalizeNullableText = (value: string | null | undefined) => {
  const text = normalizeText(value);
  return text ? text : null;
};

const normalizeIso = (value: string) => new Date(value).toISOString();

const normalizeNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return Number(value);
};

const mapSignalLink = (row: CaseSignalLinkRow): ManexCaseSignalLink => ({
  id: row.link_id,
  caseId: row.case_id,
  signalType: row.signal_type as ManexCaseSignalType,
  signalId: row.signal_id,
  productId: normalizeNullableText(row.product_id),
  articleId: normalizeNullableText(row.article_id),
  note: normalizeNullableText(row.note),
  linkedAt: normalizeIso(row.linked_at),
});

const mapHypothesis = (row: HypothesisRow): ManexCaseHypothesis => ({
  id: row.hypothesis_id,
  caseId: row.case_id,
  statement: normalizeText(row.statement),
  status: row.status as ManexHypothesisStatus,
  confidence: normalizeNumber(row.confidence),
  createdBy: normalizeNullableText(row.created_by),
  createdAt: normalizeIso(row.created_at),
  updatedAt: normalizeIso(row.updated_at),
});

const mapNote = (row: InvestigationNoteRow): ManexInvestigationNote => ({
  id: row.note_id,
  caseId: row.case_id,
  noteType: row.note_type as ManexCaseNoteType,
  body: normalizeText(row.body),
  createdBy: normalizeNullableText(row.created_by),
  createdAt: normalizeIso(row.created_at),
  updatedAt: normalizeIso(row.updated_at),
});

const mapBookmark = (row: EvidenceBookmarkRow): ManexEvidenceBookmark => ({
  id: row.bookmark_id,
  caseId: row.case_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  label: normalizeText(row.label),
  notes: normalizeNullableText(row.notes),
  createdBy: normalizeNullableText(row.created_by),
  createdAt: normalizeIso(row.created_at),
});

const getRequiredPool = () => {
  const pool = getPostgresPool();

  if (!pool) {
    throw new Error("DATABASE_URL is required for custom case-state tables.");
  }

  return pool;
};

async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await connectPostgresClient();

  if (!client) {
    throw new Error("DATABASE_URL is required for custom case-state tables.");
  }

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function touchCase(client: PoolClient, caseId: string) {
  await client.query(`UPDATE cases SET updated_at = NOW() WHERE case_id = $1`, [
    caseId,
  ]);
}

export async function ensureCaseStateTables() {
  if (!ensurePromise) {
    ensurePromise = withClient(async (client) => {
      await client.query(CASE_STATE_SCHEMA_SQL);
    }).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  return ensurePromise;
}

async function fetchCasesByIds(caseIds: string[]): Promise<ManexCase[]> {
  if (!caseIds.length) {
    return [];
  }

  const pool = getRequiredPool();
  const [caseRows, signalRows, hypothesisRows, noteRows, bookmarkRows] =
    await Promise.all([
      pool.query<CaseRow>(
        `
          SELECT
            c.case_id,
            c.title,
            c.status,
            c.priority,
            c.summary,
            c.product_id,
            c.article_id,
            c.owner_user_id,
            c.created_by,
            c.created_at,
            c.updated_at,
            COALESCE(sl.signal_count, 0) AS signal_count,
            COALESCE(h.hypothesis_count, 0) AS hypothesis_count,
            COALESCE(n.note_count, 0) AS note_count,
            COALESCE(b.bookmark_count, 0) AS bookmark_count
          FROM cases c
          LEFT JOIN (
            SELECT case_id, COUNT(*)::int AS signal_count
            FROM case_signal_links
            GROUP BY case_id
          ) sl ON sl.case_id = c.case_id
          LEFT JOIN (
            SELECT case_id, COUNT(*)::int AS hypothesis_count
            FROM hypotheses
            GROUP BY case_id
          ) h ON h.case_id = c.case_id
          LEFT JOIN (
            SELECT case_id, COUNT(*)::int AS note_count
            FROM investigation_notes
            GROUP BY case_id
          ) n ON n.case_id = c.case_id
          LEFT JOIN (
            SELECT case_id, COUNT(*)::int AS bookmark_count
            FROM evidence_bookmarks
            GROUP BY case_id
          ) b ON b.case_id = c.case_id
          WHERE c.case_id = ANY($1)
          ORDER BY c.updated_at DESC
        `,
        [caseIds],
      ),
      pool.query<CaseSignalLinkRow>(
        `
          SELECT *
          FROM case_signal_links
          WHERE case_id = ANY($1)
          ORDER BY linked_at DESC
        `,
        [caseIds],
      ),
      pool.query<HypothesisRow>(
        `
          SELECT *
          FROM hypotheses
          WHERE case_id = ANY($1)
          ORDER BY updated_at DESC
        `,
        [caseIds],
      ),
      pool.query<InvestigationNoteRow>(
        `
          SELECT *
          FROM investigation_notes
          WHERE case_id = ANY($1)
          ORDER BY updated_at DESC
        `,
        [caseIds],
      ),
      pool.query<EvidenceBookmarkRow>(
        `
          SELECT *
          FROM evidence_bookmarks
          WHERE case_id = ANY($1)
          ORDER BY created_at DESC
        `,
        [caseIds],
      ),
    ]);

  const signalMap = signalRows.rows.reduce((map, row) => {
    const current = map.get(row.case_id) ?? [];
    current.push(mapSignalLink(row));
    map.set(row.case_id, current);
    return map;
  }, new Map<string, ManexCaseSignalLink[]>());

  const hypothesisMap = hypothesisRows.rows.reduce((map, row) => {
    const current = map.get(row.case_id) ?? [];
    current.push(mapHypothesis(row));
    map.set(row.case_id, current);
    return map;
  }, new Map<string, ManexCaseHypothesis[]>());

  const noteMap = noteRows.rows.reduce((map, row) => {
    const current = map.get(row.case_id) ?? [];
    current.push(mapNote(row));
    map.set(row.case_id, current);
    return map;
  }, new Map<string, ManexInvestigationNote[]>());

  const bookmarkMap = bookmarkRows.rows.reduce((map, row) => {
    const current = map.get(row.case_id) ?? [];
    current.push(mapBookmark(row));
    map.set(row.case_id, current);
    return map;
  }, new Map<string, ManexEvidenceBookmark[]>());

  return caseRows.rows.map((row) => ({
    id: row.case_id,
    title: normalizeText(row.title),
    status: row.status as ManexCaseStatus,
    priority: row.priority as ManexCasePriority,
    summary: normalizeText(row.summary),
    productId: normalizeNullableText(row.product_id),
    articleId: normalizeNullableText(row.article_id),
    ownerUserId: normalizeNullableText(row.owner_user_id),
    createdBy: normalizeNullableText(row.created_by),
    createdAt: normalizeIso(row.created_at),
    updatedAt: normalizeIso(row.updated_at),
    counts: {
      signals: normalizeNumber(row.signal_count) ?? 0,
      hypotheses: normalizeNumber(row.hypothesis_count) ?? 0,
      notes: normalizeNumber(row.note_count) ?? 0,
      bookmarks: normalizeNumber(row.bookmark_count) ?? 0,
    },
    signalLinks: signalMap.get(row.case_id) ?? [],
    hypotheses: hypothesisMap.get(row.case_id) ?? [],
    notes: noteMap.get(row.case_id) ?? [],
    evidenceBookmarks: bookmarkMap.get(row.case_id) ?? [],
  }));
}

export async function listManexCases(limit = 16) {
  await ensureCaseStateTables();

  const pool = getRequiredPool();
  const rows = await pool.query<{ case_id: string }>(
    `
      SELECT case_id
      FROM cases
      ORDER BY updated_at DESC
      LIMIT $1
    `,
    [limit],
  );

  return fetchCasesByIds(rows.rows.map((row) => row.case_id));
}

export async function createManexCase(input: CreateManexCaseInput) {
  await ensureCaseStateTables();

  await withClient(async (client) => {
    await client.query("BEGIN");

    try {
      await client.query(
        `
          INSERT INTO cases (
            case_id,
            title,
            status,
            priority,
            summary,
            product_id,
            article_id,
            owner_user_id,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          input.id,
          input.title,
          input.status ?? "open",
          input.priority ?? "medium",
          input.summary ?? "",
          input.productId ?? null,
          input.articleId ?? null,
          input.ownerUserId ?? null,
          input.createdBy ?? null,
        ],
      );

      for (const link of input.signalLinks ?? []) {
        await client.query(
          `
            INSERT INTO case_signal_links (
              link_id,
              case_id,
              signal_type,
              signal_id,
              product_id,
              article_id,
              note
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            link.id,
            input.id,
            link.signalType,
            link.signalId,
            link.productId ?? input.productId ?? null,
            link.articleId ?? input.articleId ?? null,
            link.note ?? null,
          ],
        );
      }

      if (input.openingHypothesis) {
        await client.query(
          `
            INSERT INTO hypotheses (
              hypothesis_id,
              case_id,
              statement,
              status,
              confidence,
              created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            input.openingHypothesis.id,
            input.id,
            input.openingHypothesis.statement,
            input.openingHypothesis.status ?? "open",
            input.openingHypothesis.confidence ?? null,
            input.openingHypothesis.createdBy ?? input.createdBy ?? null,
          ],
        );
      }

      if (input.openingNote) {
        await client.query(
          `
            INSERT INTO investigation_notes (
              note_id,
              case_id,
              note_type,
              body,
              created_by
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            input.openingNote.id,
            input.id,
            input.openingNote.noteType ?? "note",
            input.openingNote.body,
            input.openingNote.createdBy ?? input.createdBy ?? null,
          ],
        );
      }

      for (const bookmark of input.evidenceBookmarks ?? []) {
        await client.query(
          `
            INSERT INTO evidence_bookmarks (
              bookmark_id,
              case_id,
              entity_type,
              entity_id,
              label,
              notes,
              created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            bookmark.id,
            input.id,
            bookmark.entityType,
            bookmark.entityId,
            bookmark.label,
            bookmark.notes ?? null,
            bookmark.createdBy ?? input.createdBy ?? null,
          ],
        );
      }

      await touchCase(client, input.id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  return (await fetchCasesByIds([input.id]))[0];
}

export async function addCaseHypothesis(input: CreateCaseHypothesisInput) {
  await ensureCaseStateTables();

  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO hypotheses (
          hypothesis_id,
          case_id,
          statement,
          status,
          confidence,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        input.id,
        input.caseId,
        input.statement,
        input.status ?? "open",
        input.confidence ?? null,
        input.createdBy ?? null,
      ],
    );

    await touchCase(client, input.caseId);
  });

  return (await fetchCasesByIds([input.caseId]))[0];
}

export async function addInvestigationNote(input: CreateInvestigationNoteInput) {
  await ensureCaseStateTables();

  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO investigation_notes (
          note_id,
          case_id,
          note_type,
          body,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        input.id,
        input.caseId,
        input.noteType ?? "note",
        input.body,
        input.createdBy ?? null,
      ],
    );

    await touchCase(client, input.caseId);
  });

  return (await fetchCasesByIds([input.caseId]))[0];
}

export async function addEvidenceBookmark(input: CreateEvidenceBookmarkInput) {
  await ensureCaseStateTables();

  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO evidence_bookmarks (
          bookmark_id,
          case_id,
          entity_type,
          entity_id,
          label,
          notes,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.id,
        input.caseId,
        input.entityType,
        input.entityId,
        input.label,
        input.notes ?? null,
        input.createdBy ?? null,
      ],
    );

    await touchCase(client, input.caseId);
  });

  return (await fetchCasesByIds([input.caseId]))[0];
}

export async function saveFilter(input: SaveFilterInput) {
  await ensureCaseStateTables();

  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO saved_filters (
          saved_filter_id,
          name,
          scope,
          filter_payload,
          created_by
        )
        VALUES ($1, $2, $3, $4::jsonb, $5)
        ON CONFLICT (saved_filter_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          scope = EXCLUDED.scope,
          filter_payload = EXCLUDED.filter_payload,
          created_by = EXCLUDED.created_by,
          updated_at = NOW()
      `,
      [
        input.id,
        input.name,
        input.scope,
        JSON.stringify(input.filterPayload),
        input.createdBy ?? null,
      ],
    );
  });
}
