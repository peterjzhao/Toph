import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { enterSample } from "@/server/accounts/service";
import { FARM_ID, ISAAC_LOG_ID } from "@/server/db/initial-data";
import { resetSampleFarm } from "@/server/db/reset-sample";
import { openTestSql } from "../helpers/test-db";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";
import { useRouteTestEnv } from "../helpers/route-env";
import { getTestDatabaseTarget } from "../helpers/test-env";

type Settings = { adminAvatar?: string; farmName: string };

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

  it("removes every change to Bays Ranch and leaves other farms alone", async () => {
    await enterSample("web");
    await sql`update toph.work_logs set summary = 'edited', is_new = false where id = ${ISAAC_LOG_ID}`;
    await sql`update toph.farms set name = 'Renamed' where id = ${FARM_ID}`;
    await sql`update toph.workspace_state set payload = jsonb_set(payload, '{settings,farmName}', '"Renamed"') where farm_id = ${FARM_ID}`;
    const [tag] = await sql<{ id: string }[]>`insert into toph.tags (id, farm_id, label, normalized_label)
      values (gen_random_uuid(), ${FARM_ID}, 'Reset check', 'reset check') returning id`;
    await sql`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${FARM_ID}, ${ISAAC_LOG_ID}, ${tag.id})`;

    const report = await resetSampleFarm(sql);
    expect(report.workLogs).toEqual({ inserted: 11, existing: 0 });

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
});
