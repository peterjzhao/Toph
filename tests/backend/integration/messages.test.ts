import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import type { MessageInbox } from "@/contracts/messages";
import * as web from "@/app/api/messages/route";
import * as webRead from "@/app/api/messages/read/route";
import * as mobile from "@/app/api/mobile/v1/messages/route";
import * as mobileRead from "@/app/api/mobile/v1/messages/read/route";
import * as workspace from "@/app/api/workspace/route";
import { deactivateMember, joinFarm, resolveAccountContext, signupFarm } from "@/server/accounts/service";
import { applyRuntimeGrants } from "@/server/db/grants";
import { openTestSql } from "../helpers/test-db";
import { prepareTestDatabase } from "../helpers/prepare-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

const PASSWORD = "correct horse battery";
import { TEST_APP_ORIGIN, useRouteTestEnv } from "../helpers/route-env";

type Identity = Awaited<ReturnType<typeof signupFarm>>;
function request(identity: Identity | null, native: boolean, method = "GET", body?: unknown, path = native ? "/api/mobile/v1/messages" : "/api/messages") {
  return new NextRequest(`${TEST_APP_ORIGIN}${path}`, { method, headers: {
    "content-type": "application/json", origin: TEST_APP_ORIGIN,
    ...(native ? { "x-toph-client": "toph-mobile" } : {}),
    ...(identity ? native ? { authorization: `Bearer ${identity.token}` } : { cookie: `toph_session=${identity.token}` } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function data(response: Response): Promise<MessageInbox> {
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store"); return body.data;
}

describe("private persisted worker inboxes", () => {
  let owner: postgres.Sql; let restore: () => void;
  let admin: Identity; let worker: Identity; let coworker: Identity; let stranger: Identity; let otherAdmin: Identity;
  const farms: string[] = [];
  const previousMobile = process.env.TOPH_MOBILE_ENABLED;
  beforeAll(async () => {
    owner = openTestSql(); await prepareTestDatabase(owner);
    const target = getTestDatabaseTarget();
    if (target.appUrl) await applyRuntimeGrants(owner, new URL(target.appUrl).username);
    restore = useRouteTestEnv({ DATABASE_URL: target.appUrl ?? target.url });
    process.env.TOPH_MOBILE_ENABLED = "true";
    const suffix = randomUUID();
    admin = await signupFarm({ name: `Message admin ${suffix}`, password: PASSWORD, farmName: "Inbox farm", timezone: "UTC", client: "web" });
    otherAdmin = await signupFarm({ name: `Other admin ${suffix}`, password: PASSWORD, farmName: "Other inbox farm", timezone: "UTC", client: "web" });
    farms.push(admin.session.farm.id, otherAdmin.session.farm.id);
    worker = await joinFarm({ name: `Message worker ${suffix}`, password: PASSWORD, code: admin.session.joinCode!, client: "mobile" });
    coworker = await joinFarm({ name: `Coworker ${suffix}`, password: PASSWORD, code: admin.session.joinCode!, client: "mobile" });
    stranger = await joinFarm({ name: `Stranger ${suffix}`, password: PASSWORD, code: otherAdmin.session.joinCode!, client: "mobile" });
  });
  afterAll(async () => {
    for (const farmId of farms) {
      await owner`delete from toph.accounts where farm_id = ${farmId}`;
      await owner`delete from toph.employees where farm_id = ${farmId}`;
      await owner`delete from toph.workspace_state where farm_id = ${farmId}`;
      await owner`delete from toph.farm_access where farm_id = ${farmId}`;
      await owner`delete from toph.farms where id = ${farmId}`;
    }
    restore();
    if (previousMobile === undefined) delete process.env.TOPH_MOBILE_ENABLED; else process.env.TOPH_MOBILE_ENABLED = previousMobile;
    await owner.end();
  });
  const message = (person: Identity, body = "Please check the north gate.") => ({ id: randomUUID(), employeeId: person.session.account.employeeId!, body });

  it("delivers admin messages only to the addressed worker and persists across connections", async () => {
    expect((await data(await mobile.GET(request(worker, true)))).messages).toEqual([]);
    const input = message(worker);
    const saved = await data(await web.POST(request(admin, false, "POST", input)));
    expect(saved.messages.find(m => m.id === input.id)).toMatchObject({ ...input, from: "admin", read: false });
    expect((await data(await mobile.GET(request(worker, true)))).messages).toEqual(saved.messages);
    expect((await data(await mobile.GET(request(coworker, true)))).messages).toEqual([]);
    expect((await data(await mobile.GET(request(stranger, true)))).messages).toEqual([]);
    expect((await data(await web.GET(request(otherAdmin, false)))).messages).toEqual([]);
    const separate = openTestSql({ max: 1 });
    try {
      const [row] = await separate`select payload -> 'messages' as messages from toph.workspace_state where farm_id = ${admin.session.farm.id}`;
      expect(row.messages).toEqual(saved.messages);
    } finally { await separate.end(); }
  });

  it("supports worker replies, recipient-only read receipts and safe duplicate retries", async () => {
    const input = message(worker, "The gate is secure.");
    const saved = await data(await mobile.POST(request(worker, true, "POST", input)));
    const reply = saved.messages.find(m => m.id === input.id)!;
    expect(reply).toMatchObject({ from: "employee", read: false });
    const read = { employeeId: input.employeeId, messageIds: [input.id] };
    expect((await mobileRead.POST(request(worker, true, "POST", read))).status).toBe(400);
    expect((await mobileRead.POST(request(coworker, true, "POST", read))).status).toBe(403);
    const receipt = await data(await webRead.POST(request(admin, false, "POST", read)));
    expect(receipt.messages.find(m => m.id === input.id)?.read).toBe(true);
    expect((await data(await webRead.POST(request(admin, false, "POST", read)))).revision).toBe(receipt.revision);
    const retried = await data(await mobile.POST(request(worker, true, "POST", input)));
    expect(retried.revision).toBe(receipt.revision);
    expect(retried.messages.filter(m => m.id === input.id)).toEqual([receipt.messages.find(m => m.id === input.id)]);
    expect(retried.messages.find(m => m.id === input.id)?.readAt).toEqual(expect.any(String));
    expect((await mobile.POST(request(worker, true, "POST", { ...input, body: "Changed" }))).status).toBe(409);
    const incoming = retried.messages.find(m => m.from === "admin")!;
    const workerReceipt = await data(await mobileRead.POST(request(worker, true, "POST", { employeeId: input.employeeId, messageIds: [incoming.id] })));
    expect(workerReceipt.messages.find(m => m.id === incoming.id)?.read).toBe(true);
  });

  it("serializes simultaneous sends and identical retries without losing any message", async () => {
    const inputs = Array.from({ length: 8 }, (_, i) => message(worker, `Concurrent ${i}`));
    const attempts = await Promise.all(inputs.map((input, i) => (i % 2 ? mobile.POST(request(worker, true, "POST", input)) : web.POST(request(admin, false, "POST", input)))));
    attempts.forEach(response => expect(response.status).toBe(200));
    const duplicate = message(worker, "One send, three retries");
    const retries = await Promise.all(Array.from({ length: 3 }, () => mobile.POST(request(worker, true, "POST", duplicate))));
    retries.forEach(response => expect(response.status).toBe(200));
    const inbox = await data(await mobile.GET(request(worker, true)));
    for (const input of [...inputs, duplicate]) expect(inbox.messages.filter(m => m.id === input.id)).toHaveLength(1);
  });

  it("treats legacy outgoing saved flags as unread until the worker actually opens them", async () => {
    const legacy = { ...message(worker, "Legacy saved message"), from: "admin", read: true, createdAt: "2026-09-16T12:00:00.000Z" };
    await owner`update toph.workspace_state set payload = jsonb_set(payload, '{messages}', (payload -> 'messages') || ${JSON.stringify([legacy])}::jsonb), revision = revision + 1 where farm_id = ${admin.session.farm.id}`;
    const before = await data(await mobile.GET(request(worker, true)));
    expect(before.messages.find(m => m.id === legacy.id)?.read).toBe(false);
    await data(await mobileRead.POST(request(worker, true, "POST", { employeeId: legacy.employeeId, messageIds: [legacy.id] })));
    const after = await data(await web.GET(request(admin, false)));
    expect(after.messages.find(m => m.id === legacy.id)).toMatchObject({ read: true, readAt: expect.any(String) });
  });

  it("does not mark a newly arriving message read when acknowledging an earlier snapshot", async () => {
    const first = message(coworker, "First"); const second = message(coworker, "Arrived while reading");
    await data(await web.POST(request(admin, false, "POST", first)));
    await data(await web.POST(request(admin, false, "POST", second)));
    const read = await data(await mobileRead.POST(request(coworker, true, "POST", { employeeId: first.employeeId, messageIds: [first.id] })));
    expect(read.messages.find(m => m.id === first.id)?.read).toBe(true);
    expect(read.messages.find(m => m.id === second.id)?.read).toBe(false);
  });

  it("rejects unauthorized, cross-worker, cross-farm and forged sender requests", async () => {
    expect((await web.GET(request(null, false))).status).toBe(401);
    expect((await mobile.GET(request(null, true))).status).toBe(401);
    expect((await web.GET(request(worker, true))).status).toBe(403);
    expect((await mobile.GET(request(admin, false))).status).toBe(403);
    expect((await mobile.POST(request(worker, true, "POST", message(coworker)))).status).toBe(403);
    expect((await web.POST(request(admin, false, "POST", message(stranger)))).status).toBe(404);
    expect((await mobile.GET(request(worker, true, "GET", undefined, `/api/mobile/v1/messages?employeeId=${coworker.session.account.employeeId}`))).status).toBe(400);
    for (const extra of [{ from: "admin" }, { createdAt: "2026-01-01T00:00:00Z" }, { read: true }, { farmId: otherAdmin.session.farm.id }]) {
      expect((await mobile.POST(request(worker, true, "POST", { ...message(worker), ...extra }))).status).toBe(400);
    }
    for (const body of [" ", "x".repeat(4001)]) expect((await web.POST(request(admin, false, "POST", message(worker, body)))).status).toBe(400);
    const foreign = request(admin, false, "POST", message(worker)); foreign.headers.set("origin", "https://elsewhere.example");
    expect((await web.POST(foreign)).status).toBe(403);
    const unmarked = request(worker, true, "POST", message(worker)); unmarked.headers.delete("x-toph-client");
    expect((await mobile.POST(unmarked)).status).toBe(403);
    const unicode = message(worker, "🌱".repeat(2000));
    expect((await web.POST(request(admin, false, "POST", unicode))).status).toBe(200);
  });

  it("prevents workspace replacement from forging messages and preserves unrelated edits", async () => {
    const initial = await (await workspace.GET(request(admin, false, "GET", undefined, "/api/workspace"))).json();
    const body = { expectedRevision: initial.revision, patch: { messages: [] } };
    expect((await workspace.PATCH(request(admin, false, "PATCH", body, "/api/workspace"))).status).toBe(400);
    const sent = message(worker, "Survives a concurrent settings save");
    await data(await web.POST(request(admin, false, "POST", sent)));
    const settings = { ...initial.data.settings, contactName: "Saved settings" };
    expect((await workspace.PATCH(request(admin, false, "PATCH", { ...body, patch: { settings } }, "/api/workspace"))).status).toBe(409);
    const latest = await data(await web.GET(request(admin, false)));
    expect((await workspace.PATCH(request(admin, false, "PATCH", { expectedRevision: latest.revision, patch: { settings } }, "/api/workspace"))).status).toBe(200);
    expect((await data(await mobile.GET(request(worker, true)))).messages.some(m => m.id === sent.id)).toBe(true);
  });

  it("revokes inbox access when a worker is deactivated, retaining their history", async () => {
    const before = await data(await web.GET(request(admin, false)));
    await deactivateMember(await resolveAccountContext(request(admin, false), "admin"), coworker.session.account.id);
    expect((await mobile.GET(request(coworker, true))).status).toBe(401);
    expect((await web.POST(request(admin, false, "POST", message(coworker)))).status).toBe(404);
    expect((await data(await web.GET(request(admin, false)))).messages).toEqual(before.messages);
  });
});
