import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { runMigrations } from "@/server/db/migrate";
import { seedInitialData } from "@/server/db/seed";
import { dropBackendSchemas, openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

const FARM_ID = "00000000-0000-4000-8000-000000000001";
const ISAAC_LOG_ID = "30000000-0000-4000-8000-000000000001";

// Isaac's summary is kept verbatim: leading double quote, no trailing quote.
const ISAAC_SUMMARY =
  "\"Offline guided voice log created at 2026-04-08T22:01:01.711Z. Question (activity_type): What type of activity was this — spraying, fertilizing, planting, irrigating, harvesting, scouting, pruning, soil work, or equipment maintenance? Answer: I'm leaving first, I'm going to go home. Question (field_block): Where were you working (field, block, or area)? Answer: yes, in one part and then 130 and 200 yes, and 130 for uh 160 and no, this yes no, no, uhm no no I remember, uhm uhm uhm, no, I don't remember anything.";

const EXPECTED_ROWS = [
  ["Isaac Wang", "Spraying", "2026-04-19", "FIELD A", "06:00", "10:40", true],
  ["Maya Patel", "Harvesting", "2026-04-20", "FIELD B", "07:30", "11:15", true],
  ["Liam Johnson", "Planting", "2026-04-21", "FIELD C", "08:00", "12:00", true],
  ["Sophia Lee", "Irrigation", "2026-04-22", "FIELD D", "06:30", "09:30", true],
  ["Ethan Kim", "Fertilizing", "2026-04-23", "FIELD E", "05:45", "09:00", false],
  ["Olivia Martinez", "Weeding", "2026-04-24", "FIELD F", "06:15", "10:00", false],
  ["Noah Brown", "Pruning", "2026-04-25", "FIELD G", "07:00", "11:30", false],
  ["Emma Davis", "Monitoring", "2026-04-26", "FIELD H", "08:15", "12:45", false],
  ["James Wilson", "Soil Testing", "2026-04-27", "FIELD I", "06:00", "09:00", false],
  ["Isabella Garcia", "Seeding", "2026-04-28", "FIELD J", "07:45", "11:00", false],
  ["Benjamin Moore", "Pest Control", "2026-04-29", "FIELD K", "06:30", "10:30", false],
] as const;

type ViewRow = {
  id: string;
  employee_id: string;
  field_id: string;
  employee_name: string;
  activity: string;
  work_date: string;
  field_name: string;
  start_local: string;
  end_local: string;
  start_at: string;
  is_new: boolean;
};

async function loadRows(sql: postgres.Sql): Promise<ViewRow[]> {
  return sql<ViewRow[]>`
    select id, employee_id, field_id, employee_name, activity, work_date::text as work_date, field_name,
           to_char(start_at at time zone 'America/Los_Angeles', 'HH24:MI') as start_local,
           to_char(end_at at time zone 'America/Los_Angeles', 'HH24:MI') as end_local,
           to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as start_at,
           is_new
    from toph.dashboard_logs where farm_id = ${FARM_ID} order by work_date, start_at, id`;
}

describe("initial dataset", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = openTestSql();
    await dropBackendSchemas(sql);
    await runMigrations(getTestDatabaseTarget().url);
  });

  afterAll(async () => {
    // This file edits rows to prove the seed leaves them alone; start the next file from scratch.
    await dropBackendSchemas(sql);
    await sql.end();
  });

  it("inserts Bays Ranch with eleven employees, eleven fields and logs, and no tags", async () => {
    const report = await seedInitialData(sql);
    expect(report.farm).toBe("inserted");
    expect(report.workLogs.inserted).toBe(11);

    const [farm] = await sql<{ name: string; timezone: string }[]>`
      select name, timezone from toph.farms where id = ${FARM_ID}`;
    expect(farm).toEqual({ name: "Bays Ranch", timezone: "America/Los_Angeles" });

    const counts = await sql<{ employees: number; fields: number; logs: number; tags: number; links: number }[]>`
      select (select count(*)::int from toph.employees where farm_id = ${FARM_ID}) as employees,
             (select count(*)::int from toph.fields where farm_id = ${FARM_ID}) as fields,
             (select count(*)::int from toph.work_logs where farm_id = ${FARM_ID}) as logs,
             (select count(*)::int from toph.tags where farm_id = ${FARM_ID}) as tags,
             (select count(*)::int from toph.work_log_tags where farm_id = ${FARM_ID}) as links`;
    expect(counts[0]).toEqual({ employees: 11, fields: 11, logs: 11, tags: 0, links: 0 });
    expect(await sql`select id from toph.employees where farm_id = ${FARM_ID} and display_name = 'Peter'`).toHaveLength(0);
  });

  it("matches every row: names, activities, dates, fields, farm-local times, and new flags", async () => {
    const rows = await loadRows(sql);
    expect(
      rows.map((r) => [r.employee_name, r.activity, r.work_date, r.field_name, r.start_local, r.end_local, r.is_new]),
    ).toEqual(EXPECTED_ROWS.map((r) => [...r]));
  });

  it("stores unambiguous instants: 06:00 in Los Angeles on April 19 is 13:00Z", async () => {
    const rows = await loadRows(sql);
    expect(rows[0].start_at).toBe("2026-04-19T13:00:00Z");
  });

  it("uses deterministic IDs", async () => {
    const rows = await loadRows(sql);
    rows.forEach((row, index) => {
      const n = String(index + 1).padStart(12, "0");
      expect(row.employee_id).toBe(`10000000-0000-4000-8000-${n}`);
      expect(row.field_id).toBe(`20000000-0000-4000-8000-${n}`);
      expect(row.id).toBe(`30000000-0000-4000-8000-${n}`);
    });
    expect(rows[0].id).toBe(ISAAC_LOG_ID);
  });

  it("preserves Isaac's summary exactly and gives every other log a plain work summary", async () => {
    const logs = await sql<{ id: string; summary: string }[]>`
      select id, summary from toph.work_logs where farm_id = ${FARM_ID} order by work_date`;
    expect(logs[0].summary).toBe(ISAAC_SUMMARY);
    for (const log of logs.slice(1)) {
      expect(log.summary).not.toContain("Offline guided voice log");
      expect(log.summary).not.toMatch(/\bdemo\b|figma|sample (summary|data|content)/i);
      expect(log.summary.length).toBeGreaterThan(20);
    }
  });

  it("attaches the recording and waveform to every log", async () => {
    const logs = await sql<{ recording_path: string | null; recording_duration_seconds: number | null; waveform_asset_path: string | null }[]>`
      select recording_path, recording_duration_seconds, waveform_asset_path from toph.work_logs where farm_id = ${FARM_ID}`;
    expect(logs).toHaveLength(11);
    for (const log of logs) {
      expect(log).toEqual({ recording_path: "/assets/sample-recording.mp3", recording_duration_seconds: 13.384671, waveform_asset_path: "/assets/waveform.svg" });
    }
  });

  it("stores the reviewed A–K map exactly like a confirmed field setup", async () => {
    const fields = await sql<{ label: string; points: number }[]>`select label, jsonb_array_length(boundary) as points from toph.fields where farm_id = ${FARM_ID} order by label`;
    expect(fields.map((f) => f.label).join("")).toBe("ABCDEFGHIJK");
    expect(fields.every((f) => f.points >= 3)).toBe(true);
    expect(await sql`select mime_type, width, height from toph.farm_images where farm_id = ${FARM_ID}`).toEqual([{ mime_type: "image/jpeg", width: 1403, height: 896 }]);
    expect(await sql`select setup_complete from toph.farm_access where farm_id = ${FARM_ID}`).toEqual([{ setup_complete: true }]);
  });

  it("is repeatable: a second run inserts nothing, overwrites nothing, and keeps user-added tags", async () => {
    const tagId = randomUUID();
    await sql`insert into toph.tags (id, farm_id, label, normalized_label) values (${tagId}, ${FARM_ID}, 'Needs review', 'needs review')`;
    await sql`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${FARM_ID}, ${ISAAC_LOG_ID}, ${tagId})`;
    await sql`update toph.work_logs set summary = 'edited locally', updated_at = now() where id = ${ISAAC_LOG_ID}`;
    const [before] = await sql<{ updated_at: string }[]>`select updated_at::text as updated_at from toph.work_logs where id = ${ISAAC_LOG_ID}`;

    const report = await seedInitialData(sql);
    expect(report.farm).toBe("existing");
    expect(report.workLogs).toEqual({ inserted: 0, existing: 11 });

    const counts = await sql<{ logs: number; employees: number; fields: number; tags: number; links: number; summary: string }[]>`
      select (select count(*)::int from toph.work_logs where farm_id = ${FARM_ID}) as logs,
             (select count(*)::int from toph.employees where farm_id = ${FARM_ID}) as employees,
             (select count(*)::int from toph.fields where farm_id = ${FARM_ID}) as fields,
             (select count(*)::int from toph.tags where farm_id = ${FARM_ID}) as tags,
             (select count(*)::int from toph.work_log_tags where work_log_id = ${ISAAC_LOG_ID} and tag_id = ${tagId}) as links,
             (select summary from toph.work_logs where id = ${ISAAC_LOG_ID}) as summary`;
    expect(counts[0]).toEqual({ logs: 11, employees: 11, fields: 11, tags: 1, links: 1, summary: "edited locally" });

    const [after] = await sql<{ updated_at: string }[]>`select updated_at::text as updated_at from toph.work_logs where id = ${ISAAC_LOG_ID}`;
    expect(after.updated_at).toBe(before.updated_at);
  });
});
