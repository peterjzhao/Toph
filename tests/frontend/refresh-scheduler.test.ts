import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveUpdateKind } from "../../src/contracts/realtime";
import { createRefreshScheduler } from "../../src/lib/realtime/refresh-scheduler";

type Call = { kinds: LiveUpdateKind[]; resolve: () => void; reject: (error: Error) => void };

function harness(options: { active?: () => boolean } = {}) {
  const calls: Call[] = [];
  const scheduler = createRefreshScheduler({
    refresh: (kinds) => new Promise<void>((resolve, reject) => { calls.push({ kinds: [...kinds].sort(), resolve, reject }); }),
    isActive: options.active,
    debounceMs: 250, minIntervalMs: 2000, retryDelaysMs: [1000, 5000],
  });
  return { calls, scheduler };
}
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("live refresh scheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("coalesces a burst of signals into one read per API", async () => {
    const { calls, scheduler } = harness();
    scheduler.request(["dashboard"]); scheduler.request(["dashboard"]); scheduler.request(["workspace"]); scheduler.request(["dashboard"]);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.map((call) => call.kinds)).toEqual([["dashboard", "workspace"]]);
  });

  it("never overlaps reads: signals during a read produce exactly one follow-up", async () => {
    const { calls, scheduler } = harness();
    scheduler.request(["dashboard"]);
    await vi.advanceTimersByTimeAsync(250);
    scheduler.request(["dashboard"]); scheduler.request(["dashboard"]); scheduler.request(["workspace"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1); // still in flight
    calls[0].resolve(); await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.map((call) => call.kinds)).toEqual([["dashboard"], ["dashboard", "workspace"]]);
  });

  it("bounds the read rate under a continuous stream of signals", async () => {
    const { calls, scheduler } = harness();
    for (let elapsed = 0; elapsed < 10_000; elapsed += 100) {
      scheduler.request(["dashboard"]);
      await vi.advanceTimersByTimeAsync(100);
      calls.at(-1)?.resolve(); await settle();
    }
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.length).toBeLessThanOrEqual(6); // one immediately, then at most one per 2 s
  });

  it("retries a failed read with backoff, then waits for the next signal", async () => {
    const { calls, scheduler } = harness();
    scheduler.request(["workspace"]);
    await vi.advanceTimersByTimeAsync(250);
    calls[0].reject(new Error("offline")); await settle();
    await vi.advanceTimersByTimeAsync(999); expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_001); expect(calls).toHaveLength(2); // min interval also applies
    calls[1].reject(new Error("offline")); await settle();
    await vi.advanceTimersByTimeAsync(5_000); expect(calls).toHaveLength(3);
    calls[2].reject(new Error("offline")); await settle();
    await vi.advanceTimersByTimeAsync(60_000); expect(calls).toHaveLength(3); // retries exhausted

    scheduler.request(["dashboard"]); // the next signal carries the unfinished kind with it
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls[3].kinds).toEqual(["dashboard", "workspace"]);
    calls[3].resolve(); await settle();
    scheduler.request(["dashboard"]);
    await vi.advanceTimersByTimeAsync(2_000);
    calls[4].reject(new Error("offline")); await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(6); // a success reset the backoff
  });

  it("holds reads while the tab is in the background and flushes once on return", async () => {
    let visible = false;
    const { calls, scheduler } = harness({ active: () => visible });
    scheduler.request(["dashboard"]); scheduler.request(["workspace"]); scheduler.request(["dashboard"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(0);
    visible = true; scheduler.resume();
    await settle();
    expect(calls.map((call) => call.kinds)).toEqual([["dashboard", "workspace"]]);
    calls[0].resolve(); await settle();
    scheduler.resume(); // nothing pending: returning to the tab alone reads nothing
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it("does nothing after dispose, including for a read that finishes late", async () => {
    const { calls, scheduler } = harness();
    scheduler.request(["dashboard"]);
    await vi.advanceTimersByTimeAsync(250);
    scheduler.request(["workspace"]);
    scheduler.dispose();
    calls[0].reject(new Error("late")); await settle();
    scheduler.request(["dashboard"]); scheduler.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });
});
