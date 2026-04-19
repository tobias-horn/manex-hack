import { env } from "@/lib/env";
import { parseUnicodeSafeJson, stringifyUnicodeSafe } from "@/lib/json-unicode";
import { resolveManexImageUrl } from "@/lib/manex-images";
import { queryPostgres } from "@/lib/postgres";

type SmokeMode = "live" | "missing" | "error";
type AccessPath = "rest" | "postgres";

type DefectDetailRow = {
  defect_id: string;
  product_id: string;
  defect_ts: string;
  defect_code: string;
  severity: string;
  article_name: string | null;
  detected_section_name: string | null;
  reported_part_number: string | null;
  reported_part_title: string | null;
  image_url: string | null;
  notes: string | null;
};

type CountRow = {
  row_count: number | string;
};

export type ManexConnectionStatus = {
  label: string;
  path: AccessPath;
  mode: SmokeMode;
  detail: string;
  elapsedMs: number | null;
  debug: string | null;
};

export type ManexSampleRow = {
  defectId: string;
  productId: string;
  defectTimestamp: string;
  defectCode: string;
  severity: string;
  articleName: string;
  detectedSection: string;
  partLabel: string;
  imageUrl: string | null;
  notes: string;
};

export type ManexDatasetSmokeTest = {
  ok: boolean;
  checkedAt: string;
  preferredPath: AccessPath | null;
  rowCount: number | null;
  sampleRows: ManexSampleRow[];
  connections: ManexConnectionStatus[];
  studio: {
    configured: boolean;
    url: string | null;
  };
};

const SAMPLE_LIMIT = 5;

const formatDebug = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return stringifyUnicodeSafe(value);
  } catch {
    return String(value);
  }
};

const redactConnectionString = (value: string | undefined) => {
  if (!value) {
    return "missing";
  }

  try {
    const url = new URL(value);

    if (url.password) {
      url.password = "********";
    }

    return url.toString();
  } catch {
    return "invalid DATABASE_URL";
  }
};

const trimNotes = (value: string | null) => {
  const text = value?.replace(/\s+/g, " ").trim();

  if (!text) {
    return "No notes attached.";
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const toSampleRow = (row: DefectDetailRow): ManexSampleRow => ({
  defectId: row.defect_id,
  productId: row.product_id,
  defectTimestamp: row.defect_ts,
  defectCode: row.defect_code,
  severity: row.severity,
  articleName: row.article_name ?? "Unknown article",
  detectedSection: row.detected_section_name ?? "Unknown section",
  partLabel:
    row.reported_part_title && row.reported_part_number
      ? `${row.reported_part_title} (${row.reported_part_number})`
      : row.reported_part_title ??
        row.reported_part_number ??
        "Unknown reported part",
  imageUrl: resolveManexImageUrl(row.image_url),
  notes: trimNotes(row.notes),
});

async function runRestSmokeTest() {
  if (!env.MANEX_REST_API_URL || !env.MANEX_REST_API_KEY) {
    return {
      rowCount: null,
      sampleRows: [] as ManexSampleRow[],
      status: {
        label: "REST API",
        path: "rest" as const,
        mode: "missing" as const,
        detail:
          "Set MANEX_REST_API_URL and MANEX_REST_API_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY).",
        elapsedMs: null,
        debug: null,
      },
    };
  }

  const startedAt = Date.now();

  try {
    const apiUrl = new URL("v_defect_detail", env.MANEX_REST_API_URL);
    apiUrl.searchParams.set(
      "select",
      [
        "defect_id",
        "product_id",
        "defect_ts",
        "defect_code",
        "severity",
        "article_name",
        "detected_section_name",
        "reported_part_number",
        "reported_part_title",
        "image_url",
        "notes",
      ].join(","),
    );
    apiUrl.searchParams.set("order", "defect_ts.desc");
    apiUrl.searchParams.set("limit", String(SAMPLE_LIMIT));

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.MANEX_REST_API_KEY}`,
        apikey: env.MANEX_REST_API_KEY,
        Prefer: "count=exact",
      },
      cache: "no-store",
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${responseText.slice(0, 300)}`,
      );
    }

    const data = parseUnicodeSafeJson<DefectDetailRow[]>(responseText);
    const contentRange = response.headers.get("content-range");
    const rowCountText = contentRange?.split("/")[1];
    const rowCount =
      rowCountText && rowCountText !== "*"
        ? Number(rowCountText)
        : data.length;

    return {
      rowCount,
      sampleRows: data.map(toSampleRow),
      status: {
        label: "REST API",
        path: "rest" as const,
        mode: "live" as const,
        detail: "PostgREST returned v_defect_detail successfully.",
        elapsedMs: Date.now() - startedAt,
        debug: null,
      },
    };
  } catch (error) {
    const debug = formatDebug(error);

    console.error("Manex REST smoke test failed", {
      apiUrl: env.MANEX_REST_API_URL,
      debug,
    });

    return {
      rowCount: null,
      sampleRows: [] as ManexSampleRow[],
      status: {
        label: "REST API",
        path: "rest" as const,
        mode: "error" as const,
        detail:
          "REST authentication or connectivity failed while reading v_defect_detail.",
        elapsedMs: Date.now() - startedAt,
        debug,
      },
    };
  }
}

async function runPostgresSmokeTest() {
  if (!env.DATABASE_URL) {
    return {
      rowCount: null,
      sampleRows: [] as ManexSampleRow[],
      status: {
        label: "Direct Postgres",
        path: "postgres" as const,
        mode: "missing" as const,
        detail: "Set DATABASE_URL to enable direct SQL access.",
        elapsedMs: null,
        debug: null,
      },
    };
  }

  const startedAt = Date.now();

  try {
    const [countRows, sampleRows] = await Promise.all([
      queryPostgres<CountRow>(
        "SELECT COUNT(*)::int AS row_count FROM v_defect_detail",
      ),
      queryPostgres<DefectDetailRow>(`
        SELECT
          defect_id,
          product_id,
          defect_ts,
          defect_code,
          severity,
          article_name,
          detected_section_name,
          reported_part_number,
          reported_part_title,
          image_url,
          notes
        FROM v_defect_detail
        ORDER BY defect_ts DESC NULLS LAST
        LIMIT $1
      `, [SAMPLE_LIMIT]),
    ]);

    const rowCount = Number(countRows?.[0]?.row_count ?? 0);

    return {
      rowCount,
      sampleRows: (sampleRows ?? []).map(toSampleRow),
      status: {
        label: "Direct Postgres",
        path: "postgres" as const,
        mode: "live" as const,
        detail: "Direct SQL query against v_defect_detail completed successfully.",
        elapsedMs: Date.now() - startedAt,
        debug: null,
      },
    };
  } catch (error) {
    const debug = formatDebug(error);

    console.error("Manex Postgres smoke test failed", {
      databaseUrl: redactConnectionString(env.DATABASE_URL),
      debug,
    });

    return {
      rowCount: null,
      sampleRows: [] as ManexSampleRow[],
      status: {
        label: "Direct Postgres",
        path: "postgres" as const,
        mode: "error" as const,
        detail:
          "Postgres authentication or connectivity failed while reading v_defect_detail.",
        elapsedMs: Date.now() - startedAt,
        debug,
      },
    };
  }
}

export async function getManexDatasetSmokeTest(): Promise<ManexDatasetSmokeTest> {
  const [restResult, postgresResult] = await Promise.all([
    runRestSmokeTest(),
    runPostgresSmokeTest(),
  ]);

  const preferredPath =
    restResult.status.mode === "live"
      ? "rest"
      : postgresResult.status.mode === "live"
        ? "postgres"
        : null;

  return {
    ok: Boolean(preferredPath),
    checkedAt: new Date().toISOString(),
    preferredPath,
    rowCount:
      restResult.rowCount ?? postgresResult.rowCount ?? null,
    sampleRows:
      restResult.sampleRows.length > 0
        ? restResult.sampleRows
        : postgresResult.sampleRows,
    connections: [restResult.status, postgresResult.status],
    studio: {
      configured: Boolean(env.MANEX_STUDIO_URL),
      url: env.MANEX_STUDIO_URL ?? null,
    },
  };
}
