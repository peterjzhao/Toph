import { afterEach, expect, test, vi } from "vitest";
import { requireMobileAccess } from "@/server/mobile/access";
import { GET } from "@/app/api/mobile/v1/accounts/route";
import { POST } from "@/app/api/mobile/v1/logs/route";
import { getRuntimeDatabase } from "@/server/db/client";
vi.mock(import("@/server/db/client"), async importOriginal => ({ ...await importOriginal(), getRuntimeDatabase: vi.fn(() => { throw new Error("No database allowed"); }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test("mobile API fails closed until explicitly enabled, before database or body work", async () => {
  vi.stubEnv("TOPH_MOBILE_ENABLED", "false");
  for (const response of [await GET(new Request("https://toph.example/api/mobile/v1/accounts")), await POST(new Request("https://toph.example/api/mobile/v1/logs", { method: "POST" }))]) {
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("NOT_CONFIGURED");
  }
  expect(getRuntimeDatabase).not.toHaveBeenCalled();
});
test("mobile writes require a deliberate client header and reject a foreign browser origin", () => {
  vi.stubEnv("TOPH_MOBILE_ENABLED", "true"); vi.stubEnv("APP_ORIGIN", "https://toph.example");
  expect(() => requireMobileAccess(new Request("https://toph.example"), true)).toThrow();
  expect(() => requireMobileAccess(new Request("https://toph.example", { headers: { "x-toph-client": "toph-mobile", origin: "https://elsewhere.example" } }), true)).toThrow();
  expect(() => requireMobileAccess(new Request("https://toph.example", { headers: { "x-toph-client": "toph-mobile" } }), true)).not.toThrow();
  expect(() => requireMobileAccess(new Request("https://toph.example", { headers: { "x-toph-client": "mobile-sample" } }), true)).toThrow();
});
test("the mobile API stays off without its setting", async () => {
  vi.stubEnv("TOPH_MOBILE_ENABLED", undefined);
  const response = await GET(new Request("https://toph.example/api/mobile/v1/accounts"));
  expect(response.status).toBe(503);
});
