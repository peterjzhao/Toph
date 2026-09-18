import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute } from "@/server/http/responses";
import { fieldTimeline } from "@/server/satellite/service";
import { instantToLocalDate } from "@/server/time/zoned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fields/timeline
 *
 * Every usable Sentinel-2 pass over the signed-in admin's farm, for the map's date slider. `extent`
 * is null when the farm's map has no location yet, and the map page then shows only its saved aerial.
 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await resolveAccountContext(request, "admin");
    const data = await fieldTimeline(ctx, { today: instantToLocalDate(new Date(), ctx.farm.timezone) });
    // Farm-private, and a new pass arrives every few days.
    return Response.json({ data }, { headers: { "Cache-Control": "private, max-age=1800" } });
  });
}
