/**
 * Prepares Bays Ranch's premade April 2026 reports with the same code as POST /api/reports and
 * freezes them into src/server/db/sample-reports.json.
 *
 * Test database only: TEST_DATABASE_URL's database name must contain "test". The script drops and
 * rebuilds that database's schemas and seeds the pristine Bays Ranch logs. Facts are detected once
 * for all seven reports, so one log never reads differently in two of them, and the detections are
 * kept in src/server/db/sample-report-facts.json. With --reuse, those saved detections are checked
 * against the logs again and used instead of asking the model, and each report keeps its original
 * preparation time: a document format change then changes no fact.
 *
 * --migration <file> also writes a migration that updates the stored samples in databases that
 * already hold them (migration 0014 inserted the first version). Deleted samples are not restored.
 *
 *   TEST_DATABASE_URL=... OPENAI_API_KEY=... npx tsx --conditions=react-server scripts/db/build-sample-reports.ts
 *   TEST_DATABASE_URL=... npx tsx --conditions=react-server scripts/db/build-sample-reports.ts --reuse --migration drizzle/0015_x.sql
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { reportCatalog, reportKinds, type ReportKind } from "@/contracts/reports";
import { createSqlClient } from "@/server/db/connection";
import { FARM } from "@/server/db/initial-data";
import { runMigrations } from "@/server/db/migrate";
import type { SampleReport } from "@/server/db/sample-reports";
import { seedInitialData } from "@/server/db/seed";
import { createFarmContext } from "@/server/farm-context";
import { assembleReport, type ReportLog } from "@/server/reports/assemble";
import { detectionModel, detectReportFacts, validateDetections, type DetectedFact } from "@/server/reports/detect";
import { applyDetections, detectionCandidates, loadReportLogs, toDetectionLog } from "@/server/reports/service";

const FROM = "2026-04-01";
const TO = "2026-04-30";
const JSON_OUT = path.resolve("src/server/db/sample-reports.json");
const FACTS = path.resolve("src/server/db/sample-report-facts.json");
const sampleReportId = (index: number) => `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
type FactsFile = { model: string; detectedAt: string; output: { logs: { logId: string; facts: { key: string; value: string; quote: string }[] }[] } };

const quoteSql = (text: string) => `'${text.replaceAll("'", "''")}'`;

function updateStatement(report: SampleReport): string {
  const json = JSON.stringify(report.document);
  if (json.includes("$report$")) throw new Error("A document contains the SQL dollar-quote tag.");
  return `UPDATE "toph"."farm_reports" SET "document" = $report$${json}$report$::jsonb
WHERE "id" = ${quoteSql(report.id)} AND "farm_id" = ${quoteSql(FARM.id)};`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reuse = args.includes("--reuse");
  const force = args.includes("--force");
  const migrationArg = args.indexOf("--migration");
  const migration = migrationArg >= 0 ? path.resolve(args[migrationArg + 1] ?? "") : null;
  const url = process.env.TEST_DATABASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!url) throw new Error("Set TEST_DATABASE_URL.");
  if (!reuse && !apiKey) throw new Error("Set OPENAI_API_KEY, or pass --reuse to use the saved detections.");
  const database = new URL(url).pathname.slice(1);
  if (!database.includes("test")) throw new Error(`Refusing to rebuild "${database}": the database name must contain "test".`);
  if (migration && existsSync(migration) && !force) throw new Error(`${path.relative(process.cwd(), migration)} exists. Pass --force to regenerate it.`);
  const previous: SampleReport[] = existsSync(JSON_OUT) ? JSON.parse(readFileSync(JSON_OUT, "utf8")) : [];

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
    const sent = [...union.values()].map(toDetectionLog);

    let detected: Map<string, DetectedFact[]>;
    let model = detectionModel;
    if (reuse) {
      const saved: FactsFile = JSON.parse(readFileSync(FACTS, "utf8"));
      detected = validateDetections(saved.output, sent);
      const kept = [...detected.values()].flat().length, stored = saved.output.logs.flatMap(entry => entry.facts).length;
      if (kept !== stored || saved.output.logs.length !== sent.length) throw new Error("The saved detections no longer match the Bays Ranch logs; detect again without --reuse.");
      model = saved.model;
    } else {
      detected = await detectReportFacts(sent, apiKey!, AbortSignal.timeout(180_000));
      const output = { logs: sent.map(log => ({ logId: log.id, facts: (detected.get(log.id) ?? []).map(fact => ({ key: fact.key, value: String(fact.value), quote: fact.quote })) })) };
      writeFileSync(FACTS, `${JSON.stringify({ model, detectedAt: new Date().toISOString(), output } satisfies FactsFile, null, 2)}\n`);
    }
    const gained = applyDetections([...union.values()], detected);

    console.log(`Read ${logs.length} logs; ${union.size} ${reuse ? "matched against the saved detections" : `sent to ${model}`}.`);
    for (const log of union.values()) {
      const facts = detected.get(log.id) ?? [];
      console.log(`\n${log.id.slice(-2)} ${log.activity}, ${log.field}: ${facts.length ? "" : "no facts"}`);
      for (const fact of facts) console.log(`   ${fact.key} = ${JSON.stringify(fact.value)}   «${fact.quote}»`);
    }

    const now = new Date().toISOString();
    const reports: SampleReport[] = reportKinds.map((kind: ReportKind, index) => {
      const earlierVersion = reuse ? previous.find(report => report.kind === kind) : undefined;
      const generatedAt = earlierVersion?.document.generatedAt ?? now;
      const { candidates, lookback } = detectionCandidates(kind, logs, earlier);
      const factsDetected = candidates.reduce((sum, log) => sum + (gained.get(log.id) ?? 0), 0);
      const document = assembleReport({
        kind, farm: { name: ctx.farm.name, timezone: ctx.farm.timezone }, period: { from: FROM, to: TO }, generatedAt,
        detection: { method: candidates.length ? "ai" : "recorded", model: candidates.length ? model : null, logsRead: candidates.length, factsDetected },
        logs, earlierApplications: lookback,
      });
      return {
        id: earlierVersion?.id ?? sampleReportId(index), kind, name: earlierVersion?.name ?? `April 2026 ${reportCatalog[kind].name}`,
        from: FROM, to: TO, createdAt: earlierVersion?.createdAt ?? generatedAt, createdBy: "Toph", document,
      };
    });

    writeFileSync(JSON_OUT, `${JSON.stringify(reports, null, 2)}\n`);
    if (migration) {
      writeFileSync(migration, `-- Bays Ranch's premade April 2026 reports in report document format ${reports[0].document.version}, written by
-- scripts/db/build-sample-reports.ts (the same rows as src/server/db/sample-reports.json).
-- Same logs, same detected facts and same preparation time as before: only the format changes.
-- Rows are updated where they still exist; a deleted sample is not restored.
${reports.map(updateStatement).join("\n--> statement-breakpoint\n")}
`);
    }
    console.log(`\nWrote ${reports.length} reports${migration ? ` and ${path.relative(process.cwd(), migration)}` : ""}:`);
    for (const report of reports) console.log(`   ${report.name}: ${report.document.readiness.message}`);
  } finally {
    await ctx.close();
  }
}

main().catch((error) => {
  console.error(`Sample reports failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
