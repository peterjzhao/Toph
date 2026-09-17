import { assertAccountWrite, resolveAccountContext } from "@/server/accounts/service";
import { notFound } from "@/server/errors";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { parseUuid } from "@/server/validation/ids";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ logId: string }> }) {
  return handleRoute(async () => {
    assertAccountWrite(request);
    const ctx = await resolveAccountContext(request, "admin");
    const id = parseUuid((await context.params).logId, "logId");
    // Preserve the supplied sample's four new flags, including through repeated sample sessions.
    const rows = ctx.session.farm.isSample
      ? await ctx.sql`select id, is_new from toph.work_logs where farm_id = ${ctx.farmId} and id = ${id}`
      : await ctx.sql`update toph.work_logs set is_new = false, reviewed_by = coalesce(reviewed_by, ${ctx.account.id}::uuid), reviewed_at = coalesce(reviewed_at, now()), updated_at = case when is_new then now() else updated_at end where farm_id = ${ctx.farmId} and id = ${id} returning id, is_new`;
    if (!rows[0]) throw notFound("Log not found.");
    return jsonResponse({ data: { logId: rows[0].id, isNew: rows[0].is_new } });
  });
}
