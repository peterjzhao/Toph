import { resolveAccountContext } from "@/server/accounts/service";
import { toApiError } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { TranscriptionError } from "@/server/recordings/audio";
import { transcriptionKey } from "@/server/recordings/process";
import { speakText } from "@/server/recordings/speech";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

/** Spoken audio for one voice-mode prompt. The OpenAI key never leaves the server. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    const audio = await speakText(request, ctx.farmId, transcriptionKey());
    return new Response(audio, { headers: { ...headers, "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength) } });
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : toApiError(cause);
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
}
