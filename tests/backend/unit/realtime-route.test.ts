import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/realtime/route";

const KEYS = ["TOPH_FARM_ID", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "DATABASE_URL"] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const FARM_ID = "00000000-0000-4000-8000-000000000001";

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; }
}

describe("GET /api/realtime", () => {
  afterEach(() => { setEnv(original as Record<string, string>); vi.restoreAllMocks(); });

  it("answers disabled without touching the database when live updates are not configured", async () => {
    setEnv({ TOPH_FARM_ID: FARM_ID });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { enabled: false } });
  });

  it("returns only the public connection details for the configured farm", async () => {
    setEnv({ TOPH_FARM_ID: FARM_ID, SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123", DATABASE_URL: "postgresql://toph_app:secret@db.example/postgres" });
    const body = await (await GET()).json();
    expect(body).toEqual({ data: { enabled: true, url: "https://abcdefghijklmnopqrst.supabase.co", key: "sb_publishable_abc123", topic: `toph:farm:${FARM_ID}`, event: "change" } });
    expect(JSON.stringify(body)).not.toMatch(/secret|postgresql/);
  });

  it("refuses a privileged key: disabled for the browser, explained in the server log without the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({ TOPH_FARM_ID: FARM_ID, SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_leak" });
    expect(await (await GET()).json()).toEqual({ data: { enabled: false } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/publishable/);
    expect(String(log.mock.calls[0][0])).not.toContain("sb_secret_do_not_leak");
  });
});
