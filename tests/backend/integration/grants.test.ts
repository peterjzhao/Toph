import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createFarmContext } from "@/server/farm-context";
import { applyRuntimeGrants } from "@/server/db/grants";
import { FARM_ID, ISAAC_LOG_ID } from "@/server/db/initial-data";
import { addLogTag, removeLogTag } from "@/server/services/tags";
import { openTestAppSql, openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { prepareTestDatabase, resetTags } from "../helpers/prepare-db";

const target = getTestDatabaseTarget();
const appRole = process.env.DATABASE_APP_ROLE?.trim() || "toph_app";

// Verifies the restricted runtime role. Needs TEST_DATABASE_APP_URL (see .env.example).
describe.skipIf(!target.appUrl)("runtime role grants", () => {
  let owner: postgres.Sql;
  let app: postgres.Sql;

  beforeAll(async () => {
    owner = openTestSql();
    await prepareTestDatabase(owner);
    await resetTags(owner);
    const result = await applyRuntimeGrants(owner, appRole);
    expect(result.applied).toBe(true);
    app = openTestAppSql() as postgres.Sql;
  });

  afterAll(async () => {
    await app?.end();
    await owner.end();
  });

  async function denied(run: () => Promise<unknown>): Promise<void> {
    await expect(run()).rejects.toMatchObject({ code: "42501" });
  }

  it("can read every table and the view", async () => {
    expect((await app`select count(*)::int as n from toph.dashboard_logs`)[0].n).toBeGreaterThan(0);
    for (const table of ["farms", "employees", "fields", "work_logs", "tags", "work_log_tags", "workspace_state"]) {
      await app.unsafe(`select * from toph.${table} limit 1`);
    }
  });

  it("can perform exactly the tag write path", async () => {
    const tagId = "50000000-0000-4000-8000-000000000777";
    await app`insert into toph.tags (id, farm_id, label, normalized_label) values (${tagId}, ${FARM_ID}, 'Grant check', 'grant check')`;
    await app`select id from toph.work_logs where id = ${ISAAC_LOG_ID} for update`;
    await app`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${FARM_ID}, ${ISAAC_LOG_ID}, ${tagId})`;
    await app`update toph.work_logs set updated_at = now() where id = ${ISAAC_LOG_ID}`;
    await app`delete from toph.work_log_tags where work_log_id = ${ISAAC_LOG_ID} and tag_id = ${tagId}`;
    await resetTags(owner);
  });

  it("cannot modify fixture records, delete tags, or change the schema", async () => {
    await denied(() => app`insert into toph.farms (id, name, timezone) values (gen_random_uuid(), 'X', 'UTC')`);
    await denied(() => app`insert into toph.employees (id, farm_id, display_name) values (gen_random_uuid(), ${FARM_ID}, 'X')`);
    await denied(() => app`insert into toph.fields (id, farm_id, name) values (gen_random_uuid(), ${FARM_ID}, 'X')`);
    await denied(
      () => app`insert into toph.work_logs (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary)
        values (gen_random_uuid(), ${FARM_ID}, '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'X', '2026-04-19', now(), now() + interval '1 hour', 'x')`,
    );
    await denied(() => app`update toph.work_logs set summary = 'tampered' where id = ${ISAAC_LOG_ID}`);
    await denied(() => app`update toph.work_logs set is_new = false where id = ${ISAAC_LOG_ID}`);
    await denied(() => app`delete from toph.work_logs where id = ${ISAAC_LOG_ID}`);
    await denied(() => app`delete from toph.tags where farm_id = ${FARM_ID}`);
    await denied(() => app`update toph.tags set label = 'x' where farm_id = ${FARM_ID}`);
    await denied(() => app`delete from toph.farms where id = ${FARM_ID}`);
    await denied(() => app.unsafe(`create table toph.smuggled (id int)`));
    await denied(() => app.unsafe(`create table public.smuggled (id int)`));
  });

  it("grants nothing to PUBLIC on the private schema", async () => {
    const [schemaAcl] = await owner<{ acl: string[] | null }[]>`select nspacl::text[] as acl from pg_namespace where nspname = 'toph'`;
    expect((schemaAcl.acl ?? []).some((entry) => entry.startsWith("="))).toBe(false);
    const tables = await owner<{ relname: string; acl: string[] | null }[]>`
      select c.relname, c.relacl::text[] as acl from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'toph' and c.relkind in ('r', 'v')`;
    for (const table of tables) {
      expect((table.acl ?? []).some((entry) => entry.startsWith("=")), `${table.relname} grants PUBLIC`).toBe(false);
    }
  });

  it("runs the full tag service through the restricted role", async () => {
    const ctx = await createFarmContext({ databaseUrl: target.appUrl as string, farmId: FARM_ID });
    try {
      const added = await addLogTag(ctx, ISAAC_LOG_ID, "Restricted role");
      expect(added.tags.map((t) => t.label)).toEqual(["Restricted role"]);
      const removed = await removeLogTag(ctx, ISAAC_LOG_ID, added.tags[0].id);
      expect(removed.tags).toEqual([]);
    } finally {
      await ctx.close();
      await resetTags(owner);
    }
  });
});
