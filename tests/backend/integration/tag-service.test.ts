import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { getLog, listTags } from "@/server/services/dashboard";
import { addLogTag, removeLogTag } from "@/server/services/tags";
import { FARM_ID, ISAAC_LOG_ID, recordId } from "@/server/db/initial-data";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { OTHER_FARM, prepareTestDatabase, resetTags, uniqueLabel } from "../helpers/prepare-db";

const MAYA_LOG_ID = recordId("workLog", 2);

describe("tag mutation services", () => {
  let sql: postgres.Sql;
  let ctx: FarmContext;

  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM_ID });
  });

  beforeEach(async () => {
    await resetTags(sql);
  });

  afterAll(async () => {
    await ctx.close();
    await sql.end();
  });

  it("adds a normalized tag, persists it, and bumps the log's updated_at", async () => {
    const before = await getLog(ctx, ISAAC_LOG_ID);
    const result = await addLogTag(ctx, ISAAC_LOG_ID, "  needs   Review ");
    expect(result.logId).toBe(ISAAC_LOG_ID);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].label).toBe("needs Review");

    // Read through a brand-new connection that never saw the write.
    const fresh = openTestSql({ max: 1 });
    try {
      const rows = await fresh<{ label: string; normalized_label: string }[]>`
        select t.label, t.normalized_label from toph.work_log_tags wt join toph.tags t on t.id = wt.tag_id
        where wt.work_log_id = ${ISAAC_LOG_ID}`;
      expect(rows).toEqual([{ label: "needs Review", normalized_label: "needs review" }]);
    } finally {
      await fresh.end();
    }

    const after = await getLog(ctx, ISAAC_LOG_ID);
    expect(after.tags).toEqual(result.tags);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  });

  it("reuses an existing tag case-insensitively instead of creating a duplicate catalog entry", async () => {
    const first = await addLogTag(ctx, ISAAC_LOG_ID, "Urgent");
    const second = await addLogTag(ctx, MAYA_LOG_ID, "URGENT");
    expect(second.tags[0].id).toBe(first.tags[0].id);
    expect(second.tags[0].label).toBe("Urgent");
    expect((await listTags(ctx)).filter((t) => t.label.toLowerCase() === "urgent")).toHaveLength(1);
  });

  it("treats a duplicate assignment as an idempotent success without touching updated_at", async () => {
    const first = await addLogTag(ctx, ISAAC_LOG_ID, "Follow up");
    const stamp = (await getLog(ctx, ISAAC_LOG_ID)).updatedAt;
    const again = await addLogTag(ctx, ISAAC_LOG_ID, "follow UP");
    expect(again.tags).toEqual(first.tags);
    expect((await getLog(ctx, ISAAC_LOG_ID)).updatedAt).toBe(stamp);
  });

  it("returns tags sorted by normalized label then ID", async () => {
    await addLogTag(ctx, ISAAC_LOG_ID, "zebra");
    await addLogTag(ctx, ISAAC_LOG_ID, "Apple");
    const result = await addLogTag(ctx, ISAAC_LOG_ID, "mango");
    expect(result.tags.map((t) => t.label)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("enforces the ten-tag limit with 409 and rolls back the catalog insert", async () => {
    for (let i = 1; i <= 10; i += 1) {
      await addLogTag(ctx, ISAAC_LOG_ID, `Tag ${i}`);
    }
    await expect(addLogTag(ctx, ISAAC_LOG_ID, "Eleventh")).rejects.toMatchObject({ status: 409, code: "TAG_LIMIT_REACHED" });
    expect((await listTags(ctx)).some((t) => t.label === "Eleventh")).toBe(false);
    expect((await getLog(ctx, ISAAC_LOG_ID)).tags).toHaveLength(10);
    // A duplicate of an already-assigned tag still succeeds at the cap.
    const dup = await addLogTag(ctx, ISAAC_LOG_ID, "tag 3");
    expect(dup.tags).toHaveLength(10);
  });

  it("serializes concurrent duplicate additions into one tag and one association", async () => {
    const label = uniqueLabel("Race");
    const results = await Promise.all(Array.from({ length: 12 }, () => addLogTag(ctx, ISAAC_LOG_ID, label)));
    const ids = new Set(results.flatMap((r) => r.tags.map((t) => t.id)));
    expect(ids.size).toBe(1);
    const [{ tags, links }] = await sql<{ tags: number; links: number }[]>`
      select (select count(*)::int from toph.tags where farm_id = ${FARM_ID} and normalized_label = ${label.toLowerCase()}) as tags,
             (select count(*)::int from toph.work_log_tags where work_log_id = ${ISAAC_LOG_ID}) as links`;
    expect({ tags, links }).toEqual({ tags: 1, links: 1 });
  });

  it("never exceeds the limit under concurrent distinct additions", async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => addLogTag(ctx, ISAAC_LOG_ID, `Parallel ${i}`)),
    );
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(6);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    }
    const [{ links }] = await sql<{ links: number }[]>`select count(*)::int as links from toph.work_log_tags where work_log_id = ${ISAAC_LOG_ID}`;
    expect(links).toBe(10);
  });

  it("removes only the association, keeps the catalog entry, and is idempotent", async () => {
    const added = await addLogTag(ctx, ISAAC_LOG_ID, "Temporary");
    const tagId = added.tags[0].id;
    await addLogTag(ctx, MAYA_LOG_ID, "temporary");

    const removed = await removeLogTag(ctx, ISAAC_LOG_ID, tagId);
    expect(removed).toEqual({ logId: ISAAC_LOG_ID, tags: [] });
    expect((await getLog(ctx, MAYA_LOG_ID)).tags.map((t) => t.id)).toEqual([tagId]);
    expect((await listTags(ctx)).some((t) => t.id === tagId)).toBe(true);

    const stamp = (await getLog(ctx, ISAAC_LOG_ID)).updatedAt;
    const again = await removeLogTag(ctx, ISAAC_LOG_ID, tagId);
    expect(again).toEqual({ logId: ISAAC_LOG_ID, tags: [] });
    expect((await getLog(ctx, ISAAC_LOG_ID)).updatedAt).toBe(stamp);

    // A valid but unknown tag ID on an in-scope log is also an idempotent success.
    const unknown = await removeLogTag(ctx, ISAAC_LOG_ID, "50000000-0000-4000-8000-000000000123");
    expect(unknown.tags).toEqual([]);
  });

  it("rejects invalid IDs and labels with 400", async () => {
    await expect(addLogTag(ctx, "nope", "Fine")).rejects.toMatchObject({ status: 400 });
    await expect(addLogTag(ctx, ISAAC_LOG_ID, "")).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    await expect(addLogTag(ctx, ISAAC_LOG_ID, "x".repeat(41))).rejects.toMatchObject({ status: 400 });
    await expect(removeLogTag(ctx, ISAAC_LOG_ID, "not-a-uuid")).rejects.toMatchObject({ status: 400 });
    await expect(removeLogTag(ctx, "not-a-uuid", "50000000-0000-4000-8000-000000000123")).rejects.toMatchObject({ status: 400 });
  });

  it("returns 404 for logs outside the configured farm and never mutates them", async () => {
    await expect(addLogTag(ctx, OTHER_FARM.logId, "Intruder")).rejects.toMatchObject({ status: 404 });
    await expect(removeLogTag(ctx, OTHER_FARM.logId, OTHER_FARM.tagId)).rejects.toMatchObject({ status: 404 });
    await expect(addLogTag(ctx, "30000000-0000-4000-8000-000000000042", "Ghost")).rejects.toMatchObject({ status: 404 });
    const [{ links }] = await sql<{ links: number }[]>`select count(*)::int as links from toph.work_log_tags where work_log_id = ${OTHER_FARM.logId}`;
    expect(links).toBe(1);
    expect((await listTags(ctx)).some((t) => t.label === "Intruder")).toBe(false);
  });

  it("cannot detach another farm's tag from a log by ID", async () => {
    await addLogTag(ctx, ISAAC_LOG_ID, "Mine");
    const result = await removeLogTag(ctx, ISAAC_LOG_ID, OTHER_FARM.tagId);
    expect(result.tags.map((t) => t.label)).toEqual(["Mine"]);
    const [{ links }] = await sql<{ links: number }[]>`select count(*)::int as links from toph.work_log_tags where work_log_id = ${OTHER_FARM.logId}`;
    expect(links).toBe(1);
  });
});
