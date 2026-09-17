import "server-only";
import { forbidden } from "@/server/errors";

/** Canonical origin (lowercase scheme/host, default port dropped) or null when not an http(s) origin. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Browser-origin check for writes: the request's Origin must match APP_ORIGIN (CSRF guard).
 * It is not a substitute for authentication.
 */
export function assertWriteOrigin(request: Request, appOrigin: string | null): void {
  const expected = normalizeOrigin(appOrigin);
  if (!expected) throw forbidden("Write requests are disabled: the application origin is not configured.");
  const actual = normalizeOrigin(request.headers.get("origin"));
  if (!actual || actual !== expected) {
    throw forbidden("Write requests must include an Origin header matching the application origin.");
  }
}
