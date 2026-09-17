import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { WorkspaceState } from "@/contracts/workspace";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { FARM_ID, recordId } from "@/server/db/initial-data";
import { seedInitialData } from "@/server/db/seed";
import { getWorkspace, patchWorkspace } from "@/server/workspace/service";
import { getMobileBootstrap } from "@/server/mobile/accounts";
import { dropBackendSchemas, openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";

const PETER_ID = recordId("employee", 12);
const migration = readFileSync("drizzle/0005_remove_extra_worker.sql", "utf8");

describe("remove the extra seeded worker from existing databases", () => {
  let owner: postgres.Sql;
  let ctx: FarmContext;
  let original: WorkspaceState;
  let previous: WorkspaceState;

  beforeAll(() => { owner = openTestSql(); });
  beforeEach(async () => {
    await dropBackendSchemas(owner);
    await prepareTestDatabase(owner);
    ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM_ID });
    original = (await getWorkspace(ctx)).data;
    original.settings.contactName = "Existing administrator";
    original.employees[0].phone = "555-0101";
    previous = {
      ...original,
      employees: [...original.employees, { ...original.employees[0], id: PETER_ID, name: "Peter" }],
      schedule: [...original.schedule, { ...original.schedule[0], id: randomUUID(), employeeId: PETER_ID }],
      messages: [...original.messages, { ...original.messages[0], id: randomUUID(), employeeId: PETER_ID }],
    };
    await owner`insert into toph.employees (id, farm_id, display_name) values (${PETER_ID}, ${FARM_ID}, 'Peter')`;
    await owner`insert into toph.mobile_profiles (farm_id, employee_id, default_field, default_activity)
      values (${FARM_ID}, ${PETER_ID}, 'FIELD A', 'Spraying')`;
    await owner`update toph.workspace_state set payload = ${JSON.stringify(previous)}::jsonb, revision = 7 where farm_id = ${FARM_ID}`;
    // A name match in another farm must never be removed.
    await owner`update toph.employees set display_name = 'Peter' where id = ${OTHER_FARM.employeeId}`;
  });
  afterEach(async () => { await ctx.close(); });
  afterAll(async () => { await dropBackendSchemas(owner); await owner.end(); });

  it("removes only the obsolete account, preserves edits/logs, and prevents stale writes and reseeding", async () => {
    const logsBefore = await owner`select * from toph.work_logs order by id`;
    await owner.unsafe(migration);
    expect(await owner`select id from toph.employees where id = ${PETER_ID}`).toHaveLength(0);
    expect(await owner`select employee_id from toph.mobile_profiles where employee_id = ${PETER_ID}`).toHaveLength(0);
    expect(await owner`select id from toph.employees where id = ${OTHER_FARM.employeeId} and display_name = 'Peter'`).toHaveLength(1);
    expect(await owner`select * from toph.work_logs order by id`).toEqual(logsBefore);
    expect(await getWorkspace(ctx)).toEqual({ data: original, revision: 8 });
    expect((await getMobileBootstrap(ctx)).accounts.map(account => account.id)).not.toContain(PETER_ID);
    await expect(patchWorkspace(ctx, { expectedRevision: 7, patch: { employees: previous.employees } }))
      .rejects.toMatchObject({ status: 409 });

    await owner.unsafe(migration);
    expect((await seedInitialData(owner)).employees).toEqual({ inserted: 0, existing: 11 });
    expect(await getWorkspace(ctx)).toEqual({ data: original, revision: 8 });
    expect(await owner`select id from toph.employees where id = ${PETER_ID}`).toHaveLength(0);
  });

  it("stops atomically if the obsolete profile has recorded work", async () => {
    const logId = randomUUID();
    await owner`insert into toph.work_logs (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary)
      values (${logId}, ${FARM_ID}, ${PETER_ID}, ${recordId("field", 1)}, 'Spraying', '2026-04-30',
        '2026-04-30T13:00:00Z', '2026-04-30T14:00:00Z', 'Preserve this recorded history.')`;
    await expect(owner.unsafe(migration)).rejects.toThrow("has recorded work");
    expect(await getWorkspace(ctx)).toEqual({ data: previous, revision: 7 });
    expect(await owner`select id from toph.employees where id = ${PETER_ID}`).toHaveLength(1);
    expect(await owner`select id from toph.work_logs where id = ${logId}`).toHaveLength(1);
    expect(await owner`select employee_id from toph.mobile_profiles where employee_id = ${PETER_ID}`).toHaveLength(1);
  });
});
