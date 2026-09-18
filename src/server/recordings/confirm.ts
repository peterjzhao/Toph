import "server-only";
import { z } from "zod";
import { classifyVoiceIntent, type VoiceConfirmResult } from "@/contracts/voice";
import { ApiError } from "@/server/errors";
import type { FarmContext } from "@/server/farm-context";
import { readJsonBodyAs } from "@/server/http/body";
import { readAudioUpload, transcribeAudio } from "./audio";
import { transcriptionKey } from "./process";
import { reserveTranscription } from "./quota";

const confirmSchema = z.object({ transcript: z.string().trim().max(2000), context: z.unknown().optional() }).strict();

/**
 * The worker's spoken reply to the read-back. Audio costs one transcription from the farm's
 * allowance; a transcript the phone already has is classified for free. Nothing is stored.
 */
export async function confirmVoice(request: Request, ctx: FarmContext, fetcher: typeof fetch = fetch): Promise<VoiceConfirmResult> {
  let transcript: string;
  if (request.headers.get("content-type")?.startsWith("application/json")) {
    ({ transcript } = await readJsonBodyAs(request, confirmSchema, () => new ApiError(400, "INVALID_TRANSCRIPT", "Send the spoken reply as a transcript."), 8000));
  } else {
    const { file } = await readAudioUpload(request);
    const key = transcriptionKey();
    await reserveTranscription(ctx);
    try { transcript = await transcribeAudio(file, key, request.signal, fetcher); }
    catch (error) {
      // Silence is an answer the phone can act on: ask again.
      if (error instanceof ApiError && error.code === "NO_SPEECH") return { transcript: "", intent: "unclear" };
      throw error;
    }
  }
  return { transcript, intent: classifyVoiceIntent(transcript) };
}
