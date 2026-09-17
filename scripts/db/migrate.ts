/**
 * Applies pending SQL migrations from drizzle/, gives accounts that predate passwords their
 * initial one (lowercased first name, stored hashed), and then grants the restricted runtime role its
 * privileges. Uses DATABASE_MIGRATION_URL (owner/DDL connection), never DATABASE_URL.
 *
 *   npm run db:migrate
 */
import { backfillPasswords } from "@/server/accounts/password";
import { createSqlClient } from "@/server/db/connection";
import { applyRuntimeGrants } from "@/server/db/grants";
import { runMigrations } from "@/server/db/migrate";
import { describeUrl, loadLocalEnv, requireEnv } from "./lib/env";

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv("DATABASE_MIGRATION_URL", "Set it in .env.local (see .env.example).");
  const sslCaPath = process.env.DATABASE_SSL_CA_PATH?.trim() || null;
  console.log(`Migrating ${describeUrl(url)}`);

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

main().catch((error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
