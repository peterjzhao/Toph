import { getTestDatabaseTarget } from "./test-env";
import { dropBackendSchemas, openTestSql } from "./test-db";

/**
 * Runs once per `vitest run`. Validates the isolated test database target and starts the
 * run from an empty backend schema. It never touches DATABASE_URL.
 */
export default async function globalSetup(): Promise<void> {
  const target = getTestDatabaseTarget();
  const sql = openTestSql({ max: 1 });
  try {
    await sql`select 1`;
    await dropBackendSchemas(sql);
  } catch (error) {
    throw new Error(
      `Cannot prepare the backend test database (${new URL(target.url).host}): ${
        error instanceof Error ? error.message : String(error)
      }. Start it with "npm run db:up" or fix TEST_DATABASE_URL.`,
    );
  } finally {
    await sql.end();
  }
}
