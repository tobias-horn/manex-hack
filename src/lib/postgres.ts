import { Pool, type QueryResultRow } from "pg";

import { env } from "@/lib/env";

let pool: Pool | null | undefined;
let poolUsesSsl: boolean | undefined;

const createPool = (useSsl: boolean) =>
  new Pool({
    connectionString: env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

export function getPostgresPool() {
  if (!env.DATABASE_URL) {
    return null;
  }

  if (pool === undefined) {
    const localConnection = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL);
    poolUsesSsl = !localConnection;
    pool = createPool(poolUsesSsl);
  }

  return pool;
}

const shouldRetryWithoutSsl = (error: unknown) =>
  error instanceof Error &&
  /does not support SSL connections/i.test(error.message);

export async function queryPostgres<T extends QueryResultRow>(
  text: string,
  values?: unknown[],
) {
  let client = getPostgresPool();

  if (!client) {
    return null;
  }

  try {
    const result = await client.query<T>(text, values);
    return result.rows;
  } catch (error) {
    if (!poolUsesSsl || !shouldRetryWithoutSsl(error)) {
      throw error;
    }

    await client.end().catch(() => undefined);
    poolUsesSsl = false;
    pool = createPool(false);
    client = pool;

    const result = await client.query<T>(text, values);
    return result.rows;
  }
}
