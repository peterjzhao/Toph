import { LIVE_UPDATE_KINDS, type LiveUpdateKind, type RealtimeConfig } from "../../contracts/realtime";
import { createRefreshScheduler } from "./refresh-scheduler";

/**
 * Lifecycle of a dashboard's live-update subscription, independent of React and of the
 * Supabase client (see supabase-channel.ts for that adapter).
 *
 * A signal never carries data: it only asks for a fresh read through the existing APIs.
 * Every successful (re)join also reads everything once, which is how changes missed while
 * the channel was down, or before it first joined, are picked up.
 */
export type EnabledRealtimeConfig = Extract<RealtimeConfig, { enabled: true }>;
export type LiveChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
export type LiveConnectionHandlers = {
  onSignal(kind: LiveUpdateKind): void;
  onStatus(status: LiveChannelStatus, error?: Error): void;
};
export type LiveConnection = {
  /** Reconnects now if the socket is down, instead of waiting for a (possibly throttled) timer. */
  reconnect(): void;
  close(): void | Promise<unknown>;
};
export type LiveEnvironment = {
  isVisible(): boolean;
  onVisible(listener: () => void): () => void;
  onOnline(listener: () => void): () => void;
};

export type LiveUpdatesOptions = {
  loadConfig(): Promise<RealtimeConfig>;
  connect(config: EnabledRealtimeConfig, handlers: LiveConnectionHandlers): Promise<LiveConnection>;
  /** Re-reads the APIs for these kinds without disturbing the page. Reject to be retried. */
  refresh(kinds: ReadonlySet<LiveUpdateKind>): Promise<void>;
  environment?: LiveEnvironment;
  warn?(message: string): void;
  debounceMs?: number;
  minIntervalMs?: number;
  configRetryDelaysMs?: readonly number[];
};

const browserEnvironment: LiveEnvironment = {
  isVisible: () => document.visibilityState !== "hidden",
  onVisible(listener) {
    const handler = () => { if (document.visibilityState !== "hidden") listener(); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
  onOnline(listener) {
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  },
};

// Retrying cannot fix a refused join; the project still needs `npm run db:enable-realtime`.
const isRefused = (error?: Error) => /unauthori[sz]ed|permission/i.test(error?.message ?? "");

export function startLiveUpdates(options: LiveUpdatesOptions): { stop(): void } {
  const environment = options.environment ?? browserEnvironment;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const scheduler = createRefreshScheduler({ refresh: options.refresh, isActive: environment.isVisible, debounceMs: options.debounceMs, minIntervalMs: options.minIntervalMs });
  let stopped = false;
  let connection: LiveConnection | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = [
    environment.onVisible(() => { scheduler.resume(); connection?.reconnect(); }),
    environment.onOnline(() => connection?.reconnect()),
  ];

  function stop() {
    if (stopped) return;
    stopped = true;
    scheduler.dispose();
    if (retryTimer !== null) clearTimeout(retryTimer);
    for (const remove of unsubscribe) remove();
    const open = connection;
    connection = null;
    if (open) void Promise.resolve(open.close()).catch(() => undefined);
  }

  const handlers: LiveConnectionHandlers = {
    onSignal(kind) { if (!stopped) scheduler.request([kind]); },
    onStatus(status, error) {
      if (stopped) return;
      if (status === "SUBSCRIBED") scheduler.request(LIVE_UPDATE_KINDS);
      else if (status === "CHANNEL_ERROR" && isRefused(error)) {
        warn("Live updates are off: the Supabase project refused this dashboard's subscription. Run `npm run db:enable-realtime` against the project database (docs/backend/realtime.md).");
        stop();
      }
      // Other errors and timeouts: the client library rejoins with backoff, then reports SUBSCRIBED.
    },
  };

  async function open(attempt: number) {
    try {
      const config = await options.loadConfig();
      if (stopped || !config.enabled) return;
      const opened = await options.connect(config, handlers);
      if (stopped) void Promise.resolve(opened.close()).catch(() => undefined);
      else connection = opened;
    } catch {
      const delay = (options.configRetryDelaysMs ?? [2_000, 10_000, 60_000])[attempt];
      if (stopped || delay === undefined) return;
      retryTimer = setTimeout(() => { retryTimer = null; void open(attempt + 1); }, delay);
    }
  }
  void open(0);

  return { stop };
}
