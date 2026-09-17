import "server-only";
import { z } from "zod";
import type { TranscriptionResult } from "@/contracts/transcription";
import type { FarmContext } from "@/server/farm-context";
import { getMobileBootstrap } from "@/server/mobile/accounts";
import { isValidCalendarDate } from "@/server/time/zoned";
import { readJsonBody } from "@/server/http/body";
import { readAudioUpload, transcribeAudio, TranscriptionError } from "./audio";
import { extractLogFields } from "./extraction";
import { reserveTranscription } from "./quota";

const contextSchema = z.object({
  accountId: z.string().uuid(), referenceDate: z.string().refine(isValidCalendarDate),
  previousTranscript: z.string().max(32_000).optional(),
}).strict();
const retrySchema = z.object({ context: contextSchema, transcript: z.string().trim().min(1).max(40_000) }).strict();

export function transcriptionKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (process.env.TOPH_TRANSCRIPTION_ENABLED !== "true" || !key) {
    throw new TranscriptionError(503, "NOT_CONFIGURED", "Transcription is not enabled on this server. Your recording can still be saved.");
  }
  return key;
}

/** Speech and extraction are ephemeral. Only the separate Save log action persists a work log. */
export async function processRecording(request: Request, ctx: FarmContext, key: string): Promise<TranscriptionResult> {
  let file: File | null = null;
  let transcript = "";
  let context: z.infer<typeof contextSchema>;
  try {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const parsed = retrySchema.parse(await readJsonBody(request, 80_000));
      context = parsed.context; transcript = parsed.transcript;
    } else {
      const upload = await readAudioUpload(request);
      file = upload.file; context = contextSchema.parse(upload.context);
    }
  } catch (error) {
    if (error instanceof z.ZodError) throw new TranscriptionError(400, "INVALID_CONTEXT", "Check the account and recording date.");
    throw error;
  }
  const bootstrap = await getMobileBootstrap(ctx);
  if (!bootstrap.accounts.some(account => account.id === context.accountId)) throw new TranscriptionError(404, "ACCOUNT_UNAVAILABLE", "Choose an active account from this farm.");
  if (!bootstrap.fields.length) throw new TranscriptionError(503, "NOT_CONFIGURED", "Add a farm field before processing recordings.");
  await reserveTranscription(ctx);
  const text = file ? await transcribeAudio(file, key, request.signal) : transcript;
  if (file) transcript = [context.previousTranscript, text].filter(Boolean).join("\n\n");
  if (transcript.length > 40_000) throw new TranscriptionError(413, "PAYLOAD_TOO_LARGE", "Split this recording into shorter work logs.");
  try {
    const fields = await extractLogFields(transcript, { fields: bootstrap.fields, referenceDate: context.referenceDate, timezone: ctx.farm.timezone }, key, request.signal);
    const required = ["fieldId", "activity", "workDate", "startTime", "endTime"] as const;
    return { text, transcript, fields, missingFields: required.filter(field => fields[field] === null), extractionError: null };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return { text, transcript, fields: null, missingFields: [], extractionError: "Your transcript is ready, but details could not be filled. Retry or enter them yourself." };
  }
}
