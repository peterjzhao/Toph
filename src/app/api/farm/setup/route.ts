import { assertAccountWrite, resolveAccountContext } from "@/server/accounts/service";
import { getFarmSetup, saveFarmSetup } from "@/server/accounts/farm-setup";
import { readJsonBody } from "@/server/http/body";
import { handleRoute, jsonResponse } from "@/server/http/responses";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => jsonResponse({ data: await getFarmSetup(await resolveAccountContext(request, "admin")) }));
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    assertAccountWrite(request);
    const ctx = await resolveAccountContext(request, "admin");
    return jsonResponse({ data: await saveFarmSetup(ctx, await readJsonBody(request, 3_100_000)) });
  });
}
