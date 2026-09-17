import { assertOwnEmployee, resolveAccountContext } from "@/server/accounts/service";
import { readJsonBody } from "@/server/http/body";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { updateMobileAccount } from "@/server/mobile/accounts";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const { accountId } = await context.params;
    const ctx = await resolveAccountContext(request, "worker");
    assertOwnEmployee(ctx, accountId);
    const body = await readJsonBody(request, 190_000);
    const data = await updateMobileAccount(ctx, accountId, body);
    return jsonResponse({ data: { ...data, accounts: data.accounts.filter(account => account.id === ctx.account.employeeId) } });
  });
}
