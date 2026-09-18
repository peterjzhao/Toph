/**
 * Puts the database into the demo state: applies pending migrations and runtime grants exactly
 * like `db:migrate`, then, in one transaction, empties every toph table and seeds Bays Ranch as in
 * the design (src/server/db/reset-demo.ts). Without --yes it only prints what it would delete.
 *
 *   npm run db:reset-demo              preview, changes nothing
 *   npm run db:reset-demo -- --yes     migrate and reset
 */
import { createSqlClient } from "@/server/db/connection";
import { planDemoReset, resetDemoState, type DemoResetPlan } from "@/server/db/reset-demo";
import { describeUrl, loadLocalEnv, requireEnv } from "./lib/env";
import { migrateDatabase } from "./lib/migrate-database";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function deletions(plan: DemoResetPlan): string[] {
  const farms = plan.otherFarms.map((farm) => `${farm.name} (${plural(farm.accounts, "account")}, ${plural(farm.logs, "log")})`);
  return [
    `Farms deleted: ${farms.length ? farms.join(", ") : "none"}`,
    `Bays Ranch accounts deleted: ${plan.extraBaysAccounts.length ? plan.extraBaysAccounts.join(", ") : "none"}`,
  ];
}

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv("DATABASE_MIGRATION_URL", "Set it in .env.local (see .env.example).");
  const sslCaPath = process.env.DATABASE_SSL_CA_PATH?.trim() || null;
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--yes")) throw new Error("The only option is --yes.");
  const target = describeUrl(url);

  if (!args.includes("--yes")) {
    const sql = createSqlClient(url, { max: 1, sslCaPath, applicationName: "toph-reset-demo" });
    try {
      console.error(`This resets ${target} to the demo state. It applies pending migrations and grants like`);
      console.error("db:migrate, then replaces all data with Bays Ranch as in the design: the eleven workers and");
      console.error("Ranch Admin (passwords are lowercase first names), eleven logs and demo day April 29, 2026.");
      console.error("Everyone is signed out and Bays Ranch gets a new join code.");
      const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass('toph.farms') is not null as exists`;
      if (exists) for (const line of deletions(await planDemoReset(sql))) console.error(line);
      else console.error("The toph schema doesn't exist yet; the migrations will create it.");
    } finally {
      await sql.end();
    }
    console.error("Deploy the matching code first, then run again with --yes: npm run db:reset-demo -- --yes");
    process.exit(2);
  }

  console.log(`Resetting ${target} to the demo state`);
  await migrateDatabase(url, sslCaPath);
  const sql = createSqlClient(url, { max: 1, sslCaPath, applicationName: "toph-reset-demo" });
  try {
    const { plan, seed } = await resetDemoState(sql);
    for (const line of deletions(plan)) console.log(line);
    console.log(`Bays Ranch restored: ${seed.employees.inserted} employees plus Ranch Admin, ${seed.fields.inserted} fields, ${seed.workLogs.inserted} logs.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  // Drizzle wraps database errors; the cause says what PostgreSQL rejected.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = (cause as { code?: string }).code === "55P03"
    ? "another connection held a table for more than 10 seconds; try again"
    : cause instanceof Error ? cause.message : String(cause);
  console.error(`Demo reset failed, so nothing was deleted: ${message}`);
  process.exit(1);
});
