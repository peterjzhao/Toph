import "server-only";
/**
 * Reuses a farm's pass list between page loads on a warm server.
 *
 * Sweeping the Sentinel-2 archive takes seconds, and its answer only changes when a new pass lands
 * every few days, so one sweep serves every request for the same key until it expires. Concurrent
 * requests share the sweep in flight, and a failed sweep is forgotten so the next request retries
 * instead of replaying the failure.
 */
import type { Acquisition } from "./catalog";

export const PASS_CACHE_MS = 30 * 60_000;
const MAX_ENTRIES = 100;

type Entry = { expiresAt: number; passes: Promise<Acquisition[]> };

export function createPassCache(ttlMs = PASS_CACHE_MS, maxEntries = MAX_ENTRIES) {
  const entries = new Map<string, Entry>();
  return {
    get(key: string, load: () => Promise<Acquisition[]>, now = Date.now()): Promise<Acquisition[]> {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now) return cached.passes;
      entries.delete(key);
      // Oldest first: a Map iterates in insertion order.
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      const passes = load();
      entries.set(key, { expiresAt: now + ttlMs, passes });
      passes.catch(() => {
        if (entries.get(key)?.passes === passes) entries.delete(key);
      });
      return passes;
    },
  };
}
