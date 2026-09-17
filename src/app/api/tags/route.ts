import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { listTags } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

/** GET /api/tags: the farm's tag catalog sorted by normalized label. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await resolveFarmContext();
    return jsonResponse({ data: await listTags(ctx) });
  });
}
