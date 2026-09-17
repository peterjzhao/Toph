import { checkRuntimeDatabase } from "@/server/db/client";
import { handleRoute, jsonResponse } from "@/server/http/responses";

export const dynamic = "force-dynamic";

/** GET /api/health: 200 only after a real database round trip; otherwise a sanitized 503. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await checkRuntimeDatabase();
    return jsonResponse({ data: { status: "ok", database: "connected" } });
  });
}
