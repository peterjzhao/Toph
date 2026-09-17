import type { NextRequest } from "next/server";
import { readRuntimeConfig, resolveFarmContext } from "@/server/farm-context";
import { assertWriteOrigin } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { removeLogTag } from "@/server/services/tags";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ logId: string; tagId: string }> };

/** DELETE /api/logs/:logId/tags/:tagId: removes the association only and returns the remaining tags. */
export async function DELETE(request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { logId, tagId } = await params;
    assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const ctx = await resolveFarmContext();
    return jsonResponse({ data: await removeLogTag(ctx, logId, tagId) });
  });
}
