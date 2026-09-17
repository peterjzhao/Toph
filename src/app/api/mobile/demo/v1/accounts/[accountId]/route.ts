import { resolveFarmContext } from "@/server/farm-context";
import { readJsonBody } from "@/server/http/body";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileDemo } from "@/server/mobile-demo/access";
import { updateMobileAccount } from "@/server/mobile-demo/accounts";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  return handleRoute(async () => {
    requireMobileDemo(request, true);
    const { accountId } = await context.params;
    const body = await readJsonBody(request, 190_000);
    return jsonResponse({ data: await updateMobileAccount(await resolveFarmContext(), accountId, body) });
  });
}
