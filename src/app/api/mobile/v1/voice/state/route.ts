import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { transcriptionKey } from "@/server/recordings/process";
import { voiceState } from "@/server/recordings/realtime";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Strict extraction of the running transcript, for injection into the realtime call. Nothing is stored. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    return jsonResponse({ data: await voiceState(request, ctx, transcriptionKey()) });
  });
}
