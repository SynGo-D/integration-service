/**
 * Postgres pool singleton.
 * -----------------------------------------------------------------------------
 * We use `pg` directly (no ORM) to keep the surface area small. This module
 * exposes a lazy singleton; test code can call `setPool(fakePool)` to
 * substitute an in-memory shim.
 */

import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function initPool(cfg: PoolConfig): Pool {
  if (pool) return pool;
  pool = new Pool(cfg);
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error("Postgres pool not initialised — call initPool() at startup");
  return pool;
}

export function setPool(p: Pool): void {
  pool = p;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}
