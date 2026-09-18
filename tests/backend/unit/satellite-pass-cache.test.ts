import { describe, expect, it, vi } from "vitest";
import type { Acquisition } from "@/server/satellite/catalog";
import { createPassCache } from "@/server/satellite/pass-cache";

const passes: Acquisition[] = [{ date: "2026-09-12", cloudCover: 3 }];

describe("createPassCache", () => {
  it("serves one sweep to every request until it expires", async () => {
    const cache = createPassCache(1_000);
    const load = vi.fn(async () => passes);

    await cache.get("farm", load, 0);
    await cache.get("farm", load, 999);
    expect(load).toHaveBeenCalledTimes(1);

    await cache.get("farm", load, 1_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares a sweep that is still in flight", async () => {
    const cache = createPassCache();
    let finish!: (value: Acquisition[]) => void;
    const load = vi.fn(() => new Promise<Acquisition[]>(resolve => { finish = resolve; }));

    const first = cache.get("farm", load, 0);
    const second = cache.get("farm", load, 0);
    finish(passes);
    expect(await first).toBe(await second);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed sweep so the next request retries", async () => {
    const cache = createPassCache();
    await expect(cache.get("farm", async () => { throw new Error("catalogue down"); }, 0)).rejects.toThrow("catalogue down");
    await expect(cache.get("farm", async () => passes, 0)).resolves.toBe(passes);
  });

  it("keeps separate farms apart and drops the oldest entry when full", async () => {
    const cache = createPassCache(60_000, 2);
    const load = vi.fn(async () => passes);

    await cache.get("a", load, 0);
    await cache.get("b", load, 0);
    await cache.get("c", load, 0);
    await cache.get("b", load, 0);
    expect(load).toHaveBeenCalledTimes(3);

    await cache.get("a", load, 0);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
