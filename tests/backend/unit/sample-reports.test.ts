import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { REPORT_DOCUMENT_VERSION, reportKinds } from "@/contracts/reports";
import { INITIAL_ROWS, recordId } from "@/server/db/initial-data";
import { SAMPLE_REPORTS } from "@/server/db/sample-reports";
import { countMissing } from "@/server/reports/assemble";
import { normalizeForQuote } from "@/server/reports/detect";

const journal: { entries: { tag: string }[] } = JSON.parse(readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8"));
const migrations = journal.entries.map(entry => readFileSync(path.resolve(`drizzle/${entry.tag}.sql`), "utf8"));

test("the migrations, applied in order, leave exactly the frozen sample reports", () => {
  // 0014 inserts the first version; later migrations update documents by ID.
  const stored = new Map<string, unknown>();
  for (const statement of migrations.flatMap(sql => sql.split("--> statement-breakpoint"))) {
    const document = /\$report\$([\s\S]*?)\$report\$/.exec(statement)?.[1];
    const id = /'(80000000-[0-9a-f-]+)'/.exec(statement)?.[1];
    if (document && id) stored.set(id, JSON.parse(document));
  }
  expect(Object.fromEntries(stored)).toEqual(Object.fromEntries(SAMPLE_REPORTS.map(report => [report.id, report.document])));
  const insert = migrations.find(sql => sql.includes('CREATE TABLE "toph"."farm_reports"'))!;
  for (const report of SAMPLE_REPORTS) {
    expect(insert).toContain(`SELECT '${report.id}', f."id", '${report.kind}', '${report.name.replaceAll("'", "''")}', '${report.from}', '${report.to}'`);
  }
  expect(insert).toMatch(/WHERE f\."id" = '00000000-0000-4000-8000-000000000001'\s+ON CONFLICT \("id"\) DO NOTHING;/);
});

test("the saved detections still match the Bays Ranch logs they came from", () => {
  const saved: { output: { logs: { logId: string; facts: { quote: string }[] }[] } } = JSON.parse(readFileSync(path.resolve("src/server/db/sample-report-facts.json"), "utf8"));
  const notes = new Map(INITIAL_ROWS.map(row => [recordId("workLog", row.n), normalizeForQuote(row.summary)]));
  for (const entry of saved.output.logs) for (const fact of entry.facts) expect(notes.get(entry.logId)).toContain(normalizeForQuote(fact.quote));
});

test("Bays Ranch has one premade April report of each kind, with every blank marked", () => {
  expect(SAMPLE_REPORTS.map(report => report.kind)).toEqual([...reportKinds]);
  for (const report of SAMPLE_REPORTS) {
    expect(report.document.version).toBe(REPORT_DOCUMENT_VERSION);
    expect(report.document.readiness.missing).toBe(countMissing(report.document.header, report.document.sections));
    expect(JSON.stringify(report.document)).not.toContain("·");
    expect(report.document.kind).toBe(report.kind);
    expect(report.document.period).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(report.document.farm.name).toBe("Bays Ranch");
  }
});

test("every detected value quotes a Bays Ranch log and every cited log exists", () => {
  const notes = INITIAL_ROWS.map(row => normalizeForQuote(row.summary));
  const logIds = new Set(INITIAL_ROWS.map(row => recordId("workLog", row.n)));
  for (const report of SAMPLE_REPORTS) {
    const cells = [...report.document.header.map(field => field.cell), ...report.document.sections.flatMap(section => section.rows.flatMap(row => row.cells))];
    for (const cell of cells.filter(item => item.quote)) {
      expect(notes.some(text => cell.quote!.split(" … ").every(part => text.includes(normalizeForQuote(part))))).toBe(true);
      expect(normalizeForQuote(cell.quote!)).toContain(normalizeForQuote(String(cell.value)).split(" ")[0]);
    }
    for (const id of [...report.document.sections.flatMap(section => section.rows.flatMap(row => row.logIds)), ...report.document.gaps.flatMap(item => item.logIds)]) {
      expect(logIds.has(id)).toBe(true);
    }
  }
});
