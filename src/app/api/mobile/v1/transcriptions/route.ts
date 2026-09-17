import { resolveAccountContext } from "@/server/accounts/service";
import { toApiError } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { TranscriptionError } from "@/server/recordings/audio";
import { processRecording, transcriptionKey } from "@/server/recordings/process";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

/** Speech plus validated form fields. Saving a log is a separate request. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    const key = transcriptionKey();
    return Response.json({ data: await processRecording(request, ctx, key) }, { headers });
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : toApiError(cause);
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
}
