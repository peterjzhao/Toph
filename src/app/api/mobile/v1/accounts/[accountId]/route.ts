import { resolveFarmContext } from "@/server/farm-context";
import { readJsonBody } from "@/server/http/body";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { updateMobileAccount } from "@/server/mobile/accounts";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const { accountId } = await context.params;
    const body = await readJsonBody(request, 190_000);
    return jsonResponse({ data: await updateMobileAccount(await resolveFarmContext(), accountId, body) });
  });
}
