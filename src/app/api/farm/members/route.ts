import { listFarmMembers, resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => jsonResponse({ data: await listFarmMembers(await resolveAccountContext(request, "admin")) }));
}
