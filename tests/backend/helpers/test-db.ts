import postgres from "postgres";
import { getTestDatabaseTarget } from "./test-env";

/**
 * Opens a fresh owner connection to the isolated test database. Callers must `end()` it.
 * A new client per call is deliberate: persistence tests must observe committed data through
 * connections that did not perform the write.
 */
export function openTestSql(options: { max?: number } = {}): postgres.Sql {
  const { url } = getTestDatabaseTarget();
  return postgres(url, { max: options.max ?? 4, prepare: false, onnotice: () => {} });
}

/** Opens a connection as the restricted runtime role, or null when TEST_DATABASE_APP_URL is unset. */
export function openTestAppSql(): postgres.Sql | null {
  const { appUrl } = getTestDatabaseTarget();
  if (!appUrl) return null;
  return postgres(appUrl, { max: 2, prepare: false, onnotice: () => {} });
}

/**
 * Drops every schema the backend manages inside the TEST database so a run starts from
 * nothing. Guarded by getTestDatabaseTarget(), which refuses runtime database URLs.
 */
export async function dropBackendSchemas(sql: postgres.Sql): Promise<void> {
  getTestDatabaseTarget();
  await sql.unsafe(`DROP SCHEMA IF EXISTS "toph" CASCADE`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS "drizzle" CASCADE`);
}

export async function listTables(sql: postgres.Sql, schema: string): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = ${schema} and table_type = 'BASE TABLE'
    order by table_name`;
  return rows.map((r) => r.table_name);
}

export async function listViews(sql: postgres.Sql, schema: string): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.views where table_schema = ${schema} order by table_name`;
  return rows.map((r) => r.table_name);
}
