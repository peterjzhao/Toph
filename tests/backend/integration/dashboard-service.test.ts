import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { getDashboard, getLog, listTags } from "@/server/services/dashboard";
import { ApiError } from "@/server/errors";
import { FARM_ID, ISAAC_LOG_ID, ISAAC_SUMMARY, recordId } from "@/server/db/initial-data";
import { resetSampleFarm } from "@/server/db/reset-sample";
import { instantToLocalDate } from "@/server/time/zoned";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { OTHER_FARM, prepareTestDatabase, resetTags } from "../helpers/prepare-db";

const FIELD_B = recordId("field", 2);
const FIELD_C = recordId("field", 3);

describe("dashboard read services", () => {
  let sql: postgres.Sql;
  let ctx: FarmContext;

  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    // Bays Ranch exactly as seeded, whatever earlier suites changed.
    await resetSampleFarm(sql);
    ctx = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: FARM_ID });
  });

  afterAll(async () => {
    await ctx.close();
    await sql.end();
  });

  it("returns the farm, computed metrics, all eleven logs, and farm-wide filter options by default", async () => {
    const { data, meta } = await getDashboard(ctx, {});

    expect(data.farm).toEqual({
      id: FARM_ID,
      name: "Bays Ranch",
      avatarUrl: "/assets/avatar.jpg",
      timezone: "America/Los_Angeles",
    });
    // The Figma cards, from the seed on its demo day: five logs arrived on April 29 and one of them
    // is unopened; eleven active employees plus the administrator; six of the seven reviewed logs
    // approved (85.7%, shown to the nearest 10).
    expect(data.metrics).toEqual({
      recordingsToday: 5,
      newRecordings: 1,
      activeWorkers: 12,
      responseAccuracy: 90,
      asOf: "2026-04-29",
    });
    expect(data.newLogCount).toBe(4);
    expect(data.logs).toHaveLength(11);
    expect(data.logs.map((l) => l.employee.name)).toEqual([
      "Isaac Wang",
      "Maya Patel",
      "Liam Johnson",
      "Sophia Lee",
      "Ethan Kim",
      "Olivia Martinez",
      "Noah Brown",
      "Emma Davis",
      "James Wilson",
      "Isabella Garcia",
      "Benjamin Moore",
    ]);
    expect(data.filterOptions.activities).toEqual([
      "Fertilizing",
      "Harvesting",
      "Irrigation",
      "Monitoring",
      "Pest Control",
      "Planting",
      "Pruning",
      "Seeding",
      "Soil Testing",
      "Spraying",
      "Weeding",
    ]);
    expect(data.filterOptions.fields.map((f) => f.name)).toEqual(
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].map((x) => `FIELD ${x}`),
    );

    expect(meta).toEqual({
      contractVersion: "2",
      filters: {
        q: null,
        activities: [],
        fieldIds: [],
        period: "all",
        dateRange: null,
        sort: "date-asc",
      },
      pagination: { total: 11, limit: 50, offset: 0, hasMore: false },
    });
  });

  it("scores only audit decisions about logs that still exist", async () => {
    const [{ reviews }] = await sql<{ reviews: unknown[] }[]>`select payload->'reviews' as reviews from toph.workspace_state where farm_id = ${FARM_ID}`;
    const stale = ["00000000-0000-4000-8000-00000000dead", "00000000-0000-4000-8000-00000000beef"]
      .map((logId) => ({ logId, status: "Flagged", note: "stale", updatedAt: "2026-04-29T21:00:00.000Z" }));
    await sql`update toph.workspace_state set payload = jsonb_set(payload, '{reviews}', ${JSON.stringify([...reviews, ...stale])}::jsonb) where farm_id = ${FARM_ID}`;
    try {
      // Counting the two stale flags would give 6 ÷ 9 → 70.
      expect((await getDashboard(ctx)).data.metrics.responseAccuracy).toBe(90);
    } finally {
      await sql`update toph.workspace_state set payload = jsonb_set(payload, '{reviews}', ${JSON.stringify(reviews)}::jsonb) where farm_id = ${FARM_ID}`;
    }
  });

  it("counts the administrator once and excludes inactive employees and other farms", async () => {
    await sql`update toph.employees set is_active = false where id = ${recordId("employee", 1)}`;
    try {
      expect((await getDashboard(ctx)).data.metrics.activeWorkers).toBe(11);
      const other = await createFarmContext({ databaseUrl: getTestDatabaseTarget().url, farmId: OTHER_FARM.id });
      try { expect((await getDashboard(other)).data.metrics.activeWorkers).toBe(2); }
      finally { await other.close(); }
    } finally {
      await sql`update toph.employees set is_active = true where id = ${recordId("employee", 1)}`;
    }
  });

  /** Sets the farm's demo day (null removes it) and when chosen logs arrived; restores both afterwards. */
  async function withFarmDay(demoDay: string | null, arrivals: Record<string, string>, run: () => Promise<void>): Promise<void> {
    const [{ settings }] = await sql<{ settings: { demoDay?: string } }[]>`select payload->'settings' as settings from toph.workspace_state where farm_id = ${FARM_ID}`;
    const originalArrivals = await sql<{ id: string; created_at: Date }[]>`select id, created_at from toph.work_logs where farm_id in (${FARM_ID}, ${OTHER_FARM.id})`;
    const setDemoDay = (day: string | null | undefined) => day
      ? sql`update toph.workspace_state set payload = jsonb_set(payload, '{settings,demoDay}', to_jsonb(${day}::text)) where farm_id = ${FARM_ID}`
      : sql`update toph.workspace_state set payload = payload #- '{settings,demoDay}' where farm_id = ${FARM_ID}`;
    try {
      await setDemoDay(demoDay);
      await sql`update toph.work_logs set created_at = '2026-01-15T20:00:00Z' where farm_id in (${FARM_ID}, ${OTHER_FARM.id})`;
      for (const [id, at] of Object.entries(arrivals)) await sql`update toph.work_logs set created_at = ${at} where id = ${id}`;
      await run();
    } finally {
      await setDemoDay(settings.demoDay);
      for (const row of originalArrivals) await sql`update toph.work_logs set created_at = ${row.created_at} where id = ${row.id}`;
    }
  }

  it("treats the farm's demo day as today, for the cards and the this-month period", async () => {
    await withFarmDay("2026-04-22", {}, async () => {
      const { data, meta } = await getDashboard(ctx, { period: "this-month" });
      expect(data.metrics.asOf).toBe("2026-04-22");
      expect(meta.filters.dateRange).toEqual({ from: "2026-04-01", to: "2026-04-30" });
      expect(data.logs).toHaveLength(11);
    });
  });

  it("counts recordings that arrived on the farm's day in its timezone, and which of those are still new", async () => {
    // Los Angeles is UTC-7 in April: the 25th runs from 07:00Z on the 25th to 06:59Z on the 26th.
    await withFarmDay("2026-04-25", {
      [recordId("workLog", 2)]: "2026-04-25T07:00:00Z", // new, first minute of the day
      [recordId("workLog", 3)]: "2026-04-26T06:59:00Z", // new, last minute of the day
      [recordId("workLog", 7)]: "2026-04-25T18:00:00Z", // already opened
      [recordId("workLog", 5)]: "2026-04-25T06:59:00Z", // the evening before
      [recordId("workLog", 6)]: "2026-04-26T07:00:00Z", // the next day
      [OTHER_FARM.logId]: "2026-04-25T18:00:00Z", // another farm's arrival
    }, async () => {
      const { metrics } = (await getDashboard(ctx)).data;
      expect({ recordingsToday: metrics.recordingsToday, newRecordings: metrics.newRecordings }).toEqual({ recordingsToday: 3, newRecordings: 2 });
    });
  });

  it("uses the real date when no demo day is set", async () => {
    await withFarmDay(null, { [recordId("workLog", 4)]: new Date().toISOString() }, async () => {
      const today = instantToLocalDate(new Date(), "America/Los_Angeles");
      const { data, meta } = await getDashboard(ctx, { period: "this-month" });
      expect(data.metrics).toMatchObject({ asOf: today, recordingsToday: 1, newRecordings: 1 });
      expect(meta.filters.dateRange?.from).toBe(`${today.slice(0, 7)}-01`);
    });
  });

  it("shapes Isaac's log exactly like the page, including recording metadata", async () => {
    const { data } = await getDashboard(ctx, {});
    const isaac = data.logs[0];
    expect(isaac).toMatchObject({
      id: ISAAC_LOG_ID,
      employee: { id: recordId("employee", 1), name: "Isaac Wang", avatarUrl: null },
      activity: "Spraying",
      date: "2026-04-19",
      field: { id: recordId("field", 1), name: "FIELD A", mapImageUrl: "/api/farm/image" },
      startAt: "2026-04-19T13:00:00.000Z",
      endAt: "2026-04-19T17:40:00.000Z",
      summary: ISAAC_SUMMARY,
      isNew: true,
      recording: {
        url: "/assets/sample-recording.mp3",
        durationSeconds: 13.384671,
        waveformAssetUrl: "/assets/waveform.svg",
        waveformPeaks: null,
      },
      tags: [],
    });
    expect(typeof isaac.updatedAt).toBe("string");
    expect(new Date(isaac.updatedAt).toISOString()).toBe(isaac.updatedAt);
    expect(data.logs.every((l) => l.recording?.url === "/assets/sample-recording.mp3")).toBe(true);
    expect(data.logs[1].isNew).toBe(true);
    expect(data.logs[4].isNew).toBe(false);
  });

  it("returns JSON-safe values only", async () => {
    const { data, meta } = await getDashboard(ctx, {});
    const roundTrip = JSON.parse(JSON.stringify({ data, meta }));
    expect(roundTrip).toEqual({ data, meta });
    const serialized = JSON.stringify({ data, meta });
    expect(serialized).not.toMatch(/farm_id|display_name|postgres|password|DATABASE/);
  });

  it("exposes an employee's image through the log's employee reference", async () => {
    await sql`update toph.employees set avatar_path = '/assets/avatar.jpg' where id = ${recordId("employee", 2)}`;
    try {
      const { data } = await getDashboard(ctx, {});
      expect(data.logs[1].employee).toEqual({ id: recordId("employee", 2), name: "Maya Patel", avatarUrl: "/assets/avatar.jpg" });
      expect((await getLog(ctx, recordId("workLog", 2))).employee.avatarUrl).toBe("/assets/avatar.jpg");
    } finally {
      await sql`update toph.employees set avatar_path = null where id = ${recordId("employee", 2)}`;
    }
  });

  it("serves the same record through getLog", async () => {
    const { data } = await getDashboard(ctx, {});
    const detail = await getLog(ctx, ISAAC_LOG_ID);
    expect(detail).toEqual(data.logs[0]);
  });

  it("filters by case-insensitive literal search across employee, activity, field, and tag labels", async () => {
    expect((await getDashboard(ctx, { q: "isaac" })).data.logs.map((l) => l.employee.name)).toEqual(["Isaac Wang"]);
    expect((await getDashboard(ctx, { q: "SOIL" })).data.logs.map((l) => l.activity)).toEqual(["Soil Testing"]);
    expect((await getDashboard(ctx, { q: "field k" })).data.logs.map((l) => l.field.name)).toEqual(["FIELD K"]);
    expect((await getDashboard(ctx, { q: "field" })).data.logs).toHaveLength(11);
    // Wildcards are literal: no row contains a percent sign or an underscore.
    expect((await getDashboard(ctx, { q: "%" })).data.logs).toHaveLength(0);
    expect((await getDashboard(ctx, { q: "_" })).data.logs).toHaveLength(0);
    expect((await getDashboard(ctx, { q: "I_aac" })).data.logs).toHaveLength(0);
  });

  it("combines activity and field filters with OR inside a list and AND across lists", async () => {
    const byActivity = await getDashboard(ctx, { activities: ["Harvesting", "Planting"] });
    expect(byActivity.data.logs.map((l) => l.activity)).toEqual(["Harvesting", "Planting"]);
    expect(byActivity.data.newLogCount).toBe(2);
    expect(byActivity.meta.pagination.total).toBe(2);

    const both = await getDashboard(ctx, { activities: ["Harvesting", "Planting"], fieldIds: [FIELD_C] });
    expect(both.data.logs.map((l) => l.field.name)).toEqual(["FIELD C"]);

    const none = await getDashboard(ctx, { activities: ["Harvesting"], fieldIds: [FIELD_C] });
    expect(none.data.logs).toEqual([]);
    expect(none.data.newLogCount).toBe(0);
    expect(none.meta.pagination.total).toBe(0);
    expect(none.data.metrics.activeWorkers).toBe(12);
    expect(none.data.filterOptions.activities).toHaveLength(11);

    const unknownField = await getDashboard(ctx, { fieldIds: ["20000000-0000-4000-8000-000000000042"] });
    expect(unknownField.data.logs).toEqual([]);
  });

  it("applies inclusive custom date boundaries, the all period, and the farm's current month", async () => {
    const window = await getDashboard(ctx, { period: "custom", from: "2026-04-20", to: "2026-04-22" });
    expect(window.data.logs.map((l) => l.date)).toEqual(["2026-04-20", "2026-04-21", "2026-04-22"]);
    expect(window.meta.filters.dateRange).toEqual({ from: "2026-04-20", to: "2026-04-22" });

    const single = await getDashboard(ctx, { period: "custom", from: "2026-04-29", to: "2026-04-29" });
    expect(single.data.logs.map((l) => l.employee.name)).toEqual(["Benjamin Moore"]);

    const outside = await getDashboard(ctx, { period: "custom", from: "2026-05-01", to: "2026-05-31" });
    expect(outside.data.logs).toEqual([]);

    const all = await getDashboard(ctx, { period: "all" });
    expect(all.data.logs).toHaveLength(11);
    expect(all.meta.filters.dateRange).toBeNull();

    // Bays Ranch's demo day, April 29, 2026, makes April its current month.
    const thisMonth = await getDashboard(ctx, { period: "this-month" });
    expect(thisMonth.meta.filters.dateRange).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(thisMonth.data.logs).toHaveLength(11);
  });

  it("sorts with the documented keys and a stable ID tie-breaker", async () => {
    const desc = await getDashboard(ctx, { sort: "date-desc" });
    expect(desc.data.logs.map((l) => l.date)[0]).toBe("2026-04-29");
    expect(desc.data.logs.map((l) => l.date)[10]).toBe("2026-04-19");

    const byEmployee = await getDashboard(ctx, { sort: "employee-asc" });
    expect(byEmployee.data.logs.map((l) => l.employee.name).slice(0, 3)).toEqual(["Benjamin Moore", "Emma Davis", "Ethan Kim"]);

    const byActivity = await getDashboard(ctx, { sort: "activity-asc" });
    expect(byActivity.data.logs.map((l) => l.activity).slice(0, 3)).toEqual(["Fertilizing", "Harvesting", "Irrigation"]);
  });

  it("paginates with total computed before the page is cut", async () => {
    const page1 = await getDashboard(ctx, { limit: 4, offset: 0 });
    expect(page1.data.logs).toHaveLength(4);
    expect(page1.meta.pagination).toEqual({ total: 11, limit: 4, offset: 0, hasMore: true });
    expect(page1.data.newLogCount).toBe(4);

    const page3 = await getDashboard(ctx, { limit: 4, offset: 8 });
    expect(page3.data.logs.map((l) => l.employee.name)).toEqual(["James Wilson", "Isabella Garcia", "Benjamin Moore"]);
    expect(page3.meta.pagination).toEqual({ total: 11, limit: 4, offset: 8, hasMore: false });

    const beyond = await getDashboard(ctx, { limit: 4, offset: 40 });
    expect(beyond.data.logs).toEqual([]);
    expect(beyond.meta.pagination.total).toBe(11);
  });

  it("never exposes another farm's records", async () => {
    const { data } = await getDashboard(ctx, { period: "all" });
    expect(data.logs.some((l) => l.id === OTHER_FARM.logId)).toBe(false);
    expect(data.filterOptions.fields.some((f) => f.id === OTHER_FARM.fieldId)).toBe(false);
    await expect(getLog(ctx, OTHER_FARM.logId)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect((await listTags(ctx)).some((t) => t.id === OTHER_FARM.tagId)).toBe(false);
    expect((await getDashboard(ctx, { fieldIds: [OTHER_FARM.fieldId] })).data.logs).toEqual([]);
  });

  it("rejects malformed log IDs with 400 and unknown IDs with 404", async () => {
    await expect(getLog(ctx, "not-a-uuid")).rejects.toBeInstanceOf(ApiError);
    await expect(getLog(ctx, "not-a-uuid")).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    await expect(getLog(ctx, "30000000-0000-4000-8000-000000000042")).rejects.toMatchObject({ status: 404 });
  });

  it("lists the farm's tag catalog sorted by normalized label", async () => {
    await sql`insert into toph.tags (id, farm_id, label, normalized_label) values
      ('50000000-0000-4000-8000-000000000001', ${FARM_ID}, 'zebra', 'zebra'),
      ('50000000-0000-4000-8000-000000000002', ${FARM_ID}, 'Apple', 'apple')`;
    expect((await listTags(ctx)).map((t) => t.label)).toEqual(["Apple", "zebra"]);
    await resetTags(sql);
  });

  it("includes assigned tag labels in search and in the returned rows", async () => {
    await sql`insert into toph.tags (id, farm_id, label, normalized_label) values ('50000000-0000-4000-8000-000000000003', ${FARM_ID}, 'Needs review', 'needs review')`;
    await sql`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${FARM_ID}, ${recordId("workLog", 7)}, '50000000-0000-4000-8000-000000000003')`;
    const { data } = await getDashboard(ctx, { q: "needs REVIEW" });
    expect(data.logs.map((l) => l.employee.name)).toEqual(["Noah Brown"]);
    expect(data.logs[0].tags).toEqual([{ id: "50000000-0000-4000-8000-000000000003", label: "Needs review" }]);
    expect((await getDashboard(ctx, { fieldIds: [FIELD_B] })).data.logs[0].tags).toEqual([]);
    await resetTags(sql);
  });
});
