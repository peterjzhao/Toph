import "server-only";
/**
 * Browser configuration for live updates (Supabase Realtime). Read from server environment at
 * request time, so no NEXT_PUBLIC_ build-time variable is needed and the server decides which
 * farm topic a dashboard may listen to.
 *
 * Only values that are public by design leave this module: the project origin and the
 * publishable/anon key. A secret or service_role key is refused, never forwarded.
 */
import { LIVE_UPDATE_EVENT, type RealtimeConfig } from "@/contracts/realtime";
import { isUuid } from "@/server/validation/ids";

export type RealtimeConfigResult = RealtimeConfig & { problem?: string | null };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The farm's private channel. Must match toph.notify_farm_change() in drizzle/0007. */
export function liveUpdatesTopic(farmId: string): string {
  return `toph:farm:${farmId.toLowerCase()}`;
}

function projectOrigin(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const local = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  return url.origin;
}

/** True for sb_publishable_… keys and for legacy JWT keys whose role claim is exactly `anon`. */
function isBrowserSafeKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && (claims as { role?: unknown }).role === "anon";
  } catch { return false; }
}

/**
 * `problem` is for server logs only and never contains the key. Unset values mean the feature
 * is simply off (`problem: null`); present-but-unusable values are reported.
 */
export function readRealtimeConfig(env: Record<string, string | undefined> = process.env): RealtimeConfigResult {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim()) ?? "";
  if (!rawUrl || !key) return { enabled: false, problem: null };

  const farmId = env.TOPH_FARM_ID?.trim();
  if (!farmId || !isUuid(farmId)) return { enabled: false, problem: "TOPH_FARM_ID must be configured before live updates can be enabled." };
  const url = projectOrigin(rawUrl);
  if (!url) return { enabled: false, problem: "SUPABASE_URL must be the project's https origin, such as https://<project-ref>.supabase.co." };
  if (!isBrowserSafeKey(key)) {
    return { enabled: false, problem: "SUPABASE_PUBLISHABLE_KEY must be the project's publishable (sb_publishable_…) or legacy anon key. Secret and service_role keys are never sent to a browser." };
  }
  return { enabled: true, url, key, topic: liveUpdatesTopic(farmId), event: LIVE_UPDATE_EVENT };
}
