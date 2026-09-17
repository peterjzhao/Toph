import { resolveAccountContext } from "@/server/accounts/service";
import { toApiError } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { TranscriptionError } from "@/server/recordings/audio";
import { checkVoiceRequest } from "@/server/recordings/realtime";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };

/** Validates a realtime tool call without a model. Saving is a separate request. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    return Response.json({ data: await checkVoiceRequest(request, ctx) }, { headers });
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : toApiError(cause);
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
}
