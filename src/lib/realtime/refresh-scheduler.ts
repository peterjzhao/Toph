import type { LiveUpdateKind } from "../../contracts/realtime";

/**
 * Turns live-update signals into a bounded number of API reads.
 *
 * Signals are coalesced per kind, reads never overlap (signals arriving during a read produce
 * one follow-up), a continuous stream is limited to one read per `minIntervalMs`, failed reads
 * retry with backoff, and nothing is read while the tab is in the background.
 */
export type RefreshSchedulerOptions = {
  /** Re-reads the APIs for these kinds. Reject to have the same kinds retried. */
  refresh: (kinds: ReadonlySet<LiveUpdateKind>) => Promise<void>;
  /** Reads wait while this returns false; call `resume()` when it may have become true. */
  isActive?: () => boolean;
  debounceMs?: number;
  minIntervalMs?: number;
  retryDelaysMs?: readonly number[];
};

export type RefreshScheduler = {
  request(kinds: Iterable<LiveUpdateKind>): void;
  /** Flushes pending kinds after the tab returns to the foreground. Reads nothing otherwise. */
  resume(): void;
  dispose(): void;
};

export function createRefreshScheduler(options: RefreshSchedulerOptions): RefreshScheduler {
  const { refresh, isActive = () => true, debounceMs = 250, minIntervalMs = 2_000, retryDelaysMs = [2_000, 10_000, 30_000] } = options;
  const pending = new Set<LiveUpdateKind>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let failures = 0;

  function schedule(delayMs: number) {
    if (disposed || running || timer !== null || pending.size === 0 || !isActive()) return;
    const wait = Math.max(delayMs, lastStartedAt + minIntervalMs - Date.now(), 0);
    timer = setTimeout(() => { timer = null; void run(); }, wait);
  }

  async function run() {
    if (disposed || running || pending.size === 0 || !isActive()) return;
    const kinds = new Set(pending);
    pending.clear();
    running = true;
    lastStartedAt = Date.now();
    let retryDelay: number | undefined = debounceMs;
    try {
      await refresh(kinds);
      failures = 0;
    } catch {
      // Keep the kinds: they ride along with the retry, the next signal, or the next resume.
      for (const kind of kinds) pending.add(kind);
      retryDelay = retryDelaysMs[failures];
      failures += 1;
    } finally {
      running = false;
    }
    if (retryDelay !== undefined) schedule(retryDelay);
  }

  return {
    request(kinds) {
      if (disposed) return;
      for (const kind of kinds) pending.add(kind);
      schedule(debounceMs);
    },
    resume() { schedule(0); },
    dispose() {
      disposed = true;
      pending.clear();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
