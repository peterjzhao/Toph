import { expect, test, vi } from "vitest";

vi.mock("@/server/db/client", () => { throw new Error("Disabled mobile route must not load a database client."); });
import { POST } from "@/app/api/mobile/v1/logs/route";

test("mobile submission stays disabled without touching authentication, storage, or the database", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
  try {
    const response = await POST();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "MOBILE_SYNC_DISABLED" } });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
