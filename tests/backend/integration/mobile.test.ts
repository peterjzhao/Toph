import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { MobileLogSubmission } from "@/contracts/mobile";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { FARM_ID } from "@/server/db/initial-data";
import { applyRuntimeGrants } from "@/server/db/grants";
import { applyMobileGrants } from "@/server/mobile/grants";
import { getMobileBootstrap, updateMobileAccount } from "@/server/mobile/accounts";
import { listMobileLogs, parseMobileSubmission, readMobileSubmission, saveMobileLog } from "@/server/mobile/logs";
import { getWorkspace, patchWorkspace } from "@/server/workspace/service";
import { getLog } from "@/server/services/dashboard";
import { openTestSql } from "../helpers/test-db";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

describe("mobile persistence", () => {
  let owner: postgres.Sql;
  let ctx: FarmContext;
  let employeeId: string;
  let fieldId: string;
  const ids: string[] = [];
  beforeAll(async () => {
    const target = getTestDatabaseTarget();
    owner = openTestSql();
    await prepareTestDatabase(owner);
    await applyRuntimeGrants(owner, "toph_app");
    await applyMobileGrants(owner, "toph_app");
    ctx = await createFarmContext({ databaseUrl: target.appUrl ?? target.url, farmId: FARM_ID });
    const bootstrap = await getMobileBootstrap(ctx);
    employeeId = bootstrap.accounts[0].id;
    fieldId = bootstrap.fields[0].id;
  });
  afterAll(async () => {
    getTestDatabaseTarget();
    if (ids.length) {
      await owner`delete from toph.mobile_recordings where log_id = any(${ids}::uuid[])`;
      await owner`delete from toph.mobile_submissions where log_id = any(${ids}::uuid[])`;
      await owner`delete from toph.work_logs where id = any(${ids}::uuid[])`;
    }
    await owner`revoke insert on toph.work_logs, toph.employees from toph_app`;
    await owner`revoke update (display_name, avatar_path, updated_at) on toph.employees from toph_app`;
    await ctx?.close(); await owner?.end();
  });
  const metadata = (): MobileLogSubmission => ({ contractVersion: "1", accountId: employeeId, clientDraftId: randomUUID(), fieldId,
    activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Checked irrigation.", transcript: "The water is flowing.",
    treatment: { product: "Test treatment", amount: 2, unit: "L" }, tags: ["Needs review"], recordings: [] });

  it("edits the shared roster, persists photos/defaults across connections, and rejects stale revisions", async () => {
    const initial = await getMobileBootstrap(ctx);
    const { id, ...profile } = initial.accounts[0];
    // Valid tiny PNG, not a filesystem URI or remote tracking image.
    const avatarUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const saved = await updateMobileAccount(ctx, id, { expectedRevision: initial.revision, profile: { ...profile, name: "Mobile test worker", phone: "555-0101", email: "mobile@example.com", avatarUrl, defaultField: initial.fields[1].name } });
    expect(saved.accounts[0]).toMatchObject({ name: "Mobile test worker", phone: "555-0101", avatarUrl });
    const separate = await createFarmContext({ databaseUrl: getTestDatabaseTarget().appUrl ?? getTestDatabaseTarget().url, farmId: FARM_ID });
    try { expect((await getMobileBootstrap(separate)).accounts[0]).toEqual(saved.accounts[0]); }
    finally { await separate.close(); }
    expect((await getWorkspace(ctx)).data.employees.find(item => item.id === id)?.name).toBe("Mobile test worker");
    await expect(updateMobileAccount(ctx, id, { expectedRevision: initial.revision, profile })).rejects.toMatchObject({ status: 409 });
    await updateMobileAccount(ctx, id, { expectedRevision: saved.revision, profile: { ...profile, avatarUrl: null } });
    expect((await getMobileBootstrap(ctx)).accounts[0].avatarUrl).toBeNull();
  });

  it("does not allow foreign accounts, fields, unsupported photo contents or extra profile fields", async () => {
    const bootstrap = await getMobileBootstrap(ctx);
    const { id, ...profile } = bootstrap.accounts[0];
    await expect(updateMobileAccount(ctx, OTHER_FARM.employeeId, { expectedRevision: bootstrap.revision, profile })).rejects.toMatchObject({ status: 404 });
    for (const patch of [{ avatarUrl: "file:///phone/photo.jpg" }, { avatarUrl: "data:image/jpeg;base64,aGVsbG8=" }, { defaultField: "ORCHARD 1" }, { farmId: OTHER_FARM.id }]) {
      await expect(updateMobileAccount(ctx, id, { expectedRevision: bootstrap.revision, profile: { ...profile, ...patch } })).rejects.toMatchObject({ status: 400 });
    }
  });

  it("commits complete notes/treatment/tags, deduplicates concurrent retries and returns the dashboard's same ID", async () => {
    const input = metadata();
    const receipts = await Promise.all([saveMobileLog(ctx, input, []), saveMobileLog(ctx, input, [])]);
    ids.push(receipts[0].logId);
    expect(receipts[0]).toEqual(receipts[1]);
    const dashboardLog = await getLog(ctx, receipts[0].logId);
    expect(dashboardLog).toMatchObject({ employee: { id: employeeId }, recording: null, tags: [{ label: "Needs review" }] });
    const listed = (await listMobileLogs(ctx, employeeId)).find(log => log.id === receipts[0].logId)!;
    expect(listed).toMatchObject({ notes: input.notes, transcript: input.transcript, treatment: input.treatment, clientDraftId: input.clientDraftId });
    await expect(saveMobileLog(ctx, { ...input, notes: "Changed after commit" }, [])).rejects.toMatchObject({ status: 409 });
    expect((await owner`select count(*)::int as n from toph.mobile_submissions where client_draft_id = ${input.clientDraftId}`)[0].n).toBe(1);
  });

  it("retains every appended clip and checks multipart bytes before committing", async () => {
    const input = metadata();
    const bytes = readFileSync("public/assets/sample-recording.mp3");
    input.recordings = [{ mimeType: "audio/mpeg", durationSeconds: 13.3 }, { mimeType: "audio/mpeg", durationSeconds: 13.3 }];
    const form = new FormData(); form.append("metadata", JSON.stringify(input));
    input.recordings.forEach((_, index) => form.append(`audio${index}`, new Blob([bytes], { type: "audio/mpeg" }), `${index}.mp3`));
    const upload = await readMobileSubmission(new Request("https://toph.example/api/mobile/v1/logs", { method: "POST", headers: { "idempotency-key": input.clientDraftId }, body: form }));
    const receipt = await saveMobileLog(ctx, upload.metadata, upload.clips); ids.push(receipt.logId);
    const log = (await listMobileLogs(ctx, employeeId)).find(item => item.id === receipt.logId)!;
    expect(log.clips).toHaveLength(2);
    expect(log.clips[0].url).not.toBe(log.clips[1].url);
    const stored = await owner`select bytes from toph.mobile_recordings where log_id = ${receipt.logId} order by position`;
    expect(stored.every(row => bytes.equals(row.bytes))).toBe(true);
    form.set("audio0", new Blob(["not audio"], { type: "audio/mpeg" }), "fake.mp3");
    await expect(readMobileSubmission(new Request("https://toph.example", { method: "POST", headers: { "idempotency-key": input.clientDraftId }, body: form }))).rejects.toMatchObject({ status: 400 });
  });

  it("requires the current submission contract", () => {
    expect(() => parseMobileSubmission({ ...metadata(), contractVersion: "sample-1" })).toThrow();
    expect(() => parseMobileSubmission({ ...metadata(), contractVersion: "2" })).toThrow();
  });

  it("keeps account queries scoped and rejects invalid and ambiguous farm times", async () => {
    await expect(listMobileLogs(ctx, OTHER_FARM.employeeId)).rejects.toMatchObject({ status: 404 });
    await expect(saveMobileLog(ctx, { ...metadata(), fieldId: OTHER_FARM.fieldId }, [])).rejects.toMatchObject({ status: 400 });
    await expect(saveMobileLog(ctx, { ...metadata(), accountId: OTHER_FARM.employeeId }, [])).rejects.toMatchObject({ status: 404 });
    expect(() => parseMobileSubmission({ ...metadata(), workDate: "2026-02-30" })).toThrow();
    for (const [workDate, startTime] of [["2026-03-08", "02:30"], ["2026-11-01", "01:30"]]) await expect(saveMobileLog(ctx, { ...metadata(), workDate, startTime }, [])).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an account archived on the web instead of accepting a stale mobile account", async () => {
    const initial = await getWorkspace(ctx);
    const saved = await patchWorkspace(ctx, { expectedRevision: initial.revision, patch: { employees: initial.data.employees.map(item => item.id === employeeId ? { ...item, status: "Inactive" } : item) } });
    await expect(saveMobileLog(ctx, metadata(), [])).rejects.toMatchObject({ status: 404 });
    await patchWorkspace(ctx, { expectedRevision: saved.revision, patch: { employees: initial.data.employees } });
  });
});
