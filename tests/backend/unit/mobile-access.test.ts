import { afterEach, expect, test, vi } from "vitest";
import { requireMobileAccess } from "@/server/mobile/access";
import { GET } from "@/app/api/mobile/v1/accounts/route";
afterEach(() => vi.unstubAllEnvs());
test("mobile API fails closed until explicitly enabled", async () => {
  vi.stubEnv("TOPH_MOBILE_ENABLED", "false");
  const response = await GET(new Request("https://toph.example/api/mobile/v1/accounts"));
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("NOT_CONFIGURED");
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
