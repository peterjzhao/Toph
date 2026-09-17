/**
 * Live-update contract between the Toph backend and open dashboards.
 *
 * Plain, JSON-serializable types only; safe to import from browser code. The signal is
 * deliberately content-free: it names which existing API to read again and never carries
 * rows, identifiers, names, or anything about recordings.
 */

/** `dashboard` → re-read GET /api/dashboard; `workspace` → re-read GET /api/workspace. */
export const LIVE_UPDATE_KINDS = ["dashboard", "workspace"] as const;
export type LiveUpdateKind = (typeof LIVE_UPDATE_KINDS)[number];

/** Broadcast event name used on the farm's private Supabase Realtime channel. */
export const LIVE_UPDATE_EVENT = "change" as const;

/** Payload written by toph.notify_farm_change(); Realtime adds its own message `id`. */
export type LiveUpdateSignal = { v: 1; kind: LiveUpdateKind };

export type RealtimeConfig =
  | { enabled: false }
  | {
      enabled: true;
      /** Supabase project origin, e.g. https://<project-ref>.supabase.co. Public. */
      url: string;
      /** Publishable (or legacy anon) key. Public by design; it can only receive signals. */
      key: string;
      /** Private channel topic for the farm this deployment serves. */
      topic: string;
      event: typeof LIVE_UPDATE_EVENT;
    };

/** GET /api/realtime */
export type RealtimeConfigResponse = { data: RealtimeConfig };
