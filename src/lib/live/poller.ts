/** How often an open dashboard reads its logs and team again. */
export const LIVE_POLL_MS = 2_000;

export type PollerOptions = {
  intervalMs: number;
  read: () => Promise<void>;
  /** Hidden tabs skip reads; returning to the tab reads immediately. */
  isVisible: () => boolean;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

/**
 * Reads on a fixed interval without ever overlapping: a tick that arrives while a read is
 * still running is skipped rather than queued. Call `poke` to read now (focus, reconnect).
 */
export function startPoller(options: PollerOptions): { poke: () => void; stop: () => void } {
  const schedule = options.setInterval ?? ((callback, ms) => globalThis.setInterval(callback, ms));
  const cancel = options.clearInterval ?? (handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  let stopped = false;
  let reading = false;
  async function tick() {
    if (stopped || reading || !options.isVisible()) return;
    reading = true;
    try { await options.read(); } catch { /* The next tick retries. */ } finally { reading = false; }
  }
  const handle = schedule(() => void tick(), options.intervalMs);
  void tick();
  return { poke: () => void tick(), stop: () => { stopped = true; cancel(handle); } };
}
