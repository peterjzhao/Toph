import "server-only";
/**
 * Per-farm allowance for Copernicus requests.
 *
 * One atomic counter row per farm, the same shape as `reserveTranscription`, kept in its own table
 * so satellite browsing and recording transcription cannot starve each other. The OpenAI call in
 * `analysis.ts` still draws on the shared AI allowance, because that is a paid model request.
 */
import { ApiError } from "@/server/errors";
import type { FarmContext } from "@/server/farm-context";

/** Scrubbing a timeline issues many small frame requests, so the minute allowance is generous. */
const PER_MINUTE = 60;
const PER_DAY = 600;

export async function reserveSatellite(ctx: FarmContext, limitMessage = "This farm has reached its satellite imagery limit. Try again in a minute.") {
  const rows = await ctx.sql`
    insert into toph.satellite_usage (farm_id, minute_start, minute_count, day_start, day_count)
    values (${ctx.farmId}, date_trunc('minute', now()), 1, (now() at time zone 'UTC')::date, 1)
    on conflict (farm_id) do update set
      minute_start = excluded.minute_start,
      minute_count = case when satellite_usage.minute_start = excluded.minute_start then satellite_usage.minute_count + 1 else 1 end,
      day_start = excluded.day_start,
      day_count = case when satellite_usage.day_start = excluded.day_start then satellite_usage.day_count + 1 else 1 end
    where (satellite_usage.minute_start < excluded.minute_start or satellite_usage.minute_count < ${PER_MINUTE})
      and (satellite_usage.day_start < excluded.day_start or satellite_usage.day_count < ${PER_DAY})
    returning farm_id`;
  if (!rows.length) throw new ApiError(429, "RATE_LIMITED", limitMessage);
}
