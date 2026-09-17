import { describe, expect, it } from "vitest";
import { liveUpdatesTopic, readRealtimeConfig } from "@/server/realtime/config";

const FARM_ID = "00000000-0000-4000-8000-000000000001";
const jwt = (payload: object) => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
const ANON_JWT = jwt({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "anon", exp: 1983812996 });
const SERVICE_JWT = jwt({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "service_role", exp: 1983812996 });
const base = { TOPH_FARM_ID: FARM_ID, SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123" };

describe("live-update browser configuration", () => {
  it("is disabled, without an error, until both public Supabase values are configured", () => {
    expect(readRealtimeConfig({ TOPH_FARM_ID: FARM_ID })).toEqual({ enabled: false, problem: null });
    expect(readRealtimeConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: "" })).toEqual({ enabled: false, problem: null });
    expect(readRealtimeConfig({ ...base, SUPABASE_URL: " " })).toEqual({ enabled: false, problem: null });
  });

  it("serves the project URL, publishable key, farm topic, and event", () => {
    expect(readRealtimeConfig({ ...base, SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/" })).toEqual({
      enabled: true, url: "https://abcdefghijklmnopqrst.supabase.co", key: "sb_publishable_abc123", topic: `toph:farm:${FARM_ID}`, event: "change",
    });
    expect(liveUpdatesTopic(FARM_ID.toUpperCase())).toBe(`toph:farm:${FARM_ID}`);
  });

  it("accepts a legacy anon key, under either variable name", () => {
    expect(readRealtimeConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: ANON_JWT })).toMatchObject({ enabled: true, key: ANON_JWT });
    expect(readRealtimeConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_ANON_KEY: ANON_JWT })).toMatchObject({ enabled: true, key: ANON_JWT });
  });

  it("never hands a privileged or unrecognized key to the browser", () => {
    for (const key of [SERVICE_JWT, "sb_secret_abc123", jwt({ role: "authenticated" }), "not-a-key", "a.b.c", "postgresql://user:pass@host/db"]) {
      const result = readRealtimeConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: key });
      expect(result.enabled).toBe(false);
      expect(result).toMatchObject({ problem: expect.stringMatching(/publishable|anon/) });
      expect(JSON.stringify(result)).not.toContain(key);
    }
  });

  it("requires an https project origin, allowing http only for a local Supabase stack", () => {
    expect(readRealtimeConfig({ ...base, SUPABASE_URL: "http://127.0.0.1:54321" })).toMatchObject({ enabled: true, url: "http://127.0.0.1:54321" });
    expect(readRealtimeConfig({ ...base, SUPABASE_URL: "http://localhost:54321" })).toMatchObject({ enabled: true });
    for (const url of ["http://abcdefghijklmnopqrst.supabase.co", "https://user:pass@x.supabase.co", "https://x.supabase.co/rest/v1", "https://x.supabase.co?apikey=1", "ftp://x.supabase.co", "x.supabase.co"]) {
      expect(readRealtimeConfig({ ...base, SUPABASE_URL: url })).toMatchObject({ enabled: false, problem: expect.stringMatching(/SUPABASE_URL/) });
    }
  });

  it("stays disabled when the farm is not configured", () => {
    expect(readRealtimeConfig({ ...base, TOPH_FARM_ID: undefined })).toMatchObject({ enabled: false, problem: expect.stringMatching(/TOPH_FARM_ID/) });
    expect(readRealtimeConfig({ ...base, TOPH_FARM_ID: "farm-1" })).toMatchObject({ enabled: false });
  });
});
