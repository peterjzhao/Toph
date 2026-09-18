/**
 * Prepares Bays Ranch's premade April 2026 reports with the same code as POST /api/reports and
 * freezes them into src/server/db/sample-reports.json and drizzle/0014_farm_reports.sql.
 *
 * Test database only: TEST_DATABASE_URL's database name must contain "test". The script drops and
 * rebuilds that database's schemas, seeds the pristine Bays Ranch logs, and detects facts once
 * for all seven reports, so one log never reads differently in two reports. Review the printed
 * detections before committing. An existing migration is kept unless --force is passed.
 *
 *   TEST_DATABASE_URL=... OPENAI_API_KEY=... npx tsx --conditions=react-server scripts/db/build-sample-reports.ts
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reportCatalog, reportKinds, type ReportKind } from "@/contracts/reports";
import { createSqlClient } from "@/server/db/connection";
import { FARM } from "@/server/db/initial-data";
import { runMigrations } from "@/server/db/migrate";
import { seedInitialData } from "@/server/db/seed";
import type { SampleReport } from "@/server/db/sample-reports";
import { createFarmContext } from "@/server/farm-context";
import { assembleReport, type ReportLog } from "@/server/reports/assemble";
import { detectionModel, detectReportFacts } from "@/server/reports/detect";
import { applyDetections, detectionCandidates, loadReportLogs, toDetectionLog } from "@/server/reports/service";

const FROM = "2026-04-01";
const TO = "2026-04-30";
const MIGRATION = path.resolve("drizzle/0014_farm_reports.sql");
const JSON_OUT = path.resolve("src/server/db/sample-reports.json");
const sampleReportId = (index: number) => `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

const DDL = `-- Regulatory reports prepared from a farm's work logs (src/contracts/reports.ts).
--
-- A row keeps its document frozen: reopening a report shows exactly what was prepared, even after
-- the logs it cites are corrected. Logs are referenced only inside the document, so deleting or
-- resetting logs never waits on a report. Additive: earlier application code ignores this table.
CREATE TABLE "toph"."farm_reports" (
  "id" uuid PRIMARY KEY NOT NULL,
  "farm_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "period_from" date NOT NULL,
  "period_to" date NOT NULL,
  "document" jsonb NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "farm_reports_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "toph"."farms"("id"),
  CONSTRAINT "farm_reports_kind" CHECK ("kind" IN (${reportKinds.map(kind => `'${kind}'`).join(", ")})),
  CONSTRAINT "farm_reports_name" CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "farm_reports_period" CHECK ("period_to" >= "period_from"),
  CONSTRAINT "farm_reports_document" CHECK (jsonb_typeof("document") = 'object' AND octet_length("document"::text) <= 2097152)
);
--> statement-breakpoint
CREATE INDEX "farm_reports_farm_created" ON "toph"."farm_reports" USING btree ("farm_id", "created_at" DESC);`;

const quoteSql = (text: string) => `'${text.replaceAll("'", "''")}'`;

function insertStatement(report: SampleReport): string {
  const json = JSON.stringify(report.document);
  if (json.includes("$report$")) throw new Error("A document contains the SQL dollar-quote tag.");
  return `INSERT INTO "toph"."farm_reports" ("id", "farm_id", "kind", "name", "period_from", "period_to", "document", "created_by", "created_at")
SELECT ${quoteSql(report.id)}, f."id", ${quoteSql(report.kind)}, ${quoteSql(report.name)}, ${quoteSql(report.from)}, ${quoteSql(report.to)}, $report$${json}$report$::jsonb, ${quoteSql(report.createdBy)}, ${quoteSql(report.createdAt)}
FROM "toph"."farms" f WHERE f."id" = ${quoteSql(FARM.id)}
ON CONFLICT ("id") DO NOTHING;`;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const url = process.env.TEST_DATABASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!url || !apiKey) throw new Error("Set TEST_DATABASE_URL and OPENAI_API_KEY.");
  const database = new URL(url).pathname.slice(1);
  if (!database.includes("test")) throw new Error(`Refusing to rebuild "${database}": the database name must contain "test".`);
  if (existsSync(MIGRATION) && !force) throw new Error(`${path.relative(process.cwd(), MIGRATION)} exists. Pass --force to regenerate it.`);

  const owner = createSqlClient(url, { max: 1, applicationName: "toph-sample-reports" });
  try {
    await owner.unsafe(`DROP SCHEMA IF EXISTS "toph" CASCADE`);
    await owner.unsafe(`DROP SCHEMA IF EXISTS "drizzle" CASCADE`);
  } finally {
    await owner.end();
  }
  await runMigrations(url);
  const seedClient = createSqlClient(url, { max: 1, applicationName: "toph-sample-reports" });
  try { await seedInitialData(seedClient); } finally { await seedClient.end(); }

  const ctx = await createFarmContext({ databaseUrl: url, farmId: FARM.id });
  try {
    const { logs, earlier } = await loadReportLogs(ctx, FROM, TO);
    const union = new Map<string, ReportLog>();
    for (const kind of reportKinds) for (const log of detectionCandidates(kind, logs, earlier).candidates) union.set(log.id, log);
    const detected = await detectReportFacts([...union.values()].map(toDetectionLog), apiKey, AbortSignal.timeout(180_000));
    const gained = applyDetections([...union.values()], detected);

    console.log(`Read ${logs.length} logs; ${union.size} sent to ${detectionModel}.`);
    for (const log of union.values()) {
      const facts = detected.get(log.id) ?? [];
      console.log(`\n${log.id.slice(-2)} ${log.activity} · ${log.field}: ${facts.length ? "" : "no facts"}`);
      for (const fact of facts) console.log(`   ${fact.key} = ${JSON.stringify(fact.value)}   «${fact.quote}»`);
    }

    const generatedAt = new Date().toISOString();
    const reports: SampleReport[] = reportKinds.map((kind: ReportKind, index) => {
      const { candidates, lookback } = detectionCandidates(kind, logs, earlier);
      const factsDetected = candidates.reduce((sum, log) => sum + (gained.get(log.id) ?? 0), 0);
      const document = assembleReport({
        kind, farm: { name: ctx.farm.name, timezone: ctx.farm.timezone }, period: { from: FROM, to: TO }, generatedAt,
        detection: { method: candidates.length ? "ai" : "recorded", model: candidates.length ? detectionModel : null, logsRead: candidates.length, factsDetected },
        logs, earlierApplications: lookback,
      });
      return { id: sampleReportId(index), kind, name: `April 2026 ${reportCatalog[kind].name}`, from: FROM, to: TO, createdAt: generatedAt, createdBy: "Toph", document };
    });

    writeFileSync(JSON_OUT, `${JSON.stringify(reports, null, 2)}\n`);
    writeFileSync(MIGRATION, `${DDL}
--> statement-breakpoint
-- Bays Ranch's premade April 2026 reports, prepared from its sample logs by
-- scripts/db/build-sample-reports.ts (the same rows as src/server/db/sample-reports.json).
-- Inserted only where that farm exists; a fresh database gets them from the seed instead.
${reports.map(insertStatement).join("\n--> statement-breakpoint\n")}
`);
    console.log(`\nWrote ${reports.length} reports:`);
    for (const report of reports) console.log(`   ${report.name}: ${report.document.readiness.message}`);
  } finally {
    await ctx.close();
  }
}

main().catch((error) => {
  console.error(`Sample reports failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
