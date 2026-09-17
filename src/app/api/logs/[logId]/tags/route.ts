import type { NextRequest } from "next/server";
import { readRuntimeConfig, resolveFarmContext } from "@/server/farm-context";
import { parseAddTagBody, readJsonBody } from "@/server/http/body";
import { assertWriteOrigin } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { addLogTag } from "@/server/services/tags";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ logId: string }> };

/** POST /api/logs/:logId/tags with `{ "label": "..." }`: assigns a tag and returns the committed tag list. */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { logId } = await params;
    assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const { label } = parseAddTagBody(await readJsonBody(request));
    const ctx = await resolveFarmContext();
    return jsonResponse({ data: await addLogTag(ctx, logId, label) });
  });
}
