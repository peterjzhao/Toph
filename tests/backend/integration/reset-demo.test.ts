import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { joinFarm, signupFarm } from "@/server/accounts/service";
import { createFarmContext } from "@/server/farm-context";
import { FARM_ID, recordId } from "@/server/db/initial-data";
import { planDemoReset, resetDemoState } from "@/server/db/reset-demo";
import { SAMPLE_REPORTS } from "@/server/db/sample-reports";
import { getDashboard } from "@/server/services/dashboard";
import { dropBackendSchemas, openTestSql } from "../helpers/test-db";
import { prepareTestDatabase } from "../helpers/prepare-db";
import { useRouteTestEnv } from "../helpers/route-env";
import { getTestDatabaseTarget } from "../helpers/test-env";

const ADMIN_ID = "90000000-0000-4000-8000-000000000001";
const DESIGN_PEOPLE = [
  "Benjamin Moore", "Emma Davis", "Ethan Kim", "Isaac Wang", "Isabella Garcia", "James Wilson",
  "Liam Johnson", "Maya Patel", "Noah Brown", "Olivia Martinez", "Ranch Admin", "Sophia Lee",
];

/** What a used production database holds besides the pristine Bays Ranch. */
async function addUsage(sql: postgres.Sql): Promise<void> {
  await signupFarm({ name: "Visitor Admin", password: "visitor-pass-1", farmName: "Visitor Farm", timezone: "America/Chicago", client: "web" });
  const [{ join_code: code }] = await sql<{ join_code: string }[]>`select join_code from toph.farm_access where farm_id = ${FARM_ID}`;
  await joinFarm({ name: "Extra Worker", password: "extra-pass-1", code, client: "mobile" });
  const [{ employee_id: employeeId }] = await sql<{ employee_id: string }[]>`select employee_id from toph.accounts where name = 'Extra Worker'`;

  // A phone submission with its recording, already opened by the administrator.
  const logId = randomUUID();
  await sql`insert into toph.work_logs (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary, is_new, reviewed_by, reviewed_at)
    values (${logId}, ${FARM_ID}, ${employeeId}, ${recordId("field", 1)}, 'Scouting', '2026-09-17', '2026-09-17T15:00:00Z', '2026-09-17T16:00:00Z', 'Live demo log.', false, ${ADMIN_ID}, now())`;
  await sql`insert into toph.mobile_profiles (farm_id, employee_id, default_field, default_activity) values (${FARM_ID}, ${employeeId}, 'FIELD A', 'Scouting')`;
  await sql`insert into toph.mobile_submissions (farm_id, employee_id, client_draft_id, log_id, content_hash, notes)
    values (${FARM_ID}, ${employeeId}, ${randomUUID()}, ${logId}, 'hash', 'Live demo log.')`;
  await sql`insert into toph.mobile_recordings (id, farm_id, log_id, position, mime_type, duration_seconds, bytes)
    values (${randomUUID()}, ${FARM_ID}, ${logId}, 0, 'audio/mp4', 3, ${Buffer.from("audio")})`;

  // Edits to the design's own data.
  await sql`update toph.work_logs set summary = 'edited', is_new = false where id = ${recordId("workLog", 1)}`;
  await sql`update toph.workspace_state set payload = payload #- '{settings,demoDay}' where farm_id = ${FARM_ID}`;
  await sql`insert into toph.tags (id, farm_id, label, normalized_label) values (${randomUUID()}, ${FARM_ID}, 'Demo tag', 'demo tag')`;

  // Satellite readings and usage counters.
  await sql`insert into toph.field_index_stats (farm_id, field_id, image_date, index_name, mean, min, max, std_dev, valid_fraction)
    values (${FARM_ID}, ${recordId("field", 1)}, '2026-08-01', 'ndvi', 0.5, 0.1, 0.9, 0.1, 1)`;
  await sql`insert into toph.satellite_usage (farm_id, minute_start, minute_count, day_start, day_count) values (${FARM_ID}, now(), 1, current_date, 1)`;
  await sql`insert into toph.transcription_usage (farm_id, minute_start, minute_count, day_start, day_count) values (${FARM_ID}, now(), 1, current_date, 1)`;
}

const count = async (sql: postgres.Sql, table: string) =>
  (await sql<{ n: number }[]>`select count(*)::int as n from ${sql("toph")}.${sql(table)}`)[0].n;

describe("resetting the database to the demo state", () => {
  let sql: postgres.Sql;
  let restoreEnv: () => void;
  beforeAll(async () => {
    sql = openTestSql();
    // Earlier suites leave their own farms behind; start from a freshly migrated and seeded database.
    await dropBackendSchemas(sql);
    await prepareTestDatabase(sql);
    restoreEnv = useRouteTestEnv();
    await addUsage(sql);
  });
  afterAll(async () => {
    restoreEnv();
    await prepareTestDatabase(sql); // brings back the other suites' second farm
    await sql.end();
  });

  it("previews what it will delete without changing anything", async () => {
    const before = await count(sql, "accounts");
    expect(await planDemoReset(sql)).toEqual({
      otherFarms: [{ name: "Other Orchard", accounts: 0, logs: 1 }, { name: "Visitor Farm", accounts: 1, logs: 0 }],
      extraBaysAccounts: ["Extra Worker"],
    });
    expect(await count(sql, "accounts")).toBe(before);
  });

  it("leaves only Bays Ranch and the design's twelve people, and keeps the migration history", async () => {
    const [{ n: migrations }] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    const report = await resetDemoState(sql);

    expect(report.plan.otherFarms.map((farm) => farm.name)).toEqual(["Other Orchard", "Visitor Farm"]);
    expect(await sql`select name from toph.farms`).toEqual([{ name: "Bays Ranch" }]);
    expect((await sql<{ name: string }[]>`select name from toph.accounts order by name`).map((row) => row.name)).toEqual(DESIGN_PEOPLE);
    expect(await count(sql, "account_sessions")).toBe(0);
    const farmTables = await sql<{ table_name: string }[]>`select c.table_name from information_schema.columns c
      join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
      where c.table_schema = 'toph' and c.column_name = 'farm_id' order by c.table_name`;
    expect(farmTables.length).toBeGreaterThan(10);
    for (const { table_name: table } of farmTables) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql("toph")}.${sql(table)} where farm_id <> ${FARM_ID}`;
      expect(n, table).toBe(0);
    }
    expect((await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n).toBe(migrations);
  });

  it("shows the Figma dashboard on Bays Ranch afterwards", async () => {
    const ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM_ID });
    try {
      const { data } = await getDashboard(ctx);
      expect(data.metrics).toEqual({ recordingsToday: 5, newRecordings: 1, activeWorkers: 12, responseAccuracy: 90, asOf: "2026-04-29" });
      expect(data.logs).toHaveLength(11);
      expect(data.logs.filter((log) => log.isNew).map((log) => `${log.employee.name} ${log.date}`)).toEqual([
        "Isaac Wang 2026-04-19", "Maya Patel 2026-04-20", "Liam Johnson 2026-04-21", "Sophia Lee 2026-04-22",
      ]);
      expect(data.logs[0].summary).not.toBe("edited");
    } finally {
      await ctx.close();
    }
  });

  it("restores Bays Ranch's map and reports, and drops its tags, phone data and satellite readings", async () => {
    expect((await sql<{ label: string }[]>`select label from toph.fields order by label`).map((row) => row.label).join("")).toBe("ABCDEFGHIJK");
    expect(await sql`select extent_source from toph.farm_images`).toEqual([{ extent_source: "placeholder" }]);
    expect(await count(sql, "farm_reports")).toBe(SAMPLE_REPORTS.length);
    for (const table of ["tags", "mobile_profiles", "mobile_submissions", "mobile_recordings", "field_index_stats", "satellite_usage", "transcription_usage"]) {
      expect(await count(sql, table), table).toBe(0);
    }
  });

  it("gives up instead of waiting behind a lock the live site holds, and changes nothing", async () => {
    await signupFarm({ name: "Late Visitor", password: "visitor-pass-2", farmName: "Late Farm", timezone: "UTC", client: "web" });
    const holder = openTestSql({ max: 1 });
    try {
      await holder.begin(async (tx) => {
        await tx`select count(*) from toph.farms`;
        await expect(resetDemoState(sql, { lockTimeoutMs: 300 })).rejects.toMatchObject({ cause: { code: "55P03" } }); // lock_not_available
      });
      expect((await sql<{ name: string }[]>`select name from toph.farms order by name`).map((row) => row.name)).toEqual(["Bays Ranch", "Late Farm"]);
    } finally {
      await holder.end();
    }
  });

  it("changes nothing when restoring the design's data fails", async () => {
    const farmsBefore = await sql`select id, name from toph.farms order by id`;
    const accountsBefore = await count(sql, "accounts");
    await sql.unsafe(`create function toph.test_reject_demo_seed() returns trigger language plpgsql as $$ begin raise exception 'seed failure probe'; end $$`);
    await sql.unsafe(`create trigger test_reject_demo_seed before insert on toph.employees for each row execute function toph.test_reject_demo_seed()`);
    try {
      await expect(resetDemoState(sql)).rejects.toMatchObject({ cause: { message: "seed failure probe" } });
      expect(await sql`select id, name from toph.farms order by id`).toEqual(farmsBefore);
      expect(await count(sql, "accounts")).toBe(accountsBefore);
    } finally {
      await sql.unsafe(`drop trigger test_reject_demo_seed on toph.employees`);
      await sql.unsafe(`drop function toph.test_reject_demo_seed()`);
    }
    await resetDemoState(sql);
    expect(await sql`select name from toph.farms`).toEqual([{ name: "Bays Ranch" }]);
  });
});
