import type { RealtimeConfigResponse } from "@/contracts/realtime";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { readRealtimeConfig } from "@/server/realtime/config";

// Environment is read per request so Vercel settings apply without a rebuild.
export const dynamic = "force-dynamic";

/**
 * GET /api/realtime: what an open dashboard needs to listen for live-update signals.
 * Public values only (project origin, publishable key, farm topic); no database access.
 * The data itself is always read through /api/dashboard and /api/workspace.
 */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const { problem, ...config } = readRealtimeConfig();
    if (problem) console.error(`[toph-api] live updates disabled: ${problem}`);
    return jsonResponse({ data: config.enabled ? config : { enabled: false } } satisfies RealtimeConfigResponse);
  });
}
