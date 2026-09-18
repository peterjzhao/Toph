import type { NextRequest } from "next/server";
import { resolveAccountContext } from "@/server/accounts/service";
import { assertWebWrite } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { deleteReport, getReport } from "@/server/reports/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ reportId: string }> };

/** GET /api/reports/:reportId: one saved report with its frozen document. */
export async function GET(request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { reportId } = await params;
    return jsonResponse({ data: await getReport(await resolveAccountContext(request, "admin"), reportId) });
  });
}

/** DELETE /api/reports/:reportId */
export async function DELETE(request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    assertWebWrite(request);
    const { reportId } = await params;
    await deleteReport(await resolveAccountContext(request, "admin"), reportId);
    return jsonResponse({ data: { removed: true } });
  });
}
