import "server-only";
import { forbidden, notConfigured } from "@/server/errors";

/** Explicit opt-in for the interview's shared profiles. This header is NOT authentication. */
export function requireMobileDemo(request: Request, write = false) {
  if (process.env.TOPH_MOBILE_DEMO_ENABLED !== "true") throw notConfigured("Mobile demo connection is not enabled on this server.");
  if (write) {
    if (request.headers.get("x-toph-client") !== "mobile-demo") throw forbidden("Use the Toph mobile demo client.");
    const origin = request.headers.get("origin");
    if (origin && origin !== process.env.APP_ORIGIN) throw forbidden("This origin is not allowed.");
  }
}
