import { describe, expect, it, vi } from "vitest";
import { startPoller } from "../../src/lib/live/poller";

function harness(read: () => Promise<void>, visible = { value: true }) {
  let tick: () => void = () => undefined;
  const clear = vi.fn();
  const poller = startPoller({ intervalMs: 2_000, read, isVisible: () => visible.value, setInterval: (callback, ms) => { expect(ms).toBe(2_000); tick = callback; return 7; }, clearInterval: clear });
  return { poller, tick: () => tick(), clear };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("live polling", () => {
  it("reads immediately and on every tick", async () => {
    const read = vi.fn(async () => undefined);
    const { tick } = harness(read);
    await flush(); tick(); await flush(); tick(); await flush();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("never overlaps a read that is still running", async () => {
    let finish: () => void = () => undefined;
    const read = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { tick, poller } = harness(read);
    tick(); tick(); poller.poke();
    expect(read).toHaveBeenCalledTimes(1);
    finish(); await flush(); tick();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("skips hidden tabs and keeps going after a failed read", async () => {
    const visible = { value: false };
    const read = vi.fn(async () => { throw new Error("offline"); });
    const { tick, poller } = harness(read, visible);
    tick(); expect(read).not.toHaveBeenCalled();
    visible.value = true; poller.poke(); await flush(); tick(); await flush();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops reading once stopped", async () => {
    const read = vi.fn(async () => undefined);
    const { tick, poller, clear } = harness(read);
    await flush(); poller.stop(); tick(); poller.poke();
    expect(read).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(7);
  });
});
