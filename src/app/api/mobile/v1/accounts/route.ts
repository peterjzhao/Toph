import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { getMobileBootstrap } from "@/server/mobile/accounts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    requireMobileAccess(request);
    return jsonResponse({ data: await getMobileBootstrap(await resolveFarmContext()) });
  });
}
