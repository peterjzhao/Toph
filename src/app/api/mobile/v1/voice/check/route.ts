import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { checkVoiceRequest } from "@/server/recordings/realtime";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Validates a realtime tool call without a model. Saving is a separate request. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    return jsonResponse({ data: await checkVoiceRequest(request, ctx) });
  });
}
