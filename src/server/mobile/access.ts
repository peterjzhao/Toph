import "server-only";
import { forbidden, notConfigured } from "@/server/errors";

/** Shared-farm access, not user authentication. */
export function mobileEnabled() {
  return process.env.TOPH_MOBILE_ENABLED === "true";
}
export function requireMobileAccess(request: Request, write = false) {
  if (!mobileEnabled()) throw notConfigured("The mobile connection is not enabled on this server.");
  if (write) {
    if (request.headers.get("x-toph-client") !== "toph-mobile") throw forbidden("Use the Toph mobile client.");
    const origin = request.headers.get("origin");
    if (origin && origin !== process.env.APP_ORIGIN) throw forbidden("This origin is not allowed.");
  }
}
