import type { NextRequest } from "next/server";
import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { getDashboard } from "@/server/services/dashboard";
import { parseDashboardQuery } from "@/server/validation/dashboard-query";

export const dynamic = "force-dynamic";

/** GET /api/dashboard: page-shaped dashboard data for the server-resolved farm. */
export async function GET(request: NextRequest): Promise<Response> {
  return handleRoute(async () => {
    const query = parseDashboardQuery(request.nextUrl.searchParams);
    const ctx = await resolveFarmContext();
    return jsonResponse(await getDashboard(ctx, query));
  });
}
