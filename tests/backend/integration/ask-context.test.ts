import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { loadAskContext } from "@/server/ask/farm-question";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { FARM_ID } from "@/server/db/initial-data";
import { resetSampleFarm } from "@/server/db/reset-sample";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { prepareTestDatabase } from "../helpers/prepare-db";

describe("Ask Toph's farm context", () => {
  let sql: postgres.Sql;
  let ctx: FarmContext;
  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    await resetSampleFarm(sql);
    ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM_ID });
  });
  afterAll(async () => { await ctx.close(); await sql.end(); });

  it("answers as of the farm's demo day, and as of the real date without one", async () => {
    const now = new Date("2026-09-17T19:00:00Z");
    expect((await loadAskContext(ctx, now)).today).toBe("Wednesday, April 29, 2026");
    await sql`update toph.workspace_state set payload = payload #- '{settings,demoDay}' where farm_id = ${FARM_ID}`;
    try {
      expect((await loadAskContext(ctx, now)).today).toBe("Thursday, September 17, 2026");
    } finally {
      await sql`update toph.workspace_state set payload = jsonb_set(payload, '{settings,demoDay}', '"2026-04-29"') where farm_id = ${FARM_ID}`;
    }
  });
});
