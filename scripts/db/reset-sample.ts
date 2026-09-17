/**
 * Resets the Bays Ranch sample farm to its seeded state. Deletes every change made to that
 * farm (logs, tags, recordings, messages, workspace edits, sessions). Other farms are kept.
 *
 *   npm run db:reset-sample -- --yes
 */
import { createSqlClient } from "@/server/db/connection";
import { FARM } from "@/server/db/initial-data";
import { resetSampleFarm } from "@/server/db/reset-sample";
import { describeUrl, loadLocalEnv, requireEnv } from "./lib/env";

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv("DATABASE_MIGRATION_URL", "Set it in .env.local (see .env.example).");
  if (process.argv[2] !== "--yes") {
    console.error(`This deletes all changes to ${FARM.name} in ${describeUrl(url)}.`);
    console.error("Run again with --yes to continue: npm run db:reset-sample -- --yes");
    process.exit(2);
  }
  console.log(`Resetting ${FARM.name} in ${describeUrl(url)}`);
  const sql = createSqlClient(url, { max: 1, sslCaPath: process.env.DATABASE_SSL_CA_PATH?.trim() || null, applicationName: "toph-reset-sample" });
  try {
    const report = await resetSampleFarm(sql);
    console.log(`Done: ${report.employees.inserted} employees, ${report.fields.inserted} fields, ${report.workLogs.inserted} logs.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
