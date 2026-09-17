import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import type { AccountSession } from "@/contracts/accounts";
import * as signup from "@/app/api/auth/signup/route";
import * as login from "@/app/api/auth/login/route";
import * as join from "@/app/api/auth/join/route";
import * as demo from "@/app/api/auth/demo/route";
import * as session from "@/app/api/auth/session/route";
import * as logout from "@/app/api/auth/logout/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as workspace from "@/app/api/workspace/route";
import * as setup from "@/app/api/farm/setup/route";
import * as image from "@/app/api/farm/image/route";
import * as members from "@/app/api/farm/members/route";
import * as member from "@/app/api/farm/members/[accountId]/route";
import * as invite from "@/app/api/farm/invite/route";
import * as bootstrap from "@/app/api/mobile/v1/accounts/route";
import * as profile from "@/app/api/mobile/v1/accounts/[accountId]/route";
import * as mobileLogs from "@/app/api/mobile/v1/logs/route";
import * as log from "@/app/api/logs/[logId]/route";
import * as review from "@/app/api/logs/[logId]/review/route";
import * as recording from "@/app/api/mobile/v1/recordings/[recordingId]/route";
import * as realtime from "@/app/api/realtime/route";
import { applyRuntimeGrants } from "@/server/db/grants";
import { applyMobileGrants } from "@/server/mobile/grants";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { prepareTestDatabase } from "../helpers/prepare-db";
import { TEST_APP_ORIGIN, useRouteTestEnv } from "../helpers/route-env";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZSkAAAAASUVORK5CYII=";
const boundary = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
function req(path: string, method = "GET", data?: unknown, credential = "", mobile = false) {
  return new NextRequest(`${TEST_APP_ORIGIN}${path}`, { method, headers: {
    ...(method !== "GET" ? { origin: TEST_APP_ORIGIN, "content-type": "application/json" } : {}),
    ...(mobile ? { "x-toph-client": "toph-mobile", ...(credential ? { authorization: `Bearer ${credential}` } : {}) } : credential ? { cookie: credential } : {}),
  }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
function upload(token: string, employeeId: string, fieldId: string, withAudio = false) {
  const id = randomUUID(); const form = new FormData();
  form.set("metadata", JSON.stringify({ contractVersion: "1", clientDraftId: id, accountId: employeeId, fieldId, activity: "Spraying", workDate: "2026-09-17", startTime: "06:00", endTime: "07:00", notes: "Persisted real farm work", transcript: null, treatment: null, tags: [], recordings: withAudio ? [{ mimeType: "audio/mpeg", durationSeconds: 13.3 }] : [] }));
  if (withAudio) form.append("audio0", new Blob([readFileSync("public/assets/sample-recording.mp3")], { type: "audio/mpeg" }), "sample.mp3");
  return new NextRequest(`${TEST_APP_ORIGIN}/api/mobile/v1/logs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-toph-client": "toph-mobile", "idempotency-key": id }, body: form });
}

describe("account-scoped signup, farm setup and review", () => {
  let sql: postgres.Sql; let restore: () => void;
  const farms: string[] = [];
  let admin: AccountSession; let cookie: string; let worker: AccountSession; let token: string; let fieldId: string; let logId: string;
  const suffix = randomUUID().slice(0, 8);
  const originalMobile = process.env.TOPH_MOBILE_ENABLED;
  beforeAll(async () => {
    sql = openTestSql(); await prepareTestDatabase(sql);
    const target = getTestDatabaseTarget();
    if (target.appUrl) { const role = new URL(target.appUrl).username; await applyRuntimeGrants(sql, role); await applyMobileGrants(sql, role); }
    restore = useRouteTestEnv({ DATABASE_URL: target.appUrl ?? target.url });
    process.env.TOPH_MOBILE_ENABLED = "true";
  });
  afterAll(async () => {
    for (const id of farms) {
      await sql`delete from toph.mobile_recordings where farm_id = ${id}`;
      await sql`delete from toph.mobile_submissions where farm_id = ${id}`;
      await sql`delete from toph.work_logs where farm_id = ${id}`;
      await sql`delete from toph.accounts where farm_id = ${id}`;
      await sql`delete from toph.mobile_profiles where farm_id = ${id}`;
      await sql`delete from toph.employees where farm_id = ${id}`;
      await sql`delete from toph.fields where farm_id = ${id}`;
      await sql`delete from toph.farm_images where farm_id = ${id}`;
      await sql`delete from toph.workspace_state where farm_id = ${id}`;
      await sql`delete from toph.farm_access where farm_id = ${id}`;
      await sql`delete from toph.farms where id = ${id}`;
    }
    restore(); if (originalMobile === undefined) delete process.env.TOPH_MOBILE_ENABLED; else process.env.TOPH_MOBILE_ENABLED = originalMobile;
    await sql.end();
  });

  it("requires an actual session; empty or forged credentials never select the sample farm", async () => {
    expect((await dashboard.GET(req("/api/dashboard"))).status).toBe(401);
    expect((await workspace.GET(req("/api/workspace"))).status).toBe(401);
    expect((await session.GET(req("/api/auth/session", "GET", undefined, "toph_session=" + "a".repeat(43)))).status).toBe(401);
    const foreign = new NextRequest(`${TEST_APP_ORIGIN}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: "https://foreign.example" }, body: JSON.stringify({ name: "Nope", farmName: "Nope" }) });
    expect((await signup.POST(foreign)).status).toBe(403);
  });

  it("creates an empty farm and counts its administrator once", async () => {
    const response = await signup.POST(req("/api/auth/signup", "POST", { name: `  New   Farmer ${suffix}  `, farmName: "My own farm" }));
    expect(response.status).toBe(201);
    const body = await response.json(); admin = body.data; farms.push(admin.farm.id);
    cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);
    expect(body.data.token).toBeUndefined(); expect(admin.account.name).toBe(`New Farmer ${suffix}`); expect(admin.farm).toMatchObject({ isDemo: false, setupComplete: false });
    const result = await (await dashboard.GET(req("/api/dashboard", "GET", undefined, cookie))).json();
    expect(result.data.metrics.activeWorkers).toBe(1); expect(result.data.logs).toEqual([]); expect(result.data.filterOptions.fields).toEqual([]);
    const state = await (await workspace.GET(req("/api/workspace", "GET", undefined, cookie))).json();
    expect(state.data.employees).toEqual([]); expect(state.data.schedule).toEqual([]); expect(state.data.messages).toEqual([]);
    expect((await (await realtime.GET(req("/api/realtime", "GET", undefined, cookie))).json()).data).toEqual({ enabled: false });
  });

  it("resolves normalized names and rolls back duplicate signup atomically", async () => {
    const [{ count: before }] = await sql`select count(*)::int as count from toph.farms`;
    const collision = await signup.POST(req("/api/auth/signup", "POST", { name: `NEW FARMER ${suffix.toUpperCase()}`, farmName: "Must not persist" }));
    expect(collision.status).toBe(409); expect((await collision.json()).error.code).toBe("NAME_TAKEN");
    expect((await sql`select count(*)::int as count from toph.farms`)[0].count).toBe(before);
    const signed = await login.POST(req("/api/auth/login", "POST", { name: `new farmer ${suffix}` })); expect(signed.status).toBe(200);
    expect((await signed.json()).data.account.id).toBe(admin.account.id);
    const results = await Promise.all([1, 2].map(() => signup.POST(req("/api/auth/signup", "POST", { name: `Concurrent ${suffix}`, farmName: "Atomic farm" }))));
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    for (const r of results) if (r.status === 201) farms.push((await r.json()).data.farm.id);
    expect((await sql`select count(*)::int as count from toph.farms`)[0].count).toBe(before + 1);
  });

  it("requires a valid raster and non-crossing labeled fields; persists stable geometry", async () => {
    expect((await setup.POST(req("/api/farm/setup", "POST", { fields: [{ label: "A", boundary }] }, cookie))).status).toBe(400);
    const badImage = { dataUrl: "data:image/svg+xml;base64,PHN2Zz4=", width: 1, height: 1 };
    expect((await setup.POST(req("/api/farm/setup", "POST", { image: badImage, fields: [{ label: "A", boundary }] }, cookie))).status).toBe(400);
    const imageData = { dataUrl: PNG, width: 1, height: 1 };
    expect((await setup.POST(req("/api/farm/setup", "POST", { image: imageData, fields: Array.from({ length: 27 }, () => ({ label: "A", boundary })) }, cookie))).status).toBe(400);
    expect((await setup.POST(req("/api/farm/setup", "POST", { image: imageData, fields: [{ label: "A", boundary: [boundary[0], boundary[2], boundary[1], boundary[3]] }] }, cookie))).status).toBe(400);
    const response = await setup.POST(req("/api/farm/setup", "POST", { image: imageData, fields: [{ label: "A", boundary }] }, cookie));
    expect(response.status).toBe(200); const result = (await response.json()).data; fieldId = result.fields[0].id;
    expect(result).toMatchObject({ image: { url: "/api/farm/image", width: 1, height: 1 }, setupComplete: true });
    const same = await setup.POST(req("/api/farm/setup", "POST", { fields: [{ id: fieldId, label: "B", boundary }] }, cookie));
    expect((await same.json()).data.fields[0]).toEqual({ id: fieldId, label: "B", boundary });
    const dash = await (await dashboard.GET(req("/api/dashboard", "GET", undefined, cookie))).json();
    expect(dash.data.filterOptions.fields).toEqual([{ id: fieldId, name: "FIELD B", boundary, mapImageUrl: "/api/farm/image" }]);
    expect((await image.GET(req("/api/farm/image", "GET", undefined, cookie))).headers.get("content-type")).toBe("image/png");
    expect((await image.GET(req("/api/farm/image"))).status).toBe(401);
  });

  it("joins by code and confines workers to their own mobile identity", async () => {
    expect((await join.POST(req("/api/auth/join", "POST", { name: `Worker ${suffix}`, code: "000000000000", client: "mobile" }, "", true))).status).toBe(400);
    const response = await join.POST(req("/api/auth/join", "POST", { name: `Worker ${suffix}`, code: admin.joinCode, client: "mobile" }, "", true));
    expect(response.status).toBe(201); const data = (await response.json()).data; worker = data; token = data.token;
    expect(worker.account.role).toBe("worker"); expect(worker.farm.id).toBe(admin.farm.id); expect(worker.joinCode).toBeUndefined();
    expect((await dashboard.GET(req("/api/dashboard", "GET", undefined, token, true))).status).toBe(403);
    expect((await members.GET(req("/api/farm/members", "GET", undefined, token, true))).status).toBe(403);
    expect((await login.POST(req("/api/auth/login", "POST", { name: worker.account.name }))).status).toBe(403);
    const dataResponse = await bootstrap.GET(req("/api/mobile/v1/accounts", "GET", undefined, token, true));
    const dataBody = (await dataResponse.json()).data;
    expect(dataBody.accounts).toHaveLength(1); expect(dataBody.accounts[0].id).toBe(worker.account.employeeId);
    expect((await mobileLogs.GET(req(`/api/mobile/v1/logs?accountId=${randomUUID()}`, "GET", undefined, token, true))).status).toBe(403);
    const updated = await profile.PATCH(req("/api/mobile/v1/accounts", "PATCH", { expectedRevision: dataBody.revision, profile: { ...dataBody.accounts[0], id: undefined, name: admin.account.name } }, token, true), params({ accountId: worker.account.employeeId! }));
    expect(updated.status).toBe(409);
    expect((await (await dashboard.GET(req("/api/dashboard", "GET", undefined, cookie))).json()).data.metrics.activeWorkers).toBe(2);
  });

  it("persists worker logs and shared first-review attribution without editing the sample", async () => {
    expect((await mobileLogs.POST(upload(token, randomUUID(), fieldId))).status).toBe(403);
    const response = await mobileLogs.POST(upload(token, worker.account.employeeId!, fieldId, true));
    expect(response.status).toBe(200); logId = (await response.json()).data.logId;
    const read = await log.GET(req(`/api/logs/${logId}`, "GET", undefined, cookie), params({ logId }));
    expect((await read.json()).data).toMatchObject({ isNew: true, field: { boundary, mapImageUrl: "/api/farm/image" } });
    expect((await review.POST(req(`/api/logs/${logId}/review`, "POST", {}, token, true), params({ logId }))).status).toBe(403);
    expect((await review.POST(req(`/api/logs/${logId}/review`, "POST", {}, cookie), params({ logId }))).status).toBe(200);
    const [first] = await sql`select is_new, reviewed_by, reviewed_at from toph.work_logs where id = ${logId}`;
    expect(first.is_new).toBe(false); expect(first.reviewed_by).toBe(admin.account.id); expect(first.reviewed_at).toBeTruthy();
    await review.POST(req(`/api/logs/${logId}/review`, "POST", {}, cookie), params({ logId }));
    expect((await sql`select reviewed_at from toph.work_logs where id = ${logId}`)[0].reviewed_at).toEqual(first.reviewed_at);
    const responseDemo = await demo.POST(req("/api/auth/demo", "POST", {})); expect(responseDemo.status).toBe(200);
    const sampleCookie = responseDemo.headers.get("set-cookie")!.split(";")[0];
    const sampleId = "30000000-0000-4000-8000-000000000001";
    const [before] = await sql`select is_new, updated_at from toph.work_logs where id = ${sampleId}`;
    await review.POST(req(`/api/logs/${sampleId}/review`, "POST", {}, sampleCookie), params({ logId: sampleId }));
    expect((await sql`select is_new, updated_at from toph.work_logs where id = ${sampleId}`)[0]).toEqual(before);
    expect((await log.GET(req(`/api/logs/${logId}`, "GET", undefined, sampleCookie), params({ logId }))).status).toBe(404);
  });

  it("keeps recording bytes private to their author and farm administrator", async () => {
    const [row] = await sql`select id from toph.mobile_recordings where log_id = ${logId}`;
    const path = `/api/mobile/v1/recordings/${row.id}`;
    expect((await recording.GET(req(path, "GET", undefined, token, true), params({ recordingId: row.id }))).status).toBe(200);
    expect((await recording.GET(req(path, "GET", undefined, cookie), params({ recordingId: row.id }))).status).toBe(200);
    expect((await recording.GET(req(path), params({ recordingId: row.id }))).status).toBe(401);
    const another = await join.POST(req("/api/auth/join", "POST", { name: `Other worker ${suffix}`, code: admin.joinCode, client: "mobile" }, "", true));
    const other = (await another.json()).data;
    expect((await recording.GET(req(path, "GET", undefined, other.token, true), params({ recordingId: row.id }))).status).toBe(404);
    const state = (await (await workspace.GET(req("/api/workspace", "GET", undefined, cookie))).json());
    const updated = await workspace.PATCH(req("/api/workspace", "PATCH", { expectedRevision: state.revision, patch: { employees: state.data.employees.map((person: { id: string }) => person.id === other.account.employeeId ? { ...person, status: "Inactive" } : person) } }, cookie));
    expect(updated.status).toBe(200);
    expect((await session.GET(req("/api/auth/session", "GET", undefined, other.token, true))).status).toBe(401);
    expect((await sql`select is_active from toph.employees where id = ${other.account.employeeId}`)[0].is_active).toBe(false);
  });

  it("rotates codes, rejects ghost members, revokes inactive worker sessions and preserves work", async () => {
    const response = await invite.POST(req("/api/farm/invite", "POST", {}, cookie)); expect(response.status).toBe(200);
    expect((await response.json()).data.joinCode).not.toBe(admin.joinCode);
    expect((await join.POST(req("/api/auth/join", "POST", { name: `Old code ${suffix}`, code: admin.joinCode, client: "mobile" }, "", true))).status).toBe(400);
    const state = await (await workspace.GET(req("/api/workspace", "GET", undefined, cookie))).json();
    expect((await workspace.PATCH(req("/api/workspace", "PATCH", { expectedRevision: state.revision, patch: { employees: [...state.data.employees, { ...state.data.employees[0], id: randomUUID(), name: "Ghost" }] } }, cookie))).status).toBe(400);
    const listed = (await (await members.GET(req("/api/farm/members", "GET", undefined, cookie))).json()).data;
    expect(listed).toHaveLength(3);
    expect((await member.DELETE(req(`/api/farm/members/${worker.account.id}`, "DELETE", undefined, cookie), params({ accountId: worker.account.id }))).status).toBe(200);
    expect((await session.GET(req("/api/auth/session", "GET", undefined, token, true))).status).toBe(401);
    expect((await login.POST(req("/api/auth/login", "POST", { name: worker.account.name, client: "mobile" }, "", true))).status).toBe(401);
    expect((await sql`select id from toph.work_logs where id = ${logId}`)).toHaveLength(1);
    expect((await (await dashboard.GET(req("/api/dashboard", "GET", undefined, cookie))).json()).data.metrics.activeWorkers).toBe(1);
    expect((await logout.POST(req("/api/auth/logout", "POST", {}, cookie))).status).toBe(200);
    expect((await session.GET(req("/api/auth/session", "GET", undefined, cookie))).status).toBe(401);
  });
});
