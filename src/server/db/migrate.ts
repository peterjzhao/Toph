/**
 * Applies the versioned SQL migrations under drizzle/ using Drizzle's migrator.
 * Used by scripts/db/migrate.ts and the backend tests; never by the app at request time.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { createSqlClient } from "./connection";

export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

export type MigrationResult = { applied: number; total: number };

async function countApplied(sql: postgres.Sql): Promise<number> {
  const [{ exists }] = await sql<{ exists: boolean }[]>`
    select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as exists`;
  if (!exists) return 0;
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)}`;
  return count;
}

/**
 * Runs pending migrations against `url`, which must carry DDL privileges
 * (DATABASE_MIGRATION_URL or TEST_DATABASE_URL). Applied migrations are recorded in
 * drizzle.__drizzle_migrations, outside the application schema.
 */
export async function runMigrations(
  url: string,
  options: { migrationsFolder?: string; sslCaPath?: string | null } = {},
): Promise<MigrationResult> {
  const migrationsFolder = options.migrationsFolder ?? path.resolve(process.cwd(), "drizzle");
  const sql = createSqlClient(url, { max: 1, sslCaPath: options.sslCaPath, applicationName: "toph-migrate" });
  try {
    const before = await countApplied(sql);
    await migrate(drizzle(sql), {
      migrationsFolder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    const total = await countApplied(sql);
    return { applied: total - before, total };
  } finally {
    await sql.end();
  }
}
