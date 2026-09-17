import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveUpdateKind, RealtimeConfig } from "../../src/contracts/realtime";
import { startLiveUpdates, type LiveConnectionHandlers } from "../../src/lib/realtime/live-updates";

const ENABLED: RealtimeConfig = { enabled: true, url: "https://project.supabase.co", key: "sb_publishable_x", topic: "toph:farm:00000000-0000-4000-8000-000000000001", event: "change" };

function harness(options: { config?: () => Promise<RealtimeConfig>; visible?: boolean } = {}) {
  const reads: LiveUpdateKind[][] = [];
  const connections: Array<{ handlers: LiveConnectionHandlers; reconnects: number; closed: number }> = [];
  const warnings: string[] = [];
  const listeners = { visible: new Set<() => void>(), online: new Set<() => void>() };
  const state = { visible: options.visible ?? true };
  const live = startLiveUpdates({
    loadConfig: options.config ?? (async () => ENABLED),
    connect: async (_config, handlers) => {
      const connection = { handlers, reconnects: 0, closed: 0 };
      connections.push(connection);
      return { reconnect: () => { connection.reconnects += 1; }, close: () => { connection.closed += 1; } };
    },
    refresh: async (kinds) => { reads.push([...kinds].sort()); },
    environment: {
      isVisible: () => state.visible,
      onVisible: (listener) => { listeners.visible.add(listener); return () => listeners.visible.delete(listener); },
      onOnline: (listener) => { listeners.online.add(listener); return () => listeners.online.delete(listener); },
    },
    warn: (message) => warnings.push(message),
    debounceMs: 100, minIntervalMs: 1000, configRetryDelaysMs: [500, 500],
  });
  const show = () => { state.visible = true; listeners.visible.forEach((listener) => listener()); };
  const hide = () => { state.visible = false; };
  const online = () => listeners.online.forEach((listener) => listener());
  return { live, reads, connections, warnings, listeners, show, hide, online };
}
const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe("live updates lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not connect when the server reports live updates as disabled", async () => {
    const h = harness({ config: async () => ({ enabled: false }) });
    await flush(10_000);
    expect(h.connections).toHaveLength(0);
    expect(h.reads).toEqual([]);
    h.live.stop();
  });

  it("opens one subscription, catches up once subscribed, then reads only what a signal names", async () => {
    const h = harness();
    await flush();
    expect(h.connections).toHaveLength(1);
    expect(h.reads).toEqual([]); // nothing is read before the channel is live
    h.connections[0].handlers.onStatus("SUBSCRIBED");
    await flush(100);
    expect(h.reads).toEqual([["dashboard", "workspace"]]);
    h.connections[0].handlers.onSignal("dashboard");
    await flush(2_000);
    expect(h.reads).toEqual([["dashboard", "workspace"], ["dashboard"]]);
    h.connections[0].handlers.onSignal("workspace"); h.connections[0].handlers.onSignal("workspace");
    await flush(2_000);
    expect(h.reads.at(-1)).toEqual(["workspace"]);
    expect(h.connections).toHaveLength(1);
  });

  it("reads everything again after the channel drops and rejoins, to pick up missed changes", async () => {
    const h = harness();
    await flush();
    const { handlers } = h.connections[0];
    handlers.onStatus("SUBSCRIBED"); await flush(2_000);
    handlers.onStatus("CHANNEL_ERROR", new Error("socket closed")); handlers.onStatus("TIMED_OUT");
    await flush(30_000);
    expect(h.reads).toHaveLength(1); // errors alone read nothing; the client library retries the join
    expect(h.connections[0].closed).toBe(0);
    handlers.onStatus("SUBSCRIBED"); await flush(2_000);
    expect(h.reads).toEqual([["dashboard", "workspace"], ["dashboard", "workspace"]]);
  });

  it("stops for good when the project refuses the subscription", async () => {
    const h = harness();
    await flush();
    const { handlers } = h.connections[0];
    handlers.onStatus("CHANNEL_ERROR", new Error("Unauthorized: You do not have permissions to read from this Channel topic: toph:farm:…"));
    await flush();
    expect(h.connections[0].closed).toBe(1);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toMatch(/db:enable-realtime/);
    handlers.onStatus("CHANNEL_ERROR", new Error("Unauthorized")); handlers.onSignal("dashboard"); h.show(); h.online();
    await flush(60_000);
    expect(h.connections).toHaveLength(1);
    expect(h.connections[0].closed).toBe(1);
    expect(h.reads).toEqual([]);
  });

  it("defers reads in a background tab, then flushes and nudges the socket on return", async () => {
    const h = harness({ visible: false });
    await flush();
    const connection = h.connections[0];
    connection.handlers.onStatus("SUBSCRIBED"); connection.handlers.onSignal("dashboard");
    await flush(60_000);
    expect(h.reads).toEqual([]);
    h.show(); await flush();
    expect(h.reads).toEqual([["dashboard", "workspace"]]);
    expect(connection.reconnects).toBe(1);
    h.online();
    expect(connection.reconnects).toBe(2);
  });

  it("retries a failed configuration request, and gives up quietly after the last retry", async () => {
    let attempts = 0;
    const h = harness({ config: async () => { attempts += 1; if (attempts < 3) throw new Error("offline"); return ENABLED; } });
    await flush(); expect(h.connections).toHaveLength(0);
    await flush(500); await flush(500);
    expect(attempts).toBe(3);
    expect(h.connections).toHaveLength(1);

    let failures = 0;
    const never = harness({ config: async () => { failures += 1; throw new Error("offline"); } });
    await flush(60_000);
    expect(failures).toBe(3);
    expect(never.connections).toHaveLength(0);
  });

  it("cleans up: no connection after an early stop, one close after a late stop, no listeners left", async () => {
    const early = harness();
    early.live.stop();
    await flush(10_000);
    expect(early.connections).toHaveLength(0);

    const late = harness();
    await flush();
    late.connections[0].handlers.onStatus("SUBSCRIBED");
    late.live.stop(); late.live.stop();
    late.connections[0].handlers.onSignal("dashboard"); late.connections[0].handlers.onStatus("SUBSCRIBED");
    await flush(60_000);
    expect(late.connections[0].closed).toBe(1);
    expect(late.reads).toEqual([]);
    expect(late.listeners.visible.size + late.listeners.online.size).toBe(0);
  });

  it("closes a connection that finishes opening after stop", async () => {
    let finish: (() => void) | undefined;
    const closed: number[] = [];
    const live = startLiveUpdates({
      loadConfig: async () => ENABLED,
      connect: () => new Promise((resolve) => { finish = () => resolve({ reconnect: () => undefined, close: () => { closed.push(1); } }); }),
      refresh: async () => undefined,
      environment: { isVisible: () => true, onVisible: () => () => undefined, onOnline: () => () => undefined },
    });
    await flush();
    live.stop();
    finish?.(); await flush();
    expect(closed).toEqual([1]);
  });
});
