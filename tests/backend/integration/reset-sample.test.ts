import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { backfillPasswords, verifyPassword } from "@/server/accounts/password";
import { loginAccount, resolveAccountContext } from "@/server/accounts/service";
import { getFarmSetup, saveFarmSetup } from "@/server/accounts/farm-setup";
import { FARM_ID, INITIAL_ROWS, ISAAC_LOG_ID, recordId } from "@/server/db/initial-data";
import { resetSampleFarm } from "@/server/db/reset-sample";
import { openTestSql } from "../helpers/test-db";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";
import { useRouteTestEnv } from "../helpers/route-env";
import { getTestDatabaseTarget } from "../helpers/test-env";

type Settings = { adminAvatar?: string; farmName: string };
const replacementImage = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZSkAAAAASUVORK5CYII=", width: 1, height: 1 };
const assignments = INITIAL_ROWS.map((row, index) => {
  const x = (index % 4) * .24, y = Math.floor(index / 4) * .3;
  return { label: row.field.slice(-1), boundary: [{ x, y }, { x: x + .2, y }, { x: x + .2, y: y + .2 }, { x, y: y + .2 }] };
});

describe("resetting the sample farm", () => {
  let sql: postgres.Sql;
  let restoreEnv: () => void;
  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    restoreEnv = useRouteTestEnv({ DATABASE_URL: getTestDatabaseTarget().url });
  });
  afterAll(async () => { restoreEnv(); await sql.end(); });

  it("seeds the admin's Figma photo into the workspace", async () => {
    const [row] = await sql<{ settings: Settings }[]>`select payload->'settings' as settings from toph.workspace_state where farm_id = ${FARM_ID}`;
    expect(row.settings.adminAvatar).toMatch(/^data:image\/jpeg;base64,\/9j\//);
  });

  it("relabels fields through the regular setup flow, keeping the IDs of fields with recorded work", async () => {
    const { token } = await loginAccount({ name: "Ranch Admin", password: "ranch", client: "web" });
    const ctx = await resolveAccountContext(new Request("http://127.0.0.1:3000/api/farm/setup", { headers: { cookie: `toph_session=${token}` } }), "admin");
    const seeded = await getFarmSetup(ctx);
    expect(seeded.image).toEqual({ url: "/api/farm/image", width: 1403, height: 896 });
    expect(seeded.fields.map(field => field.label).join("")).toBe("ABCDEFGHIJK");
    const before = await sql`select id, field_id, summary from toph.work_logs where farm_id = ${FARM_ID} order by id`;
    await expect(saveFarmSetup(ctx, { fields: assignments.slice(0, 10) })).rejects.toThrow("recorded work");
    await expect(saveFarmSetup(ctx, { fields: assignments.map((field, index) => index === 0 ? { ...field, id: OTHER_FARM.fieldId } : field) })).rejects.toThrow("does not belong");
    await expect(saveFarmSetup(ctx, { image: replacementImage, fields: assignments })).rejects.toThrow("Keep it");
    const saved = await saveFarmSetup(ctx, { fields: assignments });
    expect(saved.fields).toEqual(assignments.map((field, index) => ({ ...field, id: recordId("field", index + 1) })));
    expect(saved.image?.url).toBe("/api/farm/image");
    expect(await sql`select id, field_id, summary from toph.work_logs where farm_id = ${FARM_ID} order by id`).toEqual(before);
    expect((await getFarmSetup(ctx)).fields).toEqual(saved.fields);
  });

  it("restores Bays Ranch's Figma data while keeping its reviewed map and other farms", async () => {
    const fieldsBefore = await sql`select * from toph.fields where farm_id = ${FARM_ID} order by id`;
    const imagesBefore = await sql`select * from toph.farm_images where farm_id = ${FARM_ID}`;
    await loginAccount({ name: "Ranch Admin", password: "ranch", client: "web" });
    await sql`update toph.work_logs set summary = 'edited', is_new = false where id = ${ISAAC_LOG_ID}`;
    await sql`update toph.farms set name = 'Renamed' where id = ${FARM_ID}`;
    await sql`update toph.workspace_state set payload = jsonb_set(payload, '{settings,farmName}', '"Renamed"') where farm_id = ${FARM_ID}`;
    const [tag] = await sql<{ id: string }[]>`insert into toph.tags (id, farm_id, label, normalized_label)
      values (gen_random_uuid(), ${FARM_ID}, 'Reset check', 'reset check') returning id`;
    await sql`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${FARM_ID}, ${ISAAC_LOG_ID}, ${tag.id})`;

    const report = await resetSampleFarm(sql);
    expect(report.workLogs).toEqual({ inserted: 11, existing: 0 });
    expect(report.fields).toEqual({ inserted: 0, existing: 11 });
    expect(await sql`select * from toph.fields where farm_id = ${FARM_ID} order by id`).toEqual(fieldsBefore);
    expect(await sql`select * from toph.farm_images where farm_id = ${FARM_ID}`).toEqual(imagesBefore);

    const [log] = await sql<{ summary: string; is_new: boolean }[]>`select summary, is_new from toph.work_logs where id = ${ISAAC_LOG_ID}`;
    expect(log.summary).not.toBe("edited");
    expect(log.is_new).toBe(true);
    const [farm] = await sql<{ name: string }[]>`select name from toph.farms where id = ${FARM_ID}`;
    expect(farm.name).toBe("Bays Ranch");
    const [{ tags }] = await sql<{ tags: number }[]>`select count(*)::int as tags from toph.tags where farm_id = ${FARM_ID}`;
    expect(tags).toBe(0);
    const [{ sessions }] = await sql<{ sessions: number }[]>`select count(*)::int as sessions from toph.account_sessions s
      join toph.accounts a on a.id = s.account_id where a.farm_id = ${FARM_ID}`;
    expect(sessions).toBe(0);
    const [state] = await sql<{ settings: Settings; revision: number }[]>`select payload->'settings' as settings, revision from toph.workspace_state where farm_id = ${FARM_ID}`;
    expect(state.settings.farmName).toBe("Bays Ranch");
    expect(state.settings.adminAvatar).toMatch(/^data:image\/jpeg;base64,/);
    expect(state.revision).toBe(0);
    const [{ admins }] = await sql<{ admins: number }[]>`select count(*)::int as admins from toph.accounts where farm_id = ${FARM_ID} and role = 'admin'`;
    expect(admins).toBe(1);

    const [other] = await sql<{ summary: string }[]>`select summary from toph.work_logs where id = ${OTHER_FARM.logId}`;
    expect(other.summary).toBe("Other farm summary.");
  });

  it("reseeds every account with a hashed first-name password, and backfills accounts that lack one", async () => {
    await resetSampleFarm(sql);
    const rows = await sql<{ name: string; password_hash: string | null }[]>`select name, password_hash from toph.accounts where farm_id = ${FARM_ID}`;
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(await verifyPassword(row.name.split(" ")[0].toLowerCase(), row.password_hash), row.name).toBe(true);
    await expect(loginAccount({ name: "Ranch Admin", password: "Ranch Admin", client: "web" })).rejects.toMatchObject({ status: 401 });

    await sql`update toph.accounts set password_hash = null where farm_id = ${FARM_ID} and role = 'admin'`;
    await expect(loginAccount({ name: "Ranch Admin", password: "ranch", client: "web" })).rejects.toMatchObject({ status: 401 });
    expect(await backfillPasswords(sql)).toBe(1);
    expect(await backfillPasswords(sql)).toBe(0);
    expect((await loginAccount({ name: "Ranch Admin", password: "ranch", client: "web" })).token).toHaveLength(43);
  });

  it("only replaces the field map with the committed reviewed map when explicitly requested", async () => {
    await resetSampleFarm(sql, { preserveFields: false });
    expect(await sql`select width, height from toph.farm_images where farm_id = ${FARM_ID}`).toEqual([{ width: 1403, height: 896 }]);
    const fields = await sql<{ label: string; boundary: { x: number; y: number }[] }[]>`select label, boundary from toph.fields where farm_id = ${FARM_ID} order by label`;
    expect(fields.map(field => field.label).join("")).toBe("ABCDEFGHIJK");
    expect(fields.every((field, index) => JSON.stringify(field.boundary) !== JSON.stringify(assignments[index].boundary))).toBe(true);
  });

  it("rolls back the entire reset if restoring the fixture fails", async () => {
    await sql`update toph.work_logs set summary = 'Keep this if reset fails' where id = ${ISAAC_LOG_ID}`;
    await sql.unsafe(`create function toph.test_reject_seed() returns trigger language plpgsql as $$ begin raise exception 'seed failure probe'; end $$`);
    await sql.unsafe(`create trigger test_reject_seed before insert on toph.employees for each row execute function toph.test_reject_seed()`);
    try {
      await expect(resetSampleFarm(sql)).rejects.toThrow();
      expect((await sql`select summary from toph.work_logs where id = ${ISAAC_LOG_ID}`)[0].summary).toBe("Keep this if reset fails");
      expect((await sql`select count(*)::int as count from toph.accounts where farm_id = ${FARM_ID}`)[0].count).toBe(12);
    } finally {
      await sql.unsafe(`drop trigger test_reject_seed on toph.employees`);
      await sql.unsafe(`drop function toph.test_reject_seed()`);
      await resetSampleFarm(sql);
    }
  });
});
