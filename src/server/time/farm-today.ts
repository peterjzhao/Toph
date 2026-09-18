import "server-only";
/**
 * A farm's business "today": the demo day pinned in its Settings, otherwise the real date in the
 * farm timezone. The dashboard and Ask Toph read it; everything else keeps the real date.
 */
import { eq, sql } from "drizzle-orm";
import type { FarmContext } from "@/server/farm-context";
import { workspaceState } from "@/server/db/schema";
import { instantToLocalDate, isValidCalendarDate } from "./zoned";

export async function farmToday(ctx: FarmContext, now = new Date()): Promise<string> {
  const [row] = await ctx.db
    .select({ demoDay: sql<string | null>`${workspaceState.payload}->'settings'->>'demoDay'` })
    .from(workspaceState)
    .where(eq(workspaceState.farmId, ctx.farmId));
  return row?.demoDay && isValidCalendarDate(row.demoDay) ? row.demoDay : instantToLocalDate(now, ctx.farm.timezone);
}
