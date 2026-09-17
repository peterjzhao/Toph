/**
 * Resets the Bays Ranch sample farm to its seeded state. Deletes every change made to that
 * farm (logs, tags, recordings, messages, workspace edits, sessions), keeping its confirmed
 * field labels, boundaries and aerial image. Other farms are kept.
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
  const args = process.argv.slice(2);
  if (args.some(arg => !["--yes", "--reset-fields"].includes(arg))) throw new Error("Use --yes, and optionally --reset-fields to discard the field map too.");
  const preserveFields = !args.includes("--reset-fields");
  if (!args.includes("--yes")) {
    console.error(`This resets ${FARM.name} in ${describeUrl(url)}. ${preserveFields ? "Field labels and the aerial image are preserved." : "Field labels and the aerial image will also be deleted."}`);
    console.error("Run again with --yes to continue: npm run db:reset-sample -- --yes");
    process.exit(2);
  }
  console.log(`Resetting ${FARM.name} in ${describeUrl(url)} (${preserveFields ? "keeping field map" : "discarding field map"})`);
  const sql = createSqlClient(url, { max: 1, sslCaPath: process.env.DATABASE_SSL_CA_PATH?.trim() || null, applicationName: "toph-reset-sample" });
  try {
    const report = await resetSampleFarm(sql, { preserveFields });
    console.log(`Done: ${report.employees.inserted} employees, ${report.fields.inserted} restored fields, ${report.fields.existing} retained fields, ${report.workLogs.inserted} logs.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
