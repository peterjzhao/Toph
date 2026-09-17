import type { NextRequest } from "next/server";
import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { getLog } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ logId: string }> };

/** GET /api/logs/:logId: one log (same ID and shape as the dashboard row). */
export async function GET(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { logId } = await params;
    const ctx = await resolveFarmContext();
    return jsonResponse({ data: await getLog(ctx, logId) });
  });
}
