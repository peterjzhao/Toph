import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { reportKinds } from "@/contracts/reports";
import type { AccountContext } from "@/server/accounts/service";
import { applyRuntimeGrants } from "@/server/db/grants";
import { FARM_ID, recordId } from "@/server/db/initial-data";
import { resetSampleFarm } from "@/server/db/reset-sample";
import { SAMPLE_REPORTS } from "@/server/db/sample-reports";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { deleteReport, generateReport, getReport, listReports } from "@/server/reports/service";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";

const MAYA_HARVEST = recordId("workLog", 2);
const asAdmin = (ctx: FarmContext) => ({ ...ctx, account: { name: "Ranch Admin" } }) as unknown as AccountContext;
const signal = () => new AbortController().signal;
const april = { from: "2026-04-01", to: "2026-04-30" };

describe("regulatory reports", () => {
  let sql: postgres.Sql;
  let ctx: FarmContext;
  let other: FarmContext;

  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    await resetSampleFarm(sql);
    ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM_ID });
    other = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: OTHER_FARM.id });
  });

  afterAll(async () => {
    await other.close();
    await ctx.close();
    await sql.end();
  });

  it("seeds one premade April report of each kind, visible only to Bays Ranch", async () => {
    const reports = await listReports(ctx);
    expect(reports.map(report => report.kind)).toEqual([...reportKinds]);
    expect(reports[0]).toMatchObject({ id: SAMPLE_REPORTS[0].id, name: "April 2026 Pesticide Use Report", ...april, createdBy: "Toph", readiness: { status: "incomplete" } });
    expect(await listReports(other)).toEqual([]);
  });

  it("opens a frozen document, and never another farm's", async () => {
    const report = await getReport(ctx, SAMPLE_REPORTS[3].id);
    expect(report.document).toEqual(SAMPLE_REPORTS[3].document);
    await expect(getReport(other, SAMPLE_REPORTS[3].id)).rejects.toMatchObject({ status: 404 });
    await expect(getReport(ctx, "not-a-report")).rejects.toMatchObject({ status: 404 });
    await expect(deleteReport(other, SAMPLE_REPORTS[3].id)).rejects.toMatchObject({ status: 404 });
  });

  it("prepares, stores and deletes a report from recorded values when no key is set", async () => {
    const created = await generateReport(asAdmin(ctx), { kind: "labor-hours", name: " April hours ", ...april }, { apiKey: null, signal: signal() });
    expect(created).toMatchObject({ kind: "labor-hours", name: "April hours", createdBy: "Ranch Admin", readiness: { status: "incomplete" } });
    expect(created.document.detection).toEqual({ method: "recorded", model: null, logsRead: 0, factsDetected: 0 });
    expect(created.document.sections[0].rows).toHaveLength(11);
    expect((await listReports(ctx))[0].id).toBe(created.id);
    expect((await getReport(ctx, created.id)).document).toEqual(created.document);
    await deleteReport(ctx, created.id);
    await expect(getReport(ctx, created.id)).rejects.toMatchObject({ status: 404 });
  });

  it("reads only the logs a report needs and keeps only facts their notes state", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const logs: { id: string }[] = JSON.parse(JSON.parse(init.body as string).input[0].content).logs;
      expect(logs.map(log => log.id)).toEqual([MAYA_HARVEST]);
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ logs: [{ logId: MAYA_HARVEST, facts: [
        { key: "commodity", value: "strawberries", quote: "Harvested strawberries" },
        { key: "unit", value: "Crates", quote: "Crates were stacked" },
      ] }] }) }] }] });
    });
    const created = await generateReport(asAdmin(ctx), { kind: "harvest-traceability", name: "April harvests", ...april }, { apiKey: "test-key", signal: signal(), fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(created.document.detection).toEqual({ method: "ai", model: "gpt-4.1-mini", logsRead: 1, factsDetected: 1 });
    // The invented crop is dropped; a unit without a count is not a quantity. Both are marked where they belong.
    expect(created.document.sections[0].rows[0].cells.slice(0, 2)).toMatchObject([{ value: null, missing: { from: "log" } }, { value: null, missing: { from: "log" } }]);
    await deleteReport(ctx, created.id);
  });

  it("rejects requests a report cannot honor", async () => {
    for (const body of [
      { kind: "annual", name: "x", ...april },
      { kind: "acreage", name: "x", from: "2026-04-30", to: "2026-04-01" },
      { kind: "acreage", name: "x", from: "2025-01-01", to: "2026-04-30" },
      { kind: "acreage", name: "x", from: "2026-02-30", to: "2026-03-01" },
      { kind: "acreage", name: "   ", ...april },
    ]) {
      await expect(generateReport(asAdmin(ctx), body, { apiKey: null, signal: signal() })).rejects.toMatchObject({ status: 400 });
    }
  });

  it.skipIf(!getTestDatabaseTarget().appUrl)("lets the runtime role save and delete reports", async () => {
    expect((await applyRuntimeGrants(sql, "toph_app")).applied).toBe(true);
    const app = await createFarmContext({ databaseUrl: getTestDatabaseTarget().appUrl!, farmId: FARM_ID });
    try {
      const created = await generateReport(asAdmin(app), { kind: "acreage", name: "Runtime role", ...april }, { apiKey: null, signal: signal() });
      await deleteReport(app, created.id);
    } finally {
      await app.close();
    }
  });

  it("migration 0015 brings a stored first-version sample up to date", async () => {
    const report = SAMPLE_REPORTS[0];
    const statementFor = (file: string) => readFileSync(path.resolve("drizzle", file), "utf8").split("--> statement-breakpoint").find(statement => statement.includes(`'${report.id}'`))!;
    const first = /\$report\$([\s\S]*?)\$report\$/.exec(statementFor("0014_farm_reports.sql"))![1];
    await sql`update toph.farm_reports set document = ${first}::jsonb where id = ${report.id}`;
    expect((await getReport(ctx, report.id)).document.version).toBe(1);
    for (const statement of readFileSync(path.resolve("drizzle/0015_sample_reports_v2.sql"), "utf8").split("--> statement-breakpoint")) await sql.unsafe(statement);
    expect((await getReport(ctx, report.id)).document).toEqual(report.document);
  });

  it("restores the premade reports when the sample farm is reset", async () => {
    await generateReport(asAdmin(ctx), { kind: "nitrogen", name: "Before reset", ...april }, { apiKey: null, signal: signal() });
    await sql`delete from toph.farm_reports where id = ${SAMPLE_REPORTS[0].id}`;
    await resetSampleFarm(sql);
    expect((await listReports(ctx)).map(report => report.id)).toEqual(SAMPLE_REPORTS.map(report => report.id));
  });
});
