import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { applyRuntimeGrants } from "@/server/db/grants";
import { runMigrations } from "@/server/db/migrate";
import { createFarmContext } from "@/server/farm-context";
import { getDashboard } from "@/server/services/dashboard";
import { getWorkspace } from "@/server/workspace/service";
import { dropBackendSchemas, listTables, listViews, openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

describe("versioned migrations", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = openTestSql();
    await dropBackendSchemas(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  it("creates the private toph schema with the web and mobile tables and dashboard_logs view", async () => {
    const result = await runMigrations(getTestDatabaseTarget().url);
    expect(result.applied).toBeGreaterThan(0);

    expect(await listTables(sql, "toph")).toEqual([
      "account_sessions",
      "accounts",
      "employees",
      "farm_access",
      "farm_images",
      "farm_reports",
      "farms",
      "field_index_stats",
      "fields",
      "mobile_profiles",
      "mobile_recordings",
      "mobile_submissions",
      "satellite_usage",
      "tags",
      "transcription_usage",
      "work_log_tags",
      "work_logs",
      "workspace_state",
    ]);
    expect(await listViews(sql, "toph")).toEqual(["dashboard_logs"]);
  });

  it("records applied migrations outside the application schema and is idempotent", async () => {
    const before = await sql<{ count: string }[]>`select count(*)::text as count from drizzle.__drizzle_migrations`;
    const second = await runMigrations(getTestDatabaseTarget().url);
    const after = await sql<{ count: string }[]>`select count(*)::text as count from drizzle.__drizzle_migrations`;

    expect(second.applied).toBe(0);
    expect(after[0].count).toBe(before[0].count);
    expect(Number(after[0].count)).toBeGreaterThan(0);
  });

  it("keeps every table and the view inside the toph schema, not public", async () => {
    expect(await listTables(sql, "public")).toEqual([]);
    expect(await listViews(sql, "public")).toEqual([]);
  });
});

describe("0016 on a database in use", () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const journal = JSON.parse(readFileSync(path.join(projectRoot, "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const before = mkdtempSync(path.join(tmpdir(), "toph-before-0016-"));
  const FARM = "00000000-0000-4000-8000-000000001016";
  const EMPLOYEE = "10000000-0000-4000-8000-000000001016";
  const FIELD = "20000000-0000-4000-8000-000000001016";
  const LOG = "30000000-0000-4000-8000-000000001016";
  const RECORDING = { url: "/assets/sample-recording.mp3", durationSeconds: 13.384671, waveformAssetUrl: "/assets/waveform.svg" };
  const workspace = {
    employees: [{ id: EMPLOYEE, name: "Upgrade Worker", role: "Farm worker", email: "", phone: "", status: "Active", joinedAt: "2026-09-01" }],
    schedule: [], reviews: [], reports: [], messages: [], tickets: [],
    settings: { farmName: "Upgrade Farm", contactName: "Upgrade Admin", email: "", timezone: "America/Los_Angeles", notifications: { recordings: true, weekly: true, reminders: true } },
  };
  let sql: postgres.Sql;

  /** What the dashboard and workspace serve for the farm, read by the current code. */
  async function served() {
    const ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM });
    try {
      const { data } = await getDashboard(ctx, {});
      return { farm: data.farm, logs: data.logs.map((log) => ({ field: log.field, recording: log.recording })), workspace: (await getWorkspace(ctx)).data };
    } finally {
      await ctx.close();
    }
  }

  beforeAll(async () => {
    sql = openTestSql();
    // The migrations up to 0015, as production had them, with rows written the way that code wrote them.
    cpSync(path.join(projectRoot, "drizzle"), before, { recursive: true });
    const upTo = journal.entries.findIndex((entry) => entry.tag === "0016_drop_unused_columns");
    writeFileSync(path.join(before, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo) }));
    await dropBackendSchemas(sql);
    await runMigrations(getTestDatabaseTarget().url, { migrationsFolder: before });
    await sql`insert into toph.farms (id, name, timezone, avatar_path) values (${FARM}, 'Upgrade Farm', 'America/Los_Angeles', '/assets/avatar.jpg')`;
    await sql`insert into toph.farm_access (farm_id, join_code, is_sample, setup_complete) values (${FARM}, 'UPGRADE00016', true, true)`;
    await sql`insert into toph.farm_images (farm_id, mime_type, bytes, width, height) values (${FARM}, 'image/png', ${Buffer.from("png")}, 1, 1)`;
    await sql`insert into toph.employees (id, farm_id, display_name) values (${EMPLOYEE}, ${FARM}, 'Upgrade Worker')`;
    await sql`insert into toph.fields (id, farm_id, name, label, boundary, map_image_path)
      values (${FIELD}, ${FARM}, 'FIELD A', 'A', ${sql.json([{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.3, y: 0.5 }])}, '/api/farm/image')`;
    await sql`insert into toph.work_logs (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary, is_new,
        recording_path, recording_duration_seconds, waveform_asset_path, waveform_peaks)
      values (${LOG}, ${FARM}, ${EMPLOYEE}, ${FIELD}, 'Spraying', '2026-09-17', '2026-09-17T15:00:00Z', '2026-09-17T16:00:00Z', 'Sprayed the east rows.', true,
        ${RECORDING.url}, ${RECORDING.durationSeconds}, ${RECORDING.waveformAssetUrl}, '[0, 0.5, 1]'::jsonb)`;
    await sql`insert into toph.workspace_state (farm_id, payload) values (${FARM}, ${sql.json(workspace)})`;
  });

  afterAll(async () => {
    rmSync(before, { recursive: true, force: true });
    // Leave an empty, fully migrated database like the suite above.
    await dropBackendSchemas(sql);
    await runMigrations(getTestDatabaseTarget().url);
    await sql.end();
  });

  it("is served by the current code before it runs, so the code can deploy first", async () => {
    const { reports: _retired, ...current } = workspace;
    expect(await served()).toEqual({
      farm: { id: FARM, name: "Upgrade Farm", timezone: "America/Los_Angeles" },
      logs: [{ field: { id: FIELD, name: "FIELD A", mapImageUrl: "/api/farm/image", boundary: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.3, y: 0.5 }] }, recording: RECORDING }],
      workspace: current,
    });
  });

  it("drops the columns nothing reads and the retired reports list, keeping every row", async () => {
    const servedBefore = await served();
    expect((await runMigrations(getTestDatabaseTarget().url)).applied).toBe(1);

    const remaining = await sql`select table_name, column_name from information_schema.columns where table_schema = 'toph' and (table_name, column_name) in (
      ('farms', 'avatar_path'), ('fields', 'map_image_path'), ('work_logs', 'waveform_peaks'), ('farm_access', 'is_sample'),
      ('dashboard_logs', 'field_map_image_path'), ('dashboard_logs', 'waveform_peaks'))`;
    expect(remaining).toEqual([]);
    expect((await sql`select to_regprocedure('toph.waveform_peaks_valid(jsonb)') as fn`)[0].fn).toBeNull();
    expect(await sql`select payload ? 'reports' as reports, payload - 'reports' = ${sql.json(workspace)}::jsonb - 'reports' as rest_kept
      from toph.workspace_state where farm_id = ${FARM}`).toEqual([{ reports: false, rest_kept: true }]);
    expect(await sql`select join_code, setup_complete from toph.farm_access where farm_id = ${FARM}`).toEqual([{ join_code: "UPGRADE00016", setup_complete: true }]);
    expect(await sql`select employee_name, field_name, summary, recording_path, waveform_asset_path from toph.dashboard_logs where farm_id = ${FARM}`).toEqual([
      { employee_name: "Upgrade Worker", field_name: "FIELD A", summary: "Sprayed the east rows.", recording_path: RECORDING.url, waveform_asset_path: RECORDING.waveformAssetUrl },
    ]);
    expect(await served()).toEqual(servedBefore);

    // db:migrate re-applies the runtime grants next; they must name only objects that still exist.
    expect((await applyRuntimeGrants(sql, "toph_app")).applied).toBe(true);
    expect((await sql`select has_table_privilege('toph_app', 'toph.dashboard_logs', 'SELECT') as view`)[0].view).toBe(true);
  });
});
