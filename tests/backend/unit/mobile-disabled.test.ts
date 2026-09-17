import { afterEach, expect, test, vi } from "vitest";
import { POST } from "@/app/api/mobile/v1/logs/route";
import { resolveFarmContext } from "@/server/farm-context";
vi.mock("@/server/farm-context", () => ({ resolveFarmContext: vi.fn(() => { throw new Error("No database allowed"); }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test("mobile requests fail before database or body work when the mobile feature is disabled", async () => {
  vi.stubEnv("TOPH_MOBILE_ENABLED", "false");
  const response = await POST(new Request("https://toph.example/api/mobile/v1/logs", { method: "POST" }));
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("NOT_CONFIGURED");
  expect(resolveFarmContext).not.toHaveBeenCalled();
});
