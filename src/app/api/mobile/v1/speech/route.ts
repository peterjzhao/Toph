import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { transcriptionKey } from "@/server/recordings/process";
import { speakText } from "@/server/recordings/speech";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Spoken audio for one voice-mode prompt. The OpenAI key never leaves the server. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    const audio = await speakText(request, ctx.farmId, transcriptionKey());
    return new Response(audio, { headers: { "Cache-Control": "no-store", "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength) } });
  });
}
