import { resolveAccountContext } from "@/server/accounts/service";
import { toApiError } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { TranscriptionError } from "@/server/recordings/audio";
import { confirmVoice } from "@/server/recordings/confirm";

export const runtime = "nodejs";
export const maxDuration = 90;
const headers = { "Cache-Control": "no-store" };

/** Save, change, cancel or unclear, from the worker's spoken reply. Saving is a separate request. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    return Response.json({ data: await confirmVoice(request, ctx) }, { headers });
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : toApiError(cause);
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
}
