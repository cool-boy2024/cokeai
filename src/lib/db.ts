import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForDb = globalThis as unknown as { cokeaiPool?: Pool };

export function getPool(): Pool {
  if (globalForDb.cokeaiPool) return globalForDb.cokeaiPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  const pool = new Pool({
    connectionString,
    max: Number.parseInt(process.env.DATABASE_POOL_SIZE || "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  globalForDb.cokeaiPool = pool;
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function toNumber(value: string | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
