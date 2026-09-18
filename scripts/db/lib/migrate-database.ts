import { backfillPasswords } from "@/server/accounts/password";
import { createSqlClient } from "@/server/db/connection";
import { applyRuntimeGrants } from "@/server/db/grants";
import { runMigrations } from "@/server/db/migrate";

/**
 * The `db:migrate` steps: pending SQL migrations from drizzle/, the initial password (lowercased
 * first name, stored hashed) for accounts that predate passwords, then the restricted runtime
 * role's grants. `url` must be the owner connection (DATABASE_MIGRATION_URL).
 */
export async function migrateDatabase(url: string, sslCaPath: string | null): Promise<void> {
  const result = await runMigrations(url, { sslCaPath });
  console.log(`Migrations applied now: ${result.applied}; total recorded: ${result.total}`);

  const sql = createSqlClient(url, { max: 1, sslCaPath, applicationName: "toph-grants" });
  try {
    const backfilled = await backfillPasswords(sql);
    if (backfilled) console.log(`Set initial first-name passwords on ${backfilled} existing account(s).`);

    const role = process.env.DATABASE_APP_ROLE?.trim();
    if (!role) {
      console.log("DATABASE_APP_ROLE is empty; skipping runtime grants.");
      return;
    }
    const grants = await applyRuntimeGrants(sql, role);
    if (grants.applied) {
      const revoked = grants.revokedFrom.length ? ` Revoked access from: ${grants.revokedFrom.join(", ")}.` : "";
      console.log(`Runtime grants applied to role "${role}".${revoked}`);
    } else {
      console.log(`Runtime grants skipped: role "${role}" ${grants.reason}. Create it first (see docs/backend/setup.md).`);
    }
  } finally {
    await sql.end();
  }
}
