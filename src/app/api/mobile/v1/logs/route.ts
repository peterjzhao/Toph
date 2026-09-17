import type { ApiErrorResponse } from "@/contracts/dashboard";

export const runtime = "nodejs";

/**
 * Deliberate disabled boundary. No body parsing, auth provider, storage, or DB imports.
 * Enabling requires authenticated farm/employee scope, upload validation, and an
 * idempotent persistence transaction. See docs/deployment.md for the production boundary.
 */
export async function POST(): Promise<Response> {
  return Response.json({
    error: { code: "MOBILE_SYNC_DISABLED", message: "Mobile log submission is not connected yet. Keep the draft on your device." },
  } satisfies ApiErrorResponse, { status: 503, headers: { "Cache-Control": "no-store" } });
}
