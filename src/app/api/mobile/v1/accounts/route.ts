import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { getMobileBootstrap } from "@/server/mobile/accounts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    requireMobileAccess(request);
    const ctx = await resolveAccountContext(request, "worker");
    const data = await getMobileBootstrap(ctx);
    return jsonResponse({ data: { ...data, accounts: data.accounts.filter(account => account.id === ctx.account.employeeId) } });
  });
}
