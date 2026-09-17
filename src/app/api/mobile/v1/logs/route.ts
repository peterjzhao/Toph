import { assertOwnEmployee, resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { listMobileLogs, readMobileSubmission, saveMobileLog } from "@/server/mobile/logs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    requireMobileAccess(request);
    const ctx = await resolveAccountContext(request, "worker");
    const accountId = new URL(request.url).searchParams.get("accountId") ?? ctx.account.employeeId!;
    assertOwnEmployee(ctx, accountId);
    return jsonResponse({ data: await listMobileLogs(ctx, accountId) });
  });
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    const { metadata, clips } = await readMobileSubmission(request);
    assertOwnEmployee(ctx, metadata.accountId);
    return jsonResponse({ data: await saveMobileLog(ctx, metadata, clips) });
  });
}
