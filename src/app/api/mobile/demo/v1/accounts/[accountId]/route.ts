import { PATCH as updateAccount } from "@/app/api/mobile/v1/accounts/[accountId]/route";
import { legacyBootstrap } from "@/server/mobile/legacy";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  return legacyBootstrap(await updateAccount(request, context));
}
