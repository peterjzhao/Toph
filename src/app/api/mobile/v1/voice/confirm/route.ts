import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { confirmVoice } from "@/server/recordings/confirm";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Save, change, cancel or unclear, from the worker's spoken reply. Saving is a separate request. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    return jsonResponse({ data: await confirmVoice(request, ctx) });
  });
}
