/**
 * Loads the Bays Ranch initial dataset. Idempotent: inserts the records that are missing and
 * never touches existing rows, edits, or tags.
 *
 *   npm run db:seed
 */
import { createSqlClient } from "@/server/db/connection";
import { FARM } from "@/server/db/initial-data";
import { seedInitialData } from "@/server/db/seed";
import { describeUrl, loadLocalEnv, requireEnv } from "./lib/env";

async function main(): Promise<void> {
  loadLocalEnv();
  if (process.argv.length > 2) {
    console.error(`Unknown argument: ${process.argv[2]}`);
    process.exit(2);
  }
  const url = requireEnv("DATABASE_MIGRATION_URL", "Set it in .env.local (see .env.example).");
  console.log(`Loading ${FARM.name} initial data into ${describeUrl(url)}`);
  const sql = createSqlClient(url, { max: 1, sslCaPath: process.env.DATABASE_SSL_CA_PATH?.trim() || null, applicationName: "toph-seed" });
  try {
    const report = await seedInitialData(sql);
    console.log(`Farm: ${report.farm}`);
    for (const key of ["employees", "fields", "workLogs"] as const) {
      console.log(`${key}: inserted ${report[key].inserted}, existing ${report[key].existing}`);
    }
    console.log("Tags and tag associations were not modified.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
