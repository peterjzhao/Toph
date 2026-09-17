import "server-only";
import type { FarmContext } from "@/server/farm-context";
import { TranscriptionError } from "./audio";

/** One atomic counter row per farm: works across Vercel instances, never stores audio/text. */
export async function reserveTranscription(ctx: FarmContext) {
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
  if (!rows.length) throw new TranscriptionError(429, "RATE_LIMITED", "The farm's transcription limit has been reached. Keep the recording and try again later.");
}
