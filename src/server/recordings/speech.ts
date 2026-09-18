import "server-only";
import { z } from "zod";
import { MAX_SPEECH_CHARS } from "@/contracts/voice";
import { ApiError } from "@/server/errors";
import { readJsonBodyAs } from "@/server/http/body";
import { reserveSpeech } from "./quota";

export const speechModel = "gpt-4o-mini-tts";
const VOICE = "sage";
const MAX_SPEECH_BYTES = 2_000_000;
const speechSchema = z.object({ text: z.string().trim().min(1).max(MAX_SPEECH_CHARS) }).strict();

/** MP3 bytes for one short prompt. The text is spoken as written and never stored. */
export async function synthesizeSpeech(text: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  const timeout = AbortSignal.timeout(30_000);
  try {
    const response = await fetcher("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, timeout]),
      body: JSON.stringify({ model: speechModel, voice: VOICE, input: text, response_format: "mp3",
        instructions: "Speak calmly and clearly at an even pace, like a helpful coworker. Read the text exactly as written." }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new ApiError(429, "RATE_LIMITED", "Speech is busy. Try again in a moment.");
      throw new ApiError(502, "SPEECH_FAILED", "The prompt could not be spoken. Read it on screen instead.");
    }
    const audio = await response.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > MAX_SPEECH_BYTES) throw new ApiError(502, "SPEECH_FAILED", "The prompt could not be spoken. Read it on screen instead.");
    return audio;
  } catch (cause) {
    if (signal.aborted) throw new ApiError(499, "CANCELLED", "Speech cancelled.");
    if (timeout.aborted) throw new ApiError(504, "TIMEOUT", "Speech timed out. Read the prompt on screen instead.");
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(502, "SPEECH_FAILED", "The speech service could not be reached. Read the prompt on screen instead.");
  }
}

/** Validates `{ text }`, charges the farm's speech bucket, and returns the audio. */
export async function speakText(request: Request, farmId: string, key: string, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  const { text } = await readJsonBodyAs(request, speechSchema, () => new ApiError(400, "INVALID_TEXT", `Send up to ${MAX_SPEECH_CHARS} characters of text to speak.`), 4096);
  reserveSpeech(farmId);
  return synthesizeSpeech(text, key, request.signal, fetcher);
}
