import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { transcriptionKey } from "@/server/recordings/process";
import { createVoiceSession } from "@/server/recordings/realtime";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A short-lived OpenAI Realtime secret configured for this farm's log form. The API key never leaves the server. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    return jsonResponse({ data: await createVoiceSession(request, ctx, transcriptionKey()) });
  });
}
