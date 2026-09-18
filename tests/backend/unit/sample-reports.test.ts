import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { reportKinds } from "@/contracts/reports";
import { INITIAL_ROWS, recordId } from "@/server/db/initial-data";
import { SAMPLE_REPORTS } from "@/server/db/sample-reports";
import { normalizeForQuote } from "@/server/reports/detect";

const migration = readFileSync(path.resolve("drizzle/0014_farm_reports.sql"), "utf8");

test("migration 0014 inserts exactly the frozen sample reports", () => {
  const documents = [...migration.matchAll(/\$report\$([\s\S]*?)\$report\$/g)].map(match => JSON.parse(match[1]));
  expect(documents).toEqual(SAMPLE_REPORTS.map(report => report.document));
  for (const report of SAMPLE_REPORTS) {
    expect(migration).toContain(`SELECT '${report.id}', f."id", '${report.kind}', '${report.name.replaceAll("'", "''")}', '${report.from}', '${report.to}'`);
  }
  expect(migration).toMatch(/WHERE f\."id" = '00000000-0000-4000-8000-000000000001'\s+ON CONFLICT \("id"\) DO NOTHING;/);
});

test("Bays Ranch has one premade April report of each kind", () => {
  expect(SAMPLE_REPORTS.map(report => report.kind)).toEqual([...reportKinds]);
  for (const report of SAMPLE_REPORTS) {
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
