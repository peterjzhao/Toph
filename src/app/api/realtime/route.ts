import type { RealtimeConfigResponse } from "@/contracts/realtime";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { readRealtimeConfig } from "@/server/realtime/config";
import { resolveAccountContext } from "@/server/accounts/service";

// Environment is read per request so Vercel settings apply without a rebuild.
export const dynamic = "force-dynamic";

/**
 * GET /api/realtime: what an open dashboard needs to listen for live-update signals.
 * Public values only (project origin, publishable key, farm topic); no database access.
 * The data itself is always read through /api/dashboard and /api/workspace.
 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await resolveAccountContext(request, "admin");
    if (!ctx.session.farm.isDemo) return jsonResponse({ data: { enabled: false } } satisfies RealtimeConfigResponse);
    const { problem, ...config } = readRealtimeConfig({ ...process.env, TOPH_FARM_ID: ctx.farmId });
    if (problem) console.error(`[toph-api] live updates disabled: ${problem}`);
    return jsonResponse({ data: config.enabled ? config : { enabled: false } } satisfies RealtimeConfigResponse);
  });
}
