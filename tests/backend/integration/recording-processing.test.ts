import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { FARM_ID } from "@/server/db/initial-data";
import { applyRuntimeGrants } from "@/server/db/grants";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { getMobileBootstrap } from "@/server/mobile/accounts";
import { applyMobileGrants } from "@/server/mobile/grants";
import { processRecording } from "@/server/recordings/process";
import { reserveTranscription } from "@/server/recordings/quota";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";
import { OTHER_FARM, prepareTestDatabase } from "../helpers/prepare-db";

describe("recording processing with real PostgreSQL and a fake provider", () => {
  let owner: postgres.Sql;
  let ctx: FarmContext;
  let accountId: string;
  let fieldId: string;
  beforeAll(async () => {
    owner = openTestSql(); await prepareTestDatabase(owner);
    await applyRuntimeGrants(owner, "toph_app"); await applyMobileGrants(owner, "toph_app");
    const target = getTestDatabaseTarget();
    ctx = await createFarmContext({ databaseUrl: target.appUrl ?? target.url, farmId: FARM_ID });
    const bootstrap = await getMobileBootstrap(ctx);
    accountId = bootstrap.accounts[0].id; fieldId = bootstrap.fields[0].id;
  });
  beforeEach(async () => { await owner`delete from toph.transcription_usage where farm_id = ${FARM_ID}`; });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await owner`delete from toph.transcription_usage where farm_id = ${FARM_ID}`;
    await owner`revoke insert on toph.work_logs, toph.employees from toph_app`;
    await owner`revoke update (display_name, avatar_path, updated_at) on toph.employees from toph_app`;
    await ctx?.close(); await owner?.end();
  });
  const core = () => ({ fieldId, activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Sprayed Field A with two liters of water.", tags: [] });
  const treatment = { product: "Water", amount: 2, unit: "L" };
  const fields = () => ({ ...core(), details: treatment, ...treatment });
  const result = () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...core(), details: treatment }) }] }] });
  function upload(id = accountId) {
    const form = new FormData();
    form.append("file", new Blob([readFileSync("public/assets/sample-recording.mp3")], { type: "audio/mpeg" }), "test.mp3");
    form.append("context", JSON.stringify({ accountId: id, referenceDate: "2026-09-16", previousTranscript: "Earlier clip." }));
    return new Request("https://toph.example/api/mobile/v1/transcriptions", { method: "POST", body: form });
  }
  it("returns speech and all structured categories without saving a work log", async () => {
    const [before] = await owner`select count(*)::int as n from toph.work_logs`;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ text: "Sprayed Field A." })).mockImplementationOnce(result);
    vi.stubGlobal("fetch", fetcher);
    const output = await processRecording(upload(), ctx, "test-key");
    expect(output).toEqual({ text: "Sprayed Field A.", transcript: "Earlier clip.\n\nSprayed Field A.", fields: fields(), missingFields: [], extractionError: null,
      voice: { status: "ready_to_confirm", prompt: expect.stringContaining("Say save, or tell me what to change."), missingFields: [] } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await owner`select count(*)::int as n from toph.work_logs`)[0].n).toBe(before.n);
    expect((await owner`select day_count from toph.transcription_usage where farm_id = ${FARM_ID}`)[0].day_count).toBe(1);
  });
  it("retains text on extraction failure and reprocesses text without another speech request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ text: "Good speech." })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const output = await processRecording(upload(), ctx, "test-key");
    expect(output).toMatchObject({ text: "Good speech.", fields: null, extractionError: expect.any(String) });
    fetcher.mockClear().mockImplementationOnce(result);
    const retry = new Request("https://toph.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: { accountId, referenceDate: "2026-09-16" }, transcript: output.transcript }) });
    expect((await processRecording(retry, ctx, "test-key")).fields).toEqual(fields());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
  });
  it("rejects accounts outside the farm before provider use", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(processRecording(upload(OTHER_FARM.employeeId), ctx, "test-key")).rejects.toMatchObject({ status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("enforces minute and daily quotas atomically across concurrent requests", async () => {
    const results = await Promise.allSettled(Array.from({ length: 18 }, () => reserveTranscription(ctx)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(12);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(6);
    await owner`update toph.transcription_usage set minute_start = now() - interval '2 minutes', day_count = 120 where farm_id = ${FARM_ID}`;
    await expect(reserveTranscription(ctx)).rejects.toMatchObject({ status: 429 });
    await owner`update toph.transcription_usage set day_start = current_date - 1 where farm_id = ${FARM_ID}`;
    await reserveTranscription(ctx);
    expect((await owner`select minute_count, day_count from toph.transcription_usage where farm_id = ${FARM_ID}`)[0]).toMatchObject({ minute_count: 1, day_count: 1 });
  });
});
