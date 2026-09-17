import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { listTags } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

/** GET /api/tags: the farm's tag catalog sorted by normalized label. */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await resolveAccountContext(request, "admin");
    return jsonResponse({ data: await listTags(ctx) });
  });
}
