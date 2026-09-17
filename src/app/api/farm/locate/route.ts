import { resolveAccountContext } from "@/server/accounts/service";
import { approximateLocation } from "@/server/accounts/farm-imagery";
import { handleRoute, jsonResponse } from "@/server/http/responses";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    await resolveAccountContext(request, "admin");
    return jsonResponse({ data: approximateLocation(request.headers) });
  });
}
