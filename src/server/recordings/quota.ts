import "server-only";
import type { FarmContext } from "@/server/farm-context";
import { TranscriptionError } from "./audio";

/**
 * One atomic counter row per farm: works across Vercel instances, never stores audio/text.
 * Every paid AI request for the farm (recordings and log questions) shares this allowance.
 */
export async function reserveTranscription(ctx: FarmContext, limitMessage = "The farm's transcription limit has been reached. Keep the recording and try again later.") {
  const rows = await ctx.sql`
    insert into toph.transcription_usage (farm_id, minute_start, minute_count, day_start, day_count)
    values (${ctx.farmId}, date_trunc('minute', now()), 1, (now() at time zone 'UTC')::date, 1)
    on conflict (farm_id) do update set
      minute_start = excluded.minute_start,
      minute_count = case when transcription_usage.minute_start = excluded.minute_start then transcription_usage.minute_count + 1 else 1 end,
      day_start = excluded.day_start,
      day_count = case when transcription_usage.day_start = excluded.day_start then transcription_usage.day_count + 1 else 1 end
    where (transcription_usage.minute_start < excluded.minute_start or transcription_usage.minute_count < 12)
      and (transcription_usage.day_start < excluded.day_start or transcription_usage.day_count < 120)
    returning farm_id`;
  if (!rows.length) throw new TranscriptionError(429, "RATE_LIMITED", limitMessage);
}

const SPEECH_PER_MINUTE = 40;
const SPEECH_PER_DAY = 800;
const speechUsage = new Map<string, { minute: number; minuteCount: number; day: number; dayCount: number }>();

/**
 * Spoken prompts have their own bucket so a voice session (several prompts per log) cannot use up
 * the transcription allowance above. Counted in memory per server instance: the existing counter
 * table holds one row per farm, and a shared speech counter would need a migration. Prompts are
 * short and capped, so this bounds a runaway client rather than metering spend exactly.
 */
export function reserveSpeech(farmId: string, now = Date.now()) {
  const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
  const usage = speechUsage.get(farmId) ?? { minute, minuteCount: 0, day, dayCount: 0 };
  if (usage.minute !== minute) { usage.minute = minute; usage.minuteCount = 0; }
  if (usage.day !== day) { usage.day = day; usage.dayCount = 0; }
  if (usage.minuteCount >= SPEECH_PER_MINUTE || usage.dayCount >= SPEECH_PER_DAY) {
    throw new TranscriptionError(429, "RATE_LIMITED", "The farm's speech limit has been reached. Read the prompt on screen instead.");
  }
  usage.minuteCount += 1; usage.dayCount += 1;
  speechUsage.set(farmId, usage);
}

/** Same in-memory, per-instance counting as `reserveSpeech`, for the realtime voice routes. */
function memoryBucket(perMinute: number, perDay: number, message: string) {
  const usage = new Map<string, { minute: number; minuteCount: number; day: number; dayCount: number }>();
  return (farmId: string, now = Date.now()) => {
    const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
    const used = usage.get(farmId) ?? { minute, minuteCount: 0, day, dayCount: 0 };
    if (used.minute !== minute) { used.minute = minute; used.minuteCount = 0; }
    if (used.day !== day) { used.day = day; used.dayCount = 0; }
    if (used.minuteCount >= perMinute || used.dayCount >= perDay) throw new TranscriptionError(429, "RATE_LIMITED", message);
    used.minuteCount += 1; used.dayCount += 1;
    usage.set(farmId, used);
  };
}

/** A realtime call is billed for as long as it stays open, so starting one is the scarcest allowance. */
export const reserveVoiceSession = memoryBucket(6, 100, "The farm's voice session limit has been reached. Record the log instead.");
/** One strict extraction per spoken turn of a realtime call; kept apart from the 12 per minute recording allowance. */
export const reserveVoiceState = memoryBucket(30, 600, "The farm's voice check limit has been reached. Record the log instead.");
