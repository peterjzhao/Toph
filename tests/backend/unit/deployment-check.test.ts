import { describe, expect, it, vi } from "vitest";
import { checkMobileServer } from "../../../scripts/check-mobile-server.mjs";

function checker(overrides: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/health") return Response.json({ data: { database: "connected" } });
    const auth = new Headers(init?.headers).get("authorization");
    if (!auth) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    const defaults: Record<string, unknown> = {
      "/api/auth/session": { account: { role: "worker", employeeId: "worker" }, farm: { id: "farm" } },
      "/api/mobile/v1/accounts": { farm: { id: "farm" }, accounts: [{ id: "worker" }], fields: [] },
      "/api/mobile/v1/logs": [],
      "/api/mobile/v1/messages": { revision: 1, messages: [{ employeeId: "worker" }] },
    };
    return Response.json({ data: path in overrides ? overrides[path] : defaults[path] });
  });
  return { fetcher, log: vi.fn() };
}
describe("deployment readiness checker", () => {
  it("accepts protected routes without pretending an anonymous check verified delivery", async () => {
    const check = checker(); await checkMobileServer(check);
    expect(check.log).toHaveBeenLastCalledWith(expect.stringContaining("No send/read mutations"));
    expect(check.fetcher).toHaveBeenCalledTimes(5);
    for (const [, init] of check.fetcher.mock.calls) expect(init?.method).toBeUndefined();
  });
  it("checks authenticated inbox scope and permits a new farm with no fields or logs", async () => {
    const check = checker(); await checkMobileServer({ ...check, token: "private-token" });
    expect(check.log).toHaveBeenLastCalledWith(expect.stringContaining("Private worker bootstrap, logs, and inbox load"));
    expect(JSON.stringify(check.log.mock.calls)).not.toContain("private-token");
  });
  it("rejects a deployment that still exposes anonymous worker data", async () => {
    await expect(checkMobileServer({ log: vi.fn(), fetcher: async () => Response.json({ data: { database: "connected" } }) })).rejects.toThrow("expected HTTP 401, received 200");
  });
  it("rejects inboxes containing another worker's messages", async () => {
    await expect(checkMobileServer({ ...checker({ "/api/mobile/v1/messages": { revision: 1, messages: [{ employeeId: "someone-else" }] } }), token: "private-token" })).rejects.toThrow("Inbox does not match");
  });
  it("refuses remote plaintext or credential-bearing targets before sending a token", async () => {
    for (const server of ["http://toph.example", "https://user:secret@toph.example", "https://toph.example/?token=secret"]) {
      const check = checker(); await expect(checkMobileServer({ ...check, server, token: "private-token" })).rejects.toThrow("server origin");
      expect(check.fetcher).not.toHaveBeenCalled();
    }
  });
});
