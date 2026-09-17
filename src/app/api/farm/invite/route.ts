import { assertAccountWrite, resolveAccountContext, rotateJoinCode } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleRoute(async () => {
    assertAccountWrite(request);
    return jsonResponse({ data: { joinCode: await rotateJoinCode(await resolveAccountContext(request, "admin")) } });
  });
}
