/**
 * Keeps one realtime secret minted ahead of the tap, so starting a call is an SDP exchange rather
 * than a round trip through Toph and OpenAI first. Pure: the mint is supplied by the caller.
 *
 * A secret is billed allowance the moment it is minted (`reserveVoiceSession`), so the warmer holds
 * at most one and refreshes it only as it nears expiry — not on every render.
 */
import type { VoiceSession } from "@toph/contracts/voice";

export type SessionWarmer = {
  /** Mints a secret unless a usable one is already held or in flight. Safe to call repeatedly. */
  warm(): void;
  /** The session for a call that is starting now, or null when the caller must mint its own. */
  take(): Promise<VoiceSession> | null;
  /** Drops what is held; the secret simply expires unused. */
  clear(): void;
};
export type SessionWarmerDeps = {
  session(): Promise<VoiceSession>;
  now?(): number;
  /** How much life a secret must have left to be worth keeping, covering the SDP exchange after the tap. */
  leadMs?: number;
};

type Held = { pending: Promise<VoiceSession>; expiresAt: number | null };
export const warmLeadMs = 20_000;

export function createSessionWarmer({ session, now = Date.now, leadMs = warmLeadMs }: SessionWarmerDeps): SessionWarmer {
  let held: Held | null = null;
  // Still in flight: no expiry yet, and worth waiting for. An unparseable date is NaN, so never usable.
  const usable = (item: Held) => item.expiresAt === null || item.expiresAt - now() > leadMs;

  return {
    warm() {
      if (held && usable(held)) return;
      const item: Held = { pending: session(), expiresAt: null };
      item.pending = item.pending.then(
        result => { item.expiresAt = Date.parse(result.expiresAt); return result; },
        // A mint that failed must not poison the tap: drop it so the next warm retries.
        cause => { if (held === item) held = null; throw cause; },
      );
      item.pending.catch(() => undefined);
      held = item;
    },
    take() {
      const item = held;
      if (!item) return null;
      held = null;
      // A secret that went stale while the screen sat idle would be refused by OpenAI; mint fresh instead.
      return usable(item) ? item.pending : null;
    },
    clear() { held = null; },
  };
}
