import { resolveAccountContext } from "@/server/accounts/service";
import { validationError } from "@/server/errors";
import { satelliteRoute } from "@/server/satellite/http";
import { fieldTimeline } from "@/server/satellite/service";
import { instantToLocalDate } from "@/server/time/zoned";
import { isUuid } from "@/server/validation/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fields/timeline?field=<uuid>&month=YYYY-MM
 *
 * The scrubber's stops for the signed-in admin's farm. `extent` is null when the farm's map has no
 * location yet, and the map page then shows only its saved raster.
 */
export async function GET(request: Request): Promise<Response> {
  return satelliteRoute(async () => {
    const ctx = await resolveAccountContext(request, "admin");
    const params = new URL(request.url).searchParams;
    const fieldId = params.get("field");
    const month = params.get("month");
    if (fieldId !== null && !isUuid(fieldId)) throw validationError("Choose a field on this farm.");
    if (month !== null && !/^\d{4}-\d{2}$/.test(month)) throw validationError("Choose a month as YYYY-MM.");
    const data = await fieldTimeline(ctx, {
      fieldId: fieldId ?? undefined,
      month: month ?? undefined,
      today: instantToLocalDate(new Date(), ctx.farm.timezone),
    });
    // Farm-private, and a new pass arrives every few days.
    return Response.json({ data }, { headers: { "Cache-Control": "private, max-age=1800" } });
  });
}
