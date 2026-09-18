import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { runMigrations } from "@/server/db/migrate";
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
