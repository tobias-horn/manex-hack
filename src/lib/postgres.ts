import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { env } from "@/lib/env";

let pool: Pool | null | undefined;
let poolUsesSsl: boolean | undefined;

const createPool = (useSsl: boolean) =>
  new Pool({
    connectionString: env.DATABASE_URL,
    // Be explicit when SSL is off so local servers do not fall back to driver defaults.
    ssl: useSsl ? { rejectUnauthorized: false } : false,
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
  /(does not support SSL connections|server does not support SSL|no pg_hba\.conf entry .*ssl off)/i.test(
    error.message,
  );

async function retryWithoutSslIfNeeded(error: unknown) {
  if (!poolUsesSsl || !shouldRetryWithoutSsl(error) || !pool) {
    throw error;
  }

  await pool.end().catch(() => undefined);
  poolUsesSsl = false;
  pool = createPool(false);

  return pool;
}

export async function connectPostgresClient(): Promise<PoolClient | null> {
  let currentPool = getPostgresPool();

  if (!currentPool) {
    return null;
  }

  try {
    return await currentPool.connect();
  } catch (error) {
    currentPool = await retryWithoutSslIfNeeded(error);
    return currentPool.connect();
  }
}

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
    client = await retryWithoutSslIfNeeded(error);

    const result = await client.query<T>(text, values);
    return result.rows;
  }
}
