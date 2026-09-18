/**
 * Applies pending SQL migrations from drizzle/, gives accounts that predate passwords their
 * initial one (lowercased first name, stored hashed), and then grants the restricted runtime role its
 * privileges. Uses DATABASE_MIGRATION_URL (owner/DDL connection), never DATABASE_URL.
 *
 *   npm run db:migrate
 */
import { describeUrl, loadLocalEnv, requireEnv } from "./lib/env";
import { migrateDatabase } from "./lib/migrate-database";

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv("DATABASE_MIGRATION_URL", "Set it in .env.local (see .env.example).");
  console.log(`Migrating ${describeUrl(url)}`);
  await migrateDatabase(url, process.env.DATABASE_SSL_CA_PATH?.trim() || null);
}

main().catch((error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
