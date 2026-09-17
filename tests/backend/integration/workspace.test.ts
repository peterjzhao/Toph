import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import type { WorkspaceResponse, WorkspaceState } from "@/contracts/workspace";
import * as route from "@/app/api/workspace/route";
import { enterDemo } from "@/server/accounts/service";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { FARM_ID, ISAAC_LOG_ID } from "@/server/db/initial-data";
import { applyRuntimeGrants } from "@/server/db/grants";
import { getWorkspace, patchWorkspace } from "@/server/workspace/service";
import { MAX_WORKSPACE_BODY_BYTES } from "@/server/workspace/validation";
import { openTestSql } from "../helpers/test-db";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { TEST_APP_ORIGIN, useRouteTestEnv } from "../helpers/route-env";

const target = getTestDatabaseTarget();
const origin = TEST_APP_ORIGIN;
const headers = { origin, "content-type": "application/json" };
let cookie = "";
const request = (body: unknown, extras: Record<string, string> = {}) => new NextRequest(`${origin}/api/workspace`, {
  method: "PATCH", headers: { ...headers, cookie, ...extras }, body: JSON.stringify(body),
});

describe("persistent workspace pages", () => {
  let owner: postgres.Sql;
  let ctx: FarmContext;
  let restoreEnv: () => void;
  beforeAll(async () => {
    owner = openTestSql();
    await prepareTestDatabase(owner);
    await applyRuntimeGrants(owner, process.env.DATABASE_APP_ROLE?.trim() || "toph_app");
    ctx = await createFarmContext({ databaseUrl: target.appUrl ?? target.url, farmId: FARM_ID });
    restoreEnv = useRouteTestEnv({ DATABASE_URL: target.appUrl ?? target.url });
    cookie = `toph_session=${(await enterDemo("web")).token}`;
  });
  beforeEach(async () => {
    getTestDatabaseTarget(); // fail closed before clearing ONLY the isolated test workspace.
    await owner`delete from toph.workspace_state`;
  });
  afterAll(async () => { restoreEnv(); await ctx.close(); await owner.end(); });

  it("persists and removes an administrator photo and rejects non-image URLs", async () => {
    const initial = await getWorkspace(ctx);
    const adminAvatar = `data:image/jpeg;base64,${readFileSync("public/assets/avatar.jpg").toString("base64")}`;
    const saved = await patchWorkspace(ctx, { expectedRevision: initial.revision, patch: { settings: { ...initial.data.settings, adminAvatar } } });
    expect((await getWorkspace(ctx)).data.settings.adminAvatar).toBe(adminAvatar);
    await expect(patchWorkspace(ctx, { expectedRevision: saved.revision, patch: { settings: { ...saved.data.settings, adminAvatar: "javascript:alert(1)" } } })).rejects.toThrow();
    await patchWorkspace(ctx, { expectedRevision: saved.revision, patch: { settings: { ...saved.data.settings, adminAvatar: null } } });
    expect((await getWorkspace(ctx)).data.settings.adminAvatar).toBeNull();
  });

  it("initializes one seeded row transactionally even with concurrent first reads", async () => {
    const copies = await Promise.all(Array.from({ length: 6 }, () => getWorkspace(ctx)));
    expect(copies.every((copy) => copy.revision === 0)).toBe(true);
    expect(copies[0].data.employees).toHaveLength(11);
    expect(copies[0].data.schedule).toHaveLength(3);
    expect(copies[0].data.messages).toHaveLength(2);
    expect((await owner`select count(*)::int as n from toph.workspace_state where farm_id = ${FARM_ID}`)[0].n).toBe(1);
  });

  it("commits changes that persist across separately opened database connections", async () => {
    const initial = await getWorkspace(ctx);
    const saved = await patchWorkspace(ctx, { expectedRevision: 0, patch: {
      settings: { ...initial.data.settings, contactName: "Persistence test" },
      reviews: [{ logId: ISAAC_LOG_ID, status: "Approved", note: "Checked", updatedAt: new Date().toISOString() }],
    } });
    expect(saved.revision).toBe(1);
    const separate = await createFarmContext({ databaseUrl: target.appUrl ?? target.url, farmId: FARM_ID });
    try { expect(await getWorkspace(separate)).toEqual(saved); } finally { await separate.close(); }
    expect((await getWorkspace(ctx)).data.reviews[0].status).toBe("Approved");
  });

  it("rejects a stale revision and serializes competing writes without losing a change", async () => {
    const initial = await getWorkspace(ctx);
    const attempts = await Promise.allSettled(["First", "Second"].map((name) => patchWorkspace(ctx, {
      expectedRevision: initial.revision, patch: { settings: { ...initial.data.settings, contactName: name } },
    })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
    expect((await getWorkspace(ctx)).revision).toBe(1);
  });

  it("accepts new workspace employees and their assignments atomically", async () => {
    const initial = await getWorkspace(ctx);
    const employee = { id: randomUUID(), name: "Sample new employee", role: "Field lead", email: "", phone: "", status: "Active" as const, joinedAt: "2026-04-29" };
    const result = await patchWorkspace(ctx, { expectedRevision: 0, patch: {
      employees: [...initial.data.employees, employee],
      schedule: [...initial.data.schedule, { ...initial.data.schedule[0], id: randomUUID(), employeeId: employee.id }],
    } });
    expect(result.data.employees).toHaveLength(12);
    expect(result.data.messages).toEqual(initial.data.messages);
    expect((await owner`select count(*)::int as n from toph.employees where farm_id = ${FARM_ID}`)[0].n).toBe(11);
  });

  it("rejects cross-farm references, orphan messages and removal of historical employees", async () => {
    const { data } = await getWorkspace(ctx);
    const badPatches: Partial<WorkspaceState>[] = [
      { reviews: [{ logId: OTHER_FARM.logId, status: "Approved", note: "", updatedAt: new Date().toISOString() }] },
      { schedule: [{ ...data.schedule[0], fieldId: OTHER_FARM.fieldId }] },
      { schedule: [{ ...data.schedule[0], employeeId: OTHER_FARM.employeeId }] },
      { messages: [{ ...data.messages[0], employeeId: randomUUID() }] },
      { employees: data.employees.slice(1) },
      { employees: [...data.employees, { ...data.employees[0], id: OTHER_FARM.employeeId }] },
    ];
    for (const patch of badPatches) await expect(patchWorkspace(ctx, { expectedRevision: 0, patch })).rejects.toMatchObject({ status: 400 });
    expect((await getWorkspace(ctx)).revision).toBe(0);
  });

  it("validates unknown keys, duplicate IDs, real dates, time order and array limits", async () => {
    const { data } = await getWorkspace(ctx);
    const invalid = [
      { patch: {}, expectedRevision: 0 },
      { patch: { farmId: OTHER_FARM.id }, expectedRevision: 0 },
      { patch: { reviews: [] }, expectedRevision: -1 },
      { patch: { employees: [...data.employees, data.employees[0]] }, expectedRevision: 0 },
      { patch: { schedule: [{ ...data.schedule[0], date: "2026-02-30" }] }, expectedRevision: 0 },
      { patch: { schedule: [{ ...data.schedule[0], endTime: "06:00" }] }, expectedRevision: 0 },
      { patch: { settings: { ...data.settings, timezone: "Not/AZone" } }, expectedRevision: 0 },
      { patch: { reviews: Array.from({ length: 1001 }, () => ({ logId: ISAAC_LOG_ID, status: "Pending", note: "", updatedAt: new Date().toISOString() })) }, expectedRevision: 0 },
    ];
    for (const body of invalid) await expect(patchWorkspace(ctx, body)).rejects.toMatchObject({ status: 400 });
    expect((await getWorkspace(ctx)).revision).toBe(0);
  });

  it("supports archive, schedules, reports, support and settings without replacing messages", async () => {
    const { data } = await getWorkspace(ctx);
    const timestamp = new Date().toISOString();
    const saved = await patchWorkspace(ctx, { expectedRevision: 0, patch: {
      employees: data.employees.map((employee, index) => index === 0 ? { ...employee, status: "Inactive" } : employee),
      schedule: data.schedule.map((item) => ({ ...item, status: "Completed" })),
      reports: [{ id: randomUUID(), name: "April hours", kind: "hours", from: "2026-04-01", to: "2026-04-30", createdAt: timestamp }],
      tickets: [{ id: randomUUID(), subject: "Irrigation valve", category: "Technical", body: "The valve on FIELD D sticks when opened.", status: "Open", createdAt: timestamp }],
      settings: { ...data.settings, notifications: { recordings: false, weekly: false, reminders: false } },
    } });
    expect(saved.data.employees[0].status).toBe("Inactive");
    expect(saved.data.schedule.every((item) => item.status === "Completed")).toBe(true);
    expect(saved.data.reports).toHaveLength(1);
    expect(saved.data.tickets).toHaveLength(1);
    expect(saved.data.messages).toEqual(data.messages);
  });

  it("returns no-store HTTP envelopes, persists PATCH and returns 409 on retries", async () => {
    const read = await route.GET(new NextRequest(`${origin}/api/workspace`, { headers: { cookie } }));
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const initial = await read.json() as WorkspaceResponse;
    const body = { expectedRevision: initial.revision, patch: { settings: { ...initial.data.settings, contactName: "HTTP saved" } } };
    const written = await route.PATCH(request(body));
    expect(written.status).toBe(200);
    expect((await written.json()).data.settings.contactName).toBe("HTTP saved");
    const stale = await route.PATCH(request(body));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("REVISION_CONFLICT");
    expect((await getWorkspace(ctx)).data.settings.contactName).toBe("HTTP saved");
  });

  it("enforces origins, JSON body size, strict farm scope and content type at HTTP boundary", async () => {
    const body = { expectedRevision: 0, patch: { reviews: [] } };
    expect((await route.PATCH(request(body, { origin: "https://elsewhere.example" }))).status).toBe(403);
    expect((await route.PATCH(request(body, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await route.PATCH(request(body, { "content-length": String(MAX_WORKSPACE_BODY_BYTES + 1) }))).status).toBe(413);
    expect((await route.PATCH(request({ ...body, padding: "x".repeat(MAX_WORKSPACE_BODY_BYTES) }))).status).toBe(413);
    expect((await route.GET(new NextRequest(`${origin}/api/workspace?farmId=${OTHER_FARM.id}`))).status).toBe(400);
  });

  it.skipIf(!target.appUrl)("gives the runtime role workspace updates but no deletes or farm reassignment", async () => {
    await getWorkspace(ctx);
    await expect(ctx.sql`delete from toph.workspace_state where farm_id = ${FARM_ID}`).rejects.toMatchObject({ code: "42501" });
    await expect(ctx.sql`update toph.workspace_state set farm_id = ${OTHER_FARM.id} where farm_id = ${FARM_ID}`).rejects.toMatchObject({ code: "42501" });
  });
});
