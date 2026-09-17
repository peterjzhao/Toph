import "server-only";
/**
 * Lazy, bounded runtime database pool for the Next.js server.
 *
 * Nothing connects at import time, so building or rendering the frontend without a database
 * configured is unaffected. The first database-backed request creates the pool; missing
 * configuration surfaces as a documented 503 ApiError instead of a crash or a mock.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { databaseUnavailable } from "@/server/errors";
import { createSqlClient } from "./connection";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export type RuntimeDatabase = { url: string; sql: postgres.Sql; db: Database };

// Stored on globalThis so development hot reloads reuse one pool instead of leaking connections.
const globalCache = globalThis as unknown as { __tophRuntimeDatabase?: RuntimeDatabase };

const DEFAULT_POOL_MAX = 5;

function parsePoolMax(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : DEFAULT_POOL_MAX;
}

export function getRuntimeDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

/** Returns the shared runtime pool, creating it on first use. Throws a 503 ApiError when unconfigured. */
export function getRuntimeDatabase(): RuntimeDatabase {
  const url = getRuntimeDatabaseUrl();
  if (!url) throw databaseUnavailable("The database connection is not configured.");

  const cached = globalCache.__tophRuntimeDatabase;
  if (cached && cached.url === url) return cached;
  if (cached) void cached.sql.end({ timeout: 5 }).catch(() => undefined);

  const sql = createSqlClient(url, {
    max: parsePoolMax(process.env.DATABASE_POOL_MAX),
    sslCaPath: process.env.DATABASE_SSL_CA_PATH?.trim() || null,
    applicationName: "toph-app",
  });
  const entry: RuntimeDatabase = { url, sql, db: drizzle(sql, { schema }) };
  globalCache.__tophRuntimeDatabase = entry;
  return entry;
}

/** Runs a trivial query through the runtime pool; used by GET /api/health. */
export async function checkRuntimeDatabase(): Promise<void> {
  const { sql } = getRuntimeDatabase();
  await sql`select 1`;
}
