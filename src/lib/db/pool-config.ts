import type { PoolConfig } from "pg";

/**
 * DATABASE_URL → node-postgres pool config for Prisma's driver adapter.
 *
 * Why an adapter at all: over Supabase's transaction pooler, Prisma's built-in
 * engine needs `pgbouncer=true`, which makes it spend ~5 network round trips on
 * every statement (measured 2026-10-01: ~620 ms per query from Manila to Seoul
 * against a ~110 ms TCP round trip). node-postgres pipelines each statement
 * into ONE round trip with unnamed statements, which the transaction pooler
 * accepts without prepared-statement collisions: ~120 ms per query, and a
 * withTenant() transaction drops by the same factor.
 *
 * Two traps this function exists to close:
 *   - pg's default is PLAINTEXT, where Prisma's engine negotiated TLS. Remote
 *     hosts are forced onto TLS here. (Supabase's pooler cert is not in Node's
 *     trust store, hence no CA verification — the same as Prisma's sslmode.)
 *   - Prisma-only params (pgbouncer, connection_limit, …) mean nothing to pg,
 *     and sslmode in the URL would override the ssl object, so they are
 *     stripped and translated instead.
 */

// Reads DATABASE_URL and the optional DB_POOL_MAX override (process.env fits).
type DbEnv = Readonly<Record<string, string | undefined>>;

/** Per server instance. Fluid Compute shares one instance across requests, and
 *  the transaction pooler multiplexes these onto few server connections. */
export const DEFAULT_POOL_MAX = 5;
const IDLE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

const PRISMA_ONLY_PARAMS = [
  "pgbouncer",
  "connection_limit",
  "pool_timeout",
  "connect_timeout",
  "socket_timeout",
  "statement_cache_size",
  "schema",
  "sslmode",
  "sslaccept",
];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function positiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function pgPoolConfig(env: DbEnv): PoolConfig {
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set — cannot open a database pool");

  const url = new URL(raw);
  const params = url.searchParams;
  const sslDisabled = params.get("sslmode") === "disable" || LOCAL_HOSTS.has(url.hostname);
  const max = positiveInt(env.DB_POOL_MAX) ?? positiveInt(params.get("connection_limit")) ?? DEFAULT_POOL_MAX;

  for (const key of PRISMA_ONLY_PARAMS) params.delete(key);

  return {
    connectionString: url.toString(),
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  };
}
