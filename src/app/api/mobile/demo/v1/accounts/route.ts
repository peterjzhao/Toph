import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileDemo } from "@/server/mobile-demo/access";
import { getMobileBootstrap } from "@/server/mobile-demo/accounts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    requireMobileDemo(request);
    return jsonResponse({ data: await getMobileBootstrap(await resolveFarmContext()) });
  });
}
