import type { NextRequest } from "next/server";
import { assertAccountWrite, resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { getLog } from "@/server/services/dashboard";
import { updateLogDetails } from "@/server/services/log-details";
import { readJsonBody } from "@/server/http/body";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ logId: string }> };

/** GET /api/logs/:logId: one log (same ID and shape as the dashboard row). */
export async function GET(request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { logId } = await params;
    const ctx = await resolveAccountContext(request, "admin");
    return jsonResponse({ data: await getLog(ctx, logId) });
  });
}

/** PATCH /api/logs/:logId: an admin corrects the log's structured details. */
export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    assertAccountWrite(request);
    const { logId } = await params;
    const ctx = await resolveAccountContext(request, "admin");
    return jsonResponse({ data: await updateLogDetails(ctx, logId, await readJsonBody(request, 32_000)) });
  });
}
